const { vec3, quat, mat3 } = glMatrix;

const ENU_UP = [0, 0, 1];
const ENU_GRAVITY_DOWN = [0, 0, -1];

export function meanVector(data) {
  let mean = [0, 0, 0];
  data.forEach(v => {
    mean[0] += v[0];
    mean[1] += v[1];
    mean[2] += v[2];
  });
  mean[0] /= data.length;
  mean[1] /= data.length;
  mean[2] /= data.length;
  return mean;
}

export function centerData(data, mean) {
  return data.map(v => [v[0] - mean[0], v[1] - mean[1], v[2] - mean[2]]);
}

export function normalizeVector(v) {
  const len = Number(Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]));
  console.log('normalize Vector Länge des Vektors:', len);
  if (len < 1e-12 || isNaN(len)) {
    console.warn('normalizeVector: Eingangsvektor zu klein oder NaN, Rückgabe Ersatzvektor [1,0,0]');
    return [1, 0, 0];
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function filterValidVectors(data) {
  return data.filter(v => {
    // Wandle Float32Array (oder andere Objekte) zuerst in normales Array um
    const arr = Array.from(v);

    // Dann wandle jedes Element explizit in Number um
    const vec = arr.map(x => Number(x));

    console.log('Vektor zum Prüfen (nach Array.from und Number):', vec);

    if (vec.some(val => typeof val !== 'number' || isNaN(val))) {
      console.warn('Ungültiger Wert in Vektor erkannt:', vec);
      return false;
    }

    const len = Math.sqrt(vec[0]*vec[0] + vec[1]*vec[1] + vec[2]*vec[2]);
    console.log('Länge des Vektors:', len);
    const valid = len > 1e-12;

    if (!valid) {
      console.warn('Vektor mit zu kleiner Länge oder NaN:', vec, 'Länge:', len);
    }

    return valid;
  });
}

export function principalComponentSVD(data) {
  const validData = filterValidVectors(data);
  if (validData.length === 0) {
    throw new Error('principalComponentSVD: Keine gültigen Daten');
  }

  const mean = meanVector(validData);
  const centered = centerData(validData, mean);
  const svd = SVDJS.SVD(centered);
  const pc = svd.u.map(row => row[0]);
  return normalizeVector(pc);
}

export function safeRotationTo(fromVec, toVec) {
  const v1 = normalizeVector(fromVec);
  const v2 = normalizeVector(toVec);
  
  // Korrekte Dot-Product-Berechnung für Arrays
  let dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  
  const epsilon = 1e-6;
  if (dot > 1 - epsilon) return quat.create();
  if (dot < -1 + epsilon) {
    let axis = [1, 0, 0];
    if (Math.abs(v1[0]) > 0.9) axis = [0, 1, 0];
    const q = quat.create();
    quat.setAxisAngle(q, axis, Math.PI);
    return q;
  }
  
  // Korrekte Cross-Product-Berechnung
  const axis = [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0]
  ];
  
  const s = Math.sqrt((1 + dot) * 2);
  const invs = 1 / s;
  
  // Korrekte Quaternion-Erstellung
  return quat.fromValues(axis[0] * invs, axis[1] * invs, axis[2] * invs, s * 0.5);
}

export function computeZAlignment(accelData) {
  const validData = filterValidVectors(accelData);
  if (validData.length === 0) {
    throw new Error('computeZAlignment: Keine gültigen Accelerometerdaten');
  }
  const normData = validData.map(v => normalizeVector(v));
  const gravity = meanVector(normData);
  const gravityNorm = normalizeVector(gravity);
  console.log('Normalized gravity:', gravityNorm);
  const target = ENU_GRAVITY_DOWN;
  const q = safeRotationTo(gravityNorm, target);
  console.log('Z Alignment quaternion:', q);
  return q;
}

