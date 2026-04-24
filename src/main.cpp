#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <stdlib.h>
#include <errno.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_log.h"
#include "LSM6DSO.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <sys/param.h>
#include "freertos/ringbuf.h"
#include "driver/touch_pad.h"
#include "esp_sleep.h"

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
#include "esp_http_client.h"

#include "esp_flash.h"
#include "esp_system.h"
#include "esp_spi_flash.h" // Required for spi_flash_get_chip_size()
#include "esp_ota_ops.h"
#include "esp_flash_partitions.h"
#include "esp_now.h"
#include "esp_heap_caps.h"
#include "esp_psram.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "driver/temp_sensor.h"
#include "cJSON.h"
#ifdef CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
#include "freertos/FreeRTOSConfig.h"
#endif

// PUFFER SETTINGS
#define PACKET_SIZE      7
#define RINGBUF_PACKETS  1024
#define RINGBUF_SIZE     (PACKET_SIZE * RINGBUF_PACKETS)


#define STREAMBUFFER_SIZE 4096*32      // Mehr Luft fuer Bursts, bevor Backpressure einsetzt
#define STREAM_TRIGGER_LEVEL 7      // Minimum: 1 gesamter Sample-Frame
#define TAG "app"
#define MASTER_LOSS_FAILOVER_MS 15000
#define MASTER_RECONNECT_ATTEMPT_MS 4000

static esp_netif_t *g_sta_netif = NULL;
static esp_netif_t *g_ap_netif = NULL;
static volatile bool g_is_master_role = false;
static volatile bool g_role_transition_in_progress = false;
static char g_target_wifi_ssid[32] = "senzIMU";


// =========================================================================
// WICHTIG: lwIP-Konfigurationen (wie max TCP Connections)
// koennen NICHT hier via #define geaendert werden!
// Bitte ueber `idf.py menuconfig` -> `Component config` -> `LWIP` anpassen!
// Insbesondere: CONFIG_LWIP_MAX_ACTIVE_TCP auf mindestens 16 erhoehen!
// =========================================================================

// =========================================================================
// RGB LED CONFIGURATION (Zero-Performance-Impact)
// =========================================================================
#define LED_R_PIN GPIO_NUM_1
#define LED_G_PIN GPIO_NUM_2
#define LED_B_PIN GPIO_NUM_3

typedef enum {
    LED_STATE_OFF = 0,
    LED_STATE_GREEN, // System ready
    LED_STATE_BLUE,  // Stream running
    LED_STATE_RED    // Error / Problem
} rgb_led_state_t;

typedef struct {
    uint8_t ready_r, ready_g, ready_b;
    uint8_t stream_r, stream_g, stream_b;
    uint8_t error_r, error_g, error_b;
    uint8_t ready_intensity;
    uint8_t stream_intensity;
    uint8_t error_intensity;
} led_config_t;

static const led_config_t kDefaultLedConfig = {
    .ready_r = 0, .ready_g = 255, .ready_b = 0,
    .stream_r = 0, .stream_g = 0, .stream_b = 25,
    .error_r = 255, .error_g = 0, .error_b = 0,
    .ready_intensity = 100,
    .stream_intensity = 20,
    .error_intensity = 100
};
static led_config_t g_led_config = kDefaultLedConfig;
static led_config_t g_led_config_preview = kDefaultLedConfig;

static volatile bool led_blinking_active = false;
static rgb_led_state_t current_led_state = LED_STATE_OFF;
static rgb_led_state_t pending_led_state = LED_STATE_OFF;
static rgb_led_state_t override_preview_state = LED_STATE_OFF;

static void set_rgb_pins_raw(int r_duty, int g_duty, int b_duty) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, r_duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, g_duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2, b_duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2);
}

static void apply_led_state(rgb_led_state_t state_to_apply) {
    const led_config_t *cfg = (override_preview_state != LED_STATE_OFF) ? &g_led_config_preview : &g_led_config;

    if (state_to_apply == LED_STATE_RED) {
        uint8_t int_factor = cfg->error_intensity > 100 ? 100 : cfg->error_intensity;
        set_rgb_pins_raw(cfg->error_r * int_factor / 100, 
                         cfg->error_g * int_factor / 100, 
                         cfg->error_b * int_factor / 100);
    } else if (state_to_apply == LED_STATE_GREEN) {
        uint8_t int_factor = cfg->ready_intensity > 100 ? 100 : cfg->ready_intensity;
        set_rgb_pins_raw(cfg->ready_r * int_factor / 100, 
                         cfg->ready_g * int_factor / 100, 
                         cfg->ready_b * int_factor / 100);
    } else if (state_to_apply == LED_STATE_BLUE) {
        uint8_t int_factor = cfg->stream_intensity > 100 ? 100 : cfg->stream_intensity;
        set_rgb_pins_raw(cfg->stream_r * int_factor / 100, 
                         cfg->stream_g * int_factor / 100, 
                         cfg->stream_b * int_factor / 100);
    } else {
        set_rgb_pins_raw(0, 0, 0);
    }
}

static void set_rgb_state(rgb_led_state_t new_state) {
    pending_led_state = new_state;

    if (led_blinking_active) {
        return; 
    }

    rgb_led_state_t active_state = (override_preview_state != LED_STATE_OFF) ? override_preview_state : new_state;

    if (current_led_state == active_state) return; 
    current_led_state = active_state;

    apply_led_state(active_state);
}

static void force_led_rgb_update() {
    // Reset current_led_state to force register rewrite with identical state but new colors
    current_led_state = (rgb_led_state_t)-1; 
    set_rgb_state(pending_led_state);
}

static void led_boot_sequence_task(void *arg) {
    led_blinking_active = true;
    for(int i = 0; i < 3; i++) {
        set_rgb_pins_raw(255, 0, 0); vTaskDelay(pdMS_TO_TICKS(150)); // Rot
        set_rgb_pins_raw(0, 255, 0); vTaskDelay(pdMS_TO_TICKS(150)); // Grün
        set_rgb_pins_raw(0, 0, 255); vTaskDelay(pdMS_TO_TICKS(150)); // Blau
        if(i < 2) {
            set_rgb_pins_raw(0, 0, 0); vTaskDelay(pdMS_TO_TICKS(150)); // Pause
        }
    }
    led_blinking_active = false;
    current_led_state = LED_STATE_OFF; 
    set_rgb_state(pending_led_state); 
    vTaskDelete(NULL);
}

