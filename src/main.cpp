#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "LSM6DSO.h"
#include "nvs_flash.h"
#include <sys/param.h>
#include "freertos/ringbuf.h"

// WIFI UND SERVER INCLUDES
#include "esp_vfs.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include <lwip/ip4_addr.h>
#define HTTPD_WS_SUPPORT
#include "esp_http_server.h"
#include "esp_timer.h"
#include "esp_private/esp_clk.h"

#include "esp_littlefs.h"
#include <dirent.h> // LITTLEFS für Dateisystemoperationen
#include "esp_task_wdt.h"
#include "esp_freertos_hooks.h"
//#include "protocol_examples_common.h"
#include "lwip/sockets.h"
#include "keep_alive.h"
#include "freertos/stream_buffer.h"

#include "esp_flash.h"
#include "esp_system.h"
#include "esp_spi_flash.h" // Required for spi_flash_get_chip_size()
#include "esp_heap_caps.h"
#include "esp_psram.h"
#include "esp_log.h"
#include "driver/temp_sensor.h"
#include "cJSON.h"
#ifdef CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
#include "freertos/FreeRTOSConfig.h"
#endif

// PUFFER SETTINGS
#define PACKET_SIZE      7
#define RINGBUF_PACKETS  1024
#define RINGBUF_SIZE     (PACKET_SIZE * RINGBUF_PACKETS)


#define STREAMBUFFER_SIZE 4096*16      // z.B. Platz für >500 Samples (7 Byte/Sample)
#define STREAM_TRIGGER_LEVEL 7      // Minimum: 1 gesamter Sample-Frame


#define MEMP_NUM_TCP_PCB 5       // Standard: 4
#define MEMP_NUM_TCP_SEG 32      // Standard: 16
#define PBUF_POOL_SIZE 16        // Standard: 8

// CONFIG IDS

// Config-IDs ab 100
#define CFG_ID_ACCELSAMPLERATE   100
#define CFG_ID_ACCELRANGE        101
#define CFG_ID_ACCELFILTER       102

#define CFG_ID_GYROSAMPLERATE    103
#define CFG_ID_GYRORANGE         104
#define CFG_ID_GYROFILTER        105

#define CFG_ID_TEMPSAMPLERATE    106
#define CFG_ID_FRQFINE           107


// 7-Byte-Paketstruktur für Config
typedef struct __attribute__((packed)) {
    uint8_t id;      // 1 Byte: ID
    uint8_t data[6]; // 6 Byte: Wert(e) oder Padding
} ConfigPacket7B;

StreamBufferHandle_t sensorStream;


void send_config_value(uint8_t subId, uint16_t value) {
    uint8_t buf[7];

    // Byte 0: Haupt-Tag (Bits 3–7 = 30, Bits 0–2 = Flags=0)
    buf[0] = (30 << 3);

    // Byte 1: Sub-ID (z.B. 100, 101, 102 -> beliebig groß, kompletter Bytewert)
    buf[1] = subId;

    // Byte 2+3: 16-Bit Wert (Little Endian)
    buf[2] = value & 0xFF;
    buf[3] = (value >> 8) & 0xFF;

    // Rest auffüllen
    buf[4] = 0;
    buf[5] = 0;
    buf[6] = 0;

    // Versenden
    xStreamBufferSend(sensorStream, buf, sizeof(buf), 0);

    ESP_LOGI("CONFIGSEND", "Config sent: mainTag=30 subId=%u value=%u", subId, value);
}



// SPI SETTINGS
#define CS_PIN     4
#define SCK_PIN    7
#define MISO_PIN   8
#define MOSI_PIN   9
#define SPI_SPEED  5000000



typedef struct {
    uint16_t accelDataRate;
    uint16_t gyroDataRate;
    uint16_t accelRange;
    uint16_t gyroRange;
    uint16_t accelFilter;
    uint16_t gyroFilter;
    uint16_t tempSampleRate;
    // weitere Parameter nach Bedarf
} imu_config_t;

static imu_config_t pendingConfig = {
    .accelDataRate = 833,
    .gyroDataRate = 833,
    .accelRange = 4,
    .gyroRange = 500,
    .accelFilter = 1,
    .gyroFilter = 1,
    .tempSampleRate = 1
};
static volatile bool imuConfigChanged = false;

static uint16_t normalize_odr_value(float rate) {
    if (rate < 0.8f) return 0;
    if (rate < 8.0f) return 16;
    if (rate < 19.0f) return 125;
    if (rate < 39.0f) return 26;
    if (rate < 78.0f) return 52;
    if (rate < 156.0f) return 104;
    if (rate < 312.0f) return 208;
    if (rate < 624.0f) return 416;
    if (rate < 1246.0f) return 833;
    if (rate < 2495.0f) return 1660;
    if (rate < 4995.0f) return 3330;
    return 6660;
}

static uint16_t parse_rate_config_value(const cJSON *item) {
    if (cJSON_IsNumber(item)) {
        const double raw = item->valuedouble;
        if (raw > 0.0 && raw < 20.0) {
            return (uint16_t)lround(raw * 10.0);
        }
        return (uint16_t)lround(raw);
    }

    if (cJSON_IsString(item) && item->valuestring) {
        const double raw = atof(item->valuestring);
        if (raw > 0.0 && raw < 20.0) {
            return (uint16_t)lround(raw * 10.0);
        }
        return (uint16_t)lround(raw);
    }

    return 0;
}





