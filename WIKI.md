*Languages: [English](WIKI.md) | [Deutsch](WIKI_DE.md)*

# SenzIMU Multichannel – Wiki & Feature Reference

Welcome to the official wiki for **SenzIMU Multichannel**. This document details all essential functions and modules of the system.

---

## Table of Contents
1. [Sensors & Sampling](#1-sensors--sampling)
2. [Multi-Node Topology (WiFi & ESP-NOW)](#2-multi-node-topology-wifi--esp-now)
3. [The Web Dashboard](#3-the-web-dashboard)
4. [Live 3D Tracking & Kinematics](#4-live-3d-tracking--kinematics)
5. [Vibration, Frequency & Modal Analysis](#5-vibration-frequency--modal-analysis)
6. [Live Calibration & Sensor Fusion](#6-live-calibration--sensor-fusion)
7. [Power Management & Deep Sleep](#7-power-management--deep-sleep)

---

## 1. Sensors & Sampling

SenzIMU supports 6-DoF inertial sensors (IMUs), typically the [LSM6DSO](https://www.st.com/en/mems-and-sensors/lsm6dso.html) or similar ICs (ICM-42688).

- **Variable Sampling Rates:** The firmware allows for wireless, live adjustments of the sampling rate (ODR – Output Data Rate) from **26 Hz up to 6660 Hz**.
- **High-Speed SPI:** Communication between the ESP32-S3 and the IMU utilizes a dedicated SPI bus (up to 5 MHz), enabling latency-free acquisition even at the highest frequencies.
- **Hardware Filtering:** The sensors utilize integrated anti-aliasing filters (low-pass), the cutoff frequencies of which can be controlled directly via the web dashboard.

---

## 2. Multi-Node Topology (WiFi & ESP-NOW)

The system is designed to acquire data from *multiple* measuring points simultaneously and perfectly synchronized.

- **Role Distribution:** The system consists of **one Master** and **multiple Slaves (Nodes)**. 
- **The Master:** The master acts as a WiFi Access Point (router) and hosts the `senzIMU` WiFi network. It runs the HTTP server that delivers the dashboard (HTML/JS) to the client (browser).
- **Decentralized WiFi Streaming:** Every single node (master and slaves alike) runs its **own dedicated WebSocket server**. The browser establishes a direct point-to-point WebSocket connection to *each* node to receive the high-frequency sensor data in parallel without any bottlenecks. The master does *not* act as a relay for the slaves' sensor data!
- **Microsecond Time-Sync:** The master periodically sends beacon frames via ESP-NOW. The slaves calculate the offset of their internal timers relative to the master's. All timestamps of the sensor data are corrected prior to transmission. The result is guaranteed synchronicity of data packets down to the microsecond.

---

## 3. The Web Dashboard

The dashboard is a Single Page Application (SPA) written in Vanilla HTML/JS/CSS, hosted entirely within the LittleFS memory of the ESP32-S3.

- **Local Hosting:** No internet connection or app installation is required.
- **WebWorker Architecture:** To prevent blocking the browser thread at up to 6660 Hz across multiple channels, SenzIMU offloads computationally intensive processes to WebWorkers:
  - `decode-worker.js`: Decodes the binary WebSocket streams into Float arrays.
  - `fusion-worker.js`: Calculates quaternions (orientation) via Mahony/Madgwick filters.
  - `fft-worker.js`: Executes Fast Fourier Transforms in the background.
- **Performance Charting:** **uPlot** is used to draw the real-time graphs, allowing for the latency-free rendering of millions of data points directly in the browser.

---

## 4. Live 3D Tracking & Kinematics

One of the central features is tracking the movement of the sensors in space.

- **Sensor Fusion:** The raw data (acceleration and gyroscope) is fused using an AHRS (Attitude and Heading Reference System) algorithm. This prevents "gyro drift" and provides absolute quaternions.
- **Three.js Rendering:** A virtual 3D scene is built within the dashboard. The calculated quaternions are applied to 3D models (e.g., `Duck.glb` or custom models).
- **Kinematic Translation:** In addition to rotation, double integration of the acceleration-adjusted data (after subtracting gravity) determines the change in position (translation) in space.

---

## 5. Vibration, Frequency & Modal Analysis

At high-frequency sampling rates, SenzIMU serves as an advanced diagnostic tool for mechanical vibrations.

- **Live FFT:** The sensor's time-series data is continuously transformed into the frequency domain. This reveals dominant vibrations and resonances (e.g., the rotor speed of a motor).
- **Waterfall Spectrogram:** The dashboard visualizes the FFT data over time as a 2.5D spectrogram. Color gradients represent the intensity (amplitude) of specific frequencies over time.
- **Modal Analysis:** Because all sensor nodes in the network are highly precisely time-synchronized, they can be mounted simultaneously at different points on a structure (e.g., a machine housing or a beam). By comparing the phases and amplitudes between the sensors at specific resonant frequencies, **mode shapes** and the dynamic behavior of the entire structure can be derived live.

---

## 6. Live Calibration & Sensor Fusion

Every sensor has minimal manufacturing variances (offsets). SenzIMU provides integrated tools for calibration:

- **Gyroscope Calibration (Zero-Rate Offset):** The sensor is measured while at rest. The measured average value is permanently stored as an offset on the NVS (Non-Volatile Storage) of the ESP32-S3 and is automatically subtracted from the raw data going forward.
- **Acceleration Calibration (Gravity-Cut):** Determines the exact 1G vector at the operating location.
- **Remote Configuration:** All calibration values and settings (filters, range, sample rate) can be sent live from the browser to the nodes via WebSocket.

---

## 7. Power Management & Deep Sleep

Power management is crucial for battery operation (e.g., standalone sensor nodes in hard-to-reach areas).

- **Deep Sleep:** If no connection to the web dashboard is active (timeout), the ESP32-S3 nodes automatically enter a power-saving deep sleep mode (consuming only a few µA).
- **Touch-Wakeup (FSM):** SenzIMU utilizes the hardware touch controller of the ESP32-S3. While in the sleep state, the RTC (Real-Time Clock) peripheral periodically scans a capacitive touch pin (e.g., on the housing). If the sensor is touched or picked up, the chip wakes up within milliseconds, connects to the network, and begins streaming.
