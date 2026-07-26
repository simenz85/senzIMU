import UniDropdown from "./uniDropDown.js";
import { startFFTUpdates} from "../workers/fft-setup.js";


// Globale referenzen für Sensoren-Einstellungen entfernt!
// Nutze import { nodeDropdowns } from ... anstelle der globalen vars.

function getActiveWsWorker(fallbackWorker = null) {
  if (window.wsWorker) {
    return window.wsWorker;
  }

  return fallbackWorker || null;
}

export function setupDropdowns() {
  // FFT Fenstergröße
  let FFT_WINDOW_SIZE = 2048;
  let FFT_UPDATE_INTERVAL = 50;
  let N_AVG = 10;
  let FFT_AXIS_MODE = "COMBI";
  let FFT_WINDOW_TYPE = "RECTANGULAR";
  let DC_CUTOFF = true;
  let fftHighPass = 0;

  // Blocksize Dropdown
  new UniDropdown(document.getElementById("dropdown1"), {
    type: "select",
    label: "Time (s)",
    items: [
        { value: 0.1, label: "0.1 s" },
        { value: 0.25, label: "0.25 s" },
        { value: 0.5, label: "0.5 s" },
        { value: 1.0, label: "1.0 s" },
        { value: 2.0, label: "2.0 s" }
    ],
    defaultValue: 0.5,
    onChange: (value) => {
      // Wird nun primär von script2.js gehandled via onChange dort bzw. globalen events
      console.log("Time-Blocksize gewählt:", value);
    },
  });

  // Sample Rate Dropdown
  new UniDropdown(document.getElementById("dropdown2"), {
    type: "select",
    label: "Rate",
    items: [
      { value: 1000/60, label: "60 fps" },
      { value: 1000/30, label: "30 fps" },
      { value: 1000/20, label: "20 fps" },
      { value: 1000/10, label: "10 fps" },
      { value: 1000/5, label: "5 fps" },
      { value: 1000/1, label: "1 fps" }
    ],
    defaultValue: FFT_UPDATE_INTERVAL,
    onChange: (value) => {
      FFT_UPDATE_INTERVAL = Number(value);
      startFFTUpdates();
      console.log("Samplerate gewählt:", FFT_UPDATE_INTERVAL);
    }
  });

  // Samples Dropdown (FFT Durchschnittsanzahl)
  new UniDropdown(document.getElementById("dropdown3"), {
    type: "select",
    label: "Avg",
    items: [
      5,10,15,20,25,50,100,150,300
    ].map(v => ( { value: v, label: `${v}` } )),
    defaultValue: N_AVG,
    onChange: (value) => {
      N_AVG = Number(value);
      setAverageCount(N_AVG);
      console.log("Samples für FFT Durchschnitt gewählt:", N_AVG);
    }
  });

  // FFT Axis Mode Dropdown
  new UniDropdown(document.getElementById("dropdown6"), {
    type: "select",
    label: "AXIS",
    items: [
      { value: "COMBI", label: "KOMBINIERT" },
      { value: "ONLYX", label: "X" },
      { value: "ONLYY", label: "Y" },
      { value: "ONLYZ", label: "Z" }
    ],
    defaultValue: "COMBI",
    onChange: (value) => {
      FFT_AXIS_MODE = value;
      console.log("FFT AXIS Mode gewählt:", FFT_AXIS_MODE);
    }
  });

  // FFT Window Type Dropdown
  new UniDropdown(document.getElementById("dropdown4"), {
    type: "select",
    label: "Window",
    items: [
      { value: "BLACKMAN", label: "BLACKMAN" },
      { value: "HANNING", label: "HANNING" },
      { value: "HAMMING", label: "HAMMING" },
      { value: "RECTANGULAR", label: "RECTANGULAR" }
    ],
    defaultValue: "RECTANGULAR",
    onChange: (value) => {
      FFT_WINDOW_TYPE = value;
      console.log("FFT Window Type gewählt:", FFT_WINDOW_TYPE);
    }
  });




  // DC Cutoff Dropdown
  new UniDropdown(document.getElementById("dropdown5"), {
    type: "select",
    label: "DC",
    items: [
      { value: true, label: "YES" },
      { value: false, label: "NO" }
    ],
    defaultValue: true,
    onChange: (value) => {
      DC_CUTOFF = (value === "true" || value === true);
      console.log("DC Cutoff gewählt:", DC_CUTOFF);
    }
  });



  // Highpass Log Slider Dropdown
  new UniDropdown(document.getElementById("sliderDropdown"), {
    type: "logslider",
    label: "HPF",
    minValue: 0.001,
    maxValue: 100,
    defaultValue: 0,
    alpha: 0.3,
    onChange: (value) => {
      fftHighPass = value;
      console.log("FFT Highpass gewählt:", fftHighPass);
    }
  });

  // Hier könntest du noch IMU Dropdowns, Gyro, Accel, Temp etc. hinzufügen analog:

  // Beispiel: Accel Range Dropdown
  /*
  new UniDropdown(document.getElementById("accelRangeDD"), {
    type: "select",
    label: "Acc Range",
    items: [
      { value: 2, label: "±2g" },
      { value: 4, label: "±4g" },
      { value: 8, label: "±8g" },
      { value: 16, label: "±16g" }
    ],
    onChange: (value) => {
      console.log("Accel Range gewählt:", value);
    }
  });
  */

}
export function setupButtons() {
  const recordBtn = document.getElementById("recordBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const resetZoomBtn = document.getElementById("resetZoomBtn");
  const sidebarToggle = document.getElementById("sidebarToggle");


  // Record Button
  let isRecording = false;
  if (recordBtn) {
    recordBtn.addEventListener("click", () => {
      isRecording = !isRecording;
      recordBtn.classList.toggle("active");
      recordBtn.innerHTML = isRecording ? 'Stop' : 'Record';
      if (!isRecording && typeof recordedRows !== 'undefined' && recordedRows.length > 0) {
        if (downloadBtn) downloadBtn.style.display = "";
      } else {
        if (downloadBtn) downloadBtn.style.display = "none";
      }
    });
  }

  // Pause Button
  let paused = false;
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.classList.toggle("active");
      pauseBtn.innerHTML = paused ? "Play" : "Pause";
    });
  }

  // Download Button
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      if (typeof recordedRows !== 'undefined' && recordedRows.length === 0) return;
      // CSV Datei Erzeugen und Download starten
    });
  }

  // Reset Zoom Button
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener("click", () => {
      // Reset Zoom Logik
    });
  }


  // --- MULTI-SENSOR IDENTIFY & SYNC BUTTONS ---
  const btnIdentifySensor = document.getElementById("btnIdentifySensor");
  if (btnIdentifySensor) {
    btnIdentifySensor.addEventListener("click", () => {
      const targetIp = document.getElementById("settingsSensorTarget")?.value || "192.168.4.1";
      console.log(`[Identify] Sende Blink-Signal an ${targetIp}`);
      
      // Nutze die HTTP-API um die LED für 3 Sekunden cyan blinken zu lassen
      fetch(`http://${targetIp}/api/led_config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: "Blink", r: 0, g: 229, b: 255 })
      }).catch(e => console.warn("Identify failed", e));
      
      // Nach 3 Sekunden Default wiederherstellen
      setTimeout(() => {
        fetch(`http://${targetIp}/api/led_config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: "Solid", r: 255, g: 214, b: 0 }) // SenzIMU Yellow
        }).catch(e => console.warn("Identify revert failed", e));
      }, 3000);
    });
  }

  const btnSyncSettingsAll = document.getElementById("btnSyncSettingsAll");
  if (btnSyncSettingsAll) {
    btnSyncSettingsAll.addEventListener("click", () => {
      console.log("[Sync] Sende aktuelle Konfiguration an ALLE Sensoren!");
      
      let masterIp = "192.168.4.1";
      if (window.activeSensors && window.activeSensors.length > 0) {
          const masterNode = window.activeSensors.find(n => n.isMaster);
          if (masterNode && masterNode.ip) {
              masterIp = masterNode.ip;
          } else {
              masterIp = window.activeSensors[0].ip;
          }
      }

      // Hole aktuelle Werte aus der UI der MASTER Spalte!!
      const masterDD = nodeDropdowns[masterIp];
      const currentConfig = {
        ACCELRANGE: masterDD?.accelRange?.getValue()?.value || 16,
        ACCELSAMPLERATE: masterDD?.accelSampleRate?.getValue()?.value || 6660,
        ACCELFILTER: masterDD?.accelFilter?.getValue()?.value || 2,
        GYRORANGE: masterDD?.gyroRange?.getValue()?.value || 2000,
        GYROSAMPLERATE: masterDD?.gyroSampleRate?.getValue()?.value || 6660,
        GYROFILTER: masterDD?.gyroFilter?.getValue()?.value || 1,
        TEMPSAMPLERATE: masterDD?.tempSampleRate?.getValue()?.value || 1
      };
      
      // Sende an alle aktiven Nodes (einzeln, um JSON-Buffer-Overflows am ESP32 zu vermeiden)
      if (window.activeSensors) {
        window.activeSensors.forEach(node => {
          if (node.wsWorker) {
            Object.keys(currentConfig).forEach((key, index) => {
                const singleConfig = {};
                singleConfig[key] = currentConfig[key];
                setTimeout(() => {
                    node.wsWorker.postMessage({ type: 'send', msgContent: JSON.stringify(singleConfig) });
                }, index * 50); // 50ms Pause zwischen jedem Wert, damit der ESP hinterherkommt
            });
          }
        });
      }

      // UI für alle Secondary Nodes aktualisieren
      Object.keys(nodeDropdowns).forEach(ip => {
          if (ip !== masterIp) {
              const nd = nodeDropdowns[ip];
              if (nd) {
                  nd.accelRange?.setValueSelect(currentConfig.ACCELRANGE, true);
                  nd.accelSampleRate?.setValueSelect(currentConfig.ACCELSAMPLERATE, true);
                  nd.accelFilter?.setValueSelect(currentConfig.ACCELFILTER, true);
                  nd.gyroRange?.setValueSelect(currentConfig.GYRORANGE, true);
                  nd.gyroSampleRate?.setValueSelect(currentConfig.GYROSAMPLERATE, true);
                  nd.gyroFilter?.setValueSelect(currentConfig.GYROFILTER, true);
                  nd.tempSampleRate?.setValueSelect(currentConfig.TEMPSAMPLERATE, true);
              }
              if (!window.frontendConfigs[ip]) window.frontendConfigs[ip] = {};
              Object.assign(window.frontendConfigs[ip], currentConfig);
          }
      });
      
      // Button Feedback Animation
      const oldText = btnSyncSettingsAll.innerText;
      btnSyncSettingsAll.innerText = "✅ SYNCED!";
      btnSyncSettingsAll.style.background = "rgba(0, 255, 0, 0.3)";
      setTimeout(() => {
        btnSyncSettingsAll.innerText = oldText;
        btnSyncSettingsAll.style.background = "rgba(0, 150, 255, 0.2)";
      }, 1000);
    });
  }
}