float AccelMulti    = 0;
float FREQ_FINE     = 25;

static const char *TAG = "app";
static const char *WIFI_TAG = "wifi_ap";

RingbufHandle_t sensor_ringbuf = NULL;

// WebServer & WebSocket globals
httpd_handle_t server = NULL;
httpd_handle_t ws_server = NULL;

#define MAX_CLIENTS 8
int ws_clients[MAX_CLIENTS];
TickType_t ws_last_pong[MAX_CLIENTS];

// IMU device
spi_device_handle_t spiDevice;
LSM6DSO imu;

// Forward declarations
esp_err_t websocket_handler(httpd_req_t *req);
void ws_keepalive_task(void *arg);
void sensor_task(void *arg);
void ws_net_task(void *arg);

////////////////////////////////////////////////////////////////////////////////
// SPI INITIALISIERUNG

esp_err_t spi_bus_init() {
    spi_bus_config_t buscfg = {
        .mosi_io_num = MOSI_PIN,
        .miso_io_num = MISO_PIN,
        .sclk_io_num = SCK_PIN,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .data_io_default_level = 0,
    };
    return spi_bus_initialize(SPI3_HOST, &buscfg, SPI_DMA_CH_AUTO);
}

esp_err_t spi_device_init() {
    spi_device_interface_config_t devcfg = {};
    devcfg.clock_speed_hz = SPI_SPEED;
    devcfg.mode = 0;
    devcfg.spics_io_num = CS_PIN;
    devcfg.queue_size = 1;
    return spi_bus_add_device(SPI3_HOST, &devcfg, &spiDevice);
}

////////////////////////////////////////////////////////////////////////////////
// LITTLEFS MOUNTEN & DATEIEN AUFLISTEN

static esp_err_t mount_littlefs(void) {
    esp_vfs_littlefs_conf_t conf = {
        .base_path = "/littlefs",
        .partition_label = "littlefs",
        .format_if_mount_failed = true,
        .grow_on_mount = false,
    };
    esp_err_t ret = esp_vfs_littlefs_register(&conf);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "LittleFS mount failed: %s", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG, "LittleFS mounted");
    }
    return ret;
}

static void list_files(const char* path) {
    DIR *dir = opendir(path);
    if (!dir) {
        ESP_LOGE(TAG, "Failed to open directory: %s", path);
        return;
    }
    ESP_LOGI(TAG, "Listing directory: %s", path);

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_type == DT_DIR) {
            ESP_LOGI(TAG, "DIR  : %s", entry->d_name);
        } else {
            ESP_LOGI(TAG, "FILE : %s", entry->d_name);
        }
    }
    closedir(dir);
}

////////////////////////////////////////////////////////////////////////////////
// WIFI CONFIG PARSEN (EINFACHE .INI PARSE)

typedef struct {
    char ssid[32];
    char password[64];
    int  channel;
    char ip[16];
    char gateway[16];
    char netmask[16];
} my_wifi_config_t;

bool read_wifi_config(const char* filepath, my_wifi_config_t* config) {
    FILE *f = fopen(filepath, "r");
    if (!f) {
        ESP_LOGE(TAG, "Failed to open WiFi config file at %s", filepath);
        return false;
    }

    memset(config, 0, sizeof(my_wifi_config_t));
    config->channel = 1;
    strcpy(config->ip, "192.168.4.1");
    strcpy(config->gateway, "192.168.4.1");
    strcpy(config->netmask, "255.255.255.0");

    char line[128];
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = 0;
        if (strncmp(line, "ssid=", 5) == 0) {
            strncpy(config->ssid, line + 5, sizeof(config->ssid) - 1);
        } else if (strncmp(line, "password=", 9) == 0) {
            strncpy(config->password, line + 9, sizeof(config->password) - 1);
        } else if (strncmp(line, "channel=", 8) == 0) {
            config->channel = atoi(line + 8);
        } else if (strncmp(line, "ip=", 3) == 0) {
            strncpy(config->ip, line + 3, sizeof(config->ip) - 1);
        } else if (strncmp(line, "gateway=", 8) == 0) {
            strncpy(config->gateway, line + 8, sizeof(config->gateway) - 1);
        } else if (strncmp(line, "netmask=", 8) == 0) {
            strncpy(config->netmask, line + 8, sizeof(config->netmask) - 1);
        }
    }
    fclose(f);

    if (strlen(config->ssid) == 0) {
        ESP_LOGE(TAG, "SSID not found in config");
        return false;
    }
    return true;
}

////////////////////////////////////////////////////////////////////////////////
// WIFI AP INITIALISIERUNG

