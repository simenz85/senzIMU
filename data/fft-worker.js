// fft-worker.js
importScripts('fft.min.js');

// --- Globale Worker-Variablen ---
let fft = null;
let windowFunction = null;
let prevHighpassState = null;

// --- Fensterfunktionen (vorberechnet) ---
const WINDOWS = {
  RECTANGULAR: (N) => new Float32Array(N).fill(1.0),
  HANNING: (N) => {
    const window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      window[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1)));
    }
    return window;
  },
  HAMMING: (N) => {
    const window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      window[n] = 0.54 - 0.46 * Math.cos(2 * Math.PI * n / (N - 1));
    }
    return window;
  },
  BLACKMAN: (N) => {
    const window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      window[n] = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * n / (N - 1));
    }
    return window;
  }
};

// --- Signalverarbeitungsfunktionen ---
function removeDCOffset(signal) {
  const mean = signal.reduce((sum, x) => sum + x, 0) / signal.length;
  return signal.map(x => x - mean);
}

function applyHighpass(signal, sampleRate, cutoffFreq = 0.1) {
  const RC = 1 / (2 * Math.PI * cutoffFreq);
  const alpha = RC / (RC + 1 / sampleRate);
  const filtered = new Float32Array(signal.length);

  const prevState = prevHighpassState || signal[0];
  filtered = alpha * prevState;

  for (let i = 1; i < signal.length; i++) {
    filtered[i] = alpha * (filtered[i - 1] + signal[i] - signal[i - 1]);
  }

  prevHighpassState = filtered[filtered.length - 1];
  return filtered;
}

// --- Korrekturfaktoren für Fenster ---
function calculateCorrectionFactor(windowType) {
  switch (windowType.toUpperCase()) {
    case 'HANNING': return Math.sqrt(8 / 3);
    case 'HAMMING': return 1.8522;
    case 'BLACKMAN': return 2.3805;
    default: return 1.0;
  }
}

// --- Haupt-FFT-Verarbeitung ---
self.onmessage = (event) => {
  const {
    buffer,
    sampleRate,
    windowType = 'HANNING',
    highpassCutoff = null,
    dcCutoff = true,
    fftDBoutput = false,
    debug = false // NEU: Debug-Flag zum Ausgeben von Zwischenergebnissen
  } = event.data;

  const input = new Float32Array(buffer);

  // 1. Blocklänge bestimmen
  const N = Math.pow(2, Math.floor(Math.log2(input.length)));
  const truncated = input.subarray(0, N);

  // 2. Optional: DC-Offset entfernen
  const zeroMeanSignal = dcCutoff ? removeDCOffset(truncated) : truncated;

  if (debug) {
    // Debug: Signal nach DC-Offset entfernen
    self.postMessage({ debugMsg: 'Signal nach DC-Offset entfernen', data: zeroMeanSignal }, [zeroMeanSignal.buffer.slice(0, zeroMeanSignal.length * 4)]);
  }

  // 3. Optional: Hochpassfilter
  const processedSignal = highpassCutoff
    ? applyHighpass(zeroMeanSignal, sampleRate, highpassCutoff)
    : zeroMeanSignal;

  if (debug) {
    // Debug: Signal nach Hochpassfilter
    self.postMessage({ debugMsg: 'Signal nach Hochpassfilter', data: processedSignal }, [processedSignal.buffer.slice(0, processedSignal.length * 4)]);
  }

  // 4. Fensterung
  if (!windowFunction || windowFunction.type !== windowType || windowFunction.size !== N) {
    windowFunction = {
      type: windowType,
      window: WINDOWS[windowType.toUpperCase()](N),
      correctionFactor: calculateCorrectionFactor(windowType),
      size: N
    };
  }

  const windowedSignal = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    windowedSignal[n] = processedSignal[n] * windowFunction.window[n];
  }

  if (debug) {
    // Debug: Signal nach Fensterung
    self.postMessage({ debugMsg: 'Signal nach Fensterung', data: windowedSignal }, [windowedSignal.buffer.slice(0, windowedSignal.length * 4)]);
  }

  // 5. FFT berechnen
  if (!fft || fft.size !== N) fft = new FFT(N);
  const out = fft.createComplexArray();
  fft.realTransform(out, windowedSignal);
  fft.completeSpectrum(out);

  // 6. Magnitudenspektrum berechnen
  let mags = null;
  let magsType = fftDBoutput ? "dB" : "linear";
  const EPS = 1e-12;

if (fftDBoutput) {
  mags = new Float32Array(N / 2);
  for (let i = 0; i < mags.length; i++) {
    const re = out[2 * i];
    const im = out[2 * i + 1];
    const mag = Math.sqrt(re * re + im * im) * windowFunction.correctionFactor;
    let val = 20 * Math.log10(Math.max(mag, EPS));
    mags[i] = val < 0 ? 0 : val; // Nach unten auf 0 begrenzen
  }
  if (dcCutoff) mags[0] = 0;  // DC-Peak ebenfalls 0 statt -240
} else {
    mags = new Float32Array(N / 2);
    for (let i = 0; i < mags.length; i++) {
      const re = out[2 * i];
      const im = out[2 * i + 1];
      mags[i] = Math.sqrt(re * re + im * im) * windowFunction.correctionFactor;
    }
    if (dcCutoff) mags[0] = 1e-12; // kleiner Wert statt 0
  }

  // 7. Frequenzachse generieren
  const freqs = new Float32Array(mags.length);
  for (let i = 0; i < freqs.length; i++) {
    freqs[i] = i * sampleRate / N;
  }

  // 8. Ergebnis zurückgeben
  self.postMessage({
    freqs,
    mags,
    magsType,
    windowType: windowFunction.type,
    sampleRate,
    fftSize: N,
    timestamp: event.data.timestamp,
    timeString: event.data.timeString,
    clockTimeStr: event.data.clockTimeStr,
    axis: event.data.axis
  }, [freqs.buffer, mags.buffer]);
};
