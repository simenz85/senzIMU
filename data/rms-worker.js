// --- Signalverarbeitungsfunktionen ---
function removeDCOffset(signal) {
  const mean = signal.reduce((sum, x) => sum + x, 0) / signal.length;
  return signal.map(x => x - mean);
}

// --- Haupt-RMS-Verarbeitung ---
self.onmessage = (event) => {
  const {
    x,
    y,
    z,
    time,
    dcCutoff = false,
    debug = false,
  } = event.data;

  //console.log("EVENT DATA:", event.data);
  //console.log("X", x, "Y", y, "Z", z);

  // 1. Optional DC-Offset entfernen
  const signalX = dcCutoff ? removeDCOffset(x) : x;
  const signalY = dcCutoff ? removeDCOffset(y) : y;
  const signalZ = dcCutoff ? removeDCOffset(z) : z;

  // 2. RMS-Funktion
  function calcRMS(arr) {
    let sumSquares = 0;
    for (let i = 0; i < arr.length; i++) {
      sumSquares += arr[i] * arr[i];
    }
    return Math.sqrt(sumSquares / arr.length);
  }

  const rmsX = calcRMS(signalX);
  const rmsY = calcRMS(signalY);
  const rmsZ = calcRMS(signalZ);

  // 3. Gesamt-RMS über alle Achsen
  const rmsTotal = Math.sqrt(rmsX * rmsX + rmsY * rmsY + rmsZ * rmsZ);

  if (debug) {
    self.postMessage({
      debugMsg: 'RMS Werte berechnet',
      rmsX, rmsY, rmsZ, rmsTotal
    });
  }

  // 4. Ergebnis zurückgeben
  self.postMessage({
    rmsX,
    rmsY,
    rmsZ,
    rmsTotal,
    time
  });
};
