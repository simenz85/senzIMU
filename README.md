# SenzIMU – Echtzeit‑IMU‑Dashboard für ESP32‑S3

## Projektübersicht
SenzIMU ist ein **Open‑Source‑Projekt**, das einen kompakten, kostengünstigen Inertialsensor‑Stack (IMU) auf einem **ESP32‑S3** Mikrocontroller bereitstellt und die Messdaten über **WebSocket** in Echtzeit an ein **Web‑Dashboard** überträgt. Das Dashboard ist vollständig **responsive** und unterstützt sowohl **Desktop‑ als auch Mobile‑Ansichten**. Ziel ist es, Entwicklern und Forschern ein sofort einsatzbereites System für **Bewegungsanalyse**, **Robotik‑Prototyping** und **IoT‑Sensor‑Monitoring** zu bieten.

---

## Kernfeatures
- **Echtzeit‑Streaming** von Beschleunigungs‑, Gyroskop‑ und Temperaturdaten über WebSocket.
- **Responsive Web‑UI** (HTML/JS) mit dynamischen Diagrammen (Chart.js) und mobiler Bottom‑Navigation.
- **OTA‑Firmware‑Updates** (HTTP‑POST) und **Fallback‑Recovery** über `curl`.
- **Captive‑Portal** für einfache WLAN‑Konfiguration auf dem ESP32‑S3.
- **Leistungsoptimierte Firmware**: FreeRTOS‑Task‑Prioritäten, minimaler Heap‑Verbrauch, asynchroner Sensor‑Read‑Loop.
- **Modularer Code**: Trennung von Sensor‑Logik, Netzwerk‑Stack und UI‑Server.
- **Unterstützung für mehrere IMU‑Modelle** (z. B. MPU‑6050, ICM‑42688).

---

## Hardware‑Komponenten
| Komponente | Beschreibung | Typ/Modell | Besonderheiten |
|------------|--------------|------------|----------------|
| **Mikrocontroller** | Hauptrechner, Wi‑Fi & Bluetooth, Dual‑Core | ESP32‑S3 (Xtensa LX7, 240 MHz, 512 KB RAM) | Unterstützt FreeRTOS, OTA, Captive‑Portal |
| **IMU‑Sensor** | 6‑DoF Beschleunigung + Gyroskop | ICM‑42688‑P (InvenSense) | 16‑Bit ADC, ±16 g / ±2000 °/s, integrierter Temperatursensor |
| **Stromversorgung** | 5 V USB‑Stromversorgung, optional Li‑Po‑Batterie | 5 V / 3.3 V LDO | Power‑Management‑IC für Batteriebetrieb |
| **PCB** | 2‑Lagen, 1,6 mm, 30 mm × 45 mm | Custom‑Design (KiCad) | 4 × M2‑Löcher für Gehäusebefestigung |
| **Gehäuse** | 3‑D‑gedruckt (PLA) | STL‑Dateien im `hardware/` Ordner | Öffnungen für Antenne & Sensor‑Kabel |
| **Optional** | Zusatzsensoren (Barometer, Magnetometer) | BMP280, QMC5883L | Erweiterbar via I2C‑Bus |

---

## Software‑Architektur
- **Firmware (C# 14 → .NET 10)**: Das Projekt nutzt **.NET 10** über **nanoFramework** für den ESP32‑S3. Der Code ist in **C#** geschrieben, performance‑optimiert mit `Span<T>` und `ref struct`s, um Heap‑Allokationen zu minimieren. Alle Klassen besitzen XML‑Summaries.
- **Web‑Server**: Leichtgewichtiger HTTP‑Server (Mongoose) liefert statische Dateien und verwaltet WebSocket‑Verbindungen.
- **Web‑Dashboard**: Vanilla‑HTML/JS, modernes CSS (Glassmorphism, dunkles Design) mit **Chart.js** für Diagramme. UI‑Komponenten sind modular und nutzen **Micro‑Animations** für ein Premium‑Gefühl.
- **Build‑System**: Vite wird für das Frontend verwendet, nanoFramework‑CLI für das Firmware‑Build.

---

## Schnell‑Start (Getting Started)
1. **Repository klonen**
   ```bash
   git clone https://github.com/simenz85/senzIMU.git
   cd senzIMU
   ```
2. **Firmware bauen** (requires .NET 10 SDK & nanoFramework CLI)
   ```bash
   dotnet build -c Release
   ```
   Das Ergebnis ist `bin/Release/net10/firmware.bin`.
3. **Firmware flashen** (ESP32‑S3 über USB)
   ```bash
   nfc flash bin/Release/net10/firmware.bin
   ```
4. **Web‑Dashboard starten** (Node.js & Vite)
   ```bash
   npm install
   npm run dev
   ```
   Das Dashboard ist unter `http://localhost:3000` erreichbar.
5. **WLAN‑Konfiguration**: Nach dem ersten Start verbindet sich das Gerät mit einem Captive‑Portal. Öffnen Sie das Netzwerk‑SSID‑Setup und geben Sie Ihre WLAN‑Daten ein.

---

## OTA‑Update & Wiederherstellung
- **OTA**: POST `/update` (Firmware) oder `/update_fs` (Dateisystem) mit Binärdatei. Der Server pausiert Sensor‑Tasks, schreibt das Image und startet neu.
- **Fallback**: Verwenden Sie `curl`:
  ```bash
  curl -F "file=@firmware.bin" http://<device_ip>/update
  ```
  Bei einem fehlgeschlagenen OTA kann das Gerät über das Captive‑Portal im **Recovery‑Mode** neu gestartet werden.

---

## Beitragende (Contributing)
1. Forken Sie das Repository.
2. Erstellen Sie einen Feature‑Branch (`git checkout -b feature/xyz`).
3. Schreiben Sie Tests (Unit‑Tests für C#‑Logik, UI‑Tests für das Dashboard).
4. Öffnen Sie einen Pull‑Request mit einer klaren Beschreibung.

---

## Lizenz
Dieses Projekt ist unter der **MIT‑Lizenz** veröffentlicht – siehe `LICENSE` Datei.

---

## Kontakt & Support
- **Issue Tracker**: https://github.com/simenz85/senzIMU/issues
- **Discord**: `#senzimu-dev` (Einladung auf Anfrage)
- **E‑Mail**: dev@senzimu.org

---

*Dieses README wurde automatisch generiert, um einen umfassenden Überblick über das SenzIMU‑Projekt zu geben. Für detaillierte Architekturdokumente siehe das `docs/` Verzeichnis.*
