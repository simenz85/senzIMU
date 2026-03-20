class RingBuffer {
  constructor(size, ArrayType = Float32Array) {
    this.size = size;
    this.buffer = new ArrayType(size);
    this.index = 0;
    this.length = 0;
  }
  push(value) {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.length < this.size) this.length++;
  }
  toArray() {
    if (this.length < this.size) return Array.from(this.buffer.slice(0, this.length));
    const out = new this.buffer.constructor(this.length);
    out.set(this.buffer.subarray(this.index));
    out.set(this.buffer.subarray(0, this.index), this.size - this.index);
    return Array.from(out);
  }
}

class MultiRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.index = 0;
    this.size = 0;
  }

  push(sample) {
    this.buffer[this.index] = sample; // sample = { time, x, y, z }
    this.index = (this.index + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  pushMany(samples) {
    for (const s of samples) this.push(s);
  }

  getLast(n) {
    const count = Math.min(n, this.size);
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      const idx = (this.index - count + i + this.capacity) % this.capacity;
      result[i] = this.buffer[idx];
    }
    return result;
  }

  // optional: columns extrahieren
  getFields(fieldName, n) {
    return this.getLast(n).map(s => s[fieldName]);
  }
}

class MultiRingBuffer2 {
  constructor(channelTypes, size, channelNames) {
    this.channels = channelTypes.map(C => new C(size));
    this.index = 0;
    this.length = 0;
    this.size = size;
    this._lastSlices = Array(channelTypes.length).fill(null);
    this._lastSlicesCount = Array(channelTypes.length).fill(null);
    this._lastSlicesIndex = Array(channelTypes.length).fill(null);

    this.channelMap = channelNames.reduce((map, name, idx) => {
      map[name] = idx;
      return map;
    }, {});
    this.channelNames = channelNames;  // unbedingt setzen!
  }
  
  push(values) {
    if (!Array.isArray(values) || values.length !== this.channels.length) {
      throw new Error(`push(): values muss Array mit ${this.channels.length} Elementen sein.`);
    }
    for (let ch = 0; ch < values.length; ch++) {
      this.channels[ch][this.index] = values[ch];
      this._lastSlices[ch] = null;
    }
    this.index = (this.index + 1) % this.size;
    if (this.length < this.size) this.length++;
  }

  getChannelTypedArray(channel) {
    const buf = this.channels[channel];
    if (this.length < this.size) {
      return buf.subarray(0, this.length);
    } else {
      if (this._lastSlices[channel]) return this._lastSlices[channel];
      let arr = new buf.constructor(this.size);
      arr.set(buf.subarray(this.index));
      arr.set(buf.subarray(0, this.index), this.size - this.index);
      this._lastSlices[channel] = arr;
      return arr;
    }
  }

  getLast() {
    if (this.length === 0) return null; // kein Wert vorhanden
    const lastIdx = (this.index + this.size - 1) % this.size;
    const result = {};
    for (let i = 0; i < this.channels.length; i++) {
      result[this.channelNames[i]] = this.channels[i][lastIdx];
    }
    return result;
  }

  getFieldTypedArray(fieldName, N) {
    const ch = this.channelMap[fieldName];
    if (ch === undefined) throw new Error(`Unknown field name: ${fieldName}`);
    const buf = this.channels[ch];
    const len = this.length;
    const count = Math.min(N, len);

    if (len < this.size) {
      return buf.subarray(len - count, len);
    } else {
      if (this._lastSlices[ch] &&
          this._lastSlicesCount[ch] === count &&
          this._lastSlicesIndex[ch] === this.index) {
        return this._lastSlices[ch];
      }
      const arr = new buf.constructor(count);
      let startIdx = (this.index + this.size - count) % this.size;

      if (startIdx + count <= this.size) {
        arr.set(buf.subarray(startIdx, startIdx + count));
      } else {
        const firstPartLen = this.size - startIdx;
        arr.set(buf.subarray(startIdx, this.size));
        arr.set(buf.subarray(0, count - firstPartLen), firstPartLen);
      }

      this._lastSlices[ch] = arr;
      this._lastSlicesCount[ch] = count;
      this._lastSlicesIndex[ch] = this.index;

      return arr;
    }
  }
}

class UniDropdown {
  static instances = [];
  static hasDocListener = false;

  /**
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {'select'|'slider'|'logslider'} options.type
   */
  constructor(container, options = {}) {
    this.type = options.type || "select";
    this.container = container;
    this.button = container.querySelector('.dropdown-button');
    this.labelSpan = this.button.querySelector('.label');
    this.dropdownContent = container.querySelector('.dropdown-content');
    this.options = options;

    UniDropdown.instances.push(this);

    // Typ-spezifisch initialisieren
    if (this.type === "select") {
      this.initSelect(options);
    } else if (this.type === "slider") {
      this.initSlider(options);
    } else if (this.type === "logslider") {
      this.initLogSlider(options);
    }

    // Button Click -> Öffnen/Schließen
    this.button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (this.container.classList.contains('open')) {
        this.close();
      } else {
        UniDropdown.closeAll(this); // schließt alle anderen
        this.open();
      }
    });

    // Globaler Klick-Listener nur einmal registrieren
    if (!UniDropdown.hasDocListener) {
      document.addEventListener('click', e => {
        const isInsideDropdown = e.target.closest('.dropdown');
        if (!isInsideDropdown) {
          UniDropdown.closeAll();
        }
      });
      UniDropdown.hasDocListener = true;
    }
  }

  // ---------- SELECT ----------
  initSelect(options) {
    this.mainLabel = options.label || 'Menü';
    this.items = options.items || [];
    this.activeOption = null;

    this.dropdownContent.innerHTML = '';
    this.items.forEach(item => {
      const a = document.createElement('a');
      a.href = "#";
      a.dataset.value = item.value;
      a.textContent = item.label;
      this.dropdownContent.appendChild(a);
    });

    this.optionsElements = [...this.dropdownContent.querySelectorAll('a')];

    if (options.defaultValue) {
      const opt = this.optionsElements.find(o => o.dataset.value === options.defaultValue);
      this.setActiveOption(opt || this.optionsElements[0]);
    } else if (options.defaultIndex !== undefined && this.optionsElements[options.defaultIndex]) {
      this.setActiveOption(this.optionsElements[options.defaultIndex]);
    } else {
      this.setActiveOption(this.optionsElements[0]);
    }

    this.optionsElements.forEach(option => {
      option.addEventListener('click', e => {
        e.preventDefault();
        this.setActiveOption(option);
        this.close();
        if (typeof options.onChange === "function") {
          options.onChange(option.dataset.value, option.textContent);
        }
      });
    });
  }

  setActiveOption(optionElement) {
    if (!optionElement) return;
    if (this.activeOption) this.activeOption.classList.remove('active');
    this.activeOption = optionElement;
    this.activeOption.classList.add('active');
    this.labelSpan.textContent = `${this.mainLabel}: ${optionElement.textContent}`;
  }

  // ---------- SLIDER ----------
  initSlider(options) {
    this.mainLabel = options.label || 'Wert';
    this.min = options.min ?? 0;
    this.max = options.max ?? 100;
    this.step = options.step ?? 1;
    this.value = options.defaultValue ?? this.min;
    this.onChange = options.onChange;

    this.dropdownContent.innerHTML = '';
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'dropdown-slider';
    this.slider.min = this.min;
    this.slider.max = this.max;
    this.slider.step = this.step;
    this.slider.value = this.value;
    this.dropdownContent.appendChild(this.slider);

    this.updateSliderLabel();

    this.slider.addEventListener('input', () => {
      this.value = this.slider.value;
      this.updateSliderLabel();
      if (typeof this.onChange === 'function') {
        this.onChange(Number(this.value));
      }
    });
  }

  updateSliderLabel() {
    this.labelSpan.textContent = `${this.mainLabel}: ${this.value}`;
  }

  // ---------- LOGSLIDER ----------
  initLogSlider(options) {
    this.mainLabel = options.label || 'Wert';
    this.minValue = options.minValue ?? 0.001;
    this.maxValue = options.maxValue ?? 100;
    this.step = options.step ?? 1;
    this.value = options.defaultValue ?? this.minValue;
    this.alpha = options.alpha ?? 0.5;

    this.dropdownContent.innerHTML = '';
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'dropdown-slider';
    this.slider.min = 0;
    this.slider.max = 100;
    this.slider.step = this.step;
    this.slider.value = this.valueToPosition(this.value);
    this.dropdownContent.appendChild(this.slider);

    this.updateLogSliderLabel();

    this.slider.addEventListener('input', () => {
      const val = this.positionToValue(Number(this.slider.value));
      this.value = val;
      this.updateLogSliderLabel();
      if (typeof this.options.onChange === 'function') {
        this.options.onChange(val);
      }
    });
  }

  positionToValue(pos) {
    if (pos <= 0) return 0;
    let normPos = pos / 100;
    normPos = Math.pow(normPos, this.alpha);
    const logMin = Math.log10(this.minValue);
    const logMax = Math.log10(this.maxValue);
    const logValue = logMin + normPos * (logMax - logMin);
    return Number(Math.pow(10, logValue).toFixed(6));
  }

  valueToPosition(value) {
    if (value <= 0) return 0;
    if (value < this.minValue) return 1;
    const logMin = Math.log10(this.minValue);
    const logMax = Math.log10(this.maxValue);
    const logValue = Math.log10(value);
    let normPos = (logValue - logMin) / (logMax - logMin);
    normPos = Math.pow(normPos, 1 / this.alpha);
    normPos = Math.min(Math.max(normPos, 0), 1);
    return Math.round(normPos * 100);
  }

  updateLogSliderLabel() {
    this.labelSpan.textContent = `${this.mainLabel}: ${Number(this.value).toFixed(3)}`;
  }

  // ---------- Öffnen/Schließen ----------
  open() {
    this.container.classList.add('open');
  }
  close() {
    this.container.classList.remove('open');
  }
  static closeAll(except = null) {
    UniDropdown.instances.forEach(dd => {
      if (dd !== except) dd.close();
    });
  }

  getValue() {
    if (this.type === "select") {
      return {
        value: this.activeOption?.dataset.value,
        label: this.activeOption?.textContent
      };
    } else {
      return Number(this.value);
    }
  }

  // ---------- Neue Setter mit silent-Flag ----------
  setValueSelect(value, silent = false) {
    const opt = this.optionsElements.find(o => o.dataset.value == value);
    if (!opt) return;
    if (this.activeOption === opt) return;
    this.setActiveOption(opt);
    if (!silent && typeof this.options.onChange === "function") {
      this.options.onChange(opt.dataset.value, opt.textContent);
    }
  }

  setValueSlider(value, silent = false) {
    this.value = value;
    this.slider.value = value;
    this.updateSliderLabel();
    if (!silent && typeof this.onChange === 'function') {
      this.onChange(Number(this.value));
    }
  }

  setValueLogSlider(value, silent = false) {
    this.value = value;
    this.slider.value = this.valueToPosition(value);
    this.updateLogSliderLabel();
    if (!silent && typeof this.options.onChange === 'function') {
      this.options.onChange(this.value);
    }
  }

  // Einheitlicher Setter
  setValue(value, silent = false) {
    if (this.type === "select") {
      this.setValueSelect(value, silent);
    } else if (this.type === "slider") {
      this.setValueSlider(value, silent);
    } else if (this.type === "logslider") {
      this.setValueLogSlider(value, silent);
    }
  }
}



