
# SenzIMU Hardware Wiring Plan (XIAO ESP32-S3)

The sensor firmware has been designed specifically for the **Seeed Studio XIAO ESP32-S3**. The GPIO numbers used in the firmware correspond **1:1** to the silkscreen labels (**D0–D10**) printed on the board.

## Pin Layout

```text
                           [ USB-C ]
                         +-----------+
    [Red]   RGB LED R ----| D0     5V |--- (Only required when powering a 5V RGB LED ring)
    [Green] RGB LED G ----| D1    GND |--- Common Ground (IMU, LED, Touch)
    [Blue]  RGB LED B ----| D2    3V3 |--- 3.3V Supply (LSM6DSO)
 [LSM6DSO]  SPI CS   ----| D3    D10 |--- SPI MOSI
 [Touch]    Touch Pad ----| D4     D9 |--- SPI MISO
            Unused   ----| D5     D8 |--- SPI SCK
            TX       ----| D6     D7 |--- RX
                         +-----------+
```

## Wiring Tables

### 1. RGB Status LED

Used as a system status indicator (for example: Green = Ready, Blue = Streaming, Red = Error).

**Hardware assumption:** Common Cathode (shared GND).

| Function | XIAO Pin | ESP32 GPIO |
|----------|----------|------------|
| Red LED | **D0** | GPIO 1 |
| Green LED | **D1** | GPIO 2 |
| Blue LED | **D2** | GPIO 3 |
| Common Ground | **GND** | — |

> **Note:** Bare LEDs require suitable current-limiting resistors.

---

### 2. LSM6DSO IMU (SPI)

The IMU communicates over the **SPI3 bus** running at **5 MHz**.

| Function | LSM6DSO Pin | XIAO Pin | ESP32 GPIO |
|----------|-------------|----------|------------|
| Power | VCC | **3V3** | — |
| Ground | GND | **GND** | — |
| Chip Select | CS / NCS | **D3** | GPIO 4 |
| SPI Clock | SCK | **D8** | GPIO 7 |
| SPI MISO | SDO / SA0 | **D9** | GPIO 8 |
| SPI MOSI | SDI / SDA | **D10** | GPIO 9 |

---

### 3. Capacitive Touch Button (Sleep / Wake-Up)

Used to wake the device from Deep Sleep or trigger user events such as a controlled shutdown. The copper pad/tape is connected directly to the touch pin.

| Function | XIAO Pin | ESP32 GPIO |
|----------|----------|------------|
| Touch Input (TOUCH5) | **D4** | GPIO 5 |

> **CPU Telemetry**
>
> The firmware also initializes the ESP32-S3's internal temperature sensor. This sensor measures the chip's operating temperature internally and does **not** require any external hardware.