export function calibrateWithZPlusXY(accelIdleData, motionData, axis = 'x') {
  console.log('---- calibrateWithZPlusXY ----');
  
  // 1. Z-Achse aus Ruhedaten bestimmen
  const xIdle = accelIdleData[0];
  const yIdle = accelIdleData[1];
  const zIdle = accelIdleData[2];
  
  const meanX = xIdle.reduce((sum, val) => sum + val, 0) / xIdle.length;
  const meanY = yIdle.reduce((sum, val) => sum + val, 0) / yIdle.length;
  const meanZ = zIdle.reduce((sum, val) => sum + val, 0) / zIdle.length;
  
  const gravity = [meanX, meanY, meanZ];
  const gravityNorm = normalizeVector(gravity);
  console.log('Normalized gravity (Z-Achse):', gravityNorm);
  
  // Rotation von Gravity zu [0,0,1] (Sensor -> World)
  const targetZ = ENU_GRAVITY_DOWN;
  const zQuat = safeRotationTo(gravityNorm, targetZ);
  console.log('Z Alignment quaternion:', zQuat);
  
  // 2. Bewegungsdaten für XY-Ausrichtung
  const xMotion = motionData[0];
  const yMotion = motionData[1];
  const zMotion = motionData[2];
  
  // Bewegungsdaten mit Z-Rotation transformieren (in World-Koordinaten)
  const motionZAligned = [];
  for (let i = 0; i < xMotion.length; i++) {
    const vec = [xMotion[i], yMotion[i], zMotion[i]];
    const out = vec3.create();
    vec3.transformQuat(out, vec3.fromValues(...vec), zQuat);
    motionZAligned.push([out[0], out[1], out[2]]);
  }
  
  // Hauptkomponente in XY-Ebene finden
  const xyData = motionZAligned.map(v => [v[0], v[1], 0]); // Z-Komponente ignorieren
  
  const meanXY = meanVector(xyData);
  const centeredXY = centerData(xyData, meanXY);
  const svd = SVDJS.SVD(centeredXY);
  const principalDir = normalizeVector(svd.u.map(row => row[0]));
  
  console.log('Principal direction in XY plane:', principalDir);
  
  // Rotation von PrincipalDir zu TargetXY (in World-Koordinaten)
  const targetXY = axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  const xyQuat = safeRotationTo(principalDir, targetXY);
  console.log('XY Alignment quaternion:', xyQuat);
  
  // 3. Gesamtrotation: Zuerst XY, dann Z (Sensor -> World)
  const sensorToWorld = quat.create();
  quat.multiply(sensorToWorld, zQuat, xyQuat); // Rotation: sensor -> world
  
  // 4. Kalibrierungs-Quaternion ist das INVERSE (World -> Sensor)
  const calibrationQuat = quat.create();
  quat.conjugate(calibrationQuat, sensorToWorld); // World -> Sensor
  quat.normalize(calibrationQuat, calibrationQuat);
  
  // 5. VERIFIKATION
  console.log('=== VERIFICATION ===');
  
  // Test mit Gravity-Vektor (sollte nach [0,0,1] zeigen)
  const testGravity = vec3.fromValues(...gravity);
  const calibratedGravity = vec3.create();
  vec3.transformQuat(calibratedGravity, testGravity, calibrationQuat);
  
  console.log('Original gravity:', gravity);
  console.log('Calibrated gravity (should be [0,0,~1]):', 
              [calibratedGravity[0].toFixed(6), 
               calibratedGravity[1].toFixed(6), 
               calibratedGravity[2].toFixed(6)]);
  
  // Test mit einigen Bewegungsdaten
  console.log('Testing motion data samples:');
  for (let i = 0; i < Math.min(3, xMotion.length); i++) {
    const rawVec = [xMotion[i], yMotion[i], zMotion[i]];
    const calibVec = vec3.create();
    vec3.transformQuat(calibVec, vec3.fromValues(...rawVec), calibrationQuat);
    
    console.log(`Sample ${i}: Raw [${rawVec.map(v => v.toFixed(1))}] -> ` +
                `Calib [${calibVec[0].toFixed(1)}, ${calibVec[1].toFixed(1)}, ${calibVec[2].toFixed(1)}]`);
  }
  
  return calibrationQuat;
}