let dark = true;


// Regelmäßiges Update, z.B. alle 200 ms:
let FFT_UPDATE_INTERVAL = 50;
let FFT_WINDOW_SIZE = 2048; // Größte Zweierpotenz, ggf. auch 2048
let fftUpdateTimerId = null;
const fftMaxBuffer = [];

// FFT AVERAGE PUFFER
let N_AVG = 10;            // Anfangswert kann beliebig gewählt sein
let avgFFTBuffer = [];



const FFT_RING_SIZE = 5 * 1000 / FFT_UPDATE_INTERVAL; // z.B. 50
const dropdown1 = new UniDropdown(document.getElementById('dropdown1'), {
  type: 'select',
  label: 'Blocksize',
  items: [
    { value: 254, label: 254 },
    { value: 508, label: 508 },
    { value: 1024, label: 1024 },
    { value: 2048, label: 2048 },
    { value: 4096, label: 4096 }
  ],
  defaultValue: FFT_WINDOW_SIZE,
  onChange: (value, label) => {
    FFT_WINDOW_SIZE = value;
    console.log('Ausgewählt:', value, label);
  }
});
const dropdown2 = new UniDropdown(document.getElementById('dropdown2'), {
  type: 'select',
  label: 'Samplerate',
  items: [
    { value: 1000/60, label: "60 fps" },
    { value: 1000/30, label: "30 fps" },
    { value: 1000/20, label: "20 fps" },
    { value: 1000/10, label: "10fps"  },
    { value: 1000/5, label: "5 fps" },
    { value: 1000/1, label: "1 fps" }
  ],
  defaultValue: FFT_UPDATE_INTERVAL,
  onChange: (value, label) => {
    FFT_UPDATE_INTERVAL = value;
  // Starte das Update mit dem neuen Intervall neu
  startFFTUpdates();

    console.log('Ausgewählt:', value, label);
  }
});
const dropdown3 = new UniDropdown(document.getElementById('dropdown3'), {
  type: 'select',
  label: 'Samples',
  items: [
    { value: 5, label: "5" },
    { value: 10, label: "10" },
    { value: 15, label: "15" },
    { value: 20, label: "20"  },
    { value: 25, label: "25" },
    { value: 50, label: "50" },
    { value: 100, label: "100" },
    { value: 150, label: "150" },
    { value: 300, label: "300" }
  ],
  defaultValue: N_AVG,
  onChange: (value, label) => {
    N_AVG = value;
    setAverageCount(value);
  // Starte das Update mit dem neuen Intervall neu
    //startFFTUpdates();

    console.log('Ausgewählt:', value, label);
  }
});

// RINGPUFFER INITIALISIEREN
//const accBuffer = new MultiRingBuffer2([Float64Array, Float32Array, Float32Array, Float32Array], 20000000);

const BUFFERSIZE = 20000000;
const calibBUFFERSIZE = 700000;

const accBuffer = new MultiRingBuffer2(
  [Float64Array, Float32Array, Float32Array, Float32Array],
  BUFFERSIZE, 
  ['time', 'x', 'y', 'z']
);

const calibBuffer1 = new MultiRingBuffer2(
  [Float32Array, Float32Array, Float32Array],
  calibBUFFERSIZE, 
  ['x', 'y', 'z']
);
const calibBuffer2 = new MultiRingBuffer2(
  [Float32Array, Float32Array, Float32Array],
  calibBUFFERSIZE, 
  ['x', 'y', 'z']
);

const gyroBuffer = new MultiRingBuffer2(
  [Float64Array, Float32Array, Float32Array, Float32Array],
  BUFFERSIZE, 
  ['time', 'x', 'y', 'z']
);

const tempBuffer = new MultiRingBuffer2(
  [Float64Array, Float32Array],
  BUFFERSIZE,
  ['time', 'temperature']
);

