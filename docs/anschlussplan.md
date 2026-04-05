# SenzIMU Hardware Anschlussplan (XIAO ESP32-S3)

Der Code der Sensor-Firmware ist exakt auf das Pinout des **Seeed Studio XIAO ESP32-S3** zugeschnitten. Die in der Software verwendeten GPIO-Nummern entsprechen 1:1 dem Bestückungsaufdruck (D0-D10) auf dem Board.

## 📌 Grafisches Pinout

```text
                           [ USB-C ]
                         +-----------+
    [Rot]  RGB LED R  ---| D0     5V |--- (nur falls 5V für RGB-LED Ring nötig)
   [Grün]  RGB LED G  ---| D1    GND |--- Gemeinsames GND (IMU, LED, Touch)
   [Blau]  RGB LED B  ---| D2    3V3 |--- 3.3V VCC (LSM6DSO Sensor)
 [LSM6DSO] SPI CS     ---| D3    D10 |--- SPI MOSI [LSM6DSO]
 [Kabel]   Touch Pad  ---| D4     D9 |--- SPI MISO [LSM6DSO]
           Unbelegt   ---| D5     D8 |--- SPI SCK  [LSM6DSO]
           TX         ---| D6     D7 |--- RX
                         +-----------+
```

## 📋 Verdrahtungs-Tabellen

### 1. RGB Status LED
Dient als Systemindikator (z.B. Grün = Ready, Blau = Stream läuft, Rot = Fehler).
_Hardware-Annahme: Common Cathode (Gemeinsame Masse)._

| Funktion | XIAO Pin | ESP32 GPIO |
| :--- | :--- | :--- |
| LED Rot (R) | **D0** | GPIO 1 |
| LED Grün (G) | **D1** | GPIO 2 |
| LED Blau (B) | **D2** | GPIO 3 |
| Gemeinsame Masse | **GND** | - |
*(Hinweis: Nackte LEDs benötigen einen passenden Vorwiderstand!)*

### 2. LSM6DSO IMU Sensor (SPI)
Die IMU ist über den **SPI3-Bus** mit 5 MHz getaktet.

| Funktion | LSM6DSO Modul Pin | XIAO Pin | ESP32 GPIO |
| :--- | :--- | :--- | :--- |
| Stromversorgung | VCC | **3V3** | - |
| Masse | GND | **GND** | - |
| SPI Chip Select | CS / NCS | **D3** | GPIO 4 |
| SPI Clock | SCL / SCK | **D8** | GPIO 7 |
| SPI MISO (Master In Slave Out) | SDO / SA0 | **D9** | GPIO 8 |
| SPI MOSI (Master Out Slave In) | SDA / SDI | **D10** | GPIO 9 |

### 3. Kapazitiver Button (Sleep/Wakeup)
Dient als Trigger, um das Gerät aus dem Deep-Sleep aufzuwecken oder per Nutzerinteraktion Events wie einen System-Shutdown auszulösen. Das Kupfertape/Pad wird direkt mit dem Pin verdrahtet.

| Funktion | XIAO Pin | ESP32 GPIO |
| :--- | :--- | :--- |
| Touch-Eingang (TOUCH5) | **D4** | GPIO 5 |

> **Hinweis zur CPU-Telemetrie:** 
> Der Code initialisiert auch den ESP-internen Temperaturfühler. Dieser misst die direkte Betriebstemperatur des S3-Chips und kommuniziert rein intern, benötigt also keine äußeren Bauteile.