export function calibrateTwoAxesFlexible(motionArray1, motionArray2, gravityVector) {
    // --- Hilfsfunktionen ---
    const meanVector = (arr) => {
        const sum = arr.reduce((acc, val) => acc.map((v, i) => v + val[i]), [0,0,0]);
        return sum.map(v => v / arr.length);
    };

    const normalize = (v) => {
        const len = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2);
        return v.map(x => x / len);
    };

    const cross = (a, b) => [
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0]
    ];

    const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

    const quaternionFromAxes = (x, y, z) => {
        // Rotation-Matrix aus Achsen
        const m00 = x[0], m01 = y[0], m02 = z[0];
        const m10 = x[1], m11 = y[1], m12 = z[1];
        const m20 = x[2], m21 = y[2], m22 = z[2];
        const tr = m00 + m11 + m22;
        let qw, qx, qy, qz;

        if (tr > 0) {
            let S = Math.sqrt(tr+1.0) * 2;
            qw = 0.25 * S;
            qx = (m21 - m12) / S;
            qy = (m02 - m20) / S;
            qz = (m10 - m01) / S;
        } else if ((m00 > m11) & (m00 > m22)) {
            let S = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
            qw = (m21 - m12) / S;
            qx = 0.25 * S;
            qy = (m01 + m10) / S;
            qz = (m02 + m20) / S;
        } else if (m11 > m22) {
            let S = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
            qw = (m02 - m20) / S;
            qx = (m01 + m10) / S;
            qy = 0.25 * S;
            qz = (m12 + m21) / S;
        } else {
            let S = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
            qw = (m10 - m01) / S;
            qx = (m02 + m20) / S;
            qy = (m12 + m21) / S;
            qz = 0.25 * S;
        }
        return [qx, qy, qz, qw];
    };

    // --- Schritt 1: Mittelwerte berechnen ---
    let v1 = normalize(meanVector(motionArray1));
    let v2 = meanVector(motionArray2);

    // --- Schritt 2: Gram-Schmidt für orthogonale Achsen ---
    let proj = dot(v2, v1);
    let u2 = normalize([v2[0] - proj*v1[0], v2[1] - proj*v1[1], v2[2] - proj*v1[2]]);

    // --- Schritt 3: Z-Achse aus Kreuzprodukt ---
    let zAxis = normalize(cross(v1, u2));

    // --- Schritt 4: X- und Y-Achse ---
    let xAxis = v1;
    let yAxis = cross(zAxis, xAxis);

    // --- Schritt 5: Quaternion berechnen ---
    let finalQuat = quaternionFromAxes(xAxis, yAxis, zAxis);

    // --- Optional: Schwerkraft anpassen ---
    if (gravityVector) {
        // Wir könnten hier eine kleine Anpassung einfügen,
        // damit Z-Achse exakt auf die Gravitation zeigt.
        // zAxis = normalize(gravityVector);
    }

    return finalQuat;
}


export function calibrateTwoAxesFlexibleSimple(motionDataA, motionDataB, axisA = 'x', axisB = 'y') {
  console.log('---- calibrateTwoAxesFlexible (Simple) ----');
  
  // Hauptkomponenten extrahieren
  const getMeanVector = (data) => {
    const x = data[0], y = data[1], z = data[2];
    const meanX = x.reduce((s, v) => s + v, 0) / x.length;
    const meanY = y.reduce((s, v) => s + v, 0) / y.length;
    const meanZ = z.reduce((s, v) => s + v, 0) / z.length;
    return [meanX, meanY, meanZ];
  };
  
  const meanA = getMeanVector(motionDataA);
  const meanB = getMeanVector(motionDataB);
  
  const dirA = normalizeVector(meanA);
  let dirB = normalizeVector(meanB);
  
  console.log('Direction A:', dirA);
  console.log('Direction B:', dirB);
  
  // Orthogonalisierung
  const a = vec3.fromValues(...dirA);
  let b = vec3.fromValues(...dirB);
  
  // Projektion von B auf A entfernen
  const dot = vec3.dot(b, a);
  const proj = vec3.create();
  vec3.scale(proj, a, dot);
  vec3.subtract(b, b, proj);
  
  if (vec3.length(b) < 1e-6) {
    console.warn('Vektor B nach Orthogonalisierung zu klein');
    // Fallback: verwende einen standard orthogonalen Vektor
    vec3.set(b, a[1], -a[0], 0);
    if (vec3.length(b) < 1e-6) {
      vec3.set(b, a[2], 0, -a[0]);
    }
  }
  
  vec3.normalize(b, b);
  
  // Quaternion, das dirA auf targetA und dirB auf targetB rotiert
  const targetA = axisA === 'x' ? [1, 0, 0] : axisA === 'y' ? [0, 1, 0] : [0, 0, 1];
  const targetB = axisB === 'x' ? [1, 0, 0] : axisB === 'y' ? [0, 1, 0] : [0, 0, 1];
  
  const qA = safeRotationTo(dirA, targetA);
  const qB = safeRotationTo(dirB, targetB);
  
  // Kombiniere beide Rotationen
  const finalQuat = quat.create();
  quat.multiply(finalQuat, qB, qA);
  quat.normalize(finalQuat, finalQuat);
  
  console.log('Final quaternion:', finalQuat);
  return finalQuat;
}

