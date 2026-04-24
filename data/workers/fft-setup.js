// FFT-Chart initialisieren
export function initFFTChart() {
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
    	stroke: "white",
//    grid: {
//    	stroke: "white",
//    }
    },
    {
   	stroke: "white"
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
export function setupFFTWorker() {
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
export function startFFTUpdates() {
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

export function bufferFFTResult(magArray) {
  if (fftMaxBuffer.length >= FFT_RING_SIZE)
    fftMaxBuffer.shift(); // Ältestes raus
  fftMaxBuffer.push(magArray);
}


export function computeMaxFFTValues() {
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