static void wifi_init_ap(const my_wifi_config_t *config) {
    esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap();

    wifi_config_t wifi_config = {
        .ap = {
            .ssid = {0},
            .password = {0},
            .ssid_len = 0,
            .channel = 1,
            .authmode = WIFI_AUTH_OPEN,
            .ssid_hidden = 0,
            .max_connection = 4,
            .beacon_interval = 50,
        }
    };

    wifi_config.ap.max_connection = 4; // Auf 4 erhöhen (Maximum)
    esp_wifi_set_protocol(WIFI_IF_AP, WIFI_PROTOCOL_11B|WIFI_PROTOCOL_11G); // Nur 2.4GHz

    esp_netif_ip_info_t ip_info;
    ip4addr_aton(config->ip, (ip4_addr_t*)&ip_info.ip);
    ip4addr_aton(config->gateway, (ip4_addr_t*)&ip_info.gw);
    ip4addr_aton(config->netmask, (ip4_addr_t*)&ip_info.netmask);

    esp_netif_dhcps_stop(ap_netif);
    esp_netif_set_ip_info(ap_netif, &ip_info);
    esp_netif_dhcps_start(ap_netif);


//NEU
ip4_addr_t dns_addr;
IP4_ADDR(&dns_addr, 192, 168, 4, 1);   // AP selbst als DNS
esp_netif_dhcps_option(ap_netif,
                       ESP_NETIF_OP_SET,
                       ESP_NETIF_DOMAIN_NAME_SERVER,
                       &dns_addr, sizeof(dns_addr));

esp_netif_dhcps_option(
    ap_netif, 
    ESP_NETIF_OP_SET,
    ESP_NETIF_DOMAIN_NAME_SERVER,
    &dns_addr, // DNS
    sizeof(ip_addr_t)
);
uint32_t lease_time = 60;
esp_netif_dhcps_option(
    ap_netif,
    ESP_NETIF_OP_SET,
    ESP_NETIF_REQUESTED_IP_ADDRESS,
    &lease_time, // 60s Lease-Time
    sizeof(uint32_t)
);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));

    strncpy((char*)wifi_config.ap.ssid, config->ssid, sizeof(wifi_config.ap.ssid));
    strncpy((char*)wifi_config.ap.password, config->password, sizeof(wifi_config.ap.password));
    wifi_config.ap.channel = config->channel;

    if (strlen(config->password) >= 8) {
        wifi_config.ap.authmode = WIFI_AUTH_WPA_WPA2_PSK;
    } else {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    int8_t max_tx_power;
    esp_wifi_get_max_tx_power(&max_tx_power);
    printf("Aktuelle maximale TX Power: %d dBm\n", max_tx_power);

    esp_err_t ret = esp_wifi_set_max_tx_power(84); // 84 entspricht 20 dBm
    if (ret != ESP_OK) {
        printf("Fehler beim Setzen der TX Power: %s\n", esp_err_to_name(ret));
    }

    esp_wifi_get_max_tx_power(&max_tx_power);
    printf("Aktuelle maximale TX Power: %d dBm\n", max_tx_power);
}

////////////////////////////////////////////////////////////////////////////////
// HTTP SERVER STATIC FILE HANDLER

#define FILE_CHUNK_SIZE 1024*10  // 1 KB pro Chunk
esp_err_t http_serve_static_file(httpd_req_t *req) {
    char filepath[1024];
    const char* base_path = "/littlefs";

    // Pfad zusammensetzen
    if (strcmp(req->uri, "/") == 0) {
        snprintf(filepath, sizeof(filepath), "%s/index.html", base_path);
    } else {
        snprintf(filepath, sizeof(filepath), "%s%s", base_path, req->uri);
    }

    FILE *f = fopen(filepath, "rb");
    if (!f) {
        ESP_LOGE("HTTP", "File not found: %s", filepath);
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "File not found");
        return ESP_FAIL;
    }

    // MIME-Type setzen
    const char *ext = strrchr(filepath, '.');
    if (ext) {
        if (strcasecmp(ext, ".css") == 0) {
            httpd_resp_set_type(req, "text/css");
        } else if (strcasecmp(ext, ".js") == 0) {
            httpd_resp_set_type(req, "application/javascript");
        } else if (strcasecmp(ext, ".svg") == 0) {
            httpd_resp_set_type(req, "image/svg+xml");
        } else if (strcasecmp(ext, ".html") == 0) {
            httpd_resp_set_type(req, "text/html");
        }
    }

    // Chunk-Puffer im PSRAM allokieren, wenn vorhanden
    char *chunk = (char *) heap_caps_malloc(FILE_CHUNK_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!chunk) {
        // Fallback: normaler RAM
        chunk = (char *) malloc(FILE_CHUNK_SIZE);
    }

    if (!chunk) {
        fclose(f);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Memory allocation failed");
        return ESP_FAIL;
    }

    size_t read_bytes;
    while ((read_bytes = fread(chunk, 1, FILE_CHUNK_SIZE, f)) > 0) {
        if (httpd_resp_send_chunk(req, chunk, read_bytes) != ESP_OK) {
            free(chunk);
            fclose(f);
            return ESP_FAIL;
        }
    }

    // Transfer beenden
    httpd_resp_send_chunk(req, NULL, 0);

    free(chunk);
    fclose(f);

    return ESP_OK;
}



////////////////////////////////////////////////////////////////////////////////
// HTTP(S) SERVER START

void start_http_server() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();

    // Priorität erhöhen
    config.task_priority = 5;  // z.B. Priorität 5 (Standard oft 3)