export function applyCalibrationToAccel(accelData, calibrationQuat) {
  const vec = vec3.fromValues(accelData[0], accelData[1], accelData[2]);
  const calibratedVec = vec3.create();
  
  // Quaternion auf Beschleunigungsvektor anwenden
  vec3.transformQuat(calibratedVec, vec, calibrationQuat);

  return [calibratedVec[0], calibratedVec[1], calibratedVec[2]];
}

export function applyCalibration(rawData, calibrationQuat) {
  const vec = vec3.fromValues(...rawData);
  const calibrated = vec3.create();
  vec3.transformQuat(calibrated, vec, calibrationQuat);
  return [calibrated[0], calibrated[1], calibrated[2]];
}

export function calibrateWithZPlusXYStrict(accelIdleData, motionData, axis = 'x') {
  console.log('---- calibrateWithZPlusXY (Strict Separation) ----');
  
  // 1. Z-Achse EXKLUSIV aus Ruhedaten
  const zAxis = determineZAxisFromIdleData(accelIdleData);
  const zQuat = alignZAxis(zAxis);
  
  // 2. XY-Ausrichtung EXKLUSIV aus Bewegungsdaten
  const xyQuat = determineXYAlignmentFromMotionData(motionData, zQuat, axis);
  
  // 3. Kombinieren
  const finalQuat = quat.create();
  quat.multiply(finalQuat, xyQuat, zQuat);
  
  return finalQuat;
}

function determineZAxisFromIdleData(accelIdleData) {
  const validData = filterValidVectors(accelIdleData);
  if (validData.length === 0) {
    throw new Error('Keine gültigen Ruhedaten für Z-Achse');
  }
  
  const normData = validData.map(v => normalizeVector(v));
  const gravity = meanVector(normData);
  return normalizeVector(gravity);
}

function alignZAxis(zAxis) {
  const targetZ = ENU_GRAVITY_DOWN;
  return safeRotationTo(zAxis, targetZ);
}

function determineXYAlignmentFromMotionData(motionData, zQuat, axis) {
  const validData = filterValidVectors(motionData);
  if (validData.length === 0) {
    throw new Error('Keine gültigen Bewegungsdaten für XY-Ausrichtung');
  }
  
  // Daten mit Z-Rotation ausrichten
  const zAlignedData = validData.map(v => {
    const vec = vec3.fromValues(...v);
    const out = vec3.create();
    vec3.transformQuat(out, vec, zQuat);
    return [out[0], out[1], out[2]];
  });
  
  // Nur XY-Ebene betrachten
  const xyData = zAlignedData.map(v => [v[0], v[1], 0]);
  const principalDir = principalComponentSVD(xyData);
  
  // Sicherstellen, dass es ein XY-Vektor ist
  const principalDirXY = [principalDir[0], principalDir[1], 0];
  const principalDirXYNorm = normalizeVector(principalDirXY);
  
  const targetXY = axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  return safeRotationTo(principalDirXYNorm, targetXY);
}

