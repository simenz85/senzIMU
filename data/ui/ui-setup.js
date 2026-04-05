import UniDropdown from "./uniDropDown.js";
import { startFFTUpdates} from "../workers/fft-setup.js";
import { wsWorker } from "../workers/ws-setup.js";


export let accelSampleRateDD2, accelRangeDD2, accelFilterDD2;
export let gyroSampleRateDD2, gyroRangeDD2, gyroFilterDD2;
export let tempSampleRateDD2;

export function setupDropdowns() {
  // FFT Fenstergröße
  let FFT_WINDOW_SIZE = 2048;
  let FFT_UPDATE_INTERVAL = 50;
  let N_AVG = 10;
  let FFT_AXIS_MODE = "COMBI";
  let FFT_WINDOW_TYPE = "BLACKMAN";
  let DC_CUTOFF = true;
  let fftHighPass = 0;

  // Blocksize Dropdown
  new UniDropdown(document.getElementById("dropdown1"), {
    type: "select",
    label: "Size",
    items: [
      { value: 254, label: "254" },
      { value: 508, label: "508" },
      { value: 1024, label: "1024" },
      { value: 2048, label: "2048" },
      { value: 4096, label: "4096" }
    ],
    defaultValue: FFT_WINDOW_SIZE,
    onChange: (value) => {
      FFT_WINDOW_SIZE = Number(value);
      console.log("Blocksize gewählt:", FFT_WINDOW_SIZE);
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
    defaultValue: "BLACKMAN",
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

  // Sidebar Toggle
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      const sidebar = document.getElementById("sidebar");
      if (sidebar) sidebar.classList.toggle("expanded");
    });
  }
}

export function setupSideSettingsDropdowns() {

// SIDEPANEL SETTINGS
accelRangeDD2 = new UniDropdown(document.getElementById('accelRangeDD2'), {
  type: 'select',
  label: 'Acc Range',
  items: [
    { value: 2, label: "±2g" },
    { value: 4, label: "±4g" },
    { value: 8, label: "±8g" },
    { value: 16, label: "±16g"  },
  ],
  onChange: (value, label) => {
    // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      ACCELRANGE: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});
accelSampleRateDD2 = new UniDropdown(document.getElementById('accelSampleRateDD2'), {
  type: 'select',
  label: 'Sample Rate',
  items: [
    { value: 0, label: "OFF" },
    { value: 12.5, label: "12.5 Hz" },
    { value: 26, label: "26 Hz" },
    { value: 52, label: "52 Hz"  },
    { value: 104, label: "104 Hz"  },
    { value: 208, label: "208 Hz"  },
    { value: 416, label: "416 Hz"  },
    { value: 833, label: "833 Hz"  },
    { value: 1666, label: "1666 Hz"  },
    { value: 3330, label: "3333 Hz"  },
    { value: 6660, label: "6666 Hz"  }
  ],
  onChange: (value, label) => {
    // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      ACCELSAMPLERATE: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});
accelFilterDD2 = new UniDropdown(document.getElementById('accelFilterDD2'), {
  type: 'select',
  label: 'Accel Filter',
  items: [
    { value: "OFF", label: "OFF" },
    { value: "LOWPASS", label: "LOWPASS" },
    { value: "HIGHPASS1", label: "HIGHPASS 1" },    
    { value: "HIGHPASS2", label: "HIGHPASS 2"  },

  ],
  onChange: (value, label) => {
    // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      ACCELFILTER: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});

gyroRangeDD2 = new UniDropdown(document.getElementById('gyroRangeDD2'), {
  type: 'select',
  label: 'Gyro Range',
  items: [
    { value: 125, label: "±125°/s" },
    { value: 250, label: "±250°/s" },
    { value: 500, label: "±500°/s" },
    { value: 1000, label: "±1000°/s" },
    { value: 2000, label: "±2000°/s"  },
  ],
  onChange: (value, label) => {
    // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      GYRORANGE: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});

gyroSampleRateDD2 = new UniDropdown(document.getElementById('gyroSampleRateDD2'), {
  type: 'select',
  label: 'Gyro Sample Rate',
  items: [
    { value: 0, label: "OFF" },
    { value: 12.5, label: "12.5 Hz" },
    { value: 26, label: "26 Hz" },
    { value: 52, label: "52 Hz"  },
    { value: 104, label: "104 Hz"  },
    { value: 208, label: "208 Hz"  },
    { value: 416, label: "416 Hz"  },
    { value: 833, label: "833 Hz"  },
    { value: 1666, label: "1666 Hz"  },
    { value: 3330, label: "3333 Hz"  },
    { value: 6660, label: "6666 Hz"  }
  ],
  onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      GYROSAMPLERATE: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});
gyroFilterDD2 = new UniDropdown(document.getElementById('gyroFilterDD2'), {
  type: 'select',
  label: 'Gyro Filter',
  items: [
    { value: "OFF", label: "OFF" },
    { value: "LOWPASS", label: "LOWPASS" },
    { value: "HIGHPASS1", label: "HIGHPASS 1" },    
    { value: "HIGHPASS2", label: "HIGHPASS 2"  },

  ],
  onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      GYROFILTER: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});

tempSampleRateDD2 = new UniDropdown(document.getElementById('tempSampleRateDD2'), {
  type: 'select',
  label: 'Temp Samplerate',
  items: [
    { value: "0", label: "OFF" },
    { value: "1", label: "1.6 Hz" },
    { value: "2", label: "12.5 Hz" },
    { value: "3", label: "52 Hz"   },

  ],
  onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
      const settingsJSON = JSON.stringify({
      TEMPSAMPLERATE: value
    });
    // Nachricht an den WebSocket-Worker senden
    wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
    console.log('Ausgewählt:', value, label);
  }
});
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
    wsWorker.postMessage({ type: "send", msgContent: settingsJSON });
  });
}