// Optional: Task-Stack-Größe ggf. anpassen

    config.stack_size = 8192*2;  // Beispielwert, an deinen Bedarf anpassen
    config.max_open_sockets = 4;     // Standard: 3
    config.backlog_conn = 2;         // Standard: 1
    config.lru_purge_enable = true;  // Alte Verbindungen bereinigen
    config.max_uri_handlers = 25;
    config.uri_match_fn = httpd_uri_match_wildcard;

    if (httpd_start(&server, &config) == ESP_OK) {
        // Root-Handler
        httpd_uri_t root = {
            .uri = "/",
            .method = HTTP_GET,
            .handler = http_serve_static_file,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(server, &root);

        // WebSocket Handler
        httpd_uri_t ws_uri = {
            .uri = "/ws",
            .method = HTTP_GET,
            .handler = websocket_handler,
            .user_ctx = NULL,
            .is_websocket = true,
            .handle_ws_control_frames = false,
            
            
        };
        httpd_register_uri_handler(server, &ws_uri);

        // Wildcard für andere Dateien
        httpd_uri_t wildcard = {
            .uri = "/*",
            .method = HTTP_GET,
            .handler = http_serve_static_file,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(server, &wildcard);

        ws_server = server;  // global für ws senden

        ESP_LOGI("HTTP", "HTTP Server & WebSocket gestartet");
    }
}

////////////////////////////////////////////////////////////////////////////////
// WS CLIENT-LISTE INITIALISIERUNG

void init_ws_clients(void) {
    for (int i = 0; i < MAX_CLIENTS; i++) {
        ws_clients[i] = -1;
        ws_last_pong[i] = 0;
    }
}

////////////////////////////////////////////////////////////////////////////////
// WEBSOCKET HANDLER (robust, mit Duplikat-Schutz und EAGAIN handling)


#define ESP_ERR_HTTPD_WS_CLIENT_DISCONNECTED  (ESP_ERR_HTTPD_BASE - 1)
// ===== Der WebSocket-Handler =====
esp_err_t websocket_handler(httpd_req_t *req)
{
    int fd = httpd_req_to_sockfd(req);

    // ----------- Handshake / Connect ------------
    if (req->method == HTTP_GET) {
            ESP_LOGI("WS", "Handshake done, FD %d connected", fd);
             ESP_LOGI("WS", "Vor Neuaufnahme: ws_clients: %d %d %d %d %d %d %d %d",
             ws_clients[0], ws_clients[1], ws_clients[2], ws_clients[3],
             ws_clients[4], ws_clients[5], ws_clients[6], ws_clients[7]); // LOG

        // in Liste eintragen, falls nicht vorhanden
        bool already_in_list = false;
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (ws_clients[i] == fd) { already_in_list = true; break; }
        }
        if (!already_in_list) {
            for (int i = 0; i < MAX_CLIENTS; i++) {
                if (ws_clients[i] == -1) {
                    ws_clients[i] = fd;
                    ws_last_pong[i] = xTaskGetTickCount();
                    break;
                }
            }
        }

        // aktuelle Config an neu Verbundenen schicken
                send_config_value(CFG_ID_ACCELSAMPLERATE , pendingConfig.accelDataRate);
                send_config_value(CFG_ID_ACCELRANGE, pendingConfig.accelRange);
                send_config_value(CFG_ID_ACCELFILTER, pendingConfig.accelFilter);
                send_config_value(CFG_ID_GYRORANGE, pendingConfig.gyroRange);
                send_config_value(CFG_ID_GYROSAMPLERATE, pendingConfig.gyroDataRate);
                send_config_value(CFG_ID_GYROFILTER, pendingConfig.gyroFilter);
                send_config_value(CFG_ID_TEMPSAMPLERATE, pendingConfig.tempSampleRate);
        return ESP_OK;
    }

    // ----------- Frame vorbereiten / Länge abrufen ------------
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(ws_pkt));
    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) return ret;

    // ----------- Payload vorhanden? ------------
    if (ws_pkt.len > 0) {
        uint8_t *buf = (uint8_t *)calloc(1, ws_pkt.len + 1);
        if (!buf) return ESP_ERR_NO_MEM;
        ws_pkt.payload = buf;

        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret == ESP_OK) {
            // ------ TEXT: JSON Verarbeiten ------
            if (ws_pkt.type == HTTPD_WS_TYPE_TEXT) {
                             
                if (strcmp((char*)buf, "ping") == 0) {
                    // Spezialfall: Client hat "ping" als Text gesendet
                    ESP_LOGI("WS", "Text-Ping empfangen, sende Pong als Text");
                    // Entweder sende "pong" zurück als Text-Frame oder ignoriere
                    char pong_msg[] = "pong";
                    httpd_ws_frame_t pong_frame = {
                        .final = true,
                        .type = HTTPD_WS_TYPE_TEXT,
                        .payload = (uint8_t*)pong_msg,
                        .len = strlen(pong_msg)
                    };
                    httpd_ws_send_frame(req, &pong_frame);
                } else {
                                             
                cJSON *root = cJSON_Parse((char*)buf);
                if (root) {
                    cJSON *item = NULL;
                    cJSON_ArrayForEach(item, root) {
                        const char *key = item->string;

                        if (strcmp(key, "ACCELSAMPLERATE") == 0) {
                            uint16_t rate = parse_rate_config_value(item);
                            pendingConfig.accelDataRate = rate;
                    
                              imuConfigChanged = true;
                            send_config_value(CFG_ID_ACCELSAMPLERATE, rate);
                        }
                        else if (strcmp(key, "ACCELRANGE") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.accelRange = range;
                            imuConfigChanged = true;
                            send_config_value(CFG_ID_ACCELRANGE, range);
                        }
                        else if (strcmp(key, "ACCELFILTER") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.accelFilter = range;
                            imuConfigChanged = true;
                            send_config_value(CFG_ID_ACCELFILTER, range);
                        }
                        else if (strcmp(key, "GYROSAMPLERATE") == 0) {
                            uint16_t range = parse_rate_config_value(item);
                            pendingConfig.gyroDataRate = range;
                            imuConfigChanged = true;
                            send_config_value(CFG_ID_GYROSAMPLERATE, range);
                        }
                        else if (strcmp(key, "GYRORANGE") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.gyroRange = range;
                            imuConfigChanged = true;
                            send_config_value(CFG_ID_GYRORANGE, range);
                        }
                        else if (strcmp(key, "GYROFILTER") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.gyroFilter = range;
                            imuConfigChanged = true;
                            send_config_value(CFG_ID_GYROFILTER, range);
                        }
                        else if (strcmp(key, "TEMPSAMPLERATE") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.tempSampleRate = range;
                            imuConfigChanged = true;
                            send_config_value(CFG_ID_TEMPSAMPLERATE, range);
                        }
                        else {
                            ESP_LOGW("WS", "Unbekannter Key im JSON: %s", key);
                        }
                    }
                    cJSON_Delete(root);
                } else {
                    ESP_LOGW("WS", "Fehler: Ungültiges JSON empfangen");
                }
            }}

            // ------ BINARY ------
            else if (ws_pkt.type == HTTPD_WS_TYPE_BINARY) {
                ESP_LOGI("WS", "Binary Frame von FD %d (%d Bytes)", fd, ws_pkt.len);
            }

            // ------ PING ------
            else if (ws_pkt.type == HTTPD_WS_TYPE_PING) {
                httpd_ws_frame_t pong_pkt = {
                    .final = true,
                    .type  = HTTPD_WS_TYPE_PONG,
                    .payload = NULL,
                    .len = 0
                };
                httpd_ws_send_frame(req, &pong_pkt);
            }

            // ------ PONG ------
            else if (ws_pkt.type == HTTPD_WS_TYPE_PONG) {
                for (int i = 0; i < MAX_CLIENTS; i++) {
                    if (ws_clients[i] == fd) {
                        ws_last_pong[i] = xTaskGetTickCount();
                        break;
                    }
                }
            }

            // ------ CLOSE ------
            else if (ws_pkt.type == HTTPD_WS_TYPE_CLOSE) {
                ESP_LOGI("WS", "CLOSE von FD %d – entferne aus Liste", fd);
                for (int i = 0; i < MAX_CLIENTS; i++) {
                    if (ws_clients[i] == fd) {
                        ws_clients[i] = -1;
                        ESP_LOGI("WS", "Nach Entfernen: ws_clients: %d %d %d %d %d %d %d %d",
                                ws_clients[0], ws_clients[1], ws_clients[2], ws_clients[3],
                                ws_clients[4], ws_clients[5], ws_clients[6], ws_clients[7]); // LOG
                        break;
                    }
                }
            }

        } else {
            ESP_LOGW("WS", "Fehler beim Empfang: %s", esp_err_to_name(ret));
        }

        free(buf);
    }

    return ESP_OK;
}


