#include <stdio.h>
#include <string.h>
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


#define STREAMBUFFER_SIZE 4096*32      // Mehr Luft fuer Bursts, bevor Backpressure einsetzt
#define STREAM_TRIGGER_LEVEL 7      // Minimum: 1 gesamter Sample-Frame


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

static volatile bool led_blinking_active = false;
static rgb_led_state_t current_led_state = LED_STATE_OFF;
static rgb_led_state_t pending_led_state = LED_STATE_OFF;

static void set_rgb_pins_raw(int r_duty, int g_duty, int b_duty) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, r_duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, g_duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2, b_duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2);
}

static void set_rgb_state(rgb_led_state_t new_state) {
    pending_led_state = new_state;

    if (led_blinking_active) {
        return; // Prevent unnecessary register writes while animating
    }

    if (current_led_state == new_state) return; 
    current_led_state = new_state;

    // Assuming Common Cathode. 
    // Blau wird auf 25/255 (ca. 10%) gedimmt, da der Stream dauerhaft an ist.
    set_rgb_pins_raw(
        (new_state == LED_STATE_RED) ? 255 : 0,
        (new_state == LED_STATE_GREEN) ? 255 : 0,
        (new_state == LED_STATE_BLUE) ? 25 : 0
    );
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

// Forward declaration
static int count_active_ws_clients();

static void sleep_watchdog_task(void *arg) {
    TickType_t last_active_time = xTaskGetTickCount();
    while (1) {
        if (count_active_ws_clients() > 0) {
            last_active_time = xTaskGetTickCount();
        } else {
            if ((xTaskGetTickCount() - last_active_time) > pdMS_TO_TICKS(60000)) {
                ESP_LOGI("Sleep", "60s Timeout ohne Clients. Gehe in Deep Sleep...");
                
                led_blinking_active = true;
                bool abort_sleep = false;
                // 3x abwechselnd Grün und Blau
                for(int i = 0; i < 3; i++) {
                    if (count_active_ws_clients() > 0) { abort_sleep = true; break; }
                    set_rgb_pins_raw(0, 255, 0); vTaskDelay(pdMS_TO_TICKS(200));
                    if (count_active_ws_clients() > 0) { abort_sleep = true; break; }
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

#define TAG "app"


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

#define WS_MAX_INFLIGHT_WORK_ITEMS 3

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
        
        // Passive Disconnect Erkennung: Wenn Send fehlschlug (z.B. ESP_ERR_INVALID_ARG oder ESP_FAIL),
        // ist der Socket tot. Client aus der Liste nehmen (spart den ganzen Ping-Task Overhead).
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (ws_clients[i] == item->fd) {
                ws_clients[i] = -1;
                if (count_active_ws_clients() == 0) {
                    set_rgb_state(LED_STATE_GREEN);
                    xTaskCreate(led_disconnect_blink_task, "led_disconnect", 2048, NULL, 5, NULL);
                }
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

#define FILE_CHUNK_SIZE (1024 * 10)
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
        httpd_resp_set_hdr(req, "Cache-Control", "public, max-age=300");
    }

    // Viele Browser laden zahlreiche Assets parallel. Fuer statische Antworten
    // erzwingen wir Connection: close, damit HTTP-Sockets schnell wieder frei werden.
    httpd_resp_set_hdr(req, "Connection", "close");

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

        // Wildcard für andere Dateien
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
                    break;
                }
            }
        }

        // Neue Verbindung erkannt!
        set_rgb_state(LED_STATE_BLUE);

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
                        .fragmented = false,
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

        if (imuConfigPersistPending) {
            if (save_imu_config_to_nvs(&pendingConfig) == ESP_OK) {
                imuConfigPersistPending = false;
            }
        }


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
#define WS_FRAME_ACCUMULATION_MS 3
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

            char stats_payload[512];
            const int stats_len = snprintf(
                stats_payload,
                sizeof(stats_payload),
                "{\"type\":\"espStats\",\"activeClients\":%d,\"sensorBytes\":%u,\"sensorPackets\":%u,\"fifoPeakBytes\":0,\"streamDroppedBytes\":%u,\"streamPartialWrites\":0,\"streamBacklogPeak\":%u,\"wsBytes\":%u,\"wsFrames\":%u,\"wsSendErrors\":%u,\"freeHeap\":%u,\"minFreeHeap\":%u,\"largestHeapBlock\":%u,\"psramAvailable\":%u,\"psramTotal\":%u,\"freePsram\":%u,\"minFreePsram\":%u,\"largestPsramBlock\":%u,\"cpuLoadPct\":%d,\"cpuTempC\":%.2f,\"inflightWs\":%u,\"frameLimitPackets\":%u}",
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
                (unsigned int)frame_limit_packets
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
    set_rgb_state(LED_STATE_GREEN);


    // FreeRTOS Timer Tick Rate Workaround: 
    // Löschen des Main-Task-Watchdogs VOR dem Erstellen der anderen Tasks, 
    // da ws_net_task (Prio 5) und sensor_task (Prio 15) den app_main (Prio 1)
    // andernfalls sofort verhungern lassen und wir diesen Befehl nie erreichen würden!
    esp_task_wdt_delete(NULL);

    xTaskCreatePinnedToCore(sensor_task, "sensor_task", 12288, NULL, 15, NULL, 1); // Sensorlast auf Core 1, damit WiFi/HTTP auf Core 0 Luft behalten
    xTaskCreatePinnedToCore(ws_net_task, "ws_net_task", 16384, NULL, 5, NULL, 0); // WS-Transport nahe am WiFi/HTTP-Stack auf Core 0
                            
    return; // app_main Task sauber beenden
}