export function calibrateWithZPlusXY2(accelIdleData, motionData, axis = 'x') {
  console.log('---- calibrateWithZPlusXY ----');
  
  // 1. Z-Achse bestimmen
  const validIdleData = filterValidVectors(accelIdleData);
  const normIdleData = validIdleData.map(v => normalizeVector(v));
  const gravity = meanVector(normIdleData);
  const gravityNorm = normalizeVector(gravity);
  
  const targetZ = ENU_GRAVITY_DOWN;
  const zQuat = safeRotationTo(gravityNorm, targetZ);
  
  // 2. XY-Ausrichtung bestimmen
  const validMotionData = filterValidVectors(motionData);
  const motionZAligned = validMotionData.map(v => {
    const vec = vec3.fromValues(...v);
    const out = vec3.create();
    vec3.transformQuat(out, vec, zQuat);
    return [out[0], out[1], out[2]];
  });
  
  const xyData = motionZAligned.map(v => [v[0], v[1], 0]);
  const principalDir = principalComponentSVD(xyData);
  const principalDirXY = [principalDir[0], principalDir[1], 0];
  const principalDirXYNorm = normalizeVector(principalDirXY);
  
  const targetXY = axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  const xyQuat = safeRotationTo(principalDirXYNorm, targetXY);
  
  // 3. Kalibrierungs-Quaternion ist das Inverse der Gesamtrotation
  const sensorToWorld = quat.create();
  quat.multiply(sensorToWorld, xyQuat, zQuat);
  
  // Das Kalibrierungs-Quaternion ist die inverse Transformation
  const calibrationQuat = quat.create();
  quat.conjugate(calibrationQuat, sensorToWorld);
  
  // 4. Verifikation
  console.log('=== VERIFICATION ===');
  const testVec = vec3.fromValues(...gravityNorm);
  const resultVec = vec3.create();
  vec3.transformQuat(resultVec, testVec, calibrationQuat);
  console.log('Gravity after calibration:', [resultVec[0], resultVec[1], resultVec[2]]);
  
  return calibrationQuat;
}

export function calibrateWithIdleDataOnly(accelIdleData) {
  console.log('---- calibrateWithIdleDataOnly ----');
  
  // 1. Nur gültige Daten filtern
  const validData = filterValidVectors(accelIdleData);
  if (validData.length === 0) {
    throw new Error('calibrateWithIdleDataOnly: Keine gültigen Ruhedaten');
  }
  
  console.log('Valid idle data:', validData);
  
  // 2. Durchschnittliche Gravitationsrichtung berechnen
  const meanGravity = meanVector(validData);
  console.log('Mean gravity vector:', meanGravity);
  
  // 3. Normalisieren
  const gravityNorm = normalizeVector(meanGravity);
  console.log('Normalized gravity:', gravityNorm);
  
  // 4. Zielrichtung ist [0, 0, 1] (Z-Achse nach oben)
  const target = ENU_GRAVITY_DOWN;
  
  // 5. Rotation berechnen, die gravityNorm auf target ausrichtet
  const calibrationQuat = safeRotationTo(gravityNorm, target);
  console.log('Calibration quaternion:', calibrationQuat);
  
  // 6. VERIFIKATION - Testen mit den originalen Daten
  console.log('=== VERIFICATION ===');
  
  validData.forEach((data, index) => {
    const rawVec = vec3.fromValues(...data);
    const calibratedVec = vec3.create();
    vec3.transformQuat(calibratedVec, rawVec, calibrationQuat);
    
    console.log(`Data ${index}: Raw: [${data[0].toFixed(3)}, ${data[1].toFixed(3)}, ${data[2].toFixed(3)}] -> ` +
                `Calibrated: [${calibratedVec[0].toFixed(3)}, ${calibratedVec[1].toFixed(3)}, ${calibratedVec[2].toFixed(3)}]`);
  });
  
  // 7. Mit dem Durchschnitt testen
  const testVec = vec3.fromValues(...meanGravity);
  const resultVec = vec3.create();
  vec3.transformQuat(resultVec, testVec, calibrationQuat);
  console.log('Mean gravity after calibration:', 
              [resultVec[0].toFixed(6), resultVec[1].toFixed(6), resultVec[2].toFixed(6)]);
  
  // 8. Fehler berechnen
  const error = vec3.distance(resultVec, vec3.fromValues(0, 0, 1));
  console.log('Calibration error:', error.toFixed(6));
  
  return calibrationQuat;
}

