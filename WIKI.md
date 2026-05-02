# SenzIMU Multichannel – Wiki & Funktionsreferenz

Willkommen im offiziellen Wiki für **SenzIMU Multichannel**. Dieses Dokument beschreibt alle wesentlichen Funktionen und Module des Systems im Detail.

---

## Inhaltsverzeichnis
1. [Sensoren & Abtastung](#1-sensoren--abtastung)
2. [Multi-Node Topologie (WiFi & ESP-NOW)](#2-multi-node-topologie-wifi--esp-now)
3. [Das Web-Dashboard](#3-das-web-dashboard)
4. [Live 3D-Tracking & Kinematik](#4-live-3d-tracking--kinematik)
5. [Vibrations-, Frequenz- & Modalanalyse](#5-vibrations--frequenz---modalanalyse)
6. [Live-Kalibrierung & Sensor-Fusion](#6-live-kalibrierung--sensor-fusion)
7. [Energiemanagement & Deep Sleep](#7-energiemanagement--deep-sleep)

---

## 1. Sensoren & Abtastung

SenzIMU unterstützt 6-DoF Inertialsensoren (IMU), typischerweise den [LSM6DSO](https://www.st.com/en/mems-and-sensors/lsm6dso.html) oder ähnliche ICs (ICM-42688).

- **Variable Abtastraten:** Die Firmware ermöglicht die kabellose Live-Einstellung der Sampling-Rate (ODR – Output Data Rate) von **26 Hz bis zu 6660 Hz**.
- **High-Speed SPI:** Die Kommunikation zwischen dem ESP32-S3 und der IMU erfolgt über einen dedizierten SPI-Bus (bis zu 5 MHz), was eine latenzfreie Erfassung selbst bei höchsten Frequenzen erlaubt.
- **Hardware-Filterung:** Die Sensoren nutzen integrierte Anti-Aliasing-Filter (Low-Pass), deren Cutoff-Frequenzen sich direkt über das Web-Dashboard steuern lassen.

---

## 2. Multi-Node Topologie (WiFi & ESP-NOW)

Das System ist darauf ausgelegt, Daten von *mehreren* Messpunkten gleichzeitig und absolut synchron zu erfassen.

- **Rollenverteilung:** Das System besteht aus **einem Master** und **mehreren Slaves (Nodes)**. 
- **Der Master:** Der Master fungiert als WiFi Access Point (Router) und spannt das WLAN `senzIMU` auf. Er betreibt den HTTP-Server, welcher das Dashboard (HTML/JS) an den Client (Browser) liefert.
- **Dezentrales WiFi Streaming:** Jeder einzelne Knoten (sowohl Master als auch Slaves) betreibt einen **eigenen, dedizierten WebSocket-Server**. Der Browser baut zu *jedem* Knoten eine direkte Punkt-zu-Punkt WebSocket-Verbindung auf, um die hochfrequenten Sensordaten parallel und ohne Flaschenhals zu empfangen. Der Master fungiert *nicht* als Relay für die Sensordaten der Slaves!
- **Microsecond Time-Sync:** Der Master sendet periodisch Beacon-Frames über ESP-NOW. Die Slaves berechnen den Offset ihrer internen Timer zu dem des Masters. Alle Zeitstempel der Sensordaten werden vor der Übertragung korrigiert. Das Resultat ist eine garantierte Synchronität der Datenpakete auf die Mikrosekunde genau.

---

## 3. Das Web-Dashboard

Das Dashboard ist eine Single-Page-Application (SPA), geschrieben in Vanilla HTML/JS/CSS, die komplett im LittleFS Speicher des ESP32-S3 liegt.

- **Lokales Hosting:** Es ist keine Internetverbindung oder App-Installation erforderlich.
- **WebWorker Architektur:** Um bei bis zu 6660 Hz auf mehreren Kanälen nicht den Browser-Thread zu blockieren, lagert SenzIMU rechenintensive Prozesse in WebWorker aus:
  - `decode-worker.js`: Dekodiert die binären WebSocket-Streams in Float-Arrays.
  - `fusion-worker.js`: Berechnet die Quaternions (Orientierung) via Mahony/Madgwick Filter.
  - `fft-worker.js`: Führt die Fast-Fourier-Transformationen im Hintergrund aus.
- **Performance-Charting:** Zum Zeichnen der Echtzeit-Graphen kommt **uPlot** zum Einsatz, was das latenzfreie Rendering von Millionen von Datenpunkten im Browser erlaubt.

---

## 4. Live 3D-Tracking & Kinematik

Eines der zentralen Features ist das Verfolgen der Bewegung der Sensoren im Raum.

- **Sensor Fusion:** Die Rohdaten (Beschleunigung und Gyroskop) werden durch einen AHRS-Algorithmus (Attitude and Heading Reference System) fusioniert. Dies verhindert den "Gyro-Drift" und liefert absolute Quaternions.
- **Three.js Rendering:** Im Dashboard wird eine virtuelle 3D-Szene aufgebaut. Die berechneten Quaternions werden auf 3D-Modelle (z. B. `Duck.glb` oder eigene Modelle) angewendet.
- **Kinematische Translation:** Neben der Drehung wird durch doppelte Integration der beschleunigungsbereinigten Daten (nach Abzug der Gravitation) die Positionsänderung (Translation) im Raum ermittelt.

---

## 5. Vibrations-, Frequenz- & Modalanalyse

Bei hochfrequenter Abtastung dient SenzIMU als fortgeschrittenes Diagnosetool für mechanische Schwingungen.

- **Live-FFT:** Die Zeitreihendaten der Sensoren werden kontinuierlich in den Frequenzbereich transformiert. Damit lassen sich dominierende Schwingungen und Resonanzen ermitteln (z. B. Rotordrehzahl eines Motors).
- **Wasserfall-Spektrogramm:** Das Dashboard visualisiert die FFT-Daten über die Zeit als 2.5D Spektrogramm. Farbverläufe repräsentieren die Intensität (Amplitude) bestimmter Frequenzen im Zeitverlauf.
- **Modalanalyse:** Da alle Sensorknoten im Netzwerk hochpräzise zeitsynchronisiert sind, können sie gleichzeitig an verschiedenen Punkten einer Struktur (z. B. einem Maschinengehäuse oder einem Träger) angebracht werden. Durch den Vergleich der Phasen und Amplituden zwischen den Sensoren bei spezifischen Resonanzfrequenzen lassen sich **Schwingungsformen (Mode Shapes)** und das dynamische Verhalten der gesamten Struktur live ableiten.

---

## 6. Live-Kalibrierung & Sensor-Fusion

Jeder Sensor unterliegt minimalen fertigungsbedingten Abweichungen (Offsets). SenzIMU bietet integrierte Tools zur Kalibrierung:

- **Gyroskop-Kalibrierung (Zero-Rate Offset):** Der Sensor wird in Ruhelage gemessen. Der gemessene Durchschnittswert wird als Offset dauerhaft auf dem NVS (Non-Volatile Storage) des ESP32-S3 hinterlegt und künftig automatisch von den Rohdaten abgezogen.
- **Beschleunigungs-Kalibrierung (Gravity-Cut):** Ermittlung des exakten 1G-Vektors am Einsatzort.
- **Remote-Konfiguration:** Sämtliche Kalibrierungswerte sowie Einstellungen (Filter, Range, Samplerate) können im Live-Betrieb vom Browser aus via WebSocket an die Knoten gesendet werden.

---

## 7. Energiemanagement & Deep Sleep

Für den Batteriebetrieb (z. B. bei autarken Sensorknoten an schwer zugänglichen Stellen) ist das Energiemanagement entscheidend.

- **Deep Sleep:** Wenn keine Verbindung zum Web-Dashboard aktiv ist (Timeout), legen sich die ESP32-S3 Knoten automatisch in den stromsparenden Deep Sleep Modus (wenige µA Verbrauch).
- **Touch-Wakeup (FSM):** SenzIMU nutzt den Hardware-Touch-Controller des ESP32-S3. Die RTC-Peripherie (Real-Time Clock) scannt im Schlafzustand periodisch einen kapazitiven Touch-Pin (z. B. am Gehäuse). Wird der Sensor berührt oder aufgenommen, wacht der Chip innerhalb von Millisekunden auf, verbindet sich mit dem Netzwerk und beginnt mit dem Streaming.