////////////////////////////////////////////////////////////////////////////////
// Keepalive Task: Ping senden, Timeout prüfen und Clients entfernen

void ws_keepalive_task(void *arg) {
    const TickType_t ping_interval = pdMS_TO_TICKS(20000); // 20s
    const TickType_t pong_timeout  = pdMS_TO_TICKS(40000); // 40s

    while (1) {
        TickType_t now = xTaskGetTickCount();
        for (int i = 0; i < MAX_CLIENTS; i++) {
            int fd = ws_clients[i];
            if (fd < 0) continue;

            httpd_ws_frame_t ping_pkt = {
                .final = true,
                .fragmented = false,
                .type = HTTPD_WS_TYPE_PING,
                .payload = NULL,
                .len = 0
            };

            if (httpd_ws_send_frame_async(ws_server, fd, &ping_pkt) != ESP_OK) {
                ESP_LOGW("WS_Keepalive", "PING an FD %d fehlgeschlagen, entferne Client", fd);
                ws_clients[i] = -1;
                continue;
            }

            if ((now - ws_last_pong[i]) > pong_timeout) {
                ESP_LOGW("WS_Keepalive", "FD %d hat Timeout überschritten, entferne Client", fd);
                ws_clients[i] = -1;
            }
        }
        vTaskDelay(ping_interval);
    }
}

////////////////////////////////////////////////////////////////////////////////
// Ringbuffer Init