export function simpleZCalibration(accelIdleData) {
  console.log('---- simpleZCalibration ----');
  
  // accelIdleData enthält 3 Arrays: [xValues, yValues, zValues]
  const xData = accelIdleData[0];
  const yData = accelIdleData[1];
  const zData = accelIdleData[2];
  
  if (xData.length !== yData.length || xData.length !== zData.length) {
    throw new Error('simpleZCalibration: Ungleiche Array-Längen');
  }
  
  // Mittelwerte für jede Achse berechnen
  const meanX = xData.reduce((sum, val) => sum + val, 0) / xData.length;
  const meanY = yData.reduce((sum, val) => sum + val, 0) / yData.length;
  const meanZ = zData.reduce((sum, val) => sum + val, 0) / zData.length;
  
  const mean = [meanX, meanY, meanZ];
  console.log('Mean acceleration:', mean);
  
  const meanNorm = normalizeVector(mean);
  console.log('Normalized mean:', meanNorm);
  
  // Quaternion, das den Ruhebeschleunigungsvektor auf ENU-Down [0,0,-1] rotiert
  const q = quat.create();
  const axis = vec3.create();
  
  // Kreuzprodukt für Rotationsachse
  vec3.cross(axis, meanNorm, ENU_GRAVITY_DOWN);
  vec3.normalize(axis, axis);
  
  // Winkel berechnen
  const dot = vec3.dot(meanNorm, ENU_GRAVITY_DOWN);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  
  console.log('Rotation axis:', axis);
  console.log('Rotation angle:', angle * (180/Math.PI) + '°');
  
  quat.setAxisAngle(q, axis, angle);
  
  // Verifikation
  const testVec = vec3.fromValues(...mean);
  const result = vec3.create();
  vec3.transformQuat(result, testVec, q);
  
  console.log('After calibration:', [result[0], result[1], result[2]]);
  console.log('Should be close to:', [0, 0, -vec3.length(testVec)]);
  
  return q;
}

export function calibrateWithZPlusXYSimple(accelIdleData, motionData, axis = 'x') {
  console.log('---- calibrateWithZPlusXY (Simple) ----');
  
  // 1. Z-Achse aus Ruhedaten
  const xIdle = accelIdleData[0];
  const yIdle = accelIdleData[1];
  const zIdle = accelIdleData[2];
  
  const meanX = xIdle.reduce((s, v) => s + v, 0) / xIdle.length;
  const meanY = yIdle.reduce((s, v) => s + v, 0) / yIdle.length;
  const meanZ = zIdle.reduce((s, v) => s + v, 0) / zIdle.length;
  
  const gravity = [meanX, meanY, meanZ];
  const gravityNorm = normalizeVector(gravity);
  
  // 2. Hauptrichtung aus Bewegungsdaten (nur X-Y Komponenten)
  const xMotion = motionData[0];
  const yMotion = motionData[1];
  const zMotion = motionData[2];
  
  // Mittelwert der Bewegungsdaten (nur X-Y)
  const meanMotionX = xMotion.reduce((s, v) => s + v, 0) / xMotion.length;
  const meanMotionY = yMotion.reduce((s, v) => s + v, 0) / yMotion.length;
  const motionDir = normalizeVector([meanMotionX, meanMotionY, 0]);
  
  console.log('Gravity direction:', gravityNorm);
  console.log('Motion direction (XY):', motionDir);
  
  // 3. Zuerst Z-Ausrichtung
  const zQuat = safeRotationTo(gravityNorm, ENU_GRAVITY_DOWN);
  
  // Bewegungsrichtung nach Z-Rotation
  const motionDirZ = vec3.create();
  vec3.transformQuat(motionDirZ, vec3.fromValues(...motionDir), zQuat);
  const motionDirZNorm = normalizeVector([motionDirZ[0], motionDirZ[1], motionDirZ[2]]);
  
  // Dann XY-Ausrichtung
  const targetXY = axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  const xyQuat = safeRotationTo([motionDirZNorm[0], motionDirZNorm[1], 0], targetXY);
  
  // Gesamtrotation (Sensor -> World)
  const sensorToWorld = quat.create();
  quat.multiply(sensorToWorld, xyQuat, zQuat);
  
  // Kalibrierungs-Quaternion ist das Inverse (World -> Sensor)
  const calibrationQuat = quat.create();
  quat.conjugate(calibrationQuat, sensorToWorld);
  
  // Verifikation
  console.log('=== VERIFICATION ===');
  const testVec = vec3.fromValues(...gravity);
  const result = vec3.create();
  vec3.transformQuat(result, testVec, calibrationQuat);
  console.log('Gravity after calibration:', [result[0].toFixed(3), result[1].toFixed(3), result[2].toFixed(3)]);
  
  return calibrationQuat;
}

