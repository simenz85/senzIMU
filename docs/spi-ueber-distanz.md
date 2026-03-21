# Die Herausforderung: SPI über Distanz

SPI (Serial Peripheral Interface) ist eigentlich für die Kommunikation über wenige Zentimeter auf einer Platine gedacht. Nutzt du ein längeres LAN-Kabel, werden die Leitungskapazität und das Übersprechen (Crosstalk) zwischen den hochfrequenten Signalen zum Problem.

Um das zu lösen, machen wir uns die Struktur des LAN-Kabels zunutze. Jedes Adernpaar ist verdrillt (Twisted Pair). Wenn wir jedes schnelle Datensignal (SCK, MOSI, MISO) mit einer eigenen Masseleitung (GND) verdrillen, fangen wir Störsignale ab und geben dem Strom einen direkten Rückweg.

## Der Verdrahtungsplan

Hier ist die visuelle Darstellung der Verkabelung. Du bündelst auf der Seite des XIAO drei weiße Adern und verbindest sie mit dem einzigen GND-Pin. Dasselbe machst du auf der Seite des Sensors.

## Code-Snippet

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

## Paar-Zuordnung

1. Paar 1 (Orange): D8 an SCL/SPC. Das weiße Kabel an GND.
2. Paar 2 (Grün): D10 an SDA/SDI. Das weiße Kabel an GND.
3. Paar 3 (Braun): D9 an SDO. Das weiße Kabel an GND.
4. Paar 4 (Blau): D7 an CS/NCS. Das weiße Kabel an 3V3 (XIAO) bzw. VDD/VDDIO (Sensor).