export function setupSideSettingsDropdowns() {
    // Legacy function preserved for main.js compatibility
    // Dropdowns are now dynamically created via buildSettingsColumnForNode when nodes connect.
}

// SIDEPANEL SETTINGS
// --- MULTI-SENSOR WEICHE MIT FRONTEND-CACHE ---
window.frontendConfigs = window.frontendConfigs || {};

export function sendConfigToSelectedSensor(settingsObj) {
  const settingsJSON = JSON.stringify(settingsObj);
  const targetIp = document.getElementById("settingsSensorTarget")?.value || "192.168.4.1";
  const activeWsWorker = getActiveWsWorker();
  
  // Im Frontend cachen, damit wir es beim Zurückwechseln wieder abrufen können
  if (!window.frontendConfigs[targetIp]) {
      window.frontendConfigs[targetIp] = {};
  }
  Object.assign(window.frontendConfigs[targetIp], settingsObj);
  
  if (targetIp === "192.168.4.1") {
    if (!activeWsWorker) {
      console.warn('[Config] Kein aktiver wsWorker für Master-Konfiguration verfügbar.');
      return;
    }

    activeWsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log(`[Config] Sende an Master (192.168.4.1):`, settingsJSON);
  } else {
      if (window.activeSensors) {
          const node = window.activeSensors.find(n => n.ip === targetIp);
          if (node && node.wsWorker) {
              node.wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
              console.log(`[Config] Sende an Node (${targetIp}):`, settingsJSON);
          } else {
              console.warn(`[Config] Node ${targetIp} nicht gefunden!`);
          }
      }
  }
}

