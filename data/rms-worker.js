// --- Haupt-RMS-Verarbeitung ---
self.onmessage = (event) => {
  const { x, y, z, time } = event.data;

  if (!x || !y || !z) return;

  const len = x.length;
  if (len === 0) return;

  // 1. DC-Offset (Mittelwert) berechnen für jede Achse
  let sumX = 0, sumY = 0, sumZ = 0;
  for (let i = 0; i < len; i++) {
    sumX += x[i];
    sumY += y[i];
    sumZ += z[i];
  }
  const meanX = sumX / len;
  const meanY = sumY / len;
  const meanZ = sumZ / len;

  // 2. Signale zentrieren (AC-Anteil) und Quadrate aufsummieren
  let sumSqX = 0, sumSqY = 0, sumSqZ = 0;
  for (let i = 0; i < len; i++) {
    const acX = x[i] - meanX;
    const acY = y[i] - meanY;
    const acZ = z[i] - meanZ;
    sumSqX += acX * acX;
    sumSqY += acY * acY;
    sumSqZ += acZ * acZ;
  }

  // 3. Einzelne RMS-Werte pro Achse (√ von Varianz = Standardabweichung)
  const rmsX = Math.sqrt(sumSqX / len);
  const rmsY = Math.sqrt(sumSqY / len);
  const rmsZ = Math.sqrt(sumSqZ / len);

  // 4. Gesamter RMS-Wert der Vibration (3D-Vektorbetrag der RMS-Werte)
  const rmsTotal = Math.sqrt(rmsX * rmsX + rmsY * rmsY + rmsZ * rmsZ);

  // 5. Ergebnis zurückgeben
  self.postMessage({
    rmsX,
    rmsY,
    rmsZ,
    rmsTotal,
    time
  });
};
