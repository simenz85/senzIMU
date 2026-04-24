# Plan zur Aufteilung von script2.js

## Ziel

[data/script2.js](data/script2.js) soll in kleinere, fachlich saubere Module zerlegt werden, ohne das bestehende Dashboard, Replay, Multi-Node-Verhalten oder die Worker-Kommunikation zu brechen.

Die Datei ist aktuell ein kombinierter Entry Point fuer:

- Laufzeitstatus und Ringbuffer
- Viewport- und Motion-Steuerung
- Filter-UI und Filter-Processing
- Persistenz und Kalibrierung
- WebSocket-, Decode- und Filter-Worker-Orchestrierung
- Echtzeit-Datenverarbeitung
- Multi-Node-Discovery und globale Dashboard-APIs
- Replay- und Popup-Integration

## Leitplanken

Diese Regeln gelten fuer jeden Schritt des Umbaus:

1. [data/script2.js](data/script2.js) bleibt zunaechst der einzige Entry Point.
2. Bestehende window-APIs bleiben vorerst erhalten und delegieren intern nur auf neue Module.
3. Pro Schritt wird genau eine fachliche Domäne extrahiert.
4. Kein Schritt darf gleichzeitig API-Form, Laufzeitverhalten und Initialisierungsreihenfolge aendern.
5. Neue Module duerfen keine zyklischen Imports erzeugen.
6. Jeder Schritt endet mit einer Smoke-Pruefung im Browser.

## Harte Kopplungspunkte

Diese Stellen definieren, was vorerst kompatibel bleiben muss:

- Replay nutzt [data/ui/replay-manager.js](data/ui/replay-manager.js#L31), [data/ui/replay-manager.js](data/ui/replay-manager.js#L151) und [data/ui/replay-manager.js](data/ui/replay-manager.js#L374).
- Node-UI nutzt [data/ui/ui-setup.js](data/ui/ui-setup.js#L262), [data/ui/ui-setup.js](data/ui/ui-setup.js#L440) und [data/ui/ui-setup.js](data/ui/ui-setup.js#L456).
- Worker-Erzeugung und Bootstrap sitzen in [data/script2.js](data/script2.js#L3577) und [data/script2.js](data/script2.js#L3870).
- Die globale Live-Verarbeitung haengt an [data/script2.js](data/script2.js#L4214) und [data/script2.js](data/script2.js#L4295).
- Die Multi-Node-API haengt an [data/script2.js](data/script2.js#L4746).
- Das Kalibrierungs-Popup greift indirekt ueber [data/script2.js](data/script2.js#L4775) und direkt ueber [data/script2.js](data/script2.js#L8638) auf den globalen Zustand zu.

## Aktuelle Window-API-Karte

Diese APIs sind heute implizite Verträge nach aussen und duerfen in den fruehen Phasen nicht verschwinden:

### Direkte Runtime- und Replay-APIs

- `window.wsWorker` aus [data/script2.js](data/script2.js#L3578)
  Verwendet von [data/ui/replay-manager.js](data/ui/replay-manager.js#L31) und [data/ui/ui-setup.js](data/ui/ui-setup.js#L262).
- `window.startChartUpdates` aus [data/script2.js](data/script2.js#L4214)
  Verwendet von [data/ui/replay-manager.js](data/ui/replay-manager.js#L36).
- `window.processSensorBatch` aus [data/script2.js](data/script2.js#L4295)
  Verwendet intern ueber [data/script2.js](data/script2.js#L4531).
- `window.applyStaticReplayData` aus [data/script2.js](data/script2.js#L7588)
  Verwendet von [data/ui/replay-manager.js](data/ui/replay-manager.js#L151).
- `window.updateReplayDashboard` aus [data/script2.js](data/script2.js#L7671)
  Verwendet von [data/ui/replay-manager.js](data/ui/replay-manager.js#L374).

### Multi-Node- und Node-UI-APIs

- `window.getNodeByIp` aus [data/script2.js](data/script2.js#L4746)
  Verwendet intern vom Popup in [data/script2.js](data/script2.js#L8669) und [data/script2.js](data/script2.js#L8753).
- `window.setNodeOrientationMode` aus [data/script2.js](data/script2.js#L4750)
  Verwendet von [data/ui/ui-setup.js](data/ui/ui-setup.js#L440).
- `window.toggleNodeGravityCut` aus [data/script2.js](data/script2.js#L4762)
  Verwendet von [data/ui/ui-setup.js](data/ui/ui-setup.js#L456).
- `window.openNodeCalibrationPopup` aus [data/script2.js](data/script2.js#L4775)
  Ist Einstiegspunkt fuer Node-bezogene Kalibrierung.
- `window.buildNodeAccelerationSample` aus [data/script2.js](data/script2.js#L4791)
  Verwendet intern in der Node-Pipeline bei [data/script2.js](data/script2.js#L4732).

### Daten- und Chart-APIs

- `window.insertIntoMultiChart` aus [data/script2.js](data/script2.js#L4996)
  Verwendet intern in [data/script2.js](data/script2.js#L4388) und [data/script2.js](data/script2.js#L4723).
- `window.activeSensors` aus [data/script2.js](data/script2.js#L4542)
  Ist globaler Zustand fuer Multi-Node und UI.
- `window.multiChartData` aus [data/script2.js](data/script2.js#L4543)
  Ist globaler Datencontainer fuer Multi-Chart-Bucketing.
- `window.multiFftData` aus [data/script2.js](data/script2.js#L4544)
  Ist globaler Datencontainer fuer FFT-Mehrkanalansicht.
- `window.setFftSensorCount` aus [data/script2.js](data/script2.js#L4546)
  Steuert Chart-Rekonfiguration fuer FFT.
- `window.setRmsSensorCount` aus [data/script2.js](data/script2.js#L4585)
  Steuert Chart-Rekonfiguration fuer RMS.
- `window.getMultiChartDataWindow` aus [data/script2.js](data/script2.js#L4837)
  Liefert geclipptes Multi-Chart-Zeitfenster.
- `window.updateDashboard` aus [data/script2.js](data/script2.js#L5343)
  Ist globaler Dashboard-Update-Einstieg.

### Kalibrierungs- und Sensor-Hilfen

- `window.buildLiveAccelerationSample`
  Wird indirekt ueber [data/script2.js](data/script2.js#L4796) als Master-Pfad der Node-Kalibrierung genutzt.
- `window.setOrientationMode`
  Wird indirekt ueber [data/script2.js](data/script2.js#L4757) fuer Master-Nodes genutzt.
- `window.setGravityCutEnabled`
  Wird indirekt ueber [data/script2.js](data/script2.js#L4769) fuer Master-Nodes genutzt.
- `window.resetDashboardBuffers` aus [data/script2.js](data/script2.js#L138)
  Ist globaler Reset-Hook fuer gepufferte Live-Daten.

### Sonstige globale Laufzeitobjekte

- `window.waterfallRenderer` und `window.gyroWaterfallRenderer` aus [data/script2.js](data/script2.js#L3899)
  Bleiben vorerst globale Integrationsobjekte fuer Waterfall-Ansichten.
- Audio-Status und Sonifikation ab [data/script2.js](data/script2.js#L9252)
  Diese Globals spaeter isolieren, aber in den fruehen Phasen unangetastet lassen.

Folgerung:
Die fruehen Refactor-Schritte duerven diese APIs nur intern umverdrahten, nicht entfernen oder umbenennen.

## Zielstruktur

Empfohlene Zielstruktur unter [data/app](data):

- [data/app/runtime/app-state.js](data)
  Zentrale State-Factory fuer Buffer, Flags, Worker-Referenzen, Charts und Laufzeitwerte.
- [data/app/runtime/window-api.js](data)
  Einziger Ort fuer window-Bindings und Rueckwaertskompatibilitaet.
- [data/app/runtime/bootstrap.js](data)
  Initialisiert Module und verdrahtet DOMContentLoaded.
- [data/app/runtime/workers.js](data)
  Erzeugt und verwaltet wsWorker, decodeWorker, Filter-Worker und optionale Worker.
- [data/app/buffers/buffer-registry.js](data)
  Erstellt Ringbuffer und kapselt Reset- und Windowing-Helfer.
- [data/app/telemetry/telemetry-controller.js](data)
  Telemetriepanel, Boot-Overlay, Status-Rendering.
- [data/app/motion/motion-controller.js](data)
  Motion-Viewport, Motion-Controls, Motion-Worker-Sync.
- [data/app/orientation/orientation-math.js](data)
  Quaternion-, Gravity- und Transform-Helfer ohne DOM.
- [data/app/orientation/calibration-store.js](data)
  Cookie- und localStorage-Persistenz fuer Kalibrierung und App-Settings.
- [data/app/orientation/orientation-controller.js](data)
  Orientation-Modes, Reference-State, Gravity-Cut, Viewport-Sync.
- [data/app/filter/filter-ui.js](data)
  Filter-Panel, Dropdown-Konfiguration, Sync-Toggle, Sichtbarkeit.
- [data/app/filter/filter-processing.js](data)
  Sample-Rate-Schaetzung, Warmup, Fensterbildung, Downsampling, Zero-Phase-IIR.
- [data/app/filter/filter-controller.js](data)
  Glue-Code zwischen UI, Processing, Buffern und Filter-Workern.
- [data/app/stream/stream-controller.js](data)
  setupWSWorker, connectWebSocket, decodeWorker-Verdrahtung, Basis-Datenfluss.
- [data/app/stream/sensor-batch-processor.js](data)
  Kernlogik fuer processSensorBatch, Buffer-Fuellen, Chart-Update, Audio-Hooks.
- [data/app/multinode/node-registry.js](data)
  activeSensors, Node-Zugriff, Node-Lebenszyklus.
- [data/app/multinode/node-pipeline.js](data)
  SensorNode-Klasse, per-Node-Worker und Bucketing.
- [data/app/replay/replay-bridge.js](data)
  Rueckwaertskompatible Hooks fuer Replay-Dashboard und statische Daten.
- [data/app/calibration/calibration-popup-controller.js](data)
  Popup-Logik mit klarer API statt direktem Zugriff auf verstreute Globals.

Hinweis:
Die Pfade unter [data/app](data) sind Zielbilder. Die Dateien existieren heute noch nicht. Wichtig ist die fachliche Trennung, nicht der exakte Name.

## Reihenfolge der Extraktion

### Phase 0: Sicherheitsnetz aufbauen

Ziel:
Bevor Logik verschoben wird, werden stabile Ein- und Ausgaenge definiert.

Arbeit:

1. In [data/script2.js](data/script2.js) eine interne Struktur `appState` einfuehren.
2. Alle spaeter zu extrahierenden Bereiche lesen und schreiben ueber diese Struktur, auch wenn die Variablen vorerst noch lokal bleiben.
3. Alle relevanten window-Exporte in einem Block sammeln und dokumentieren.

Abnahme:

- Dashboard laedt wie bisher.
- Replay funktioniert weiter.
- Keine neuen Konsolenfehler.

### Phase 1: Reine Hilfslogik auslagern

Ziel:
Seiteneffektarme Funktionen zuerst verschieben.

Quelle:

- [data/script2.js](data/script2.js#L2112) bis [data/script2.js](data/script2.js#L3179)

Extrahieren:

1. Cookie- und localStorage-Helfer
2. Sanitizer fuer App- und Viewport-Settings
3. Quaternion-Helfer
4. Gravity- und Transform-Helfer ohne DOM-Seiteneffekte

Neue Module:

1. `orientation-math.js`
2. `calibration-store.js`

Wichtig:

- Diese Module bekommen keine direkten DOM-Zugriffe.
- Sie kennen weder `window` noch Worker.

Abnahme:

- Kalibrierung wird unveraendert gelesen und geschrieben.
- Orientation-Wechsel zeigt dasselbe Verhalten.

### Phase 2: Buffer und gemeinsamer Zustand zentralisieren

Ziel:
Die verstreuten Top-Level-Variablen aus [data/script2.js](data/script2.js#L18) und die Ringbuffer aus [data/script2.js](data/script2.js#L53) werden in eine zentrale State-Quelle verschoben.

Neue Module:

1. `app-state.js`
2. `buffer-registry.js`

Inhalt:

- Buffer-Erzeugung
- Reset-Logik aus [data/script2.js](data/script2.js#L138)
- zentrale Flags wie `gravityCutEnabled`, `currentOrientationMode`, `currentSampleRate`
- Handles fuer Charts und Worker

Wichtig:

- Vorerst nur kapseln, nicht umbenennen.
- Bestehende Funktionen in [data/script2.js](data/script2.js) greifen ueber Adapter auf den Zustand zu.

Abnahme:

- Live-Chart, Filter und Replay greifen auf dieselben Daten wie vorher zu.

### Phase 3: Motion und Viewport abtrennen

Ziel:
Die Motion-Domaene ist fachlich gut isolierbar.

Quelle:

- [data/script2.js](data/script2.js#L216) bis [data/script2.js](data/script2.js#L448)
- Synchronisation in [data/script2.js](data/script2.js#L3021) bis [data/script2.js](data/script2.js#L3179)

Neue Module:

1. `motion-controller.js`
2. Teile von `orientation-controller.js`

Schnittstelle:

- Initialisierung bekommt DOM-Elemente, State und Worker injiziert.
- Exportiert nur klar benannte Methoden wie `initMotionControls`, `syncMotionTransform`, `buildMotionAccelerationSample`.

Abnahme:

- Motion-Tab laeuft.
- Motion-Reset, Slider und Mode-Toggle funktionieren.
- Keine Aenderung an [data/ui/motion-viewport.js](data/ui/motion-viewport.js).

### Phase 4: Filter in UI und Processing zerlegen

Ziel:
Die Filterlogik ist gross genug fuer zwei Module und zu riskant fuer einen Einzelschnitt.

Quelle UI:

- [data/script2.js](data/script2.js#L844) bis [data/script2.js](data/script2.js#L1219)

Quelle Processing:

- [data/script2.js](data/script2.js#L1289) bis [data/script2.js](data/script2.js#L1922)

Neue Module:

1. `filter-ui.js`
2. `filter-processing.js`
3. `filter-controller.js`

Regel:

- `filter-ui.js` darf keine Kenntnis von Ringbuffer-Implementierung haben.
- `filter-processing.js` darf keine DOM-Operationen ausfuehren.
- `filter-controller.js` verbindet beide Seiten.

Abnahme:

- Filter aktivieren/deaktivieren
- Acc- und Gyro-Filter synchronisieren
- Chart-Sichtbarkeit
- Warmup und Sample-Rate-Verhalten

### Phase 5: Telemetrie isolieren

Ziel:
Der Telemetrieblock ist gross, aber relativ eigenstaendig und daher ein guter spaeter Mittelschnitt.

Quelle:

- [data/script2.js](data/script2.js#L3584) bis [data/script2.js](data/script2.js#L3860)

Neues Modul:

1. `telemetry-controller.js`

Abnahme:

- Overlay-Zustaende wechseln korrekt.
- Panel laesst sich ein- und ausblenden.
- Werte aktualisieren sich weiter.

### Phase 6: Worker-Runtime trennen

Ziel:
Worker-Erzeugung und Worker-Verdrahtung aus dem Monolith loesen.

Quelle:

- [data/script2.js](data/script2.js#L3577) bis [data/script2.js](data/script2.js#L4531)

Neue Module:

1. `workers.js`
2. `stream-controller.js`

Wichtig:

- `window.wsWorker` bleibt wegen Replay und UI-Kompatibilitaet zunaechst erhalten.
- Worker werden an Fachmodule injiziert, nicht dort erzeugt.

Abnahme:

- Connect und Disconnect funktionieren.
- Decode-Worker liefert weiter an dieselbe Batch-Verarbeitung.
- Replay kann die Verbindung weiter unterbrechen.

### Phase 7: Sensor-Batch-Processing isolieren

Ziel:
Die Kernverarbeitung aus dem Live-Datenstrom auslagern, ohne Datenpfad zu aendern.

Quelle:

- [data/script2.js](data/script2.js#L4295) bis etwa [data/script2.js](data/script2.js#L4541)

Neues Modul:

1. `sensor-batch-processor.js`

Wichtig:

- Dieser Schritt erst nach Phase 2 bis 6.
- Die Funktion bleibt zunaechst unter `window.processSensorBatch` veroeffentlicht.

Abnahme:

- Live-Daten landen weiter in Charts, Buffern, FFT, RMS, Motion und Impact-Test.
- Audio-Sonifikation bleibt stabil.

### Phase 8: Multi-Node und Node-Pipeline isolieren

Ziel:
Die Node-spezifische Logik aus dem globalen Dateiende herausziehen.

Quelle:

- [data/script2.js](data/script2.js#L4542) bis in den Bucketing- und Dashboard-Bereich

Neue Module:

1. `node-registry.js`
2. `node-pipeline.js`
3. Teile von `replay-bridge.js`

Wichtig:

- Die APIs `window.getNodeByIp`, `window.setNodeOrientationMode`, `window.toggleNodeGravityCut` und `window.buildNodeAccelerationSample` bleiben erhalten.
- Das Popup nutzt vorerst weiter denselben Einstiegspunkt.

Abnahme:

- Discovery und Node-Anlage funktionieren.
- Node-Orientierung und Gravity-Cut werden in der UI sauber weitergereicht.

### Phase 9: Popup und Replay entkoppeln

Ziel:
Globale Seiteneffekte aus Popup und Replay in klare Bridges verschieben.

Quelle:

- Replay-APIs in [data/script2.js](data/script2.js#L7588) und [data/script2.js](data/script2.js#L7671)
- Popup-Logik ab [data/script2.js](data/script2.js#L8638)

Neue Module:

1. `replay-bridge.js`
2. `calibration-popup-controller.js`

Abnahme:

- Offline-Replay bleibt bedienbar.
- Kalibrierungs-Popup funktioniert fuer Master und Secondary Nodes weiter.

### Phase 10: script2.js auf Bootstrap reduzieren

Ziel:
[data/script2.js](data/script2.js) bleibt nur noch als dünne Fassade und kann spaeter in `bootstrap.js` umbenannt werden.

Endzustand:

- Imports aller Controller
- Erstellung von `appState`
- Initialisierung und Verdrahtung
- Export des Kompatibilitaetslayers nach `window`

## Was zuerst nicht angefasst werden sollte

Diese Bereiche sind spaet dran, weil sie viele Seiteneffekte haben:

1. `processSensorBatch`
2. Sonifikation
3. Replay-Bridge
4. SensorNode-Klasse
5. Popup-Logik

Wenn diese Bereiche zu frueh angefasst werden, steigt das Risiko fuer schwer sichtbare Laufzeitfehler stark.

## Empfohlene erste konkrete Extraktionswelle

Wenn wir direkt anfangen wollen, ist diese Welle die sicherste:

1. `orientation-math.js`
   Enthält Quaternion-, Gravity- und Transform-Helfer.
2. `calibration-store.js`
   Enthält Cookie-, localStorage- und Sanitizer-Helfer.
3. `app-state.js`
   Führt einen zentralen Zustand ein, ohne APIs zu aendern.

Diese erste Welle aendert nur wenig Laufzeitverhalten, reduziert aber bereits einen grossen Teil der Dateilaenge und schafft saubere Importgrenzen fuer alle spaeteren Schritte.

## Abnahmeliste pro Schritt

Nach jeder Extraktion manuell pruefen:

1. Seite startet ohne Syntax- oder Importfehler.
2. WebSocket verbindet sich.
3. Live-Charts aktualisieren sich.
4. Filter-UI reagiert.
5. Motion-Ansicht reagiert.
6. Kalibrierung wird wiederhergestellt.
7. Replay laesst sich starten.
8. Node-Controls in der UI funktionieren.
9. Browser-Konsole bleibt frei von neuen Fehlern.

## Klare Abbruchkriterien

Der Umbau wird sofort gestoppt und rueckwaerts abgesichert, wenn:

1. Ein Schritt neue globale API-Namen einfuehrt, die bestehende Verbraucher nicht kennen.
2. Imports zyklisch werden.
3. Worker doppelt erzeugt werden.
4. `processSensorBatch` in einem Schritt gleichzeitig fachlich und strukturell veraendert wird.
5. Replay oder Node-Kalibrierung nicht mehr stabil laufen.

## Empfehlung

Die naechste praktische Arbeit sollte nicht mit Filter oder Multi-Node beginnen, sondern mit Phase 1.

Der sicherste erste PR-Schnitt ist:

1. Quaternion- und Persistenzhilfen aus [data/script2.js](data/script2.js#L2112) bis [data/script2.js](data/script2.js#L3179) auslagern.
2. In [data/script2.js](data/script2.js) nur Imports und Delegation belassen.
3. Danach kurz im Browser smoke-testen.

Erst wenn dieser Schnitt stabil ist, sollte Phase 2 folgen.