# SenzIMU Hardware Connection Diagram (XIAO ESP32-S3)

The sensor firmware code is precisely tailored to the pinout of the **Seeed Studio XIAO ESP32-S3**. The GPIO numbers used in the software correspond 1:1 to the silkscreen labels (D0-D10) on the board.

## 📌 Graphical Pinout

```text
                           [ USB-C ]
                         +-----------+
    [Red]   RGB LED R  ---| D0     5V |--- (only if 5V needed for RGB-LED ring)
   [Green]  RGB LED G  ---| D1    GND |--- Common GND (IMU, LED, Touch)
   [Blue]   RGB LED B  ---| D2    3V3 |--- 3.3V VCC (LSM6DSO Sensor)
 [LSM6DSO]  SPI CS     ---| D3    D10 |--- SPI MOSI [LSM6DSO]
 [Cable]    Touch Pad  ---| D4     D9 |--- SPI MISO [LSM6DSO]
            Unused     ---| D5     D8 |--- SPI SCK  [LSM6DSO]
            TX         ---| D6     D7 |--- RX
                         +-----------+
```

## 📋 Wiring Tables

### 1. RGB Status LED
Serves as a system indicator (e.g., Green = Ready, Blue = Stream active, Red = Error).
_Hardware assumption: Common Cathode (shared ground)._

| Function | XIAO Pin | ESP32 GPIO |
| :--- | :--- | :--- |
| LED Red (R) | **D0** | GPIO 1 |
| LED Green (G) | **D1** | GPIO 2 |
| LED Blue (B) | **D2** | GPIO 3 |
| Common Ground | **GND** | - |
*(Note: Bare LEDs require appropriate current-limiting resistors!)*

### 2. LSM6DSO IMU Sensor (SPI)
The IMU is clocked via the **SPI3 bus** at 5 MHz.

| Function | LSM6DSO Module Pin | XIAO Pin | ESP32 GPIO |
| :--- | :--- | :--- | :--- |
| Power Supply | VCC | **3V3** | - |
| Ground | GND | **GND** | - |
| SPI Chip Select | CS / NCS | **D3** | GPIO 4 |
| SPI Clock | SCL / SCK | **D8** | GPIO 7 |
| SPI MISO (Master In Slave Out) | SDO / SA0 | **D9** | GPIO 8 |
| SPI MOSI (Master Out Slave In) | SDA / SDI | **D10** | GPIO 9 |

### 3. Capacitive Button (Sleep/Wakeup)
Serves as a trigger to wake the device from deep sleep or to trigger user interaction events such as system shutdown. The copper tape/pad is wired directly to the pin.

| Function | XIAO Pin | ESP32 GPIO |
| :--- | :--- | :--- |
| Touch Input (TOUCH5) | **D4** | GPIO 5 |

> **CPU Telemetry Note:** 
> The code also initializes the ESP's internal temperature sensor. It measures the direct operating temperature of the S3 chip and communicates purely internally, therefore requiring no external components.