// Map für dynamische Dropdown-Instanzen pro Node
export const nodeDropdowns = {};
window.nodeDropdowns = nodeDropdowns;

export function buildSettingsColumnForNode(nodeIp, channelName, color, nodeMac = "") {
    const host = document.getElementById("multiNodeSettingsHost");
    if (!host) return;

    // Erzeuge Knoten-Container (Spalte)
    const colDiff = document.createElement("div");
    colDiff.style.display = "flex";
    colDiff.style.flexDirection = "column";
    colDiff.style.minWidth = "220px";
    colDiff.style.backgroundColor = "rgba(255,255,255,0.02)";
    colDiff.style.border = `1px solid ${color}`;
    colDiff.style.borderRadius = "6px";
    colDiff.style.padding = "10px";

    // CSS Klassen an HTML anpassen wie gewünscht, hier der einfache Weg:
    const safeIp = nodeIp.replace(/\./g, '_');
    const macDisplay = nodeMac ? `<br><span style="font-size:0.95rem; font-weight:bold; color:#e0e0e0; letter-spacing: 1px;">MAC: ${nodeMac}</span>` : "";
    
    colDiff.innerHTML = `
        <div style="font-weight:bold; color:${color}; margin-bottom:15px; border-bottom:1px solid ${color}; padding-bottom:10px;">
           <div style="display: flex; justify-content: space-between; align-items: start;">
               <div>
                   <span style="font-size:1.1rem">${channelName}</span><br>
                   <span style="font-size:0.75rem; color:#aaa; font-family:monospace;">IP: ${nodeIp}</span>
                   ${macDisplay}
               </div>
               <div style="display: flex; flex-direction: column; gap: 4px;">
               </div>
           </div>
        </div>
        
        <div class="label1" style="font-size:0.75rem; margin-top:5px;">COORDINATESYSTEM</div>
        <div class="dropdown" id="CSDD_${safeIp}">
          <button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button>
          <div class="dropdown-content"></div>
        </div>

        <button id="openBtn_${safeIp}" style="padding:4px; font-size:0.8rem; margin-top:4px;">Kalibrieren</button>
        <button class="toggle-button" id="gravityBtn_${safeIp}" style="padding:4px; font-size:0.8rem; margin-top:4px; margin-bottom:10px;">Cut Gravity</button>

        <div class="label1" style="font-size:0.75rem;">ACC SETTINGS</div>
        <div class="dropdown" id="accelSampleRateDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>
        <div class="dropdown" id="accelRangeDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>
        <div class="dropdown" id="accelFilterDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>

        <div class="label1" style="font-size:0.75rem; margin-top:10px;">GYRO SETTINGS</div>
        <div class="dropdown" id="gyroSampleRateDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>
        <div class="dropdown" id="gyroRangeDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>
        <div class="dropdown" id="gyroFilterDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>

        <div class="label1" style="font-size:0.75rem; margin-top:10px;">TEMP SETTINGS</div>
        <div class="dropdown" id="tempSampleRateDD_${safeIp}"><button class="dropdown-button"><span class="label"></span><span class="arrow">▼</span></button><div class="dropdown-content"></div></div>
        
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 8px;">
           <button id="ledConfigBtn_${safeIp}" style="padding:6px; border-radius: 4px; background: rgba(56, 101, 150, 0.3); border: 1px solid #386596; color: #fff; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(56,101,150,0.6)'" onmouseout="this.style.background='rgba(56,101,150,0.3)'">🎨 LED Config</button>
           <button id="identifyBtn_${safeIp}" style="padding:6px; border-radius: 4px; background: rgba(0, 229, 255, 0.2); border: 1px solid #00e5ff; color: #00e5ff; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,229,255,0.4)'" onmouseout="this.style.background='rgba(0,229,255,0.2)'">🚨 Identify</button>
           <button id="shutdownBtn_${safeIp}" style="padding:6px; border-radius: 4px; background: rgba(255,0,0,0.15); border: 1px solid rgba(255,0,0,0.5); color: #ff6b6b; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,0,0,0.3)'" onmouseout="this.style.background='rgba(255,0,0,0.15)'">Shutdown</button>
        </div>

        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1); text-align: center; cursor: pointer;">
           <span id="otaTriggerBtn_${safeIp}" style="font-size: 11px; color: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 4px; transition: all 0.2s; user-select: none;" onmouseover="this.style.color='rgba(255,255,255,0.6)'" onmouseout="this.style.color='rgba(255,255,255,0.2)'" title="Doppelklick für Firmware-Update dieses Nodes">SenzIMU v1.0.0</span>
        </div>
    `;

    host.appendChild(colDiff);

    // Initialisiere die logischen Dropdowns
    const cb = (key, val) => {
        let obj = {};
        obj[key] = val;
        // temporären Hack anwenden: Wir faken das Dropdown, damit sendConfigToSelectedSensor weiß wer der Empfänger ist
        const oldTarget = document.getElementById("settingsSensorTarget")?.value;
        const targetSelect = document.getElementById("settingsSensorTarget");
        if(targetSelect) targetSelect.value = nodeIp; // fake context
        sendConfigToSelectedSensor(obj);
        if(targetSelect && oldTarget) targetSelect.value = oldTarget; // revert
    };

    nodeDropdowns[nodeIp] = {
        accelRange: new UniDropdown(document.getElementById(`accelRangeDD_${safeIp}`), {
            type: 'select', label: 'Acc Range',
            items: [{ value: 2, label: "±2g" }, { value: 4, label: "±4g" }, { value: 8, label: "±8g" }, { value: 16, label: "±16g" }],
            onChange: (v) => cb('ACCELRANGE', v)
        }),
        accelSampleRate: new UniDropdown(document.getElementById(`accelSampleRateDD_${safeIp}`), {
            type: 'select', label: 'Sample Rate',
            items: [
                { value: 0, label: "OFF" }, { value: 125, label: "12.5 Hz" }, { value: 26, label: "26 Hz" },
                { value: 52, label: "52 Hz" }, { value: 104, label: "104 Hz" }, { value: 208, label: "208 Hz" },
                { value: 416, label: "416 Hz" }, { value: 833, label: "833 Hz" }, { value: 1660, label: "1666 Hz" },
                { value: 3330, label: "3333 Hz" }, { value: 6660, label: "6666 Hz" }
            ],
            onChange: (v) => cb('ACCELSAMPLERATE', v)
        }),
        accelFilter: new UniDropdown(document.getElementById(`accelFilterDD_${safeIp}`), {
            type: 'select', label: 'Accel Filter',
            items: [{ value: 0, label: "OFF" }, { value: 1, label: "LOWPASS" }, { value: 2, label: "HIGHPASS 1" }, { value: 3, label: "HIGHPASS 2" }],
            onChange: (v) => cb('ACCELFILTER', v)
        }),
        gyroRange: new UniDropdown(document.getElementById(`gyroRangeDD_${safeIp}`), {
            type: 'select', label: 'Gyro Range',
            items: [{ value: 125, label: "±125°/s" }, { value: 250, label: "±250°/s" }, { value: 500, label: "±500°/s" }, { value: 1000, label: "±1000°/s" }, { value: 2000, label: "±2000°/s" }],
            onChange: (v) => cb('GYRORANGE', v)
        }),
        gyroSampleRate: new UniDropdown(document.getElementById(`gyroSampleRateDD_${safeIp}`), {
            type: 'select', label: 'Gyro Sample Rate',
            items: [
                { value: 0, label: "OFF" }, { value: 125, label: "12.5 Hz" }, { value: 26, label: "26 Hz" },
                { value: 52, label: "52 Hz" }, { value: 104, label: "104 Hz" }, { value: 208, label: "208 Hz" },
                { value: 416, label: "416 Hz" }, { value: 833, label: "833 Hz" }, { value: 1660, label: "1666 Hz" },
                { value: 3330, label: "3333 Hz" }, { value: 6660, label: "6666 Hz" }
            ],
            onChange: (v) => cb('GYROSAMPLERATE', v)
        }),
        gyroFilter: new UniDropdown(document.getElementById(`gyroFilterDD_${safeIp}`), {
            type: 'select', label: 'Gyro Filter',
            items: [{ value: 0, label: "OFF" }, { value: 1, label: "LOWPASS" }, { value: 2, label: "HIGHPASS 1" }, { value: 3, label: "HIGHPASS 2" }],
            onChange: (v) => cb('GYROFILTER', v)
        }),
        tempSampleRate: new UniDropdown(document.getElementById(`tempSampleRateDD_${safeIp}`), {
            type: 'select', label: 'Temp Samplerate',
            items: [{ value: 0, label: "OFF" }, { value: 1, label: "1.6 Hz" }, { value: 2, label: "12.5 Hz" }, { value: 3, label: "52 Hz" }],
            onChange: (v) => cb('TEMPSAMPLERATE', v)
        }),
        csdd: new UniDropdown(document.getElementById(`CSDD_${safeIp}`), {
            type: 'select', label: 'Orientation',
            items: [
                { value: "0", label: "World Simple" },
                { value: "5", label: "World Advanced" },
                { value: "1", label: "Fixed Axis (Z-up)" },
            ],
            onChange: (v) => {
                if(window.setNodeOrientationMode) window.setNodeOrientationMode(nodeIp, Number(v));
            }
        })
    };
    
    // Bind Local Calibration Buttons
    const openBtn = document.getElementById(`openBtn_${safeIp}`);
    if (openBtn) {
        openBtn.addEventListener("click", () => {
            if(window.openNodeCalibrationPopup) window.openNodeCalibrationPopup(nodeIp);
        });
    }

    const gravityBtn = document.getElementById(`gravityBtn_${safeIp}`);
    if (gravityBtn) {
        if (window.getNodeByIp) {
            const tempNode = window.getNodeByIp(nodeIp);
            if (tempNode && tempNode.gravityCutEnabled) {
                gravityBtn.classList.add('active');
            }
        }
        gravityBtn.addEventListener("click", () => {
            if(window.toggleNodeGravityCut) {
                const newState = window.toggleNodeGravityCut(nodeIp);
                gravityBtn.classList.toggle('active', newState);
            }
        });
    }

    const identifyBtn = document.getElementById(`identifyBtn_${safeIp}`);
    if (identifyBtn) {
        identifyBtn.addEventListener("click", () => {
            const oldTarget = document.getElementById("settingsSensorTarget")?.value;
            const targetSelect = document.getElementById("settingsSensorTarget");
            if (targetSelect) targetSelect.value = nodeIp; // fake context
            
            sendConfigToSelectedSensor({ COMMAND: "IDENTIFY" });
            
            if (targetSelect && oldTarget) targetSelect.value = oldTarget; // revert
        });
    }

    const shutdownBtn = document.getElementById(`shutdownBtn_${safeIp}`);
    if (shutdownBtn) {
        shutdownBtn.addEventListener("click", () => {
            const overlay = document.createElement("div");
            overlay.style.position = "fixed";
            overlay.style.inset = "0";
            overlay.style.zIndex = "4000";
            overlay.style.display = "flex";
            overlay.style.alignItems = "center";
            overlay.style.justifyContent = "center";
            overlay.style.padding = "24px";
            overlay.style.background = "rgba(0, 0, 0, 0.7)";
            overlay.style.backdropFilter = "blur(10px)";
            overlay.style.color = "#f1f4f8";
            overlay.style.fontFamily = "'Segoe UI', 'Roboto', Arial, sans-serif";
            overlay.style.opacity = "0";
            overlay.style.transition = "opacity 200ms ease";

            overlay.innerHTML = `
              <div class="shutdown-card">
                <div class="shutdown-title">Sensor Herunterfahren?</div>
                <div style="margin-bottom: 15px; color: #b0b8c1; font-size: 0.95rem;">Soll der Sensor (${nodeIp}) wirklich in den Deep Sleep versetzt werden?</div>
                <div class="shutdown-buttons">
                  <button id="btnNodeShutdownNo_${safeIp}" class="shutdown-btn-no">Abbrechen</button>
                  <button id="btnNodeShutdownYes_${safeIp}" class="shutdown-btn-yes">Herunterfahren</button>
                </div>
              </div>
            `;
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.style.opacity = "1";
            });

            const closeOverlay = () => {
                overlay.style.opacity = "0";
                setTimeout(() => overlay.remove(), 200);
            };

            document.getElementById(`btnNodeShutdownNo_${safeIp}`).addEventListener("click", closeOverlay);
            
            document.getElementById(`btnNodeShutdownYes_${safeIp}`).addEventListener("click", () => {
                closeOverlay();
                const oldTarget = document.getElementById("settingsSensorTarget")?.value;
                const targetSelect = document.getElementById("settingsSensorTarget");
                if (targetSelect) targetSelect.value = nodeIp; // fake context
                
                sendConfigToSelectedSensor({ COMMAND: "SHUTDOWN" });
                
                if (targetSelect && oldTarget) targetSelect.value = oldTarget; // revert
                
                shutdownBtn.innerText = "Shutting down...";
                shutdownBtn.style.opacity = "0.5";
                shutdownBtn.disabled = true;
            });
        });
    }

    const ledConfigBtn = document.getElementById(`ledConfigBtn_${safeIp}`);
    if (ledConfigBtn) {
        ledConfigBtn.addEventListener("click", () => {
            const targetSelect = document.getElementById("settingsSensorTarget");
            if (targetSelect) {
                targetSelect.value = nodeIp; // Change global target to this sensor permanently while overlay is open
            }
            
            const globalLedBtn = document.getElementById("btnOpenLedConfigOverlay");
            if (globalLedBtn) {
                globalLedBtn.click();
            }
        });
    }

    const otaBtn = document.getElementById(`otaTriggerBtn_${safeIp}`);
    if (otaBtn) {
        otaBtn.addEventListener("dblclick", () => {
            if (typeof window.triggerGlobalOtaUpload === 'function') {
                window.triggerGlobalOtaUpload(nodeIp, channelName);
            }
        });
    }

    // Lade Sensor Config in UI
    let cfg = {
        ACCELSAMPLERATE: 833, GYROSAMPLERATE: 833, ACCELRANGE: 4, GYRORANGE: 500,
        ACCELFILTER: 1, GYROFILTER: 1, TEMPSAMPLERATE: 1
    };
    if (window.sensorConfigs && window.sensorConfigs[nodeIp]) {
        const sCfg = window.sensorConfigs[nodeIp];
        if(sCfg[100] !== undefined) cfg.ACCELSAMPLERATE = sCfg[100];
        if(sCfg[101] !== undefined) cfg.ACCELRANGE = sCfg[101];
        if(sCfg[102] !== undefined) cfg.ACCELFILTER = sCfg[102];
        if(sCfg[103] !== undefined) cfg.GYROSAMPLERATE = sCfg[103];
        if(sCfg[104] !== undefined) cfg.GYRORANGE = sCfg[104];
        if(sCfg[105] !== undefined) cfg.GYROFILTER = sCfg[105];
        if(sCfg[106] !== undefined) cfg.TEMPSAMPLERATE = sCfg[106];
    }
    if (window.frontendConfigs && window.frontendConfigs[nodeIp]) Object.assign(cfg, window.frontendConfigs[nodeIp]);

    const nd = nodeDropdowns[nodeIp];
    nd.accelRange.setValueSelect(cfg.ACCELRANGE, true);
    nd.accelSampleRate.setValueSelect(cfg.ACCELSAMPLERATE, true);
    nd.accelFilter.setValueSelect(cfg.ACCELFILTER, true);
    nd.gyroRange.setValueSelect(cfg.GYRORANGE, true);
    nd.gyroSampleRate.setValueSelect(cfg.GYROSAMPLERATE, true);
    nd.gyroFilter.setValueSelect(cfg.GYROFILTER, true);
    nd.tempSampleRate.setValueSelect(cfg.TEMPSAMPLERATE, true);

    if (window.getNodeByIp) {
        const tempNode = window.getNodeByIp(nodeIp);
        if (tempNode && typeof tempNode.orientationMode !== 'undefined') {
            nd.csdd.setValueSelect(tempNode.orientationMode.toString(), true);
        }
    }
}

// Weitere Setup-Funktion für Formular
export function setupFormHandler(wsWorker) {
  const form = document.getElementById("settingsForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const settingsObj = {};
    formData.forEach((val, key) => {
      settingsObj[key] = val;
    });
    const settingsJSON = JSON.stringify(settingsObj);
    const activeWsWorker = getActiveWsWorker(wsWorker);
    if (!activeWsWorker) {
      console.warn('[SettingsForm] Kein aktiver wsWorker verfügbar.');
      return;
    }

    activeWsWorker.postMessage({ type: "send", msgContent: settingsJSON });
  });
}
