# SPI ueber Distanz

## Ziel

Diese Datei enthaelt dieselbe Verdrahtungsinformation in drei Formen:
- als Mermaid-Diagramm
- als Tabelle
- als ASCII-Fallback

Wenn Mermaid in der Markdown-Vorschau nicht angezeigt wird, kannst du die Tabelle oder die ASCII-Darstellung direkt verwenden.

## Mermaid

```mermaid
flowchart LR
    subgraph XIAO["XIAO ESP32-S3"]
        X_SCK["D8 : SCK"]
        X_MOSI["D10 : MOSI"]
        X_MISO["D9 : MISO"]
        X_CS["D7 : CS"]
        X_3V3["3V3"]
        X_GND["GND"]
    end

    subgraph LSM["LSM6DSO Sensor"]
        S_SCK["SCL / SPC"]
        S_MOSI["SDA / SDI"]
        S_MISO["SDO"]
        S_CS["CS / NCS"]
        S_VDD["VDD & VDDIO"]
        S_GND["GND"]
    end

    X_SCK -->|"[Paar 1] Orange"| S_SCK
    X_GND -.->|"[Paar 1] Weiß-Orange"| S_GND

    X_MOSI -->|"[Paar 2] Grün"| S_MOSI
    X_GND -.->|"[Paar 2] Weiß-Grün"| S_GND

    X_MISO -->|"[Paar 3] Braun"| S_MISO
    X_GND -.->|"[Paar 3] Weiß-Braun"| S_GND

    X_CS -->|"[Paar 4] Blau"| S_CS
    X_3V3 -.->|"[Paar 4] Weiß-Blau"| S_VDD
```

## Verdrahtungstabelle

| Paar | Farbe | XIAO ESP32-S3 | Sensor | Rueckleiter |
|---|---|---|---|---|
| 1 | Orange / Weiß-Orange | D8 : SCK | SCL / SPC | GND |
| 2 | Grün / Weiß-Grün | D10 : MOSI | SDA / SDI | GND |
| 3 | Braun / Weiß-Braun | D9 : MISO | SDO | GND |
| 4 | Blau / Weiß-Blau | D7 : CS und 3V3 | CS / NCS und VDD & VDDIO | 3V3 |

## ASCII-Fallback

```text
XIAO ESP32-S3                        LSM6DSO Sensor
----------------------------        ----------------------------
D8   : SCK        --------------->  SCL / SPC
GND  / Rueckweg   - - - - - - - ->  GND

D10  : MOSI       --------------->  SDA / SDI
GND  / Rueckweg   - - - - - - - ->  GND

D9   : MISO       --------------->  SDO
GND  / Rueckweg   - - - - - - - ->  GND

D7   : CS         --------------->  CS / NCS
3V3  / Versorgung - - - - - - - ->  VDD & VDDIO
```

## Paar-Zuordnung

1. Paar 1: Orange an D8 : SCK, Weiß-Orange an GND.
2. Paar 2: Grün an D10 : MOSI, Weiß-Grün an GND.
3. Paar 3: Braun an D9 : MISO, Weiß-Braun an GND.
4. Paar 4: Blau an D7 : CS, Weiß-Blau an 3V3 beziehungsweise VDD & VDDIO.

## Hinweis

SPI ist fuer kurze Strecken gedacht. Bei laengeren Kabeln helfen verdrillte Paare mit nah gefuehrtem Rueckleiter dabei, Stoerungen und Uebersprechen zu reduzieren.