static void led_disconnect_blink_task(void *arg) {
    if(led_blinking_active) {
        vTaskDelete(NULL);
        return;
    }
    led_blinking_active = true;
    
    // Ganz kurzer, rasanter Blitz (3x rot) als Disconnect-Warnung (total 600ms)
    for(int i = 0; i < 3; i++) {
        set_rgb_pins_raw(255, 0, 0); 
        vTaskDelay(pdMS_TO_TICKS(100));
        set_rgb_pins_raw(0, 0, 0); 
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    
    led_blinking_active = false;
    current_led_state = LED_STATE_OFF; 
    set_rgb_state(pending_led_state);
    vTaskDelete(NULL);
}

static int count_active_ws_clients();
static bool scan_for_master_network(const char *ssid);
static void start_master_ap_mode(void);

// =========================================================================
// ESP-NOW Zeitsynchronisation
// =========================================================================
volatile int64_t g_time_sync_offset = 0;

typedef struct __attribute__((packed)) {
    uint8_t packet_type; // 0x01 = TimeSync
    int64_t master_timestamp;
} esp_now_sync_pkt_t;

void esp_now_trigger_sync() {
    if (!g_is_master_role) return;
    esp_now_sync_pkt_t sync_data;
    sync_data.packet_type = 0x01;
    sync_data.master_timestamp = esp_timer_get_time();
    uint8_t broadcast_mac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    esp_now_send(broadcast_mac, (uint8_t *)&sync_data, sizeof(sync_data));
    // ESP_LOGI("ESP-NOW", "Gesendet: TimeSync Beacon an alle Nodes, ts=%lld", sync_data.master_timestamp);
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void on_esp_now_recv(const esp_now_recv_info_t *esp_now_info, const uint8_t *data, int len) {
#else
void on_esp_now_recv(const uint8_t *mac_addr, const uint8_t *data, int len) {
#endif
    if (g_is_master_role || len < sizeof(esp_now_sync_pkt_t)) return;
    esp_now_sync_pkt_t *pkt = (esp_now_sync_pkt_t *)data;
    if (pkt->packet_type == 0x01) {
        int64_t local_time = esp_timer_get_time();
        int64_t offset = pkt->master_timestamp - local_time;
        if (g_time_sync_offset == 0) {
            g_time_sync_offset = offset;
        } else {
            g_time_sync_offset = (int64_t)(0.8 * g_time_sync_offset + 0.2 * offset);
        }
    }
}

void init_esp_now() {
    if (esp_now_init() != ESP_OK) {
        ESP_LOGE("ESP-NOW", "Init failed");
        return;
    }
    #if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
    esp_now_register_recv_cb(on_esp_now_recv);
    #else
    esp_now_register_recv_cb(on_esp_now_recv);
    #endif

    esp_now_peer_info_t peerInfo = {};
    memset(&peerInfo, 0, sizeof(peerInfo));
    for (int i=0; i<6; i++) peerInfo.peer_addr[i] = 0xFF;
    peerInfo.channel = 1;
    peerInfo.ifidx = g_is_master_role ? WIFI_IF_AP : WIFI_IF_STA;
    peerInfo.encrypt = false;
    
    if (esp_now_add_peer(&peerInfo) != ESP_OK) {
        ESP_LOGE("ESP-NOW", "Failed to add broadcast peer");
    } else {
        ESP_LOGI("ESP-NOW", "Broadcast Peer aktiv. Offset: %lld", g_time_sync_offset);
    }
}

static void wifi_watchdog_task(void *arg) {
    TickType_t master_lost_since = 0;
    TickType_t last_reconnect_attempt = 0;
    TickType_t last_time_sync = 0;

    while (1) {
        if (g_is_master_role) {
            if (last_time_sync == 0 || (xTaskGetTickCount() - last_time_sync) > pdMS_TO_TICKS(30000)) {
                last_time_sync = xTaskGetTickCount();
                esp_now_trigger_sync();
            }
        }

        wifi_mode_t mode;
        if (esp_wifi_get_mode(&mode) == ESP_OK && mode != WIFI_MODE_NULL) {
            if (count_active_ws_clients() > 0) {
                set_rgb_state(LED_STATE_BLUE);
            } else {
                set_rgb_state(LED_STATE_GREEN);
            }
        } else {
            set_rgb_state(LED_STATE_RED);
        }

        if (!g_is_master_role && !g_role_transition_in_progress) {
            wifi_ap_record_t ap_info = {};
            esp_netif_ip_info_t ip_info = {};
            const bool sta_has_link = esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK;
            const bool sta_has_ip = (g_sta_netif != NULL) &&
                                    (esp_netif_get_ip_info(g_sta_netif, &ip_info) == ESP_OK) &&
                                    (ip_info.ip.addr != 0);

            if (sta_has_link && sta_has_ip) {
                master_lost_since = 0;
            } else {
                TickType_t now = xTaskGetTickCount();
                if (master_lost_since == 0) {
                    master_lost_since = now;
                    last_reconnect_attempt = 0;
                    ESP_LOGW(TAG, "Master-Verbindung verloren. Starte Failover-Timer...");
                }

                if ((last_reconnect_attempt == 0) ||
                    ((now - last_reconnect_attempt) >= pdMS_TO_TICKS(MASTER_RECONNECT_ATTEMPT_MS))) {
                    last_reconnect_attempt = now;
                    ESP_LOGI(TAG, "Versuche Reconnect zum Master...");
                    esp_wifi_connect();
                }

                if ((now - master_lost_since) >= pdMS_TO_TICKS(MASTER_LOSS_FAILOVER_MS)) {
                    if (!scan_for_master_network(g_target_wifi_ssid)) {
                        ESP_LOGW(TAG, "Kein Master mehr gefunden. Promote zu Master/AP.");
                        start_master_ap_mode();
                    } else {
                        ESP_LOGI(TAG, "Master-Netz wieder sichtbar. Bleibe Node.");
                        master_lost_since = now;
                    }
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

static volatile bool g_force_deep_sleep = false;

static void sleep_watchdog_task(void *arg) {
    TickType_t last_active_time = xTaskGetTickCount();
    while (1) {
        if (!g_force_deep_sleep && count_active_ws_clients() > 0) {
            last_active_time = xTaskGetTickCount();
        } else {
            if (g_force_deep_sleep || (xTaskGetTickCount() - last_active_time) > pdMS_TO_TICKS(300000)) {
                if (g_force_deep_sleep) {
                    ESP_LOGI("Sleep", "Shutdown per WebUI angefordert. Gehe in Deep Sleep...");
                } else {
                    ESP_LOGI("Sleep", "5m Timeout ohne Clients. Gehe in Deep Sleep...");
                }
                
                led_blinking_active = true;
                bool abort_sleep = false;
                // 3x abwechselnd Grün und Blau
                for(int i = 0; i < 3; i++) {
                    if (!g_force_deep_sleep && count_active_ws_clients() > 0) { abort_sleep = true; break; }
                    set_rgb_pins_raw(0, 255, 0); vTaskDelay(pdMS_TO_TICKS(200));
                    if (!g_force_deep_sleep && count_active_ws_clients() > 0) { abort_sleep = true; break; }
                    set_rgb_pins_raw(0, 0, 255); vTaskDelay(pdMS_TO_TICKS(200));
                }
                set_rgb_pins_raw(0, 0, 0);

                if (abort_sleep) {
                    ESP_LOGI("Sleep", "Client connected during prep! Aborting Deep Sleep.");
                    led_blinking_active = false;
                    continue; // Gehe zurück in die while(1) Überwachungsschleife
                }
                vTaskDelay(pdMS_TO_TICKS(100));

                // Touch-Sensor Initialisieren (D4 = GPIO5 = TOUCH5)
                touch_pad_init();
                #if SOC_TOUCH_SENSOR_VERSION == 2 // ESP32-S2 und S3
                
                touch_pad_config(TOUCH_PAD_NUM5);
                
                // Leerer Handler um Panics beim Einschlafen zu verhindern, falls Trigger zuckt
                touch_pad_isr_register([](void *arg) {}, NULL, (touch_pad_intr_mask_t)TOUCH_PAD_INTR_MASK_ALL);
                
                touch_pad_set_fsm_mode(TOUCH_FSM_MODE_TIMER); // ZWINGEND für Hintergrundmessungen nötig!
                touch_pad_sleep_channel_enable(TOUCH_PAD_NUM5, true); // Erst Sleep Channel registrieren
                touch_pad_fsm_start(); // DANN FSM starten!
                           vTaskDelay(pdMS_TO_TICKS(150)); // Warten bis die FSM Messungen abgeschlossen hat
                
                uint32_t sleep_base = 0;
                touch_pad_sleep_channel_read_benchmark(TOUCH_PAD_NUM5, &sleep_base);
                
                if (sleep_base == 0 || sleep_base >= 4000000) {
                    sleep_base = 25000;
                    ESP_LOGW("Sleep", "Ungültiger Benchmark (%u)! Setze Notfall-Base auf 25000.", (unsigned int)sleep_base);
                }

                uint32_t threshold = sleep_base / 15; // ~6.6% Delta - Sehr empfindlich für 0.5mm Plastik!
                esp_err_t err = touch_pad_sleep_set_threshold(TOUCH_PAD_NUM5, threshold);
                
                // Explizit das Active Mode Threshold zusaetzlich setzen, manche Hardware Revs benoetigen das als Fallback
                touch_pad_set_thresh(TOUCH_PAD_NUM5, threshold);
                
                // Setze explizite Taktvorgaben für den Sleep Modus, falls der RTC Oszillator abbricht
                touch_pad_sleep_channel_set_work_time(1000, 500);
                
                ESP_LOGI("Sleep", "S3 Config: Base=%u, Thresh=%u, Err_Thresh=%s", 
                         (unsigned int)sleep_base, (unsigned int)threshold, esp_err_to_name(err));
                
                #else
                uint16_t sleep_base;
                touch_pad_read(TOUCH_PAD_NUM5, &sleep_base);
                uint16_t threshold = sleep_base - (sleep_base / 5); // 20% für ESP32
                touch_pad_set_thresh(TOUCH_PAD_NUM5, threshold); 
                ESP_LOGI("Sleep", "ESP32 Deep Sleep Touch Configured! Pad: D4, Base: %u, Threshold (Absolut): %u", sleep_base, threshold);
                #endif

                // RTC-Peripherie zwingend anlassen, damit die Touch-FSM im Schlaf weiterläuft
                esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);
                esp_sleep_enable_touchpad_wakeup();
                
                // ZWINGEND: Status/Interrupts VOR dem Sleep löschen, damit der RTC Controller nicht in einem 
                // bereits ausgelösten Event hängt und den ESP nie wieder aufweckt!
                touch_pad_intr_clear((touch_pad_intr_mask_t)TOUCH_PAD_INTR_MASK_ALL);
                
                // S3 benoetigt zwingend aktivierte Interrupts, damit das RTC-Modul das Event fängt.
                touch_pad_intr_enable((touch_pad_intr_mask_t)(TOUCH_PAD_INTR_MASK_ACTIVE));

                vTaskDelay(pdMS_TO_TICKS(50)); // Kurze Pause damit die UART den Print sicher abschickt
                esp_deep_sleep_start();
            }
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void init_rgb_led() {
    ledc_timer_config_t ledc_timer = {
        .speed_mode       = LEDC_LOW_SPEED_MODE,
        .duty_resolution  = LEDC_TIMER_8_BIT,
        .timer_num        = LEDC_TIMER_0,
        .freq_hz          = 4000,
        .clk_cfg          = LEDC_AUTO_CLK
    };
    ledc_timer_config(&ledc_timer);

    ledc_channel_config_t ledc_channel[3] = {
        { .gpio_num = LED_R_PIN, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0, .intr_type = LEDC_INTR_DISABLE, .timer_sel = LEDC_TIMER_0, .duty = 0, .hpoint = 0 },
        { .gpio_num = LED_G_PIN, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_1, .intr_type = LEDC_INTR_DISABLE, .timer_sel = LEDC_TIMER_0, .duty = 0, .hpoint = 0 },
        { .gpio_num = LED_B_PIN, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_2, .intr_type = LEDC_INTR_DISABLE, .timer_sel = LEDC_TIMER_0, .duty = 0, .hpoint = 0 }
    };
    for(int i=0; i<3; i++) { ledc_channel_config(&ledc_channel[i]); }

    xTaskCreate(led_boot_sequence_task, "led_boot", 2048, NULL, 5, NULL);
    xTaskCreate(sleep_watchdog_task, "sleep_wdg", 2048, NULL, 5, NULL);
}

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

typedef struct {
    uint32_t sensor_bytes_read;
    uint32_t sensor_packets_read;
    uint32_t stream_dropped_bytes;
    uint32_t ws_bytes_sent;
    uint32_t ws_frames_sent;
    uint32_t ws_send_errors;
    uint32_t stream_backlog_peak;
} runtime_transport_stats_t;

StreamBufferHandle_t sensorStream;
static runtime_transport_stats_t g_runtime_transport_stats = {};
static bool g_temp_sensor_ready = false;

static runtime_transport_stats_t snapshot_runtime_transport_stats() {
    runtime_transport_stats_t snapshot = {
        .sensor_bytes_read = __atomic_exchange_n(&g_runtime_transport_stats.sensor_bytes_read, 0, __ATOMIC_RELAXED),
        .sensor_packets_read = __atomic_exchange_n(&g_runtime_transport_stats.sensor_packets_read, 0, __ATOMIC_RELAXED),
        .stream_dropped_bytes = __atomic_exchange_n(&g_runtime_transport_stats.stream_dropped_bytes, 0, __ATOMIC_RELAXED),
        .ws_bytes_sent = __atomic_exchange_n(&g_runtime_transport_stats.ws_bytes_sent, 0, __ATOMIC_RELAXED),
        .ws_frames_sent = __atomic_exchange_n(&g_runtime_transport_stats.ws_frames_sent, 0, __ATOMIC_RELAXED),
        .ws_send_errors = __atomic_exchange_n(&g_runtime_transport_stats.ws_send_errors, 0, __ATOMIC_RELAXED),
        .stream_backlog_peak = __atomic_exchange_n(&g_runtime_transport_stats.stream_backlog_peak, 0, __ATOMIC_RELAXED),
    };
    return snapshot;
}

static void init_system_telemetry() {
    temp_sensor_config_t temp_sensor = {
        .dac_offset = TSENS_DAC_L2,
        .clk_div = 6,
    };

    esp_err_t ret = temp_sensor_set_config(temp_sensor);
    if (ret == ESP_OK) {
        ret = temp_sensor_start();
    }

    if (ret == ESP_OK) {
        g_temp_sensor_ready = true;
    } else {
        ESP_LOGW(TAG, "Temperatursensor-Telemetrie nicht verfügbar: %s", esp_err_to_name(ret));
    }
}

static float sample_cpu_temperature_c() {
    if (!g_temp_sensor_ready) {
        return NAN;
    }

    float cpu_temp = 0.0f;
    if (temp_sensor_read_celsius(&cpu_temp) != ESP_OK) {
        return NAN;
    }

    return cpu_temp;
}

static int sample_cpu_load_percent() {
#ifdef CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
    const UBaseType_t task_count = uxTaskGetNumberOfTasks();
    if (task_count == 0) {
        return -1;
    }

    TaskStatus_t *task_status_array = (TaskStatus_t *)malloc(sizeof(TaskStatus_t) * task_count);
    if (task_status_array == NULL) {
        return -1;
    }

    uint32_t total_runtime = 0;
    const UBaseType_t populated = uxTaskGetSystemState(task_status_array, task_count, &total_runtime);
    if (populated == 0 || total_runtime == 0) {
        free(task_status_array);
        return -1;
    }

    uint64_t idle_runtime = 0;
    for (UBaseType_t i = 0; i < populated; i++) {
        if (strncmp(task_status_array[i].pcTaskName, "IDLE", 4) == 0) {
            idle_runtime += task_status_array[i].ulRunTimeCounter;
        }
    }

    free(task_status_array);

    const uint64_t total_runtime_64 = total_runtime;
    if (idle_runtime >= total_runtime_64) {
        return 0;
    }

    const uint64_t busy_runtime = total_runtime_64 - idle_runtime;
    return (int)((busy_runtime * 100ULL) / total_runtime_64);
#else
    return -1;
#endif
}

static void update_stream_backlog_peak(size_t backlog_bytes) {
    uint32_t current_peak = __atomic_load_n(&g_runtime_transport_stats.stream_backlog_peak, __ATOMIC_RELAXED);
    while (backlog_bytes > current_peak) {
        if (__atomic_compare_exchange_n(
                &g_runtime_transport_stats.stream_backlog_peak,
                &current_peak,
                (uint32_t)backlog_bytes,
                false,
                __ATOMIC_RELAXED,
                __ATOMIC_RELAXED)) {
            break;
        }
    }
}

static size_t shed_sensor_stream_bytes(size_t bytes_to_drop) {
    uint8_t discard_buffer[PACKET_SIZE * 64];
    size_t total_dropped = 0;
    size_t remaining = bytes_to_drop - (bytes_to_drop % PACKET_SIZE);

    while (remaining >= PACKET_SIZE) {
        size_t chunk = remaining < sizeof(discard_buffer) ? remaining : sizeof(discard_buffer);
        chunk -= (chunk % PACKET_SIZE);
        if (chunk < PACKET_SIZE) {
            break;
        }

        size_t dropped = xStreamBufferReceive(sensorStream, discard_buffer, chunk, 0);
        dropped -= (dropped % PACKET_SIZE);
        if (dropped < PACKET_SIZE) {
            break;
        }

        total_dropped += dropped;
        remaining -= dropped;
    }

    if (total_dropped > 0) {
        __atomic_add_fetch(&g_runtime_transport_stats.stream_dropped_bytes, total_dropped, __ATOMIC_RELAXED);
    }

    return total_dropped;
}


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

void send_config_float(uint8_t subId, float value) {
    uint8_t buf[7];
    buf[0] = (30 << 3);
    buf[1] = subId;
    memcpy(&buf[2], &value, sizeof(float)); 
    buf[6] = 0;
    xStreamBufferSend(sensorStream, buf, sizeof(buf), 0);
    ESP_LOGI("CONFIGSEND", "Config sent float: mainTag=30 subId=%u value=%.6f", subId, value);
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

static const imu_config_t kDefaultImuConfig = {
    .accelDataRate = 833,
    .gyroDataRate = 833,
    .accelRange = 4,
    .gyroRange = 500,
    .accelFilter = 1,
    .gyroFilter = 1,
    .tempSampleRate = 1
};

static imu_config_t pendingConfig = kDefaultImuConfig;
static volatile bool imuConfigChanged = false;
static volatile bool imuConfigPersistPending = false;
static const char *IMU_CONFIG_NVS_NAMESPACE = "imu_cfg";
static const char *IMU_CONFIG_NVS_KEY = "sensor_cfg";

static bool is_supported_odr_value(uint16_t value) {
    switch (value) {
        case 0:
        case 16:
        case 125:
        case 26:
        case 52:
        case 104:
        case 208:
        case 416:
        case 833:
        case 1660:
        case 3330:
        case 6660:
            return true;
        default:
            return false;
    }
}

static bool sanitize_imu_config(imu_config_t *config) {
    if (config == NULL) {
        return false;
    }

    bool changed = false;

    if (!is_supported_odr_value(config->accelDataRate)) {
        config->accelDataRate = kDefaultImuConfig.accelDataRate;
        changed = true;
    }

    if (!is_supported_odr_value(config->gyroDataRate)) {
        config->gyroDataRate = kDefaultImuConfig.gyroDataRate;
        changed = true;
    }

    switch (config->accelRange) {
        case 2:
        case 4:
        case 8:
        case 16:
            break;
        default:
            config->accelRange = kDefaultImuConfig.accelRange;
            changed = true;
            break;
    }

    switch (config->gyroRange) {
        case 125:
        case 250:
        case 500:
        case 1000:
        case 2000:
            break;
        default:
            config->gyroRange = kDefaultImuConfig.gyroRange;
            changed = true;
            break;
    }

    if (config->accelFilter > 3) {
        config->accelFilter = kDefaultImuConfig.accelFilter;
        changed = true;
    }

    if (config->gyroFilter > 3) {
        config->gyroFilter = kDefaultImuConfig.gyroFilter;
        changed = true;
    }

    if (config->tempSampleRate > 3) {
        config->tempSampleRate = kDefaultImuConfig.tempSampleRate;
        changed = true;
    }

    return changed;
}

static esp_err_t save_imu_config_to_nvs(const imu_config_t *config) {
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t handle;
    esp_err_t ret = nvs_open(IMU_CONFIG_NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "NVS open for save failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = nvs_set_blob(handle, IMU_CONFIG_NVS_KEY, config, sizeof(*config));
    if (ret == ESP_OK) {
        ret = nvs_commit(handle);
    }

    nvs_close(handle);

    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Sensor-Konfiguration in NVS gespeichert");
    } else {
        ESP_LOGE(TAG, "Sensor-Konfiguration konnte nicht gespeichert werden: %s", esp_err_to_name(ret));
    }

    return ret;
}

static esp_err_t load_imu_config_from_nvs(imu_config_t *config) {
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t handle;
    esp_err_t ret = nvs_open(IMU_CONFIG_NVS_NAMESPACE, NVS_READONLY, &handle);
    if (ret != ESP_OK) {
        return ret;
    }

    size_t required_size = sizeof(*config);
    ret = nvs_get_blob(handle, IMU_CONFIG_NVS_KEY, config, &required_size);
    nvs_close(handle);

    if (ret != ESP_OK) {
        return ret;
    }

    if (required_size != sizeof(*config)) {
        ESP_LOGW(TAG, "Persistierte Sensor-Konfiguration hat unerwartete Größe: %u", (unsigned)required_size);
        *config = kDefaultImuConfig;
        return ESP_ERR_NVS_INVALID_LENGTH;
    }

    const bool sanitized = sanitize_imu_config(config);
    if (sanitized) {
        ESP_LOGW(TAG, "Persistierte Sensor-Konfiguration enthielt ungueltige Werte und wurde bereinigt");
    }

    return ESP_OK;
}

static const char *LED_CONFIG_NVS_NAMESPACE = "led_cfg";
static const char *LED_CONFIG_NVS_KEY = "color_cfg";

static esp_err_t save_led_config_to_nvs(const led_config_t *config) {
    if (config == NULL) return ESP_ERR_INVALID_ARG;
    nvs_handle_t handle;
    esp_err_t ret = nvs_open(LED_CONFIG_NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "NVS open for LED config save failed: %s", esp_err_to_name(ret));
        return ret;
    }
    ret = nvs_set_blob(handle, LED_CONFIG_NVS_KEY, config, sizeof(*config));
    if (ret == ESP_OK) nvs_commit(handle);
    nvs_close(handle);
    return ret;
}

static esp_err_t load_led_config_from_nvs(led_config_t *config) {
    if (config == NULL) return ESP_ERR_INVALID_ARG;
    nvs_handle_t handle;
    esp_err_t ret = nvs_open(LED_CONFIG_NVS_NAMESPACE, NVS_READONLY, &handle);
    if (ret != ESP_OK) return ret;
    size_t required_size = sizeof(*config);
    ret = nvs_get_blob(handle, LED_CONFIG_NVS_KEY, config, &required_size);
    nvs_close(handle);
    if (ret != ESP_OK) return ret;
    if (required_size != sizeof(*config)) {
        *config = kDefaultLedConfig;
        return ESP_ERR_NVS_INVALID_LENGTH;
    }
    return ESP_OK;
}

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

RingbufHandle_t sensor_ringbuf = NULL;

// WebServer & WebSocket globals
httpd_handle_t server = NULL;
httpd_handle_t ws_server = NULL;

#define MAX_CLIENTS 8
int ws_clients[MAX_CLIENTS];
int ws_clients_errors[MAX_CLIENTS];

static int count_active_ws_clients() {
    int count = 0;
    for (int i = 0; i < MAX_CLIENTS; i++) {
        if (ws_clients[i] >= 0) {
            count++;
        }
    }
    return count;
}

typedef struct {
    httpd_handle_t server;
    int fd;
    httpd_ws_type_t type;
    uint8_t *payload;
    size_t len;
} ws_send_work_item_t;

static volatile uint32_t g_ws_inflight_work_items = 0;

#define WS_MAX_INFLIGHT_WORK_ITEMS 10

static uint8_t *alloc_ws_payload_buffer(size_t len) {
    if (len == 0) {
        return NULL;
    }

    uint8_t *buffer = (uint8_t *)heap_caps_malloc(len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (buffer == NULL) {
        buffer = (uint8_t *)malloc(len);
    }

    return buffer;
}

static void ws_send_work(void *arg) {
    ws_send_work_item_t *item = (ws_send_work_item_t *)arg;
    if (item == NULL) {
        return;
    }

    httpd_ws_frame_t frame = {
        .final = true,
        .fragmented = false,
        .type = item->type,
        .payload = item->payload,
        .len = item->len,
    };

    const esp_err_t result = httpd_ws_send_frame_async(item->server, item->fd, &frame);
    if (result != ESP_OK) {
        __atomic_add_fetch(&g_runtime_transport_stats.ws_send_errors, 1, __ATOMIC_RELAXED);
        ESP_LOGW("WS", "Send error async (FD %d): %s, entferne Client passiv", item->fd, esp_err_to_name(result));
        
        // Wenn Senden fehlgeschlagen ist, Fehlerzähler erhöhen
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (ws_clients[i] == item->fd) {
                ws_clients_errors[i]++;
                // Drop erst nach 15 kumulativen, aufeinanderfolgenden Fehlern
                if (ws_clients_errors[i] > 15) {
                    ESP_LOGW("WS", "Zu viele Fehler (FD %d), entferne Client endgültig.", item->fd);
                    ws_clients[i] = -1;
                    ws_clients_errors[i] = 0;
                    if (count_active_ws_clients() == 0) {
                        set_rgb_state(LED_STATE_GREEN);
                        xTaskCreate(led_disconnect_blink_task, "led_disconnect", 2048, NULL, 5, NULL);
                    }
                }
                break;
            }
        }
    } else {
        // Erfolg: Fehlerzähler für diesen FD zurücksetzen!
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (ws_clients[i] == item->fd) {
                ws_clients_errors[i] = 0;
                break;
            }
        }
    }

    if (item->payload != NULL) {
        free(item->payload);
    }
    __atomic_sub_fetch(&g_ws_inflight_work_items, 1, __ATOMIC_RELAXED);
    free(item);
}

static esp_err_t queue_ws_frame_copy(httpd_handle_t server_handle, int fd, httpd_ws_type_t type, const uint8_t *payload, size_t len) {
    if (server_handle == NULL) {
        return ESP_FAIL;
    }

    if (__atomic_load_n(&g_ws_inflight_work_items, __ATOMIC_RELAXED) >= WS_MAX_INFLIGHT_WORK_ITEMS) {
        return ESP_ERR_NO_MEM;
    }

    __atomic_add_fetch(&g_ws_inflight_work_items, 1, __ATOMIC_RELAXED);

    ws_send_work_item_t *item = (ws_send_work_item_t *)heap_caps_malloc(sizeof(ws_send_work_item_t), MALLOC_CAP_8BIT);
    if (item == NULL) {
        item = (ws_send_work_item_t *)malloc(sizeof(ws_send_work_item_t));
    }
    if (item == NULL) {
        __atomic_sub_fetch(&g_ws_inflight_work_items, 1, __ATOMIC_RELAXED);
        return ESP_ERR_NO_MEM;
    }

    uint8_t *payload_copy = NULL;
    if (len > 0) {
        payload_copy = alloc_ws_payload_buffer(len);
        if (payload_copy == NULL) {
            __atomic_sub_fetch(&g_ws_inflight_work_items, 1, __ATOMIC_RELAXED);
            free(item);
            return ESP_ERR_NO_MEM;
        }
        memcpy(payload_copy, payload, len);
    }

    item->server = server_handle;
    item->fd = fd;
    item->type = type;
    item->payload = payload_copy;
    item->len = len;

    const esp_err_t queue_result = httpd_queue_work(server_handle, ws_send_work, item);
    if (queue_result != ESP_OK) {
        __atomic_sub_fetch(&g_ws_inflight_work_items, 1, __ATOMIC_RELAXED);
        if (payload_copy != NULL) {
            free(payload_copy);
        }
        free(item);
        return queue_result;
    }

    return ESP_OK;
}

// IMU device
spi_device_handle_t spiDevice;
LSM6DSO imu;

// Forward declarations
esp_err_t websocket_handler(httpd_req_t *req);
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

static my_wifi_config_t g_wifi_cfg = {};

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

// Globals for Nodes
#define MAX_NODES 10
typedef struct {
    char ip[16];
    char mac[18];
    uint32_t last_seen_ms;
} active_node_t;

static active_node_t active_nodes[MAX_NODES];
static int num_active_nodes = 0;

static void format_device_mac(char *out, size_t out_size) {
    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, out_size, "%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    } else {
        snprintf(out, out_size, "00:00:00:00:00:00");
    }
}

static int compare_active_nodes(const void *lhs, const void *rhs) {
    const active_node_t *a = (const active_node_t *)lhs;
    const active_node_t *b = (const active_node_t *)rhs;

    const bool a_has_mac = a->mac[0] != '\0';
    const bool b_has_mac = b->mac[0] != '\0';
    if (a_has_mac && b_has_mac) {
        const int mac_cmp = strcmp(a->mac, b->mac);
        if (mac_cmp != 0) return mac_cmp;
    } else if (a_has_mac != b_has_mac) {
        return a_has_mac ? -1 : 1;
    }

    return strcmp(a->ip, b->ip);
}

static void sort_active_nodes(void) {
    if (num_active_nodes > 1) {
        qsort(active_nodes, num_active_nodes, sizeof(active_node_t), compare_active_nodes);
    }
}

static void add_active_node(const char* ip, const char* mac) {
    if (!ip || ip[0] == '\0') return;

    for (int i = 0; i < num_active_nodes; i++) {
        const bool same_mac = mac && mac[0] != '\0' && strcmp(active_nodes[i].mac, mac) == 0;
        const bool same_ip = strcmp(active_nodes[i].ip, ip) == 0;
        if (same_mac || same_ip) {
            strncpy(active_nodes[i].ip, ip, sizeof(active_nodes[i].ip) - 1);
            active_nodes[i].ip[sizeof(active_nodes[i].ip) - 1] = '\0';
            if (mac && mac[0] != '\0') {
                strncpy(active_nodes[i].mac, mac, sizeof(active_nodes[i].mac) - 1);
                active_nodes[i].mac[sizeof(active_nodes[i].mac) - 1] = '\0';
            }
            active_nodes[i].last_seen_ms = (uint32_t)(esp_timer_get_time() / 1000);
            sort_active_nodes();
            ESP_LOGI("HTTP", "Node aktualisiert: ip=%s mac=%s", active_nodes[i].ip, active_nodes[i].mac);
            return;
        }
    }

    if (num_active_nodes < MAX_NODES) {
        strncpy(active_nodes[num_active_nodes].ip, ip, sizeof(active_nodes[num_active_nodes].ip) - 1);
        active_nodes[num_active_nodes].ip[sizeof(active_nodes[num_active_nodes].ip) - 1] = '\0';
        if (mac && mac[0] != '\0') {
            strncpy(active_nodes[num_active_nodes].mac, mac, sizeof(active_nodes[num_active_nodes].mac) - 1);
            active_nodes[num_active_nodes].mac[sizeof(active_nodes[num_active_nodes].mac) - 1] = '\0';
        } else {
            active_nodes[num_active_nodes].mac[0] = '\0';
        }
        active_nodes[num_active_nodes].last_seen_ms = (uint32_t)(esp_timer_get_time() / 1000);
        num_active_nodes++;
        sort_active_nodes();
        ESP_LOGI("HTTP", "Neuer Node aktiv registriert: ip=%s mac=%s (Total: %d)", ip, active_nodes[num_active_nodes - 1].mac, num_active_nodes);
        
        // Notify WebSocket clients
        char notify_buf[128];
        int len = snprintf(notify_buf, sizeof(notify_buf), "{\"type\":\"node_registered\",\"ip\":\"%s\",\"mac\":\"%s\"}", ip, mac ? mac : "");
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (ws_clients[i] >= 0) {
                queue_ws_frame_copy(ws_server, ws_clients[i], HTTPD_WS_TYPE_TEXT, (const uint8_t *)notify_buf, len);
            }
        }
    }
}

static void cleanup_active_nodes(void) {
    uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
    int originalCount = num_active_nodes;
    for (int i = 0; i < num_active_nodes; ) {
        // Timeout extrem erhöht, da Nodes sich derzeit nur beim Booten einmalig registrieren!
        // Sonst schmeißt der Master sie nach 15 Sekunden heimlich aus der Liste.
        if (now - active_nodes[i].last_seen_ms > 86400000) { 
            ESP_LOGI("HTTP", "Entferne inaktiven Node (Timeout): ip=%s mac=%s", active_nodes[i].ip, active_nodes[i].mac);
            for (int j = i; j < num_active_nodes - 1; j++) {
                active_nodes[j] = active_nodes[j + 1];
            }
            num_active_nodes--;
        } else {
            i++;
        }
    }
    if (originalCount != num_active_nodes) {
        sort_active_nodes();
    }
}

// HTTP API Handlers
esp_err_t http_get_nodes_handler(httpd_req_t *req) {
    cleanup_active_nodes();
    
    char buf[768] = "[";
    char own_ip[16] = "192.168.4.1";
    char own_mac[18] = "";
    esp_netif_ip_info_t ip_info;
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
    if (!netif) netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (netif) {
        esp_netif_get_ip_info(netif, &ip_info);
        esp_ip4addr_ntoa(&ip_info.ip, own_ip, sizeof(own_ip));
    }
    format_device_mac(own_mac, sizeof(own_mac));
    
    snprintf(buf + strlen(buf), sizeof(buf) - strlen(buf),
             "{\"ip\":\"%s\",\"mac\":\"%s\",\"isMaster\":true}", own_ip, own_mac);
    for(int i=0; i<num_active_nodes; i++) {
        if (strcmp(active_nodes[i].ip, own_ip) != 0) {
            snprintf(buf + strlen(buf), sizeof(buf) - strlen(buf),
                     ",{\"ip\":\"%s\",\"mac\":\"%s\",\"isMaster\":false}",
                     active_nodes[i].ip,
                     active_nodes[i].mac[0] != '\0' ? active_nodes[i].mac : "");
        }
    }
    strcat(buf, "]");
    
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, buf, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

esp_err_t http_register_node_handler(httpd_req_t *req) {
    char buf[128];
    int ret = httpd_req_recv(req, buf, MIN(req->content_len, sizeof(buf) - 1));
    if (ret <= 0) return ESP_FAIL;
    buf[ret] = '\0';

    char ip[16] = "";
    char mac[18] = "";

    cJSON *json = cJSON_Parse(buf);
    if (json) {
        cJSON *ip_item = cJSON_GetObjectItem(json, "ip");
        cJSON *mac_item = cJSON_GetObjectItem(json, "mac");
        if (cJSON_IsString(ip_item) && ip_item->valuestring) {
            strncpy(ip, ip_item->valuestring, sizeof(ip) - 1);
            ip[sizeof(ip) - 1] = '\0';
        }
        if (cJSON_IsString(mac_item) && mac_item->valuestring) {
            strncpy(mac, mac_item->valuestring, sizeof(mac) - 1);
            mac[sizeof(mac) - 1] = '\0';
        }
        cJSON_Delete(json);
    } else {
        strncpy(ip, buf, sizeof(ip) - 1);
        ip[sizeof(ip) - 1] = '\0';
    }

    add_active_node(ip, mac);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_sendstr(req, "OK");
    return ESP_OK;
}

static bool scan_for_master_network(const char *ssid) {
    wifi_scan_config_t scan_config = {};
    scan_config.ssid = (uint8_t *)(ssid && ssid[0] != '\0' ? ssid : "senzIMU");
    scan_config.bssid = 0;
    scan_config.channel = 0;
    scan_config.show_hidden = false;

    ESP_LOGI(TAG, "Suche nach Netz: %s...", (const char *)scan_config.ssid);
    esp_err_t err = esp_wifi_scan_start(&scan_config, true);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "WiFi-Scan fehlgeschlagen: %s", esp_err_to_name(err));
        return false;
    }

    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);
    return ap_count > 0;
}

static void start_master_ap_mode(void) {
    if (g_role_transition_in_progress) return;
    g_role_transition_in_progress = true;

    ESP_LOGI(TAG, "Starte als Master (AP)...");
    g_is_master_role = true;
    num_active_nodes = 0;

    esp_wifi_disconnect();
    esp_wifi_stop();

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));

    wifi_config_t ap_config = {};
    ap_config.ap.channel = 1;
    ap_config.ap.authmode = WIFI_AUTH_OPEN;
    ap_config.ap.max_connection = 8;
    ap_config.ap.beacon_interval = 100;
    strncpy((char*)ap_config.ap.ssid, g_target_wifi_ssid, sizeof(ap_config.ap.ssid));

    esp_netif_ip_info_t ap_ip;
    ip4addr_aton("192.168.4.1", (ip4_addr_t*)&ap_ip.ip);
    ip4addr_aton("192.168.4.1", (ip4_addr_t*)&ap_ip.gw);
    ip4addr_aton("255.255.255.0", (ip4_addr_t*)&ap_ip.netmask);

    if (g_ap_netif) {
        esp_netif_dhcps_stop(g_ap_netif);
        esp_netif_set_ip_info(g_ap_netif, &ap_ip);

        ip4_addr_t dns_addr;
        IP4_ADDR(&dns_addr, 192, 168, 4, 1);
        esp_netif_dhcps_option(g_ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER, &dns_addr, sizeof(dns_addr));
        uint32_t lease_time = 60;
        esp_netif_dhcps_option(g_ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_REQUESTED_IP_ADDRESS, &lease_time, sizeof(uint32_t));
        esp_netif_dhcps_start(g_ap_netif);
    }

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_wifi_set_max_tx_power(84);

    g_role_transition_in_progress = false;
}

// WIFI AUTO-ROLE INITIALISIERUNG
static void wifi_init_auto_role(const my_wifi_config_t *config) {
    g_sta_netif = esp_netif_create_default_wifi_sta();
    g_ap_netif = esp_netif_create_default_wifi_ap();
    
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    uint8_t mac[6];
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    int boot_delay = (mac[5] % 50) + (mac[4] % 10) * 100; // Bis zu 1000ms delay
    ESP_LOGI(TAG, "Multi-Sensor: Verzögere Start um %d ms...", boot_delay);
    vTaskDelay(pdMS_TO_TICKS(boot_delay));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());

    const char *target_ssid = config->ssid[0] != '\0' ? config->ssid : "senzIMU";
    strncpy(g_target_wifi_ssid, target_ssid, sizeof(g_target_wifi_ssid) - 1);
    g_target_wifi_ssid[sizeof(g_target_wifi_ssid) - 1] = '\0';
    bool found = scan_for_master_network(target_ssid);

    if (found) {
        ESP_LOGI(TAG, "Netzwerk senzIMU gefunden! Verbinde als Node (STA)...");
        g_is_master_role = false;
        wifi_config_t sta_config = {};
        strcpy((char*)sta_config.sta.ssid, target_ssid);
        if (strlen((char*)config->password) > 0) {
           strcpy((char*)sta_config.sta.password, config->password);
        }
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta_config));
        esp_wifi_connect();
        
        int retries = 0;
        esp_netif_ip_info_t ip_info;
        while (retries < 20) {
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_netif_get_ip_info(g_sta_netif, &ip_info);
            if (ip_info.ip.addr != 0) {
                char my_ip_str[16];
                char my_mac_str[18];
                char register_payload[96];
                sprintf(my_ip_str, IPSTR, IP2STR(&ip_info.ip));
                format_device_mac(my_mac_str, sizeof(my_mac_str));
                snprintf(register_payload, sizeof(register_payload), "{\"ip\":\"%s\",\"mac\":\"%s\"}", my_ip_str, my_mac_str);
                ESP_LOGI(TAG, "Verbunden! Meine IP: %s", my_ip_str);
                
                esp_http_client_config_t http_cfg = {};
                http_cfg.url = "http://192.168.4.1/api/register_node";
                http_cfg.method = HTTP_METHOD_POST;
                http_cfg.timeout_ms = 3000;
                
                esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
                esp_http_client_set_post_field(client, register_payload, strlen(register_payload));
                esp_http_client_set_header(client, "Content-Type", "application/json");
                
                for (int attempt = 0; attempt < 5; attempt++) {
                    esp_err_t err = esp_http_client_perform(client);
                    if (err == ESP_OK) {
                        ESP_LOGI("HTTP_CLIENT", "Erfolgreich als Node registriert! ip=%s mac=%s", my_ip_str, my_mac_str);
                        break;
                    } else {
                        ESP_LOGW("HTTP_CLIENT", "Registrierung fehlgeschlagen: %s, neuer Versuch...", esp_err_to_name(err));
                        vTaskDelay(pdMS_TO_TICKS(1000));
                    }
                }
                
                esp_http_client_cleanup(client);
                
                return;
            }
            retries++;
        }
        ESP_LOGI(TAG, "IP Timeout. Fallback auf AP...");
        start_master_ap_mode();
        return;
    }

    ESP_LOGI(TAG, "Netzwerk senzIMU NICHT gefunden. Starte als Master (AP)...");
    start_master_ap_mode();
}