void init_ringbuffer() {
    sensor_ringbuf = xRingbufferCreate(RINGBUF_SIZE, RINGBUF_TYPE_NOSPLIT);
    assert(sensor_ringbuf != NULL);

}

////////////////////////////////////////////////////////////////////////////////
// IMU INIT

void readIMUparameters() {

AccelMulti = imu.getAccelMultiplier();
ESP_LOGE("IMU", "AccelMulti: %f", AccelMulti);

FREQ_FINE = imu.getLSBSTEP(); // in µs
ESP_LOGE("IMU", "FREQ_FINE: %f", FREQ_FINE); 





}

void initIMU() {
    esp_err_t ret = spi_bus_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI Bus Init failed: %s", esp_err_to_name(ret));
        return;
    }
    ret = spi_device_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI Device Init failed: %s", esp_err_to_name(ret));
        return;
    }

    if (imu.beginSPICore(CS_PIN, SPI_SPEED, spiDevice) != IMU_SUCCESS) {
        ESP_LOGE(TAG, "IMU init failed");
        return;
    }

    uint8_t whoami = 0;
    if (imu.readRegister(&whoami, 0x0F) == IMU_SUCCESS) {
        ESP_LOGI(TAG, "LSM6DSO WHO_AM_I: 0x%02X", whoami);
    } else {
        ESP_LOGE(TAG, "Failed to read WHO_AM_I");
    }

    if (imu.initialize(BASIC_SETTINGS)) {
        ESP_LOGI(TAG, "IMU initialized successfully");
    } else {
        ESP_LOGE(TAG, "IMU initialization failed");
    }

    imu.setIncrement();
    imu.setFifoDepth(3000);
    imu.setAccelBatchDataRate(pendingConfig.accelDataRate);
    imu.setGyroBatchDataRate(pendingConfig.gyroDataRate);
    imu.initialize(FIFO_SETTINGS);
    imu.setAccelRange(pendingConfig.accelRange);
    imu.setAccelDataRate(pendingConfig.accelDataRate);
    imu.setGyroRange(pendingConfig.gyroRange);
    imu.setGyroDataRate(pendingConfig.gyroDataRate);
    imu.setAccelBatchDataRate(pendingConfig.accelDataRate);
    imu.setGyroBatchDataRate(pendingConfig.gyroDataRate);

    uint8_t fifoCtrl4;
    if (imu.readRegister(&fifoCtrl4, FIFO_CTRL4) == IMU_SUCCESS) {
        ESP_LOGI(TAG, "fifoctrl 4 (vor write): 0x%02X", fifoCtrl4);
    } else {
        ESP_LOGW(TAG, "Fehler beim Lesen von FIFO_CTRL4");
    }

    if (imu.writeRegister(FIFO_CTRL4, 0x46) == IMU_SUCCESS) {
        if (imu.readRegister(&fifoCtrl4, FIFO_CTRL4) == IMU_SUCCESS) {
            ESP_LOGI(TAG, "fifoctrl 4 (nach write): 0x%02X", fifoCtrl4);
        } else {
            ESP_LOGW(TAG, "Fehler beim Lesen von FIFO_CTRL4 nach write");
        }
    } else {
        ESP_LOGW(TAG, "Fehler beim Schreiben von FIFO_CTRL4");
    }

    float fine_res_us = imu.imuSettings.LSBSTEP * 1000000.0f;
    ESP_LOGI(TAG, "INTERNAL_FREQ_FINE: %.6f µs", fine_res_us);

    uint8_t regValue;
    imu.readRegister(&regValue, CTRL10_C);
    regValue |= (1 << 5);
    imu.writeRegister(CTRL10_C, regValue);
    imu.setBlockDataUpdate(1);
    imu.setTSdecimation(32);
    imu.setTempSamplingRate(1);


    

    readIMUparameters();

    ESP_LOGI(TAG, "IMU initialized and ready"); 
}