let FFT_AXIS_MODE;
const dropdown6 = new UniDropdown(document.getElementById('dropdown6'), {
  type: 'select',
  label: 'AXIS',
  items: [
    { value: "COMBI", label: "KOMBINIERT" },
    { value: "ONLYX", label: "X" },
    { value: "ONLYY", label: "Y" },
    { value: "ONLYZ", label: "Z"  },
  ],
  defaultValue: N_AVG,
  onChange: (value, label) => {
    FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});



let FFT_WINDOW_TYPE;
const dropdown4 = new UniDropdown(document.getElementById('dropdown4'), {
  type: 'select',
  label: 'WinType',
  items: [
    { value: "BLACKMAN", label: "BLACKMAN" },
    { value: "HANNING", label: "HANNING" },
    { value: "HAMMING", label: "HAMMING" },
    { value: "RECTANGULAR", label: "RECTANGULAR"  },
  ],
  defaultValue: N_AVG,
  onChange: (value, label) => {
    FFT_WINDOW_TYPE = value;
    console.log('Ausgewählt:', value, label);
  }
});

let DC_CUTOFF = true;
const dropdown5 = new UniDropdown(document.getElementById('dropdown5'), {
  type: 'select',
  label: 'DC Cutoff',
  items: [
    { value: true, label: "YES" },
    { value: false, label: "NO" },

  ],
  defaultValue: true,
  onChange: (value, label) => {
    DC_CUTOFF = (value === "true");
    console.log('Ausgewählt:', DC_CUTOFF, label);
  }
});



let fftHighPass = 0;

  const logSliderDropdown = new UniDropdown(document.getElementById('sliderDropdown'), {
    type: 'logslider',
    label: 'HIGHPASS',
    minValue: 0.001,
    maxValue: 100,
    defaultValue: 0,
    alpha: 0.3,  // alpha <1 = "weniger intensive" Skalierung; 1 = normale Log-Skala
    
    onChange: (value, label) => {
    fftHighPass = value;
    console.log('Ausgewählt:', value, label);
  }
  });

// IMU SETTINGS

const accelRangeDD = new UniDropdown(document.getElementById('accelRangeDD'), {
  type: 'select',
  label: 'Acc Range',
  items: [
    { value: 2, label: "±2g" },
    { value: 4, label: "±4g" },
    { value: 8, label: "±8g" },
    { value: 16, label: "±16g"  },
  ],
  onChange: (value, label) => {
    //FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});
const accelSampleRateDD = new UniDropdown(document.getElementById('accelSampleRateDD'), {
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
    //FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});
const acelFFilterDD = new UniDropdown(document.getElementById('accelFilterDD'), {
  type: 'select',
  label: 'Accel Filter',
  items: [
    { value: "OFF", label: "OFF" },
    { value: "LOWPASS", label: "LOWPASS" },
    { value: "HIGHPASS1", label: "HIGHPASS 1" },    
    { value: "HIGHPASS2", label: "HIGHPASS 2"  },

  ],
  onChange: (value, label) => {
    //FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});

const gyroRangeDD = new UniDropdown(document.getElementById('gyroRangeDD'), {
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
    //FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});
const gyroSampleRateDD = new UniDropdown(document.getElementById('gyroSampleRateDD'), {
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
    //FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});
const gyroFilterDD = new UniDropdown(document.getElementById('gyroFilterDD'), {
  type: 'select',
  label: 'Gyro Filter',
  items: [
    { value: "OFF", label: "OFF" },
    { value: "LOWPASS", label: "LOWPASS" },
    { value: "HIGHPASS1", label: "HIGHPASS 1" },    
    { value: "HIGHPASS2", label: "HIGHPASS 2"  },

  ],
  onChange: (value, label) => {
    //FFT_AXIS_MODE = value;
    console.log('Ausgewählt:', value, label);
  }
});

// SIDEPANEL SETTINGS

const accelRangeDD2 = new UniDropdown(document.getElementById('accelRangeDD2'), {
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
const accelSampleRateDD2 = new UniDropdown(document.getElementById('accelSampleRateDD2'), {
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
const accelFilterDD2 = new UniDropdown(document.getElementById('accelFilterDD2'), {
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
const gyroRangeDD2 = new UniDropdown(document.getElementById('gyroRangeDD2'), {
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
const gyroSampleRateDD2 = new UniDropdown(document.getElementById('gyroSampleRateDD2'), {
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
const gyroFilterDD2 = new UniDropdown(document.getElementById('gyroFilterDD2'), {
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
const tempSampleRateDD2 = new UniDropdown(document.getElementById('tempSampleRateDD2'), {
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





// === Globale Variablen ===
let SAMPLE_RATE = 6600;
const MAX_SAMPLES = 10000;

/* // RINGPUFFER
const chartData = [
  new RingBuffer(MAX_SAMPLES, Float64Array),  // Zeitstempel
  new RingBuffer(MAX_SAMPLES, Float32Array),  // X
  new RingBuffer(MAX_SAMPLES, Float32Array),  // Y
  new RingBuffer(MAX_SAMPLES, Float32Array)   // Z
];

// PERFO UPDATES

const pendingChartData = [
  new RingBuffer(MAX_SAMPLES, Float64Array),  // Zeitstempel
  new RingBuffer(MAX_SAMPLES, Float32Array),  // X
  new RingBuffer(MAX_SAMPLES, Float32Array),  // Y
  new RingBuffer(MAX_SAMPLES, Float32Array)   // Z
];


const TempChartData  = [
  new RingBuffer(MAX_SAMPLES, Float64Array),  // Zeitstempel
  new RingBuffer(MAX_SAMPLES, Float32Array),  // X
  new RingBuffer(MAX_SAMPLES, Float32Array),  // Y
  new RingBuffer(MAX_SAMPLES, Float32Array)   // Z
]; */

const chartData = [[], [], [], []]; // time, x, y, z
//const ChartData = [[], []]; // time, temperature

//let updateIntervalMs = 30; // Startwert (etwa 33 FPS)
let chartUpdateTimer = null;

let lastTimestamp = 0;
let currentTemperature = 0;
let temp = 0;
let paused = false;
let autoScroll = true;
let pausedLastTimestamp = 0;
let panOffset = 0;
let currentTimeRange = 5;
let samplesReceived = 0;
let lastRateCheck = performance.now();
let isRecording = false;
let recordedRows = [];

let SamplesPerSecond= 0;
let samplecount = 0;
let totaltimeforcount = 0;
let tts = 0.0;
let fts = 0.0;
let lts = 0.0;

// Chart-Zoom-Einstellungen
let yRanges = [
  { zoom: 1, pan: 0 },
  { zoom: 1, pan: 0 },
  { zoom: 1, pan: 0 }
];

// IMUPLOT
let plot = null;


// Initiale (leere) Arrays mit gewünschter Länge
const plN = 20;
const pltimes = new Float32Array(plN); // oder []
const plxs = new Float32Array(plN);
const plys = new Float32Array(plN);
const plzs = new Float32Array(plN);

const traces = [
  {
  x: [2, 3, 4, 5],

  y: [16, 5, 11, 9],

  mode: 'lines',
  line: { color: 'red', width: 1.25 },
  },
  {
    x: Array.from(pltimes),
    y: Array.from(plys),
    mode: 'lines',
    name: 'Y',
    line: { color: 'green' , width: 1 }
  },
  {
    x: Array.from(pltimes),
    y: Array.from(plzs),
    mode: 'lines',
    name: 'Z',
    line: { color: 'blue' }
  }
];

const layout = {
  title: 'XYZ-Daten vs. Zeit',
  xaxis: { title: 'Zeit' },
  yaxis: { title: 'Messwert' }
};

//Plotly.newPlot('tester', traces, layout);



// FFT PLOT

//let fftWorker = null;updat
let fftPlot = null;


// === Web Workers ===
const wsWorker = new Worker("ws-worker.js");
const decodeWorker = new Worker("decode-worker.js");
const filterWorker = new Worker('filter-worker.js');


// === Init ===
document.addEventListener("DOMContentLoaded", () => {
  
  try {
  const testWorker = new Worker("fft-worker.js");
  console.log("Worker geladen");
  testWorker.terminate();
} catch(e) {
  console.error("Worker konnte nicht geladen werden:", e);
}
  
  
  initChart();
  enableChartZoomAndPan();
  setupWSWorker();
  setupDecodeWorker();
  setupUIListeners();
  connectWebSocket();
  startChartUpdates();
  initFFTChart();
  setupFFTWorker();
  startFFTUpdates();

    


  // 👉 Hier der Sidebar-Toggle-Code:
  document.getElementById('sidebarToggle').addEventListener('click', function() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('expanded');
  });
});

// SLIDER ACTION

document.getElementById('fpsSlider').addEventListener('input', function() {
  const fps = parseInt(this.value, 10);
  document.getElementById('fpsValue').textContent = fps;
  updateIntervalMs = Math.round(1000 / fps);
  startChartUpdates(); // setzt neuen Intervall
});

// === WebSocket Worker einrichten ===
function setupWSWorker() {
wsWorker.onmessage = (event) => {
  const { type, payload } = event.data;
  if (type === "data") {
    // ArrayBuffer als Transferable weitergeben
    decodeWorker.postMessage(payload, [payload]);
  } else if (type === "connected") {
    console.log("WebSocket verbunden.");
  } else if (type === "closed") {
    console.warn("WebSocket getrennt.");
  } else if (type === "error") {
    console.error("WebSocket-Fehler:", payload);
  }
};
}



let chartUpdateRunning = false;
let lastChartUpdate = 0;
let updateIntervalMs = 40; // 25 FPS

function startChartUpdates() {
  function updateLoop(now) {
    if (!chartUpdateRunning) return;

    if (now - lastChartUpdate >= updateIntervalMs) {
      updateDashboard();
      lastChartUpdate = now;
    }

    requestAnimationFrame(updateLoop);
  }

  chartUpdateRunning = true;
  lastChartUpdate = performance.now();
  requestAnimationFrame(updateLoop);
}







// === Decode Worker einrichten ===
 function setupDecodeWorker() {
decodeWorker.onmessage = (event) => {
  
  const { acc, gyro, temp, info } = event.data;
  
  if (acc && acc.length > 0) {
    for (let sample of acc) {
      // sample ist { time, x, y, z }
      // push als Array oder Objekt in deinen MultiRingBuffer
      accBuffer.push([sample.time, sample.x, sample.y, sample.z]);
    }
  }

  if (gyro && gyro.length > 0) {
    for (let sample of gyro) {
      // sample ist { time, x, y, z }
      // push als Array oder Objekt in deinen MultiRingBuffer
      gyroBuffer.push([sample.time, sample.x, sample.y, sample.z]);
    }
  }

  if (temp && temp.length > 0) {
    for (let sample of temp) {
      // sample ist { time, value }
      // push als Array oder Objekt in deinen MultiRingBuffer
      tempBuffer.push([sample.time, sample.value]);
    }
  }

  if (info && info.length > 0) {
      info.forEach(entry => {
          console.log("INFO BEKOMMEN: " + entry.type + "  " + entry.value);
          switch (entry.type) {
              case "ACCELRATE":
                  accelSampleRateDD2.setValue(entry.value, true);
                  break;
              case "ACCELRANGE":
                  accelRangeDD2.setValue(entry.value, true);
                  break;
              case "ACCELFILTER":
                  accelFilterDD2.setValue(entry.value, true);
                  break;

              case "GYROFILTER":
                  gyroFilterDD2.setValue(entry.value, true);
                  break;
              case "GYROSAMPLERATE":
                  gyroSampleRateDD2.setValue(entry.value, true);
                  break;

              case "GYRORANGE":
                  gyroRangeDD2.setValue(entry.value, true);
                  break;
              case "TEMPSAMPLERATE":
                  tempSampleRateDD2.setValue(entry.value, true);
                  break;


              default:
                  console.warn("Unbekannte Config-SubID");
          }
      });
  }
}}


	

 


// === WebSocket starten ===
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let url = `${protocol}//${location.host}/ws`;
  url = 'ws://192.168.4.1/ws';
  console.log("[WS] Verbinde zu WebSocket:", url);
  wsWorker.postMessage({ type: "connect", wsServerUrl: url });
}

// === Sample verarbeiten ===
function handleDecodedSample(sample) {
 // const { id, timestamp, value1, value2, value3, timestamp_raw, value1_raw, value2_raw, value3_raw } = sample;

const { id, timestamp, value1, value2, value3 } = sample;
 // console.log(`[SAMPLE] ID: ${id}, Timestamp: ${timestamp.toFixed(5)}s, Values: [${value1.toFixed(2)}, ${value2.toFixed(2)}, ${value3.toFixed(2)}]`);

  if (id === 1 || id === 2) {
    chartData[0].push(timestamp);
    chartData[1].push(value1);
    chartData[2].push(value2);
    chartData[3].push(value3);
    samplesReceived++;
  }

  if (id === 3) {
    temp = value1;
  }

  if (isRecording) {
    recordedRows.push([timestamp, id, value1, value2, value3]);
  }

  lastTimestamp = timestamp;

  // Puffergröße begrenzen
  if (chartData[0].length > MAX_SAMPLES) {
    for (let i = 0; i < chartData.length; i++) chartData[i].shift();
  }
}


// UPDATE UI

function updateDashboard() {
  
 
  
  //console.log("[DASHBOARD] Update started, accBuffer size:", accBuffer.size);
  let lastAccSample = accBuffer.getLast();
  let lastGyroSample = gyroBuffer.getLast();
  let Samplerate1 = 0.0;
  let totalSeconds1 = 0;

//console.log("accBuffer", accBuffer.length);
//console.log("gyroBuffer", gyroBuffer.length);
//console.log("tempBuffer", tempBuffer.length);


if (accBuffer.length>0){
  if (accBuffer.length >= 2) {  
    let lastTwoTimes = accBuffer.getFieldTypedArray("time", 2);
    if (lastTwoTimes.length === 2) {
    let diff = lastTwoTimes[1] - lastTwoTimes[0];
    //console.log("Differenz vom letzten und vorletzten Wert:", diff);

    Samplerate1 = 1000000 / diff;
    //console.log("Samplerate 1:", Samplerate1);
} else {
  console.log("Nicht genug Werte im Ringpuffer");
}
}

if (tempBuffer.length > 0) {
  let lastTempSample = tempBuffer.getLast();
  currentTemperature = lastTempSample.temperature;
}
else {
  console.log("Temperaturpuffer leer");
  currentTemperature = 0;
}

if (accBuffer.length > 0) {     
  
  totalSeconds1 = lastAccSample.time * 0.000001;
  const hours = Math.floor(totalSeconds1 / 3600);
  const minutes = Math.floor((totalSeconds1 % 3600) / 60);
  const seconds = totalSeconds1 % 60;
  const formattedTime =
    (hours > 0 ? hours + ":" : "") +
    (hours > 0 ? String(minutes).padStart(2, '0') : minutes) + ":" +
    seconds.toFixed(2).padStart(5, '0');

  document.getElementById("timestamp").textContent = formattedTime;


}

  // Temperatur: aus globaler Variable (da tempBuffer noch nicht implementiert)
    document.getElementById("temperature").textContent = currentTemperature.toFixed(2);
    document.getElementById("samplerate").textContent = Samplerate1.toFixed(2);
    document.getElementById("accX").textContent = lastAccSample.x.toFixed(1);
    document.getElementById("accY").textContent = lastAccSample.y.toFixed(1);
    document.getElementById("accZ").textContent = lastAccSample.z.toFixed(1);
    document.getElementById("gyroX").textContent = lastGyroSample.x.toFixed(1);
    document.getElementById("gyroY").textContent = lastGyroSample.y.toFixed(1);
    document.getElementById("gyroZ").textContent = lastGyroSample.z.toFixed(1);

  // Plot aktualisieren
  if (plot) {
    //console.log("[DASHBOARD] Updating plot...");
    // Für y-Achsen z.B. Felder extrahieren:

lastTimestamp = lastAccSample.time;
const N = Samplerate1 * 5; // gewünschter Ausschnitt
const times = accBuffer.getFieldTypedArray('time', N);
const xs = accBuffer.getFieldTypedArray('x', N);
const ys = accBuffer.getFieldTypedArray('y', N);
const zs = accBuffer.getFieldTypedArray('z', N);



// Zeichnen im Div mit der ID 'plotly-div'


/*   const newTraces = [
    { x: times, y: xs, mode: 'lines', name: 'X', line: { color: 'red' } },
    { x: times, y: ys, mode: 'lines', name: 'Y', line: { color: 'green' } },
    { x: times, y: zs, mode: 'lines', name: 'Z', line: { color: 'blue' } }
  ];

  Plotly.react('tester', newTraces, layout); */


 if (paused==true){return};
//autoScroll = true;

currenttimerange = 5; // Sekunden



      const xMinBefore = chart.scales.x.min;
      const xMaxBefore = chart.scales.x.max;
      const yMinBefore = chart.scales.y.min;
      const yMaxBefore = chart.scales.y.max;
      chart.setData([times, xs, ys, zs]);
       //chart.setData([timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]);

      // Wenn Nutzer den Pan-Bereich manuell gesetzt hat, übernehmen wir den Offset
      // Sonst automatisch weiter scollen (xPanOffset wird intern im Overlay verwaltet)
      // Wir triggern ein Event für die X-Achse, damit Overlay das neu repositioniert
      window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: lastTimestamp} }));

      // Y-Skala behalten
      if(yMinBefore !== undefined && yMaxBefore !== undefined){
        chart.setScale("y", {min: yMinBefore, max: yMaxBefore});
      }


 plot.setData([times, xs, ys, zs]);

    plot.redraw(false);
    if (!paused && autoScroll) {
      plot.setScale("x", [lastTimestamp - currentTimeRange*1000000, lastTimestamp]);
    }
    plot.setScale("y", getYRange());
  } else {
    console.log("[DASHBOARD] Plot not initialized");
  
  } 









}





}


// ALTE VERSION
/* function updateDashboard() {
  if (chartData[0].length === 0) return;

  // Aktuellen Index berechnen (Ringpuffer-Logik)
    const lastIndex = (chartData[0].index + chartData[0].size - 1) % chartData[0].size;

    const totalSeconds = chartData[0].buffer[lastIndex] * 0.001;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formattedTime =
      (hours > 0 ? hours + ":" : "") +
      (hours > 0 ? String(minutes).padStart(2, '0') : minutes) + ":" +
      seconds.toFixed(2).padStart(5, '0');  // z.B. "05.23"

    // Ausgabe
    document.getElementById("timestamp").textContent = formattedTime;


  // Letzte Werte aus dem Ringpuffer holen
  //document.getElementById("timestamp").textContent = (chartData[0].buffer[lastIndex]*0.001).toFixed(1);
  document.getElementById("temperature").textContent = currentTemperature.toFixed(2);
  document.getElementById("accX").textContent = chartData[1].buffer[lastIndex].toFixed(1);
  document.getElementById("accY").textContent = chartData[2].buffer[lastIndex].toFixed(1);
  document.getElementById("accZ").textContent = chartData[3].buffer[lastIndex].toFixed(1);
  document.getElementById("samplerate").textContent = SamplesPerSecond.toFixed(2);

  // lastTimestamp aktualisieren
  lastTimestamp = chartData[0].buffer[lastIndex];

  // Datenvalidierung (nur gültigen Bereich prüfen!)
  for (let i = 0; i < chartData.length; i++) {
    let data = [];
    if (chartData[i].length < chartData[i].size) {
      data = Array.from(chartData[i].buffer.slice(0, chartData[i].length));
    } else {
      // vollen Ring in richtiger Reihenfolge zusammensetzen
      const part1 = chartData[i].buffer.slice(chartData[i].index);
      const part2 = chartData[i].buffer.slice(0, chartData[i].index);
      data = Array.from(part1).concat(Array.from(part2));
    }
    //if (!data.every(x => typeof x === "number" && !isNaN(x))) {
     // console.warn("Fehlerhafte Daten in chartData[" + i + "]: ", data);
    //}
  }

  // Samplerate nur einmal pro Sekunde updaten
  const now = performance.now();
  if (now - lastRateCheck >= 1000) {
    document.getElementById("samplerate").textContent = samplesReceived;
    samplesReceived = 0;
    lastRateCheck = now;
  }

  

  // Chart bekommt Snapshot per .toArray()
  if (plot) {
    plot.setData(chartData.map(buf => buf.toArray()));
    plot.redraw(false);
    if (!paused && autoScroll) {
      plot.setScale("x", [lastTimestamp - currentTimeRange*1000, lastTimestamp]);
    }
    plot.setScale("y", getYRange());
  }
} */



// === Chart-Initialisierung ===






function initChart() {
  const opts = {
    width: document.getElementById("livechart2").clientWidth,
    height: 400,
    
            axes: [
                {

                },
                {} // Y-Achse
            ],

            cursor: { drag: { x: true, y: true, setScale: true, zoom: true, sync: true, r: true } },
    scales: {
      x: {
        time: false,
        auto: true,
        
        range: (u, min, max) => {
          return paused
            ? [pausedLastTimestamp - currentTimeRange*1000, pausedLastTimestamp]
            : [lastTimestamp - currentTimeRange + panOffset, lastTimestamp + panOffset];
        },
      },
      y: {
        auto: false,
        range: getYRange()
      }
    },
      axes: [
  	{
    	stroke: () => dark ? "white" : "black",
//    grid: {
//    	stroke: () => dark ? "white" : "black",
//    }
    },
    {
   	stroke: () => dark ? "white" : "black"
   },
  ],
    series: [
      { label: "Time (s)",},
      { label: "Acc X (mg)", stroke: "#FFD600" },
      { label: "Acc Y (mg)", stroke: "#ec3030ff" },
      { label: "Acc Z (mg)", stroke: "#7a96e2ff" },
    ]
  };

  plot = new uPlot(opts, chartData, document.getElementById("accChart"));
}

// === Y-Achsenbereich berechnen ===
function getYRange() {
  return (u, seriesIdx) => {
    const baseRange = 2500;
    let { zoom, pan } = yRanges[0];  // für einfachen globalen Bereich für alle Serien
    let half = baseRange / zoom;
    return [pan - half, pan + half];
  };
}

// === UI Button-Events ===
function setupUIListeners() {
  const recordBtn = document.getElementById("recordBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resetZoomBtn = document.getElementById("resetZoomBtn");

  recordBtn.addEventListener("click", () => {
    isRecording = !isRecording;
    recordBtn.classList.toggle("active");

    if (isRecording) {
      recordedRows = [];
      recordBtn.innerHTML = '<i class="fas fa-stop"></i> Stop';
      downloadBtn.style.display = "none";
    } else {
      recordBtn.innerHTML = '<i class="fas fa-circle"></i> Record';
      if (recordedRows.length > 0) {
        downloadBtn.style.display = "";
      }
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (!recordedRows.length) return;
    const csv = "timestamp_raw,id,value1_raw,value2_raw,value3_raw\n" +
      recordedRows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording_${new Date().toISOString().replace(/[:.]/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    downloadBtn.style.display = "none";
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.classList.toggle("active");
    pauseBtn.innerHTML = paused
      ? '<i class="fas fa-play"></i> Play'
      : '<i class="fas fa-pause"></i> Pause';
    if (paused) {
      pausedLastTimestamp = lastTimestamp;
    }
  });

  resetZoomBtn.addEventListener("click", () => {
    yRanges.forEach(range => { range.zoom = 1; range.pan = 0; });
    panOffset = 0;
    currentTimeRange = 5;
    if (plot) {
      plot.setScale("y", getYRange());
      plot.setScale("x", [lastTimestamp - currentTimeRange*1000000, lastTimestamp]);
    }
  });

  window.addEventListener("resize", () => {
    if (plot) {
      plot.setSize({
        width: document.getElementById("accChart").clientWidth,
        height: 400
      });
    }
  });
}

// === Chart Interaktion: Pan, Mousewheel-Zoom, Zoombox ===
function enableChartZoomAndPan() {
  const chartElem = plot.root;
  const zoomBox = document.getElementById("zoomBox");
  const axisThickness = 60;
  const axisHeight = 40;

  let isPanning = false;
  let isZoomBox = false;
  let panStart = {};
  let panLastRange = {};
  let boxStart = {};

  chartElem.addEventListener('wheel', (e) => {
    e.preventDefault();
    autoScroll = false;
    const rect = chartElem.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 1.15 : 0.87;

    if (x < axisThickness) {
      // Y-Achsen-Zoom
      const center = plot.posToVal(plot.bbox.height - y, 'y');
      const range = plot.scales.y.max - plot.scales.y.min;
      const newRange = range * delta;
      const p = (center - plot.scales.y.min) / range;
      const min = center - p * newRange;
      const max = center + (1 - p) * newRange;

      // === Y-Bereich im State speichern ===
      const meanY = (min + max) / 2;
      const spanY = max - min;
      yRanges.forEach((r) => {
        r.zoom = 2500 / (0.5 * spanY);
        r.pan  = meanY;
      });
      plot.setScale('y', getYRange());
      plot.redraw(true);
    } else if (y > plot.bbox.height - axisHeight) {
      // X-Achsen-Zoom
      const center = plot.posToVal(x, 'x');
      const range = plot.scales.x.max - plot.scales.x.min;
      const newRange = range * delta;
      const p = (center - plot.scales.x.min) / range;
      const min = center - p * newRange;
      const max = center + (1 - p) * newRange;
      plot.setScale('x', [min, max]);
      currentTimeRange = newRange;
      panOffset = max - lastTimestamp;
    } else {
      // XY-Zoom
      const centerX = plot.posToVal(x, 'x');
      const rangeX = plot.scales.x.max - plot.scales.x.min;
      const newRangeX = rangeX * delta;
      const pX = (centerX - plot.scales.x.min) / rangeX;
      const minX = centerX - pX * newRangeX;
      const maxX = centerX + (1 - pX) * newRangeX;

      const centerY = plot.posToVal(plot.bbox.height - y, 'y');
      const rangeY = plot.scales.y.max - plot.scales.y.min;
      const newRangeY = rangeY * delta;
      const pY = (centerY - plot.scales.y.min) / rangeY;
      const minY = centerY - pY * newRangeY;
      const maxY = centerY + (1 - pY) * newRangeY;

      // === Y-Bereich im State speichern ===
      const meanY = (minY + maxY) / 2;
      const spanY = maxY - minY;
      yRanges.forEach((r) => {
        r.zoom = 2500 / (0.5 * spanY);
        r.pan  = meanY;
      });      
      plot.setScale('x', [minX, maxX]);
      plot.setScale('y', getYRange());
      plot.redraw(true);
      currentTimeRange = newRangeX;
      panOffset = maxX - lastTimestamp;
    }
  });

  chartElem.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isPanning = true;
      const rect = chartElem.getBoundingClientRect();
      panStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      panLastRange = {
        xMin: plot.scales.x.min, xMax: plot.scales.x.max,
        yMin: plot.scales.y.min, yMax: plot.scales.y.max
      };
      chartElem.style.cursor = "grabbing";
      autoScroll = false;
    }
    if (e.button === 2) {
      isZoomBox = true;
      const rect = chartElem.getBoundingClientRect();
      boxStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      zoomBox.style.display = "block";
      zoomBox.style.left = `${boxStart.x}px`;
      zoomBox.style.top = `${boxStart.y}px`;
      zoomBox.style.width = `1px`;
      zoomBox.style.height = `1px`;
      autoScroll = false;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const rect = chartElem.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - panStart.x;
      const dy = y - panStart.y;
      const pixelsX = plot.bbox.width;
      const pixelsY = plot.bbox.height;
      const rangeX = panLastRange.xMax - panLastRange.xMin;
      const rangeY = panLastRange.yMax - panLastRange.yMin;
      const shiftX = -dx * rangeX / pixelsX;
      const shiftY =  dy * rangeY / pixelsY;

      plot.setScale('x', [panLastRange.xMin + shiftX, panLastRange.xMax + shiftX]);

      // === Y-Pan als State merken ===
      let newMinY = panLastRange.yMin + shiftY;
      let newMaxY = panLastRange.yMax + shiftY;
      const meanY = (newMinY + newMaxY) / 2;
      const spanY = newMaxY - newMinY;
      yRanges.forEach((r) => {
        r.zoom = 2500 / (0.5 * spanY);
        r.pan  = meanY;
      });
      plot.setScale('y', getYRange());
      plot.redraw(true);
    }
    if (isZoomBox) {
      const rect = chartElem.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const left = Math.min(boxStart.x, x);
      const top = Math.min(boxStart.y, y);
      const width = Math.abs(x - boxStart.x);
      const height = Math.abs(y - boxStart.y);
      zoomBox.style.left = `${left}px`;
      zoomBox.style.top = `${top}px`;
      zoomBox.style.width = `${width}px`;
      zoomBox.style.height = `${height}px`;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      chartElem.style.cursor = "";
    }
    if (isZoomBox) {
      const rect = chartElem.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const x1 = Math.min(boxStart.x, x);
      const x2 = Math.max(boxStart.x, x);
      const y1 = Math.min(boxStart.y, y);
      const y2 = Math.max(boxStart.y, y);
      if (Math.abs(x2 - x1) > 10 && Math.abs(y2 - y1) > 10) {
        const minX = plot.posToVal(x1, 'x');
        const maxX = plot.posToVal(x2, 'x');
        const minY = plot.posToVal(plot.bbox.height - y2, 'y');
        const maxY = plot.posToVal(plot.bbox.height - y1, 'y');

        // === Auch für Zoombox Y-STATE setzen! ===
        const meanY = (minY + maxY) / 2;
        const spanY = maxY - minY;
        yRanges.forEach((r) => {
          r.zoom = 2500 / (0.5 * spanY);
          r.pan  = meanY;
        });
        plot.setScale('x', [minX, maxX]);
        plot.setScale('y', getYRange());
        plot.redraw(true);
        currentTimeRange = maxX - minX;
        panOffset = maxX - lastTimestamp;
      }
      zoomBox.style.display = "none";
      isZoomBox = false;
    }
  });

  chartElem.addEventListener('contextmenu', e => { e.preventDefault(); });
}




// Event-Handler für Formularabsenden
document.getElementById('settingsForm').addEventListener('submit', function(event) {
  event.preventDefault();

  const formData = new FormData(this);
  const settingsObj = {};

  formData.forEach((value, key) => {
    settingsObj[key] = value;
  });

  const settingsJSON = JSON.stringify(settingsObj);

  // Nachricht an den WebSocket-Worker senden
  wsWorker.postMessage({
    type: "send",
    msgContent: settingsJSON
  });

  console.log("Settings an Worker gesendet:", settingsJSON);
});


// FFT SHIT
// FFT-Chart initialisieren
function initFFTChart() {
  const opts = {
    width: document.getElementById("fftChartarea").clientWidth,
    height: 500,
    scales: {
      x: {        
        time: false,
        label: "Frequenz (Hz)",
        //range: (u, min, max) => [0, 3300],
      },
      y: {
        auto: true,
        label: "Magnitude"        
      }
    },
          axes: [
  	{
    	stroke: () => dark ? "white" : "black",
//    grid: {
//    	stroke: () => dark ? "white" : "black",
//    }
    },
    {
   	stroke: () => dark ? "white" : "black"
   },
  ],
   series: [
  { label: "Freq (Hz)" },
  { // Max Magnitude – sehr dezent im Hintergrund
    label: "Max Magnitude",
    stroke: null,
    width: 0,
    fill: "rgba(200,210,223,0.08)" ,  // sehr helles, fast weißblaues Grau, extrem dezent
    points: { show: false }
  },

  { // Average Magnitude – Hauptdarstellung: kräftig und gelb (Kontrast zu Blau)
    label: "Average Magnitude",
    stroke: "#FFD600",                // sattes, leuchtendes Gelb (deutlich auf dunklem Grund)
    width: 2.,
    fill: "rgba(255, 213, 0, 0.5)",      // gelbliche Fläche, leicht transparent
    points: { show: false }
  },

  { // Current Magnitude – feine, kühle Linie, keine Füllung
    label: "Current Magnitude",
    stroke: "rgba(110,190,255,0.45)", // helles Cyan-Blau, halbtransparent
    width: 1,
    points: { show: false }
  },
]
  };
  fftPlot = new uPlot(opts, [[], [], []], document.getElementById("fftChart"));
}

// FFT Worker initialisieren
function setupFFTWorker() {
fftWorker = new Worker("fft-worker.js");
console.log("[Main] FFT Worker:", fftWorker);
console.log("FFT WORKER STARTED");

  fftWorker.onmessage = (e) => {
    const { freqs, mags } = e.data;
  //console.log("[DEBUG] empfangene freqs:", freqs);
 // console.log("[DEBUG] empfangene mags:", mags);

  if (!freqs || !mags) {
    console.warn("[Worker] Ungültige Daten empfangen:", e.data);
    return;
  }

    //const skipBins = 0;
    //const plotFreqs = freqs.slice(skipBins);
    //const plotMags = mags.slice(skipBins);

    // MAX PUFFER
    bufferFFTResult(mags); // Magnitudenpuffer für die letzten 5 Sekunden
    const maxValues = computeMaxFFTValues();
    // MITTELWERT PUFFER
    bufferAverageFFT(mags); // In Mittelungspuffer stecken
    const meanValues = computeAverageFFT();

    // setData erwartet ein Array: [x, serie1, serie2]
    
  // NEU: Bereich für x-Achse berechnen
  const minFreq = Math.min(...freqs);
  const maxFreq = Math.max(...freqs);
  const maxAmp = Math.max(...meanValues);

  // X-Achse dynamisch setzen
  if (fftPlot) {
    fftPlot.setScale("x", [0.0, maxFreq]);
    fftPlot.setScale("y", [0.0, maxAmp]);
    //fftPlot.setData([plotFreqs, maxValues, plotMags]);
    fftPlot.setData([toRegularArray(freqs), maxValues,toRegularArray(meanValues), toRegularArray(mags)]);
    //fftPlot.setData([plotFreqs, meanValues]);
    //fftPlot.redraw();
  }

  };
}


function bufferFFTResult(magArray) {
  if (fftMaxBuffer.length >= FFT_RING_SIZE)
    fftMaxBuffer.shift(); // Ältestes raus
  fftMaxBuffer.push(magArray);
}


function computeMaxFFTValues() {
  if (fftMaxBuffer.length === 0) return [];
  const numBins = fftMaxBuffer[0].length;
  let maxValues = Array(numBins).fill(-Infinity);

  for (let bin = 0; bin < numBins; bin++) {
    for (let i = 0; i < fftMaxBuffer.length; i++) {
      maxValues[bin] = Math.max(maxValues[bin], fftMaxBuffer[i][bin]);
    }
  }
  return maxValues;
}



function startFFTUpdates() {
  // Falls das Intervall schon läuft, abbrechen
  if (fftUpdateTimerId !== null) {
    clearInterval(fftUpdateTimerId);
  }

  fftUpdateTimerId = setInterval(() => {
    if (!fftWorker || !fftPlot) return;



//const arr = accBuffer.getFieldTypedArray('x', FFT_WINDOW_SIZE);


    const arr = getSelectedData(FFT_AXIS_MODE, accBuffer,FFT_WINDOW_SIZE);
    
   // const arr = chartData[1].toArray();
    const tarr = accBuffer.getFieldTypedArray('time', FFT_WINDOW_SIZE);

    const arrLen = arr.length;

    if (arrLen < FFT_WINDOW_SIZE) return;

    const idx0 = arrLen - 1;
    const idx1 = arrLen - FFT_WINDOW_SIZE;
    const t0 = tarr[idx0];
    const t1 = tarr[idx1];
    const delta = t0 - t1;

    if (delta <= 0) {
      console.warn("FFT: Ungültiges Zeitintervall!!!");
      return;
    }

      const frq = Math.round(FFT_WINDOW_SIZE * (1000000 / delta));
      const windowArr = arr.slice(idx1, idx0 + 1);
      const buf = Float32Array.from(windowArr);

      fftWorker.postMessage({
      buffer: buf.buffer,
      sampleRate: frq,
      windowType: FFT_WINDOW_TYPE,// oder 'HANNING', 'HAMMING', 'RECTANGULAR'
      highpassCutoff: fftHighPass,
      dcCutoff: DC_CUTOFF, 
    }, [buf.buffer]);


    //fftWorker.postMessage({ buffer: buf.buffer, sampleRate: frq }, [buf.buffer]);
  }, FFT_UPDATE_INTERVAL);
}



/*   function getSelectedData(mode, chartData) {
  switch (mode) {
    case "COMBI": {
      // Alle Werte zu einer Reihenfolge kombinieren – zum Beispiel als "Betrag" (Vektor-Länge)
      const arrX = chartData[1].toArray();
      const arrY = chartData[2].toArray();
      const arrZ = chartData[3].toArray();
      // Kombiniere: sqrt(x^2 + y^2 + z^2) für jeden Zeitschritt
      return arrX.map((x, i) => {
        const y = arrY[i] ?? 0;
        const z = arrZ[i] ?? 0;
        return Math.sqrt(x * x + y * y + z * z);
      });
    }
    case "ONLYX":
      return chartData[1].toArray();
    case "ONLYY":
      return chartData[2].toArray();
    case "ONLYZ":
      return chartData[3].toArray();
    default:
      return chartData[1].toArray(); // Fallback
  }
} */

function getSelectedData(mode, accBuffer, N) {
  switch (mode) {
    case "COMBI": {
      // Hier werden tatsächlich alle Achsen benötigt!
      const xs = accBuffer.getFieldTypedArray('x', N);
      const ys = accBuffer.getFieldTypedArray('y', N);
      const zs = accBuffer.getFieldTypedArray('z', N);
      return xs.map((x, i) => {
        const y = ys[i] ?? 0;
        const z = zs[i] ?? 0;
        return Math.sqrt(x * x + y * y + z * z);
      });
    }
    case "ONLYX":
      return accBuffer.getFieldTypedArray('x', N);
    case "ONLYY":
      return accBuffer.getFieldTypedArray('y', N);
    case "ONLYZ":
      return accBuffer.getFieldTypedArray('z', N);
    default:
      return accBuffer.getFieldTypedArray('x', N); // Fallback
  }
}








 // FFT MITTELUNG
 
function bufferAverageFFT(mags) {
  //console.log("[DEBUG] Neuer Eintrag (mags):", mags);
  if (avgFFTBuffer.length >= N_AVG) {
    avgFFTBuffer.shift();
  }
  avgFFTBuffer.push(mags);
 // console.log("[DEBUG] Buffer-Länge:", avgFFTBuffer.length);
 // console.log("[DEBUG] Erstes Element im Buffer:", avgFFTBuffer[0]);
  // Optional: Alle Längen prüfen
/*   for (let i = 0; i < avgFFTBuffer.length; i++) {
    if (!Array.isArray(avgFFTBuffer[i])) {
      console.warn(`[WARN] Buffer-Eintrag ${i} ist kein Array!`, avgFFTBuffer[i]);
    } else {
      console.log(`[DEBUG] Buffer-Eintrag ${i} Länge:`, avgFFTBuffer[i].length);
    }
  } */
}
  
function computeAverageFFT() {
  //console.log("[DEBUG] Mittelwertberechnung über Buffer-Länge:", avgFFTBuffer.length);
  if (avgFFTBuffer.length === 0) return [];
  const len = avgFFTBuffer[0].length;
  let avg = new Array(len).fill(0);
  for (let i = 0; i < avgFFTBuffer.length; i++) {
    if (avgFFTBuffer[i].length !== len) {
      console.error(`[ERROR] Abweichende Länge in Buffer bei Index ${i}:`, avgFFTBuffer[i].length, "erwartet:", len);
    }
    for (let j = 0; j < len; j++) {
      avg[j] += avgFFTBuffer[i][j];
    }
  }
  for (let j = 0; j < len; j++) {
    avg[j] /= avgFFTBuffer.length;
  }
  //console.log("[DEBUG] Gemitteltes Ergebnis (Ausschnitt):", avg.slice(0, 10)); // Nur die ersten 10 Einträge, damit Log nicht explodiert
  return avg;
}
  
function setAverageCount(newVal) {
  N_AVG = Math.max(1, parseInt(newVal)); // Mindestwert 1
  while (avgFFTBuffer.length > N_AVG) {
    avgFFTBuffer.shift(); // Buffer ggf. verkleinern
  }
}
  
  
  // Konvertiere Float32Array in Array (nur wenn nötig)
function toRegularArray(arr) {
  return Array.from(arr);
}
  
 function formatMicroseconds(v) {
  const totalSeconds = v / 1e3;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = (totalSeconds % 60).toFixed(3);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.padStart(6, '0')}`;
} 
  




  /* setInterval(() => {
    
    if (!fftWorker || !fftPlot) {
      console.warn("FFT Worker oder Plot nicht initialisiert");
      return;
    }

    if (chartData[1].length < FFT_WINDOW_SIZE) {
      console.warn(`[FFT] Nicht genug Daten: chartData[1].length = ${chartData[1].length}`);
      return;
    }

    // Index-Grenzen für das FFT-Fenster
    const startIdx = chartData[1].length - FFT_WINDOW_SIZE;
    const endIdx = chartData[1].length - 1;

    // Signalwerte für das FFT-Window extrahieren (als Float32Array)
    const windowArr = new Float32Array(FFT_WINDOW_SIZE);
    for (let i = 0; i < FFT_WINDOW_SIZE; i++) {
      windowArr[i] = chartData[1][startIdx + i];
    }

    // Zeitstempel des Fensters am Anfang und Ende
    const t0 = chartData[0][startIdx];
    const t1 = chartData[0][endIdx];
    console.log("T0 INDEX", startIdx, "T1 INDEX", endIdx);
    console.log("T0", t0, "T1", t1);


    // Zeitdifferenz in Sekunden (Annahme: Zeitstempel in ms)
    const deltaT = (t1 - t0) / 1000;
    console.log("DELTA T " + String(deltaT));
    if (deltaT <= 0) {
      console.warn("[FFT] Ungültige Zeitdifferenz für Samplingrate:", deltaT);
      return;
    }

    // Effektive Abtastrate berechnen
   // const effectiveSampleRate = (FFT_WINDOW_SIZE - 1) / deltaT;
    //effectiveSampleRate = SAMPLE_RATE;
console.log("LEN chartData[0]:", chartData[0].length, "LEN chartData[1]:", chartData[1].length);
    console.log(`[FFT] Sende Fenster mit ${FFT_WINDOW_SIZE} Werten an Worker.`);
    //console.log(`[FFT] Effektive Samplerate: ${effectiveSampleRate.toFixed(1)} Hz`);
console.log(`[FFT] Effektive Samplerate: ${SAMPLE_RATE.toFixed(1)} Hz`);
    // Buffer an Worker schicken (Transferable Objekt)
    fftWorker.postMessage(
      { buffer: windowArr.buffer, sampleRate: SAMPLE_RATE },
      [windowArr.buffer]
    );

  }, FFT_UPDATE_INTERVAL); */






  
		function getSize() {				
      const container = document.getElementById("livechart2");
      return {
					width: container.clientWidth,
					height: container.clientHeight,
				}
			}

		window.addEventListener("resize", e => {
				chart.setSize(getSize());
			});


let timestamps = [];
let values1 = [];
let values2 = [];
let values3 = [];
const maxPoints = 300000;
const now = Date.now();
for(let i = -99; i <= 0; i++) {
  const t = (now + i*1000)/1000;
  timestamps.push(t);
  values1.push(Math.sin(i/5)*10 + 50);
  values2.push(Math.cos(i/5)*7 + 40);
  values3.push(Math.tan(i/10)*5 + 30);
}
const container = document.getElementById("livechart2");
const options = {
  ...getSize(),
  title: "Live-Daten mit 3 Serien",
      width: container.clientWidth,
      height: container.clientHeight,

  
    axes: [
        {
        scale: "x",
        label: "Zeit (s)",
        grid: { show: true },
        ticks: { format: (u, v) => new Date(v * 1000).toLocaleTimeString() },
        stroke: "white"
      },
      {
        scale: "y",
        label: "Wert",
        grid: { show: true },
        ticks: { format: (u, v) => v.toFixed(2) + " mg" },
        stroke: "white"
        }
    ],
  
  
  scales: {
    x: { time: true },
    y: { range: [-1500, 1500] }
  },
  series: [


      { label: "Zeit", value: (u, v) => v === null ? "-" : new Date(v * 1).toLocaleTimeString() },
      { label: "Acc X (mg)", stroke: "#FFD600" },
      { label: "Acc Y (mg)", stroke: "#ec3030ff" },
      { label: "Acc Z (mg)", stroke: "#7a96e2ff" },


  ],
  cursor: {
    drag: { x: true, y: true, setScale: true }
  },
};

    const chart = new uPlot(options, [timestamps.slice(), values1.slice(), values2.slice(), values3.slice()], document.getElementById("livechart2"));

        const pauseBtn2 = document.getElementById("pauseBtn2");
        let paused2 = false;
        pauseBtn2.textContent = "⏸"; // Start mit Pause-Symbol
        pauseBtn2.onclick = () => {
        paused = !paused;
        pauseBtn2.textContent = paused   ? "▶" : "⏸";
        };


function zoomAxis(axis, factor, pointerPos) {
  const sc = chart.scales[axis];
  const range = sc.max - sc.min;
  const newRange = range * factor;
  const newMin = sc.min + range * pointerPos - newRange * pointerPos;
  const newMax = newMin + newRange;
  if (newMax - newMin < 1e-9) return;

  // Vor dem Setzen: anderen Achsenbereich sichern
  let otherMin, otherMax;
  if (axis === "x") {
    otherMin = chart.scales.y.min;
    otherMax = chart.scales.y.max;
  } else if (axis === "y") {
    otherMin = chart.scales.x.min;
    otherMax = chart.scales.x.max;
  }
  chart.setScale(axis, { min: newMin, max: newMax });
  // Danach: anderen Achsenbereich sofort wieder setzen
  if (axis === "x" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("y", { min: otherMin, max: otherMax });
  }
  if (axis === "y" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("x", { min: otherMin, max: otherMax });
  }
  console.log("ZOOM AXIS " + axis);
}

function panAxis(axis, deltaPx, axisPxLength) {
  if (axisPxLength === 0) return;
  const sc = chart.scales[axis];
  const range = sc.max - sc.min;
  const delta = -(deltaPx / axisPxLength) * range;

  // Vor dem Setzen: anderen Achsenbereich sichern
  let otherMin, otherMax;
  if (axis === "x") {
    otherMin = chart.scales.y.min;
    otherMax = chart.scales.y.max;
  } else if (axis === "y") {
    otherMin = chart.scales.x.min;
    otherMax = chart.scales.x.max;
  }

  chart.setScale(axis, { min: sc.min + delta, max: sc.max + delta });
  // Danach: anderen Achsenbereich sofort wieder setzen
  if (axis === "x" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("y", { min: otherMin, max: otherMax });
  }
  if (axis === "y" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("x", { min: otherMin, max: otherMax });
  }
}

    function updateCursor(el, dragging, canDrag) {
      if(dragging) {
        el.style.cursor = "grabbing";
      } else {
        el.style.cursor = canDrag ? (el.id === "y-axis-overlay" ? "ns-resize" : "ew-resize") : "default";
      }
    }

    // Y Axis Overlay
    (() => {
      const yOverlay = document.getElementById("y-axis-overlay");
      let isPanning = false;
      let lastY = 0;
      yOverlay.addEventListener("wheel", e => {
        e.preventDefault();
        const rect = yOverlay.getBoundingClientRect();
        const pointerPos = (e.clientY - rect.top) / rect.height;
        const factor = e.deltaY < 0 ? 0.85 : 1.15;
        zoomAxis("y", factor, pointerPos);
      }, { passive: false });
      yOverlay.addEventListener("mousedown", e => {
        if(e.button !== 0) return;
        e.preventDefault();
        isPanning = true;
        lastY = e.clientY;
        updateCursor(yOverlay, true, true);
      });
      window.addEventListener("mousemove", e => {
        if(!isPanning) return;
        e.preventDefault();
        const deltaY = lastY - e.clientY;
        lastY = e.clientY;
        panAxis("y", deltaY, yOverlay.getBoundingClientRect().height);
      });
      window.addEventListener("mouseup", e => {
        if(isPanning) {
          isPanning = false;
          updateCursor(yOverlay, false, true);
        }
      });
      yOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(yOverlay, false, true));
      yOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(yOverlay, false, false));
    })();

    // X Axis Overlay mit Persistenz von Pan-Offset
    (() => {
      const xOverlay = document.getElementById("x-axis-overlay");
      let isPanning = false;
      let lastX = 0;

      // Pan-Offset in Sekunden, initial 0 = Ansicht ganz rechts
      let panOffset = 0;

      xOverlay.addEventListener("wheel", e => {
        e.preventDefault();
        const rect = xOverlay.getBoundingClientRect();
        const pointerPos = (e.clientX - rect.left) / rect.width;
        const factor = e.deltaY < 0 ? 0.85 : 1.15;
        zoomAxis("x", factor, pointerPos);
      }, { passive: false });

      xOverlay.addEventListener("mousedown", e => {
        if(e.button !== 0) return;
        e.preventDefault();
        isPanning = true;
        lastX = e.clientX;
        updateCursor(xOverlay, true, true);
      });

      window.addEventListener("mousemove", e => {
        if(!isPanning) return;
        e.preventDefault();
        const deltaX = e.clientX - lastX;
        lastX = e.clientX;

        const scX = chart.scales.x;
        const range = scX.max - scX.min;
        const widthPx = xOverlay.getBoundingClientRect().width;
        const deltaSec = -(deltaX / widthPx) * range;

        panOffset += deltaSec;

        // Begrenzung: Kein verschieben nach rechts über Live-Ende hinaus (max 0)
        if (panOffset > 0) panOffset = 0;

        // Sichtbarkeitsbereich durch Offset verschieben
        chart.setScale("x", {
          min: scX.min + deltaSec,
          max: scX.max + deltaSec
        });
      });

      window.addEventListener("mouseup", e => {
        if(isPanning) {
          isPanning = false;
          updateCursor(xOverlay, false, true);
        }
      });

      xOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(xOverlay, false, true));
      xOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(xOverlay, false, false));

      // Live-Daten Update erweitert: benutzt panOffset um Ansicht zu verschieben
      window.addEventListener("liveDataUpdate", (e) => {
        const latest = e.detail.latestTimestamp;
        const visibleRange = chart.scales.x.max - chart.scales.x.min;

        // Nur automatic scroll wenn panOffset nahe 0 ist (<= -0.5 Sek)
        if (panOffset > -0.5) {
          panOffset = 0;
          chart.setScale("x", { min: latest - visibleRange, max: latest });
        } else {
          // sonst Ansicht mit panOffset beibehalten (schiebt Fenster nach links)
          chart.setScale("x", {
            min: latest - visibleRange + panOffset,
            max: latest + panOffset
          });
        }
      });

      // Expose panOffset zum restlichen Script (für Live-Daten Update)
      window.getPanOffset = () => panOffset;
      window.setPanOffset = (offset) => { panOffset = offset; };
    })();

    // Rechte Maustaste Zoombox
    let zoomBoxing = false;
    let zoomStart = null;

    chart.over.addEventListener("contextmenu", e => e.preventDefault());

chart.over.addEventListener("wheel", e => {
  e.preventDefault();

  // Relative Mausposition im Chart-Overlay
  const rect = chart.over.getBoundingClientRect();
  const pointerPosX = (e.clientX - rect.left) / rect.width;
  const pointerPosY = (e.clientY - rect.top) / rect.height;

  // Zoom-Faktor: Mausrad hoch = Faktor < 1 (reinzoomen), sonst > 1 (rauszoomen)
  const factor = e.deltaY < 0 ? 0.85 : 1.15;

  // Zoom Funktion analog zu deinen zoomAxis
  function zoomAxis(axis, factor, pointerPos) {
    const sc = chart.scales[axis];
    const range = sc.max - sc.min;
    const newRange = range * factor;
    const newMin = sc.min + range * pointerPos - newRange * pointerPos;
    const newMax = newMin + newRange;
    if (newMax - newMin < 1e-9) return;
    chart.setScale(axis, { min: newMin, max: newMax });
  }

  zoomAxis('x', factor, pointerPosX);
  zoomAxis('y', factor, pointerPosY);
}, { passive: false });


    chart.over.addEventListener("mousedown", e => {
      if(e.button === 2){
        zoomBoxing = true;
        zoomStart = {x: e.offsetX, y: e.offsetY};
        chart.over.style.cursor = "crosshair";
      }
    });

    chart.over.addEventListener("mouseup", e => {
      if(e.button === 2 && zoomBoxing){
        zoomBoxing = false;
        chart.over.style.cursor = "";

        const x0 = zoomStart.x, y0 = zoomStart.y;
        const x1 = e.offsetX, y1 = e.offsetY;

        const xMin = chart.posToVal(Math.min(x0, x1), "x");
        const xMax = chart.posToVal(Math.max(x0, x1), "x");
        const yMin = chart.posToVal(Math.max(y0, y1), "y");
        const yMax = chart.posToVal(Math.min(y0, y1), "y");

        if(xMax > xMin && yMax > yMin){
          chart.setScale("x", {min: xMin, max: xMax});
          chart.setScale("y", {min: yMin, max: yMax});
        }
      }
    });

    // Doppelklick reset
    chart.over.addEventListener("dblclick", () => {
      window.setPanOffset(0);
      chart.setScale("x", {auto: true});
      chart.setScale("y", {auto: true});
    });





    // Live-Daten Simulation & Updates mit persistierendem Pan-Offset
    let lastTimestamp2 = timestamps[timestamps.length - 1];
    function addLiveDataPoint() {
      if (paused) return;

  lastTimestamp2 += 1;
  timestamps.push(lastTimestamp2);
  values1.push(Math.sin(lastTimestamp2/5) * 10 + 50 + (Math.random() - 0.5));
  values2.push(Math.cos(lastTimestamp2/7) * 7 + 40 + (Math.random() - 0.5));
  values3.push(Math.sin(lastTimestamp2/10) * 5 + 30 + (Math.random() - 0.5));

      if (timestamps.length > maxPoints) {
        timestamps.shift();
        values1.shift();
        values2.shift();
        values3.shift();
      }

      const xMinBefore = chart.scales.x.min;
      const xMaxBefore = chart.scales.x.max;
      const yMinBefore = chart.scales.y.min;
      const yMaxBefore = chart.scales.y.max;

      chart.setData([timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]);

      // Wenn Nutzer den Pan-Bereich manuell gesetzt hat, übernehmen wir den Offset
      // Sonst automatisch weiter scollen (xPanOffset wird intern im Overlay verwaltet)
      // Wir triggern ein Event für die X-Achse, damit Overlay das neu repositioniert
      window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: lastTimestamp2 } }));

      // Y-Skala behalten
      if(yMinBefore !== undefined && yMaxBefore !== undefined){
        chart.setScale("y", {min: yMinBefore, max: yMaxBefore});
      }
     if(xMinBefore !== undefined && xMaxBefore !== undefined){
        chart.setScale("x", {min: xMinBefore, max: xMaxBefore});
      }
      //window.setPanOffset(0);




    }
    //setInterval(addLiveDataPoint, 1); // 33 FPS

    function startLoading(button) {
  const statusbar = document.getElementById("statusbar");
  const progress = statusbar.querySelector(".progress");

  // Statusbar sichtbar machen
  statusbar.style.display = "block";

  // Progressbar zurücksetzen
  progress.style.transition = "none";
  progress.style.width = "0%";

  // Kleinen Delay, damit CSS-Transition sauber startet
  setTimeout(() => {
    progress.style.transition = "width 10s linear";
    progress.style.width = "100%";
  }, 50);

  // Nach 10s (fertig geladen)
  setTimeout(() => {
    alert("Fertig geladen!");
    statusbar.style.display = "none";
    progress.style.width = "0%";
  }, 10000);
}