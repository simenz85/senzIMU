# senzIMU

ESP-IDF- und PlatformIO-Projekt fuer das Seeed XIAO ESP32S3 mit LittleFS-basierter Weboberflaeche unter `data/`.

## Struktur

- `src/`: Firmware
- `data/`: Web-UI und Worker
- `lib/`: lokale Bibliotheken
- `include/`: Projekt-Header und Zusatzdateien

## Voraussetzungen

- PlatformIO
- ESP-IDF Toolchain

## Wichtige Befehle

Build:

```powershell
pio run -e seeed_xiao_esp32s3
```

Firmware hochladen:

```powershell
pio run -e seeed_xiao_esp32s3 -t upload
```

Dateisystem hochladen:

```powershell
pio run -e seeed_xiao_esp32s3 -t uploadfs
```

Seriellen Monitor starten:

```powershell
pio device monitor -b 115200
```