////////////////////////////////////////////////////////////////////////////////
// HTTP SERVER STATIC FILE HANDLER

#define FILE_CHUNK_SIZE (1024 * 10)
esp_err_t http_serve_static_file(httpd_req_t *req) {
    char filepath[1024];
    const char* base_path = "/littlefs";

    // URI ohne Query-Parameter extrahieren
    char req_uri[512];
    strncpy(req_uri, req->uri, sizeof(req_uri) - 1);
    req_uri[sizeof(req_uri) - 1] = '\0';
    char *query_ptr = strchr(req_uri, '?');
    if (query_ptr) {
        *query_ptr = '\0';
    }

    // Pfad zusammensetzen
    if (strcmp(req_uri, "/") == 0) {
        snprintf(filepath, sizeof(filepath), "%s/index.html", base_path);
    } else {
        snprintf(filepath, sizeof(filepath), "%s%s", base_path, req_uri);
    }

    struct stat file_stat;
    if (stat(filepath, &file_stat) == -1) {
        ESP_LOGE("HTTP", "File stat failed: %s", filepath);
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "File not found");
        return ESP_FAIL;
    }

    FILE *f = fopen(filepath, "rb");
    if (!f) {
        ESP_LOGE("HTTP", "File not found: %s", filepath);
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "File not found");
        return ESP_FAIL;
    }

    bool is_html = false;
    bool is_static_asset = false;

    // MIME-Type setzen
    const char *ext = strrchr(filepath, '.');
    if (ext) {
        if (strcasecmp(ext, ".css") == 0) {
            httpd_resp_set_type(req, "text/css");
            is_static_asset = true;
        } else if (strcasecmp(ext, ".js") == 0) {
            httpd_resp_set_type(req, "application/javascript");
            is_static_asset = true;
        } else if (strcasecmp(ext, ".svg") == 0) {
            httpd_resp_set_type(req, "image/svg+xml");
            is_static_asset = true;
        } else if (strcasecmp(ext, ".png") == 0) {
            httpd_resp_set_type(req, "image/png");
            is_static_asset = true;
        } else if (strcasecmp(ext, ".glb") == 0) {
            httpd_resp_set_type(req, "model/gltf-binary");
            is_static_asset = true;
        } else if (strcasecmp(ext, ".html") == 0) {
            httpd_resp_set_type(req, "text/html");
            is_html = true;
        }
    }

    if (is_html) {
        httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (is_static_asset) {
        // Cache-Control vorerst komplett auf no-cache für die Entwicklung!
        httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate"); 
    }

    // ACHTUNG: 'Connection: close' absichtlich entfernt,
    // damit der Browser Keep-Alive nutzt und superschnell parallel laedt!

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
        // httpd_resp_send_chunk fomatisiert die Daten zu HTTP-Chunks (dies ist fuer Keep-Alive auch bei beliebigen Groessen zulaessig!)
        if (httpd_resp_send_chunk(req, chunk, read_bytes) != ESP_OK) {
            break;
        }
    }

    // Transfer beenden
    httpd_resp_send_chunk(req, NULL, 0);

    free(chunk);
    fclose(f);

    return ESP_OK;
}


