# senzIMU

senzIMU ist ein ESP-IDF- und PlatformIO-Projekt fuer das Seeed XIAO ESP32-S3. Die Firmware liest einen LSM6DSO per SPI aus, streamt Sensor- und Konfigurationsdaten ueber WLAN/WebSocket und stellt eine browserbasierte Analyse- und Bedienoberflaeche aus LittleFS bereit.

## Projektziel

Das Projekt verbindet drei Bereiche in einem Repository:

- Firmware fuer das XIAO ESP32-S3
- Web-UI fuer Live-Daten, FFT, RMS, Filter und Kalibrierung
- Dokumentation fuer Verdrahtung und Projektstruktur

Der Fokus liegt auf IMU-Datenerfassung, Live-Visualisierung und interaktiver Sensorausrichtung direkt im Browser.

## Hardware

- Board: Seeed XIAO ESP32-S3
- Sensor: ST LSM6DSO
- Bus: SPI
- Dateisystem: LittleFS
- Netzwerk: WLAN Access Point plus HTTP/WebSocket

## Firmware-Ueberblick

Die zentrale Firmware liegt in src/main.cpp und uebernimmt unter anderem:

- SPI-Initialisierung fuer den LSM6DSO
- Start des LittleFS-Dateisystems
- HTTP-Server fuer die Weboberflaeche
- WebSocket-Kommunikation fuer Sensordaten und Konfiguration
- IMU-Konfigurationsverwaltung fuer Sampleraten, Bereiche und Filter
- Streaming der Messdaten ueber FreeRTOS-Buffer

Aktuelle SPI-Belegung in der Firmware:

- CS = GPIO4
- SCK = GPIO7
- MISO = GPIO8
- MOSI = GPIO9
- SPI-Takt = 5 MHz

## Weboberflaeche

Die Dateien unter data/ werden nach LittleFS hochgeladen und im Browser ausgefuehrt. Die Web-UI bietet aktuell unter anderem:

- ACC-Livechart
- Gyro-Livechart
- ACC-FFT und RMS
- Gyro-FFT und RMS
- Filter-Worker fuer Live-Filterung
- 3D-Align-Ansicht fuer ACC- und Gyro-Ausrichtung
- Kalibrierung und Referenzaufnahme

Wichtige Frontend-Dateien:

- data/index.html: Hauptoberflaeche
- data/script2.js: zentrale UI-Logik
- data/stylesheet.css: Hauptstil
- data/decode-worker2.js: Dekodierung eingehender Sensordaten
- data/filter-worker.js: Streaming-Filterung
- data/fft-worker.js: FFT-Berechnung
- data/rms-worker.js: RMS-Berechnung
- data/ui/acc-vector-viewport.js: 3D-Viewport fuer manuelle Ausrichtung
- data/utils/format-utils.js: Hilfsfunktionen fuer Formatierung

## Projektstruktur

```text
.
|- src/
|  |- main.cpp
|  |- partitions_littlefs.csv
|  `- CMakeLists.txt
|- data/
|  |- index.html
|  |- script2.js
|  |- stylesheet.css
|  |- decode-worker2.js
|  |- fft-worker.js
|  |- rms-worker.js
|  |- filter-worker.js
|  |- ui/
|  |- utils/
|  |- charts/
|  `- icons/
|- lib/
|  |- LSM6DSO/
|  `- WSS/
|- include/
|- docs/
|  |- spi-ueber-distanz.md
|  `- spi-ueber-distanz-fallback.md
|- platformio.ini
|- sdkconfig.defaults
`- README.md
```

## Wichtige Verzeichnisse

- src/: Firmware und Partitionslayout
- data/: komplette Webanwendung fuer LittleFS
- lib/LSM6DSO/: Sensoransteuerung
- lib/WSS/: Keep-Alive- und Socket-Hilfen
- include/: Zusatzdateien und Projekt-Header
- docs/: projektspezifische Dokumentation

## Build-Konfiguration

Die PlatformIO-Konfiguration verwendet:

- Plattform: espressif32
- Framework: espidf
- Board: seeed_xiao_esp32s3
- Dateisystem: littlefs
- Partitionstabelle: src/partitions_littlefs.csv

Siehe dazu auch platformio.ini.

## Voraussetzungen

- PlatformIO
- ESP-IDF Toolchain
- USB-Zugriff auf das XIAO ESP32-S3
- Browser fuer die Weboberflaeche

## Build und Flash

Projekt bauen:

```powershell
pio run -e seeed_xiao_esp32s3
```

Firmware hochladen:

```powershell
pio run -e seeed_xiao_esp32s3 -t upload
```

LittleFS-Inhalt hochladen:

```powershell
pio run -e seeed_xiao_esp32s3 -t uploadfs
```

Seriellen Monitor starten:

```powershell
pio device monitor -b 115200
```

## Laufzeitverhalten

Nach dem Start initialisiert die Firmware den Sensor, mountet LittleFS und stellt die Weboberflaeche bereit. Die Kommunikation mit dem Browser erfolgt ueber WebSocket. Sensorwerte werden dekodiert, gefiltert, visualisiert und koennen direkt in der UI kalibriert werden.

## Dokumentation

Vorhandene Projektdokumente:

- docs/spi-ueber-distanz.md: Hauptdokument zur SPI-Verdrahtung
- docs/spi-ueber-distanz-fallback.md: alternative Darstellung mit Tabelle und ASCII-Fallback

## Hinweise

- Die Weboberflaeche unter data/ enthaelt mehrere Backup- und Experimentdateien. Nicht jede Datei ist Teil des aktiven Hauptpfads.
- Die verdrahtete SPI-Belegung in der Dokumentation sollte immer gegen src/main.cpp geprueft werden.
- Sampleraten werden in der Firmware und UI ueber feste Kennwerte wie 125, 833, 1660, 3330 und 6660 kodiert.