////////////////////////////////////////////////////////////////////////////////
void sensor_task(void* pvParameters) {
    constexpr uint16_t maxFifoBlock = 126*15; // Puffergröße für Burst
    uint8_t* fifoBuf = (uint8_t*)heap_caps_malloc(maxFifoBlock, MALLOC_CAP_DMA);
    TickType_t last_overflow_log = 0;

    if (!fifoBuf) {
        ESP_LOGE(TAG, "Memory Allocation Failed!");
        vTaskDelete(NULL);
    }

    esp_task_wdt_add(NULL);

    while (1) {
        esp_task_wdt_reset();

    if (imuConfigChanged) {
        imuConfigChanged = false; // Flag zurücksetzen
        
        // ACCELSETTINGS
        imu.setAccelDataRate(pendingConfig.accelDataRate);
        imu.setAccelBatchDataRate(pendingConfig.accelDataRate);
        imu.setAccelRange(pendingConfig.accelRange);
        // GYRO SETTINGS
        imu.setGyroRange(pendingConfig.gyroRange);
        imu.setGyroDataRate(pendingConfig.gyroDataRate);
        imu.setGyroBatchDataRate(pendingConfig.gyroDataRate);
        // TEMP SETTINGS
        imu.setTempSamplingRate(pendingConfig.tempSampleRate);


        printf("GYRORANGE: %u\n", imu.getGyroRange());


        pendingConfig.accelDataRate = normalize_odr_value(imu.getAccelDataRate());
        pendingConfig.gyroDataRate = normalize_odr_value(imu.getGyroDataRate());
       



        ESP_LOGI(TAG, "IMU-Konfiguration angewendet: ACCEL_DR=%u, ACCEL_RANGE=%u, GYRO_RANGE=%u",
                 pendingConfig.accelDataRate,
                 pendingConfig.accelRange,
                 pendingConfig.gyroRange);

                send_config_value(CFG_ID_ACCELSAMPLERATE , pendingConfig.accelDataRate);
                send_config_value(CFG_ID_ACCELRANGE, pendingConfig.accelRange);
                send_config_value(CFG_ID_ACCELFILTER, pendingConfig.accelFilter);
                send_config_value(CFG_ID_GYRORANGE, pendingConfig.gyroRange);
                send_config_value(CFG_ID_GYROSAMPLERATE, pendingConfig.gyroDataRate);
                send_config_value(CFG_ID_GYROFILTER, pendingConfig.gyroFilter);
                send_config_value(CFG_ID_TEMPSAMPLERATE, pendingConfig.tempSampleRate);


    }

   // Hier können weitere Konfigurationen hinzugefügt werden




        int available = imu.getFifoStatus();
        while (available >= 7) {
            uint16_t burst = (available / 7) * 7;
            if (burst > maxFifoBlock) burst = (maxFifoBlock / 7) * 7;

            status_t rc = imu.fifoburstRead(fifoBuf, burst);
            if (rc != IMU_SUCCESS) {
                ESP_LOGE(TAG, "FIFO Burst-Read failed!");
                break;
            }

            size_t sent = xStreamBufferSend(sensorStream, fifoBuf, burst, pdMS_TO_TICKS(2));
            if (sent < burst) {
                TickType_t now = xTaskGetTickCount();
                if ((now - last_overflow_log) >= pdMS_TO_TICKS(1000)) {
                    ESP_LOGW(TAG, "StreamBuffer overflow/backpressure: %d Bytes verloren.", (burst - sent));
                    last_overflow_log = now;
                }

                if (sent == 0) {
                    vTaskDelay(pdMS_TO_TICKS(2));
                }

                // Nicht weiter aus der IMU-FIFO ziehen, wenn der StreamBuffer bereits voll läuft.
                break;
            }
            available -= burst;
        }

        vTaskDelay(pdMS_TO_TICKS(4));
    }

    heap_caps_free(fifoBuf);
    vTaskDelete(NULL);
}


////////////////////////////////////////////////////////////////////////////////
// WS NET TASK: Pakete sammeln und an alle WebSocket Clients senden

#define MAX_PACKETS_PER_FRAME 512
#define MAX_FRAME_SIZE (PACKET_SIZE * MAX_PACKETS_PER_FRAME)