////////////////////////////////////////////////////////////////////////////////
// HTTP(S) OTA UPDATE HANDLER
esp_err_t http_ota_update_handler(httpd_req_t *req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    ESP_LOGI("OTA", "Starte OTA Update...");
    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE("OTA", "Keine OTA Partition gefunden!");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "No OTA partition");
        return ESP_FAIL;
    }

    esp_ota_handle_t update_handle = 0;
    esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &update_handle);
    if (err != ESP_OK) {
        ESP_LOGE("OTA", "esp_ota_begin fehlgeschlagen: %s", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA begin failed");
        return err;
    }

    int remaining = req->content_len;
    char buf[1024];

    while (remaining > 0) {
        int recv_len = httpd_req_recv(req, buf, MIN(remaining, sizeof(buf)));
        if (recv_len <= 0) {
            if (recv_len == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            ESP_LOGE("OTA", "Verbindungsabbruch während OTA");
            esp_ota_abort(update_handle);
            return ESP_FAIL;
        }

        err = esp_ota_write(update_handle, buf, recv_len);
        if (err != ESP_OK) {
            ESP_LOGE("OTA", "esp_ota_write fehlgeschlagen: %s", esp_err_to_name(err));
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA write failed");
            return err;
        }

        remaining -= recv_len;
    }

    err = esp_ota_end(update_handle);
    if (err != ESP_OK) {
        ESP_LOGE("OTA", "esp_ota_end fehlgeschlagen: %s", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA end failed");
        return err;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE("OTA", "esp_ota_set_boot_partition fehlgeschlagen: %s", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA boot set failed");
        return err;
    }

    ESP_LOGI("OTA", "OTA Update erfolgreich. Reboot in 2s...");
    httpd_resp_sendstr(req, "OK");

    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
    return ESP_OK;
}

////////////////////////////////////////////////////////////////////////////////
// HTTP(S) FILESYSTEM UPDATE HANDLER
esp_err_t http_fs_update_handler(httpd_req_t *req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    ESP_LOGI("OTA", "Starte FS Update...");
    const esp_partition_t *fs_partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "littlefs");
    if (fs_partition == NULL) {
        ESP_LOGE("OTA", "Keine LittleFS Partition gefunden!");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "No FS partition");
        return ESP_FAIL;
    }

    esp_err_t err = esp_partition_erase_range(fs_partition, 0, fs_partition->size);
    if (err != ESP_OK) {
        ESP_LOGE("OTA", "FS erase fehlgeschlagen: %s", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "FS erase failed");
        return err;
    }

    int remaining = req->content_len;
    char buf[1024];
    uint32_t offset = 0;

    while (remaining > 0) {
        int recv_len = httpd_req_recv(req, buf, MIN(remaining, sizeof(buf)));
        if (recv_len <= 0) {
            if (recv_len == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            ESP_LOGE("OTA", "Verbindungsabbruch während FS OTA");
            return ESP_FAIL;
        }

        err = esp_partition_write(fs_partition, offset, buf, recv_len);
        if (err != ESP_OK) {
            ESP_LOGE("OTA", "FS write fehlgeschlagen: %s", esp_err_to_name(err));
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "FS write failed");
            return err;
        }

        offset += recv_len;
        remaining -= recv_len;
    }

    ESP_LOGI("OTA", "FS Update erfolgreich. Reboot in 2s...");
    httpd_resp_sendstr(req, "OK");

    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
    return ESP_OK;
}

esp_err_t http_get_led_config_handler(httpd_req_t *req) {
    char buf[256];
    snprintf(buf, sizeof(buf),
             "{\"ready\":[%u,%u,%u],\"stream\":[%u,%u,%u],\"error\":[%u,%u,%u],\"ready_int\":%u,\"stream_int\":%u,\"error_int\":%u}",
             g_led_config.ready_r, g_led_config.ready_g, g_led_config.ready_b,
             g_led_config.stream_r, g_led_config.stream_g, g_led_config.stream_b,
             g_led_config.error_r, g_led_config.error_g, g_led_config.error_b,
             g_led_config.ready_intensity, g_led_config.stream_intensity, g_led_config.error_intensity);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, buf, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

esp_err_t http_options_led_config_handler(httpd_req_t *req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_status(req, "204 No Content");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

esp_err_t http_post_led_config_handler(httpd_req_t *req) {
    char buf[512];
    int ret = httpd_req_recv(req, buf, MIN(req->content_len, sizeof(buf) - 1));
    if (ret <= 0) {
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty request");
        return ESP_FAIL;
    }
    buf[ret] = '\0';

    cJSON *json = cJSON_Parse(buf);
    if (!json) {
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    bool save_to_nvs = false;
    cJSON *save_flag = cJSON_GetObjectItem(json, "save");
    if (cJSON_IsBool(save_flag) && save_flag->valueint) save_to_nvs = true;

    led_config_t *target_cfg = save_to_nvs ? &g_led_config : &g_led_config_preview;

    cJSON *ready = cJSON_GetObjectItem(json, "ready");
    if (cJSON_IsArray(ready) && cJSON_GetArraySize(ready) == 3) {
        target_cfg->ready_r = cJSON_GetArrayItem(ready, 0)->valueint;
        target_cfg->ready_g = cJSON_GetArrayItem(ready, 1)->valueint;
        target_cfg->ready_b = cJSON_GetArrayItem(ready, 2)->valueint;
    }

    cJSON *stream = cJSON_GetObjectItem(json, "stream");
    if (cJSON_IsArray(stream) && cJSON_GetArraySize(stream) == 3) {
        target_cfg->stream_r = cJSON_GetArrayItem(stream, 0)->valueint;
        target_cfg->stream_g = cJSON_GetArrayItem(stream, 1)->valueint;
        target_cfg->stream_b = cJSON_GetArrayItem(stream, 2)->valueint;
    }

    cJSON *error = cJSON_GetObjectItem(json, "error");
    if (cJSON_IsArray(error) && cJSON_GetArraySize(error) == 3) {
        target_cfg->error_r = cJSON_GetArrayItem(error, 0)->valueint;
        target_cfg->error_g = cJSON_GetArrayItem(error, 1)->valueint;
        target_cfg->error_b = cJSON_GetArrayItem(error, 2)->valueint;
    }

    cJSON *r_int = cJSON_GetObjectItem(json, "ready_int");
    if (cJSON_IsNumber(r_int)) target_cfg->ready_intensity = r_int->valueint;

    cJSON *s_int = cJSON_GetObjectItem(json, "stream_int");
    if (cJSON_IsNumber(s_int)) target_cfg->stream_intensity = s_int->valueint;

    cJSON *e_int = cJSON_GetObjectItem(json, "error_int");
    if (cJSON_IsNumber(e_int)) target_cfg->error_intensity = e_int->valueint;

    cJSON *preview = cJSON_GetObjectItem(json, "preview");
    if (cJSON_IsString(preview)) {
        if (strcmp(preview->valuestring, "ready") == 0) override_preview_state = LED_STATE_GREEN;
        else if (strcmp(preview->valuestring, "stream") == 0) override_preview_state = LED_STATE_BLUE;
        else if (strcmp(preview->valuestring, "error") == 0) override_preview_state = LED_STATE_RED;
        else override_preview_state = LED_STATE_OFF;
    }

    cJSON_Delete(json);

    if (save_to_nvs) {
        save_led_config_to_nvs(&g_led_config);
        g_led_config_preview = g_led_config;
    }
    force_led_rgb_update();

    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, "{\"status\":\"ok\"}", HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

////////////////////////////////////////////////////////////////////////////////
// HTTP(S) SERVER START

#define FIRMWARE_VERSION "SenzIMU v1.0.3"

void start_http_server() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    const int lwip_reserved_sockets = 3;
    const int safe_open_sockets = (CONFIG_LWIP_MAX_SOCKETS > lwip_reserved_sockets)
        ? (CONFIG_LWIP_MAX_SOCKETS - lwip_reserved_sockets)
        : 1;

    // HTTPD nicht zu niedrig priorisieren, damit Verbindungsaufbau und Asset-Serving
    // unter Sensorlast weiterhin zeitnah bedient werden.
    config.task_priority = 8;


// Optional: Task-Stack-Größe ggf. anpassen

    config.stack_size = 8192*2;  // Beispielwert, an deinen Bedarf anpassen
    config.max_open_sockets = safe_open_sockets;
    config.backlog_conn = safe_open_sockets;
    config.recv_wait_timeout = 3600; // WICHTIG: Verhindert, dass idle WebSockets nach 5s von IDF getrennt werden!
    config.send_wait_timeout = 30;   
    config.lru_purge_enable = true;  // Alte Verbindungen bereinigen
    config.max_uri_handlers = 25;
    config.max_req_hdr_len = 8192;
    config.uri_match_fn = httpd_uri_match_wildcard;

    ESP_LOGI("HTTP", "LWIP_MAX_SOCKETS=%d, HTTP max_open_sockets=%d", CONFIG_LWIP_MAX_SOCKETS, config.max_open_sockets);

    esp_err_t start_err = httpd_start(&server, &config);
    if (start_err == ESP_OK) {
        // Root-Handler
        httpd_uri_t root = {
            .uri = "/",
            .method = HTTP_GET,
            .handler = http_serve_static_file,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        esp_err_t root_err = httpd_register_uri_handler(server, &root);
        if (root_err != ESP_OK) {
            ESP_LOGE("HTTP", "Root-Handler Registrierung fehlgeschlagen: %s", esp_err_to_name(root_err));
        }

        // OTA Handler
        httpd_uri_t ota_uri = {
            .uri = "/update",
            .method = HTTP_POST,
            .handler = http_ota_update_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        esp_err_t ota_err = httpd_register_uri_handler(server, &ota_uri);
        if (ota_err != ESP_OK) {
            ESP_LOGE("HTTP", "OTA-Handler Registrierung fehlgeschlagen: %s", esp_err_to_name(ota_err));
        }

        // FS OTA Handler
        httpd_uri_t fs_ota_uri = {
            .uri = "/update_fs",
            .method = HTTP_POST,
            .handler = http_fs_update_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        esp_err_t fs_ota_err = httpd_register_uri_handler(server, &fs_ota_uri);
        if (fs_ota_err != ESP_OK) {
            ESP_LOGE("HTTP", "FS-OTA-Handler Registrierung fehlgeschlagen: %s", esp_err_to_name(fs_ota_err));
        }

        // WebSocket Handler
        httpd_uri_t ws_uri = {
            .uri = "/ws",
            .method = HTTP_GET,
            .handler = websocket_handler,
            .user_ctx = NULL,
            .is_websocket = true,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        esp_err_t ws_err = httpd_register_uri_handler(server, &ws_uri);
        if (ws_err != ESP_OK) {
            ESP_LOGE("HTTP", "WebSocket-Handler Registrierung fehlgeschlagen: %s", esp_err_to_name(ws_err));
        }

        // OTA OPTIONS Handlers (CORS)
        httpd_uri_t ota_options_uri = {
            .uri = "/update",
            .method = HTTP_OPTIONS,
            .handler = http_options_led_config_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &ota_options_uri);

        httpd_uri_t fs_ota_options_uri = {
            .uri = "/update_fs",
            .method = HTTP_OPTIONS,
            .handler = http_options_led_config_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &fs_ota_options_uri);

        // LED Config Handlers
        httpd_uri_t led_get_uri = {
            .uri = "/api/led_config",
            .method = HTTP_GET,
            .handler = http_get_led_config_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &led_get_uri);

        httpd_uri_t led_post_uri = {
            .uri = "/api/led_config",
            .method = HTTP_POST,
            .handler = http_post_led_config_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &led_post_uri);

        httpd_uri_t led_options_uri = {
            .uri = "/api/led_config",
            .method = HTTP_OPTIONS,
            .handler = http_options_led_config_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &led_options_uri);

        httpd_uri_t get_nodes_uri = {
            .uri = "/api/nodes",
            .method = HTTP_GET,
            .handler = http_get_nodes_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &get_nodes_uri);

        httpd_uri_t register_node_uri = {
            .uri = "/api/register_node",
            .method = HTTP_POST,
            .handler = http_register_node_handler,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(server, &register_node_uri);

        // Wildcard für andere Dateien (MUSS als ALLERLETZTES registriert werden!)
 httpd_uri_t wildcard = {
            .uri = "/*",
            .method = HTTP_GET,
            .handler = http_serve_static_file,
            .user_ctx = NULL,
            .is_websocket = false,
            .handle_ws_control_frames = false,
            .supported_subprotocol = NULL
        };
        esp_err_t wildcard_err = httpd_register_uri_handler(server, &wildcard);
        if (wildcard_err != ESP_OK) {
            ESP_LOGE("HTTP", "Wildcard-Handler Registrierung fehlgeschlagen: %s", esp_err_to_name(wildcard_err));
        }
        ws_server = server;  // global für ws senden
        ESP_LOGI("HTTP", "HTTP Server & WebSocket gestartet");
    } else {
        ESP_LOGE("HTTP", "httpd_start fehlgeschlagen: %s", esp_err_to_name(start_err));
    }
}
////////////////////////////////////////////////////////////////////////////////
// WS CLIENT-LISTE INITIALISIERUNG
void init_ws_clients(void) {
    for (int i = 0; i < MAX_CLIENTS; i++) {
        ws_clients[i] = -1;
        ws_clients_errors[i] = 0;
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
                    ws_clients_errors[i] = 0;
                    break;
                }
            }
        }
        // Neue Verbindung erkannt!
        set_rgb_state(LED_STATE_BLUE);
        // WICHTIG: Keine Config während HTTP_GET senden. Websocket Handshake ist asynchron.
        // Die Config wird erst verschickt, wenn der Client "get_config" über Websocket anfrägt.
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
                    char pong_msg[] = "pong";
                    httpd_ws_frame_t pong_frame = {
                        .final = true,
                        .fragmented = false,
                        .type = HTTPD_WS_TYPE_TEXT,
                        .payload = (uint8_t*)pong_msg,
                        .len = strlen(pong_msg)
                    };
                    httpd_ws_send_frame(req, &pong_frame);
                } else if (strcmp((char*)buf, "get_config") == 0) {
                    // Cient hat Handshake überlebt und fragt initial nach Config
                    ESP_LOGI("WS", "Initial Config request empfangen");
                    send_config_value(CFG_ID_ACCELSAMPLERATE , pendingConfig.accelDataRate);
                    send_config_value(CFG_ID_ACCELRANGE, pendingConfig.accelRange);
                    send_config_value(CFG_ID_ACCELFILTER, pendingConfig.accelFilter);
                    send_config_value(CFG_ID_GYRORANGE, pendingConfig.gyroRange);
                    send_config_value(CFG_ID_GYROSAMPLERATE, pendingConfig.gyroDataRate);
                    send_config_value(CFG_ID_GYROFILTER, pendingConfig.gyroFilter);
                    send_config_value(CFG_ID_TEMPSAMPLERATE, pendingConfig.tempSampleRate);
                    send_config_float(107, FREQ_FINE);
                    
                    char fw_json[64];
                    snprintf(fw_json, sizeof(fw_json), "{\"type\":\"firmwareVer\",\"version\":\"%s\"}", FIRMWARE_VERSION);
                    httpd_ws_frame_t fw_frame = {
                        .final = true,
                        .fragmented = false,
                        .type = HTTPD_WS_TYPE_TEXT,
                        .payload = (uint8_t*)fw_json,
                        .len = strlen(fw_json)
                    };
                    httpd_ws_send_frame(req, &fw_frame);

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
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_ACCELSAMPLERATE, rate);
                        }
                        else if (strcmp(key, "ACCELRANGE") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.accelRange = range;
                            imuConfigChanged = true;
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_ACCELRANGE, range);
                        }
                        else if (strcmp(key, "ACCELFILTER") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.accelFilter = range;
                            imuConfigChanged = true;
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_ACCELFILTER, range);
                        }
                        else if (strcmp(key, "GYROSAMPLERATE") == 0) {
                            uint16_t range = parse_rate_config_value(item);
                            pendingConfig.gyroDataRate = range;
                            imuConfigChanged = true;
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_GYROSAMPLERATE, range);
                        }
                        else if (strcmp(key, "GYRORANGE") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.gyroRange = range;
                            imuConfigChanged = true;
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_GYRORANGE, range);
                        }
                        else if (strcmp(key, "GYROFILTER") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.gyroFilter = range;
                            imuConfigChanged = true;
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_GYROFILTER, range);
                        }
                        else if (strcmp(key, "TEMPSAMPLERATE") == 0) {
                            uint16_t range = cJSON_IsNumber(item) ? (uint16_t)item->valueint
                                                                  : (uint16_t)atoi(item->valuestring);
                            pendingConfig.tempSampleRate = range;
                            imuConfigChanged = true;
                            imuConfigPersistPending = true;
                            send_config_value(CFG_ID_TEMPSAMPLERATE, range);
                        }
                        else if (strcmp(key, "COMMAND") == 0) {
                            if (cJSON_IsString(item) && strcmp(item->valuestring, "SHUTDOWN") == 0) {
                                ESP_LOGI("WS", "Shutdown vom Button empfangen");
                                g_force_deep_sleep = true;
                            }
                            else if (cJSON_IsString(item) && strcmp(item->valuestring, "IDENTIFY") == 0) {
                                ESP_LOGI("WS", "Identify vom Button empfangen");
                                xTaskCreate(led_boot_sequence_task, "led_ident", 2048, NULL, 5, NULL);
                            }
                            else if (cJSON_IsString(item) && strcmp(item->valuestring, "PING") == 0) {
                                // Nur Keepalive, nichts tun. Ignoriert absichtlich, um Timeout zu verhindern.
                            }
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
                    .fragmented = false,
                    .type  = HTTPD_WS_TYPE_PONG,
                    .payload = NULL,
                    .len = 0
                };
                httpd_ws_send_frame(req, &pong_pkt);
            }
            // ------ PONG ------
            else if (ws_pkt.type == HTTPD_WS_TYPE_PONG) {
                // Pong wird jetzt passiv ignoriert, wir verlassen uns auf Socket-Errors
            }
            // ------ CLOSE ------
            else if (ws_pkt.type == HTTPD_WS_TYPE_CLOSE) {
                ESP_LOGI("WS", "CLOSE von FD %d – entferne aus Liste", fd);
                for (int i = 0; i < MAX_CLIENTS; i++) {
                    if (ws_clients[i] == fd) {
                        ws_clients[i] = -1;
                        if (count_active_ws_clients() == 0) {
                            set_rgb_state(LED_STATE_GREEN);
                            xTaskCreate(led_disconnect_blink_task, "led_disconnect", 2048, NULL, 5, NULL);
                        }
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
    imu.setFifoDepth(4096);
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
        sanitize_imu_config(&pendingConfig);
       



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
                send_config_float(107, FREQ_FINE);

        if (imuConfigPersistPending) {
            if (save_imu_config_to_nvs(&pendingConfig) == ESP_OK) {
                imuConfigPersistPending = false;
            }
        }

        esp_now_trigger_sync(); // Trigger sync after settings tweak
    }

   // Hier können weitere Konfigurationen hinzugefügt werden




        int available_frames = imu.getFifoStatus();
        int available_bytes = available_frames * 7;

        while (available_bytes >= 7) {
            uint16_t burst = available_bytes;
            if (burst > maxFifoBlock) burst = (maxFifoBlock / 7) * 7;

            status_t rc = imu.fifoburstRead(fifoBuf, burst);
            if (rc != IMU_SUCCESS) {
                ESP_LOGE(TAG, "FIFO Burst-Read failed!");
                break;
            }

            __atomic_add_fetch(&g_runtime_transport_stats.sensor_bytes_read, burst, __ATOMIC_RELAXED);
            __atomic_add_fetch(&g_runtime_transport_stats.sensor_packets_read, burst / PACKET_SIZE, __ATOMIC_RELAXED);

            size_t sent = xStreamBufferSend(sensorStream, fifoBuf, burst, pdMS_TO_TICKS(2));
            if (sent < burst) {
                TickType_t now = xTaskGetTickCount();
                __atomic_add_fetch(&g_runtime_transport_stats.stream_dropped_bytes, (burst - sent), __ATOMIC_RELAXED);
                if ((now - last_overflow_log) >= pdMS_TO_TICKS(1000)) {
                    ESP_LOGW(TAG, "StreamBuffer overflow/backpressure: %d Bytes verloren.", (burst - sent));
                    last_overflow_log = now;
                }

                if (sent == 0) {
                    vTaskDelay(0);
                }

                // Nicht weiter aus der IMU-FIFO ziehen, wenn der StreamBuffer bereits voll läuft.
                break;
            }
            available_bytes -= burst;
        }

        if (imu.getFifoStatus() < 1) {
            vTaskDelay(1); // Gib der IDLE-Task Zeit, wenn keine Daten in der FIFO sind
        } else {
            vTaskDelay(0); // Ansonsten sofort weitere Daten abholen
        }
    }

    heap_caps_free(fifoBuf);
    vTaskDelete(NULL);
}