export function calibrateWithZPlusXYFixed(accelIdleData, motionData) {
    console.log("---- calibrateWithZPlusXYFixed ----");

    // 1) Z-Kalibrierung (wie simpleZCalibration)
    console.log("---- simpleZCalibration ----");
    const mean = averageVector(accelIdleData);
    console.log("Mean acceleration:", mean);

    const normMean = normalizeVector(mean);
    console.log("Normalized mean:", normMean);

    const targetZ = ENU_GRAVITY_DOWN;
    const zQuat = quaternionFromVectors(normMean, targetZ);
    console.log("Z-Quaternion:", zQuat);

    // Test: Gravitation nach Z-Kalibrierung
    const gravityAfterZ = applyQuaternionToVector(zQuat, mean);
    console.log("After Z calibration (should be ~0,0,|g|):", gravityAfterZ);

    // 2) Motion-Vektor mitteln und normalisieren
    const motionRaw = averageMotionDirection(motionData);
    console.log("Motion direction (raw):", motionRaw);

    // Nach Z-Kalibrierung
    const motionAfterZ = applyQuaternionToVector(zQuat, motionRaw);
    const motionDir = normalizeVector(motionAfterZ);
    console.log("Motion direction after Z calibration:", motionDir);

    // 3) Projektion auf XY-Ebene
    const projXY = [motionDir[0], motionDir[1], 0];
    normalizeVector(projXY);

    // Winkel zwischen projiziertem Vektor und X-Achse
    let angle = Math.atan2(projXY[1], projXY[0]);  // atan2(y,x)

    // Quaternion: Drehung um Z-Achse
    const halfAngle = -angle / 2; // Minus: dreht projXY auf +X
    const xyQuat = [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)];
    console.log("XY-Quaternion:", xyQuat);

    // 4) Endgültiges Kalibrierungsquaternion = erst Z, dann XY
    const finalQuat = multiplyQuaternions(xyQuat, zQuat);
    console.log("Final calibration quaternion:", finalQuat);

    // Test: Gravitation prüfen
    const gravityFinal = applyQuaternionToVector(finalQuat, mean);
    console.log("Gravity after calibration:", gravityFinal);

    // Test: Motion prüfen
    const motionFinal = applyQuaternionToVector(finalQuat, motionRaw);
    console.log("Motion after calibration:", motionFinal);

    return new Float32Array(finalQuat);
}

function averageMotionDirection(motionData) {
    if (!motionData || motionData.length === 0) {
        console.warn("averageMotionDirection: no motion data provided");
        return [1, 0, 0]; // fallback Richtung
    }
    const avg = averageVector(motionData);
    return normalizeVector(avg);
}

function averageVector(data) {
    if (!data || data.length < 3) {
        console.error("averageVector: invalid input", data);
        return [0, 0, 0];
    }

    const len = data[0].length;
    let sumX = 0, sumY = 0, sumZ = 0;

    for (let i = 0; i < len; i++) {
        sumX += data[0][i];
        sumY += data[1][i];
        sumZ += data[2][i];
    }

    return [sumX / len, sumY / len, sumZ / len];
}

function applyQuaternionToVector(q, v) {
    // q = [x, y, z, w]  (Quaternion)
    // v = [vx, vy, vz]  (Vektor)

    const x = q[0], y = q[1], z = q[2], w = q[3];
    const vx = v[0], vy = v[1], vz = v[2];

    // Quaternion-Multiplikation: v' = q * v * q^-1
    const ix =  w * vx + y * vz - z * vy;
    const iy =  w * vy + z * vx - x * vz;
    const iz =  w * vz + x * vy - y * vx;
    const iw = -x * vx - y * vy - z * vz;

    return [
        ix * w + iw * -x + iy * -z - iz * -y,
        iy * w + iw * -y + iz * -x - ix * -z,
        iz * w + iw * -z + ix * -y - iy * -x
    ];
}

