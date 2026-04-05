# 📡 OTA (Over-The-Air) Flash Anleitung für senzIMU

Diese Anleitung beschreibt, wie du deinen ESP32 kabellos über das Netzwerk flashen kannst, ohne diesen per USB anschließen zu müssen. Das funktioniert selbst dann, wenn das Frontend (die Weboberfläche) kaputtgeladen wurde oder fehlerhaft ist, da wir eine reine Backend-Verbindung (`RAW Binary POST`) nutzen.

---

## 🛠 Voraussetzungen

Damit OTA via Terminal funktioniert, musst du folgende Dinge sicherstellen:
1. Der ESP32 muss eingeschaltet sein und du bist mit dem WLAN des ESP32 verbunden (z.B. als Access Point) oder der ESP32 befindet sich in deinem lokalen Netzwerk.
2. Du benötigst das Programm `curl`. 
   - **Tipp für Windows-Nutzer:** Nutze in der Windows-PowerShell immer `curl.exe`, da `curl` in PowerShell standardmäßig ein fehlerhafter Alias für `Invoke-WebRequest` ist. (In Linux/Mac reicht einfach `curl`).

## 📁 1. Dateisystem (LittleFS / Web-Dateien) Flashen

Wenn du Änderungen an deiner `index.html`, `stylesheet.css`, `script.js` oder ähnlichen Web-Dateien im `data/`-Ordner gemacht hast, muss das Dateisystem neu hochgeladen werden.

1. Baue das Dateisystem-Image in PlatformIO (z.B. via Task **Build Filesystem Image** u.a. in VS Code, oder in der Konsole mit `pio run -t buildfs`).
2. Dadurch wird die Datei `.pio/build/seeed_xiao_esp32s3/littlefs.bin` erstellt.
3. Führe im Haupt-Projektordner folgenden Befehl im Terminal / PowerShell aus:

```bash
# Sende das LittleFS Image an den ESP32 (Passe ggf. die IP-Adresse 192.168.4.1 an dein Setup an)
curl.exe --data-binary @.pio/build/seeed_xiao_esp32s3/littlefs.bin http://192.168.4.1/update_fs
```

Nach wenigen Sekunden antwortet das Terminal mit `FS Update Success. Rebooting...` und dein ESP32 startet mit den neuen Webseiten-Dateien neu!

## 💻 2. Firmware (App-Code / C++) Flashen

Wenn du Änderungen an der `main.cpp` oder im `src/`-Ordner vorgenommen hast, muss der Hauptcode neu kompiliert und hochgeladen werden.

1. Kompiliere dein Projekt in PlatformIO (z.B. über das Häkchen / **Build** Task, oder am Terminal `pio run`).
2. Dadurch wird die Datei `.pio/build/seeed_xiao_esp32s3/firmware.bin` erzeugt.
3. Führe im Haupt-Projektordner folgenden Befehl im Terminal / PowerShell aus:

```bash
# Sende die C++ Firmware an den ESP32 (Passe ggf. die IP-Adresse 192.168.4.1 an)
curl.exe --data-binary @.pio/build/seeed_xiao_esp32s3/firmware.bin http://192.168.4.1/update
```

Der Vorgang dauert (je nach WLAN-Verbindung und Dateigröße) ein kleines bisschen länger. Danach antwortet das Terminal mit `Firmware Update Success. Rebooting...` und der ESP32 startet mit der neuen Logik neu!

---

## 🆘 Fehlerbehebung (Troubleshooting)

- **Fehler: "Connection refused" / "Timeout"**
  Überprüfe, ob du wirklich mit dem WLAN des ESP32 verbunden bist. Lässt sich die Seite `http://192.168.4.1` im Browser (notfalls rudimentär) öffnen? 
- **Fehler in der Powershell: "'@.pio/build/...' kann nicht aufgelöst werden"**
  Stelle sicher, dass du im Terminal `curl.exe` mit dem `.exe` am Ende verwendest, nicht das PowerShell-eigene `curl`.
- **Nichts passiert nach dem Update:** 
  Warte 3-5 Sekunden und lade die Webseite einmal mit `Strg + F5` (Cache-Refresh) neu.
- **Wenn gar nichts mehr geht:**
  Sollte während des Flash-Vorgangs der Strom ausfallen und dein ESP32 reagiert gar nicht mehr (Bootloop), musst du *einmalig* das Backup per USB-Kabel über PlatformIO einspielen (`Upload` / `Upload Filesystem Image`). Ab dann sind die OTA-Endpunkte wieder aktiv.