void ws_net_task(void *arg) {
    uint8_t send_buffer[MAX_FRAME_SIZE];
    esp_task_wdt_add(NULL);
    ESP_LOGI(TAG, "WEBSOCKET TASK - READY");

    while (1) {
        size_t total_bytes = 0;

        while (total_bytes + PACKET_SIZE <= MAX_FRAME_SIZE) {
            size_t bytes_read = xStreamBufferReceive(sensorStream,
                                                     send_buffer + total_bytes,
                                                     PACKET_SIZE,
                                                     pdMS_TO_TICKS(1));
            if (bytes_read != PACKET_SIZE) {
                // Nicht genug Daten für weiteres Paket
                break;
            }
            total_bytes += PACKET_SIZE;
        }

        if (total_bytes > 0) {
            httpd_ws_frame_t frame = {
                .final = true,
                .type = HTTPD_WS_TYPE_BINARY,
                .payload = send_buffer,
                .len = total_bytes
            };

            for (int i = 0; i < MAX_CLIENTS; i++) {
                if (ws_clients[i] >= 0) {
                    esp_err_t res = httpd_ws_send_frame_async(ws_server, ws_clients[i], &frame);
                    if (res != ESP_OK) {
                        ESP_LOGW(TAG, "Send an Client %d fehlgeschlagen: %s",
                                 i, esp_err_to_name(res));
                        ws_clients[i] = -1; // Client austragen
                    }
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(5));
        esp_task_wdt_reset();
    }
}


////////////////////////////////////////////////////////////////////////////////
// SYSTEM MONITORING
#define SYSINFO_ID 99
static const char *TAG_SYS = "SYS_MONITOR";
void systemMonitorTask(void *pvParameters)
{
    char runtimeStatsBuf[512];


    temp_sensor_config_t temp_sensor = {
    .dac_offset = TSENS_DAC_L2, // empfohlen für Standard-Bereich -10°C bis 80°C
    .clk_div = 6,               // Taktrate für Messungen (empfohlener Standard)
};

temp_sensor_set_config(temp_sensor);    // Konfiguration setzen
temp_sensor_start();                    // Sensor starten

    while (1)
    {
        // Heap-Größe
        size_t free_internal = heap_caps_get_free_size(MALLOC_CAP_8BIT);
        size_t min_free_internal = heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT);

        // PSRAM-Info (nur wenn vorhanden/init)
        size_t free_psram = 0;
        size_t min_free_psram = 0;
        //if (esp_psram_is_initialized()) {
            free_psram = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
            min_free_psram = heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM);
        //}

        // Flash-Größe
        uint32_t flash_size_kb = 1024 / 1024;

        float cpu_temp = 0.0f;
        esp_err_t ret = temp_sensor_read_celsius(&cpu_temp);

        if (ret != ESP_OK) {
            ESP_LOGW(TAG_SYS, "Temperaturmessung fehlgeschlagen");
            cpu_temp = -999.0f; // Fehlerindikator
        }




        // Stack-Freiraum (für diesen Task)
        UBaseType_t free_stack_words = uxTaskGetStackHighWaterMark(NULL);

        // Ausgabe der Laufzeitstatistik aller Tasks, falls aktiviert
        #ifdef CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
        vTaskGetRunTimeStats(runtimeStatsBuf);
        ESP_LOGI(TAG_SYS, "CPU Task-Usage Stats:\n%s", runtimeStatsBuf);
        #endif

        ESP_LOGI(TAG_SYS,
          "[SYSINFO] FreeHeap=%dB MinHeap=%dB FreePSRAM=%dB MinPSRAM=%dB Flash=%dKB CPUtemp=%.2f°C StackFree=%u words",
          (int)free_internal, (int)min_free_internal, (int)free_psram, (int)min_free_psram, (int)flash_size_kb, cpu_temp, (unsigned int)free_stack_words
        );

        /* 
        // Später: binär in Packet packen und in StreamBuffer/WebSocket schieben
        typedef struct __attribute__((packed)) {
            uint8_t id;
            uint32_t freeHeap;
            uint32_t minFreeHeap;
            uint32_t freePsram;
            uint32_t minFreePsram;
            uint32_t flashSizeKB;
            uint32_t stackFreeWords;
        } SysInfoPacket;

        SysInfoPacket pkt = {
            .id = SYSINFO_ID,
            .freeHeap = free_internal,
            .minFreeHeap = min_free_internal,
            .freePsram = free_psram,
            .minFreePsram = min_free_psram,
            .flashSizeKB = flash_size_kb,
            .stackFreeWords = free_stack_words
        };
        xStreamBufferSend(sensorStream, &pkt, sizeof(pkt), 0);
        */
        UBaseType_t watermark = uxTaskGetStackHighWaterMark(NULL);
        if(watermark < 512) { // Mindestreserve
            ESP_LOGE(TAG_SYS, "Kritischer Stackmangel: %d words", watermark);
            vTaskDelay(pdMS_TO_TICKS(10000));
            continue;
        }

        // Sicherere Task-List-Ausgabe
        if(uxTaskGetNumberOfTasks() < 20) {
            char taskListBuf[1536];
            vTaskList(taskListBuf);
            ESP_LOGI(TAG_SYS, "Tasks:\n%.*s", 1500, taskListBuf); // Begrenzte Ausgabe
        }
        vTaskDelay(pdMS_TO_TICKS(5000)); // alle 2 Sekunden
    }
}


// Vor app_main() oder in main():
void init_psram() {
    if (esp_psram_is_initialized()) {
        ESP_LOGI(TAG, "PSRAM initialized: %d MB", esp_psram_get_size() / 1048576);
        heap_caps_malloc_extmem_enable(4096); // Minimum-Allocation-Größe
    }
}

////////////////////////////////////////////////////////////////////////////////
// APP MAIN

extern "C" void app_main() {
   
    ESP_LOGI(TAG, "Starting IMU Application...");
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_log_level_set("httpd_ws", ESP_LOG_VERBOSE);
    esp_log_level_set("wifi", ESP_LOG_DEBUG);
    esp_task_wdt_add(NULL);

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    init_psram();

    ret = mount_littlefs();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "LittleFS mount failed, aborting");
        return;
    }

    sensorStream = xStreamBufferCreate(STREAMBUFFER_SIZE, STREAM_TRIGGER_LEVEL); // z.B. 4 KiB Puffer, Trigger-Level 7 Bytes
        if (sensorStream == NULL) {
            ESP_LOGE(TAG, "StreamBuffer creation failed");
            // Fehlerbehandlung
        }

    list_files("/littlefs");

    my_wifi_config_t wifi_cfg;
    if (!read_wifi_config("/littlefs/wifi_config.ini", &wifi_cfg)) {
        ESP_LOGE(TAG, "Failed to read WiFi config, using default values");
    }

    init_ringbuffer();
    wifi_init_ap(&wifi_cfg);

    init_ws_clients();
    start_http_server();

    initIMU();

    ESP_LOGI(TAG, "ALL LOADED - READY");


//xTaskCreatePinnedToCore(systemMonitorTask, "sys_monitor", 6144, NULL, 5, NULL, tskNO_AFFINITY);
xTaskCreatePinnedToCore(sensor_task, "sensor_task", 12288, NULL, 5, NULL, tskNO_AFFINITY);
xTaskCreatePinnedToCore(ws_net_task, "ws_net_task", 16384, NULL, 5, NULL, tskNO_AFFINITY);
                            
    // Hauptloop zum Beispiel für weiter Optionen
    while (1) {
        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