function multiplyQuaternions(q1, q2) {
    // q = q1 * q2
    const x1 = q1[0], y1 = q1[1], z1 = q1[2], w1 = q1[3];
    const x2 = q2[0], y2 = q2[1], z2 = q2[2], w2 = q2[3];

    return [
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,  // x
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,  // y
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,  // z
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2   // w
    ];
}

function quaternionFromVectors(vFrom, vTo) {
    // Normalisiere Eingabevektoren
    const from = normalizeVector(vFrom);
    const to = normalizeVector(vTo);

    // Kreuzprodukt (Drehachse)
    const axis = [
        from[1] * to[2] - from[2] * to[1],
        from[2] * to[0] - from[0] * to[2],
        from[0] * to[1] - from[1] * to[0]
    ];

    // Skalarprodukt
    const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];

    // Falls Vektoren fast gleich sind → Einheits-Quaternion zurück
    if (dot > 0.999999) {
        return [0, 0, 0, 1];
    }

    // Falls Vektoren fast entgegengesetzt sind → 180° Rotation
    if (dot < -0.999999) {
        // Wähle irgendeine senkrechte Achse
        let orth = [1, 0, 0];
        if (Math.abs(from[0]) > 0.9) orth = [0, 1, 0];

        axis[0] = from[1] * orth[2] - from[2] * orth[1];
        axis[1] = from[2] * orth[0] - from[0] * orth[2];
        axis[2] = from[0] * orth[1] - from[1] * orth[0];

        const len = Math.hypot(axis[0], axis[1], axis[2]);
        axis[0] /= len;
        axis[1] /= len;
        axis[2] /= len;

        return [axis[0], axis[1], axis[2], 0]; // 180° Drehung
    }

    // Berechne Quaternion normal
    const s = Math.sqrt((1 + dot) * 2);
    const invs = 1 / s;

    return [
        axis[0] * invs,
        axis[1] * invs,
        axis[2] * invs,
        s * 0.5
    ];
}

export function calibrateWithZPlusXYSuperSimple(accelIdleData, motionData, axis = 'x') {
  console.log('---- calibrateWithZPlusXY (Super Simple) ----');
  
  // 1. Z-Achse wie in simpleZCalibration
  const zCalibQuat = simpleZCalibration(accelIdleData);
  
  // 2. XY-Ausrichtung aus Bewegungsdaten
  const xMotion = motionData[0];
  const yMotion = motionData[1];
  
  // Einfacher Mittelwert der Bewegungsdaten
  const meanMotionX = xMotion.reduce((sum, val) => sum + val, 0) / xMotion.length;
  const meanMotionY = yMotion.reduce((sum, val) => sum + val, 0) / yMotion.length;
  
  const motionDirRaw = normalizeVector([meanMotionX, meanMotionY, 0]);
  
  // Bewegungsrichtung nach Z-Kalibrierung
  const motionDirZ = vec3.create();
  vec3.transformQuat(motionDirZ, vec3.fromValues(...motionDirRaw), zCalibQuat);
  const motionDirXY = normalizeVector([motionDirZ[0], motionDirZ[1], 0]);
  
  console.log('Motion direction after Z calibration:', motionDirXY);
  
  // XY-Rotation
  const targetXY = axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  const xyQuat = safeRotationTo(motionDirXY, targetXY);
  
  // Kombinieren
  const finalQuat = quat.create();
  quat.multiply(finalQuat, zCalibQuat, xyQuat);
  
  // Kalibrierungs-Quaternion ist das Inverse
  const calibrationQuat = quat.create();
  quat.conjugate(calibrationQuat, finalQuat);
  
  // Test
  console.log('=== TEST ===');
  const testX = accelIdleData[0][0];
  const testY = accelIdleData[1][0]; 
  const testZ = accelIdleData[2][0];
  const testVec = [testX, testY, testZ];
  
  const result = vec3.create();
  vec3.transformQuat(result, vec3.fromValues(...testVec), calibrationQuat);
  console.log('Test vector after calibration:', [result[0].toFixed(1), result[1].toFixed(1), result[2].toFixed(1)]);
  
  return calibrationQuat;
}