////////////////////////////////////////////////////////////////////////////////
// WS NET TASK: Pakete sammeln und an alle WebSocket Clients senden

#define MAX_PACKETS_PER_FRAME 256
#define MIN_PACKETS_PER_FRAME 32
#define MAX_FRAME_SIZE (PACKET_SIZE * MAX_PACKETS_PER_FRAME)
#define WS_FRAME_WAIT_MS 8
#define WS_FRAME_ACCUMULATION_MS 20
#define WS_SEND_NOMEM_BACKOFF_MS 40
#define WS_SEND_FAIL_BACKOFF_MS 120
#define WS_STREAM_HIGH_WATERMARK_BYTES (STREAMBUFFER_SIZE * 3 / 4)
#define WS_STREAM_SHED_BYTES (PACKET_SIZE * 256)

void ws_net_task(void *arg) {
    uint8_t send_buffer[MAX_FRAME_SIZE];
    int64_t last_stats_sent_us = esp_timer_get_time();
    int64_t ws_send_backoff_until_us = 0;
    int64_t last_nomem_log_us = 0;
    int64_t last_shed_log_us = 0;
    uint32_t consecutive_pressure_events = 0;
    uint32_t calm_send_cycles = 0;
    size_t current_frame_size_limit = MAX_FRAME_SIZE;
    esp_task_wdt_add(NULL);
    ESP_LOGI(TAG, "WEBSOCKET TASK - READY");

    while (1) {
        const int64_t loop_now_us = esp_timer_get_time();
        const size_t backlog_before_receive = xStreamBufferBytesAvailable(sensorStream);
        update_stream_backlog_peak(backlog_before_receive);

        if (backlog_before_receive >= WS_STREAM_HIGH_WATERMARK_BYTES) {
            const size_t shed_bytes = shed_sensor_stream_bytes(WS_STREAM_SHED_BYTES);
            if (shed_bytes > 0 && (loop_now_us - last_shed_log_us) >= 1000000) {
                last_shed_log_us = loop_now_us;
                ESP_LOGW(TAG, "WS Überlastschutz aktiv: %u Bytes verworfen, um aktuelle Daten bevorzugt zu halten.", (unsigned int)shed_bytes);
            }
        }

        if (loop_now_us < ws_send_backoff_until_us) {
            vTaskDelay(pdMS_TO_TICKS(WS_SEND_NOMEM_BACKOFF_MS));
            continue;
        }

        if (__atomic_load_n(&g_ws_inflight_work_items, __ATOMIC_RELAXED) >= WS_MAX_INFLIGHT_WORK_ITEMS) {
            vTaskDelay(1);
            continue;
        }

        size_t total_bytes = xStreamBufferReceive(sensorStream,
                                                 send_buffer,
                                                 PACKET_SIZE,
                                                 (pdMS_TO_TICKS(WS_FRAME_WAIT_MS) == 0) ? 1 : pdMS_TO_TICKS(WS_FRAME_WAIT_MS));

        if (total_bytes > 0) {
            const int64_t accumulation_deadline_us = esp_timer_get_time() + ((int64_t)WS_FRAME_ACCUMULATION_MS * 1000);

            while (total_bytes + PACKET_SIZE <= current_frame_size_limit) {
                const size_t available_bytes = xStreamBufferBytesAvailable(sensorStream);
                const size_t remaining_capacity = current_frame_size_limit - total_bytes;
                const size_t chunk_bytes = available_bytes < remaining_capacity ? available_bytes : remaining_capacity;
                const size_t aligned_chunk_bytes = chunk_bytes - (chunk_bytes % PACKET_SIZE);

                if (aligned_chunk_bytes < PACKET_SIZE) {
                    if (esp_timer_get_time() >= accumulation_deadline_us) {
                        break;
                    }

                    vTaskDelay(0); // Polling yield
                    continue;
                }

                const size_t bytes_read = xStreamBufferReceive(sensorStream,
                                                               send_buffer + total_bytes,
                                                               aligned_chunk_bytes,
                                                               0);
                const size_t aligned_bytes_read = bytes_read - (bytes_read % PACKET_SIZE);
                if (aligned_bytes_read < PACKET_SIZE) {
                    break;
                }

                total_bytes += aligned_bytes_read;
            }

            total_bytes -= (total_bytes % PACKET_SIZE);
        }

        if (total_bytes > 0) {
            for (int i = 0; i < MAX_CLIENTS; i++) {
                if (ws_clients[i] >= 0) {
                    esp_err_t res = queue_ws_frame_copy(ws_server, ws_clients[i], HTTPD_WS_TYPE_BINARY, send_buffer, total_bytes);
                    if (res != ESP_OK) {
                        __atomic_add_fetch(&g_runtime_transport_stats.ws_send_errors, 1, __ATOMIC_RELAXED);
                        consecutive_pressure_events += 1;
                        if (res == ESP_ERR_NO_MEM) {
                            current_frame_size_limit = current_frame_size_limit > (MIN_PACKETS_PER_FRAME * PACKET_SIZE)
                                ? current_frame_size_limit / 2
                                : (MIN_PACKETS_PER_FRAME * PACKET_SIZE);
                            current_frame_size_limit -= (current_frame_size_limit % PACKET_SIZE);
                            calm_send_cycles = 0;
                            ws_send_backoff_until_us = esp_timer_get_time() + ((int64_t)WS_SEND_NOMEM_BACKOFF_MS * 1000);
                            if ((esp_timer_get_time() - last_nomem_log_us) >= 1000000) {
                                last_nomem_log_us = esp_timer_get_time();
                                ESP_LOGW(TAG, "WS send backpressure: Client %d meldet %s, Frame-Limit jetzt %u Bytes", i, esp_err_to_name(res), (unsigned int)current_frame_size_limit);
                            }
                            if (consecutive_pressure_events >= 3) {
                                const size_t shed_bytes = shed_sensor_stream_bytes(WS_STREAM_SHED_BYTES);
                                if (shed_bytes > 0 && (esp_timer_get_time() - last_shed_log_us) >= 1000000) {
                                    last_shed_log_us = esp_timer_get_time();
                                    ESP_LOGW(TAG, "WS Überlastschutz aktiv: %u Bytes verworfen nach wiederholtem NO_MEM.", (unsigned int)shed_bytes);
                                }
                            }
                            break;
                        }

                        current_frame_size_limit = current_frame_size_limit > (MIN_PACKETS_PER_FRAME * PACKET_SIZE)
                            ? current_frame_size_limit / 2
                            : (MIN_PACKETS_PER_FRAME * PACKET_SIZE);
                        current_frame_size_limit -= (current_frame_size_limit % PACKET_SIZE);
                        calm_send_cycles = 0;
                        ws_send_backoff_until_us = esp_timer_get_time() + ((int64_t)WS_SEND_FAIL_BACKOFF_MS * 1000);
                        ESP_LOGW(TAG, "Send an Client %d fehlgeschlagen: %s",
                                 i, esp_err_to_name(res));
                    } else {
                        consecutive_pressure_events = 0;
                        calm_send_cycles += 1;
                        if (calm_send_cycles >= 32 && current_frame_size_limit < MAX_FRAME_SIZE) {
                            calm_send_cycles = 0;
                            current_frame_size_limit = current_frame_size_limit * 2;
                            if (current_frame_size_limit > MAX_FRAME_SIZE) {
                                current_frame_size_limit = MAX_FRAME_SIZE;
                            }
                            current_frame_size_limit -= (current_frame_size_limit % PACKET_SIZE);
                        }
                        __atomic_add_fetch(&g_runtime_transport_stats.ws_bytes_sent, total_bytes, __ATOMIC_RELAXED);
                        __atomic_add_fetch(&g_runtime_transport_stats.ws_frames_sent, 1, __ATOMIC_RELAXED);
                    }
                }
            }
        }

        const int64_t now_us = esp_timer_get_time();
        if ((now_us - last_stats_sent_us) >= 1000000) {
            last_stats_sent_us = now_us;

            const runtime_transport_stats_t stats = snapshot_runtime_transport_stats();
            const int active_clients = count_active_ws_clients();
            const size_t free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            const size_t min_free_internal = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            const size_t largest_free_internal = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            const bool psram_available = esp_psram_is_initialized();
            const size_t total_psram = psram_available ? (size_t)esp_psram_get_size() : 0;
            const size_t free_psram = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
            const size_t min_free_psram = heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM);
            const size_t largest_free_psram = heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM);
            const float cpu_temp_c = sample_cpu_temperature_c();
            const int cpu_load_pct = sample_cpu_load_percent();
            const uint32_t inflight_ws_items = __atomic_load_n(&g_ws_inflight_work_items, __ATOMIC_RELAXED);
            const uint32_t frame_limit_packets = (uint32_t)(current_frame_size_limit / PACKET_SIZE);

            uint64_t synced_time_us = (uint64_t)((int64_t)esp_timer_get_time() + g_time_sync_offset);
            char stats_payload[600];
            const int stats_len = snprintf(
                stats_payload,
                sizeof(stats_payload),
                "{\"type\":\"espStats\",\"activeClients\":%d,\"sensorBytes\":%u,\"sensorPackets\":%u,\"fifoPeakBytes\":0,\"streamDroppedBytes\":%u,\"streamPartialWrites\":0,\"streamBacklogPeak\":%u,\"wsBytes\":%u,\"wsFrames\":%u,\"wsSendErrors\":%u,\"freeHeap\":%u,\"minFreeHeap\":%u,\"largestHeapBlock\":%u,\"psramAvailable\":%u,\"psramTotal\":%u,\"freePsram\":%u,\"minFreePsram\":%u,\"largestPsramBlock\":%u,\"cpuLoadPct\":%d,\"cpuTempC\":%.2f,\"inflightWs\":%u,\"frameLimitPackets\":%u,\"syncedEspTime\":%llu}",
                active_clients,
                (unsigned int)stats.sensor_bytes_read,
                (unsigned int)stats.sensor_packets_read,
                (unsigned int)stats.stream_dropped_bytes,
                (unsigned int)stats.stream_backlog_peak,
                (unsigned int)stats.ws_bytes_sent,
                (unsigned int)stats.ws_frames_sent,
                (unsigned int)stats.ws_send_errors,
                (unsigned int)free_internal,
                (unsigned int)min_free_internal,
                (unsigned int)largest_free_internal,
                psram_available ? 1U : 0U,
                (unsigned int)total_psram,
                (unsigned int)free_psram,
                (unsigned int)min_free_psram,
                (unsigned int)largest_free_psram,
                cpu_load_pct,
                (double)cpu_temp_c,
                (unsigned int)inflight_ws_items,
                (unsigned int)frame_limit_packets,
                (unsigned long long)synced_time_us
            );

            if (stats_len > 0 && active_clients > 0) {
                for (int i = 0; i < MAX_CLIENTS; i++) {
                    if (ws_clients[i] >= 0) {
                        if (queue_ws_frame_copy(ws_server, ws_clients[i], HTTPD_WS_TYPE_TEXT, (const uint8_t *)stats_payload, (size_t)stats_len) != ESP_OK) {
                            __atomic_add_fetch(&g_runtime_transport_stats.ws_send_errors, 1, __ATOMIC_RELAXED);
                        }
                    }
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(1));
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
        size_t free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
        size_t min_free_internal = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

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
    init_rgb_led(); // LED Init
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
    init_system_telemetry();

    pendingConfig = kDefaultImuConfig;
    ret = load_imu_config_from_nvs(&pendingConfig);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Sensor-Konfiguration aus NVS geladen: ACC_DR=%u, GYRO_DR=%u, ACC_RANGE=%u, GYRO_RANGE=%u",
                 pendingConfig.accelDataRate,
                 pendingConfig.gyroDataRate,
                 pendingConfig.accelRange,
                 pendingConfig.gyroRange);
    } else if (ret == ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGI(TAG, "Keine gespeicherte Sensor-Konfiguration gefunden, verwende Defaults");
    } else {
        ESP_LOGW(TAG, "Gespeicherte Sensor-Konfiguration konnte nicht geladen werden (%s), verwende Defaults", esp_err_to_name(ret));
        pendingConfig = kDefaultImuConfig;
    }

    ret = load_led_config_from_nvs(&g_led_config);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "LED-Konfiguration aus NVS geladen");
        set_rgb_state(pending_led_state); // Reapply current state with new colors
    } else if (ret == ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGI(TAG, "Keine gespeicherte LED-Konfiguration gefunden, verwende Defaults");
    } else {
        ESP_LOGE(TAG, "Fehler beim Laden der LED-Konfiguration: %s", esp_err_to_name(ret));
        g_led_config = kDefaultLedConfig;
    }

    ret = mount_littlefs();
    if (ret != ESP_OK) {
        set_rgb_state(LED_STATE_RED);
        ESP_LOGE(TAG, "LittleFS mount failed, aborting");
        return;
    }

    sensorStream = xStreamBufferCreate(STREAMBUFFER_SIZE, STREAM_TRIGGER_LEVEL); // z.B. 4 KiB Puffer, Trigger-Level 7 Bytes
        if (sensorStream == NULL) {
            set_rgb_state(LED_STATE_RED);
            ESP_LOGE(TAG, "StreamBuffer creation failed");
            // Fehlerbehandlung
        }

    list_files("/littlefs");

    memset(&g_wifi_cfg, 0, sizeof(g_wifi_cfg));
    if (!read_wifi_config("/littlefs/wifi_config.ini", &g_wifi_cfg)) {
        ESP_LOGE(TAG, "Failed to read WiFi config, using default values");
    }

    init_ringbuffer();
    wifi_init_auto_role(&g_wifi_cfg);
    init_esp_now(); // ESP-NOW initialisieren

    init_ws_clients();
    start_http_server();

    initIMU();

    ESP_LOGI(TAG, "ALL LOADED - READY");
    // LED State wird nun vom wifi_watchdog_task kontinuierlich gesteuert!

    // FreeRTOS Timer Tick Rate Workaround: 
    // Löschen des Main-Task-Watchdogs VOR dem Erstellen der anderen Tasks, 
    // da ws_net_task (Prio 5) und sensor_task (Prio 15) den app_main (Prio 1)
    // andernfalls sofort verhungern lassen und wir diesen Befehl nie erreichen würden!
    esp_task_wdt_delete(NULL);

    xTaskCreatePinnedToCore(sensor_task, "sensor_task", 12288, NULL, 15, NULL, 1); // Sensorlast auf Core 1, damit WiFi/HTTP auf Core 0 Luft behalten
    xTaskCreatePinnedToCore(ws_net_task, "ws_net_task", 16384, NULL, 5, NULL, 0); // WS-Transport nahe am WiFi/HTTP-Stack auf Core 0
    xTaskCreate(wifi_watchdog_task, "wifi_wd_task", 4096, NULL, 2, NULL);
                            
    return; // app_main Task sauber beenden
}
