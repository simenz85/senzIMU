// fusion-worker.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/numeric/1.2.6/numeric.min.js');

// ---------------------------- CONFIGURATION ----------------------------
const CONFIG = {
  BETA: 0.3,                   // Madgwick gain
  CALIBRATION_SAMPLES: 800,    // ca. 2s @200Hz
  G_TO_MS2: 1 / 1000.0,  // milli-g → m/s²
  //G_TO_MS2: 9.80665 / 1000.0,  // milli-g → m/s²
  USE_ACC_BIAS: true         // optional Acc-Korrektur
};


let lastAcc = 0;

// ---------------------------- STATE ----------------------------
let filter = {
  q: [1, 0, 0, 0], // quaternion
  gyroBias: { x: 0, y: 0, z: 0 },
  accBias: { x: 0, y: 0, z: 0 },
};

let lastTimeUs = null;

// --- Kalibrierung ---
let calibrating = false;
let calibSamples = [];

// ---------------------------- FUNCTIONS ----------------------------

function radToDeg(rad) {
  return rad * 180 / Math.PI;
}

function normalize(v) {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return n > 0 ? v.map(x => x / n) : v;
}

function madgwickUpdate(acc, gyro, dt) {
  let q = filter.q;
  let gx = (gyro.x - filter.gyroBias.x);
  let gy = (gyro.y - filter.gyroBias.y);
  let gz = (gyro.z - filter.gyroBias.z);

  // 1. Gyro integration (quaternion derivative)
  let qDot = [
    0.5 * (-q[1] * gx - q[2] * gy - q[3] * gz),
    0.5 * ( q[0] * gx + q[2] * gz - q[3] * gy),
    0.5 * ( q[0] * gy - q[1] * gz + q[3] * gx),
    0.5 * ( q[0] * gz + q[1] * gy - q[2] * gx)
  ];

  // 2. Acc correction
  let accVec = normalize([acc.x, acc.y, acc.z]);
  if (accVec[0] !== 0 || accVec[1] !== 0 || accVec[2] !== 0) {
    let f = [
      2 * (q[1]*q[3] - q[0]*q[2]) - accVec[0],
      2 * (q[0]*q[1] + q[2]*q[3]) - accVec[1],
      2 * (0.5 - q[1]*q[1] - q[2]*q[2]) - accVec[2]
    ];
    let J = [
      [-2*q[2],  2*q[3], -2*q[0], 2*q[1]],
      [ 2*q[1],  2*q[0],  2*q[3], 2*q[2]],
      [      0, -4*q[1], -4*q[2],      0]
    ];
    let step = numeric.transpose(J).map(r => r[0]*f[0] + r[1]*f[1] + r[2]*f[2]);
    step = normalize(step);

    qDot = qDot.map((val, i) => val - CONFIG.BETA * step[i]);
  }

  // 3. Integrate
  q = q.map((val, i) => val + qDot[i] * dt);
  q = normalize(q);
  filter.q = q;
}

function quatToEuler(q) {
  let [w, x, y, z] = q;
  let sinr = 2 * (w * x + y * z);
  let cosr = 1 - 2 * (x * x + y * y);
  let roll = Math.atan2(sinr, cosr);

  let sinp = 2 * (w * y - z * x);
  let pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI/2 : Math.asin(sinp);

  let siny = 2 * (w * z + x * y);
  let cosy = 1 - 2 * (y * y + z * z);
  let yaw = Math.atan2(siny, cosy);

  return { roll, pitch, yaw };
}

function qToTiltHeadingRoll(q) {
    const [w,x,y,z] = q;

    // Roll: Rotation um X-Achse
    const roll = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y));

    // Pitch (Tilt): Rotation um Y-Achse, kann über ±90 gehen
    const pitch = Math.atan2(2*(w*y - z*x), 1 - 2*(y*y + x*x));

    // Yaw (Heading): Rotation um Z-Achse
    const yaw = Math.atan2(2*(w*z + x*y), 1 - 2*(z*z + y*y));

    return { roll: radToDeg(roll), pitch: radToDeg(pitch), yaw: radToDeg(yaw) };
}

function quatToMatrix(q) {
    const [w, x, y, z] = q;
    return [
        [1 - 2*y*y - 2*z*z,   2*x*y - 2*w*z,       2*x*z + 2*w*y],
        [2*x*y + 2*w*z,       1 - 2*x*x - 2*z*z,   2*y*z - 2*w*x],
        [2*x*z - 2*w*y,       2*y*z + 2*w*x,       1 - 2*x*x - 2*y*y]
    ];
}

function rotateAccToWorld(accLocal, q) {
    // 1. Gesamte Beschleunigung (Magnitude)
    const totalAcc = Math.hypot(accLocal.x, accLocal.y, accLocal.z);
    if (totalAcc === 0) return { x: 0, y: 0, z: 0 };

    // 2. Normierte Richtung
    const dir = [
        accLocal.x / totalAcc,
        accLocal.y / totalAcc,
        accLocal.z / totalAcc
    ];

    // 3. Quaternion → Rotationsmatrix
    const [w, x, y, z] = q;
    const R = [
        [1 - 2*y*y - 2*z*z,   2*x*y - 2*w*z,       2*x*z + 2*w*y],
        [2*x*y + 2*w*z,       1 - 2*x*x - 2*z*z,   2*y*z - 2*w*x],
        [2*x*z - 2*w*y,       2*y*z + 2*w*x,       1 - 2*x*x - 2*y*y]
    ];

    // 4. Richtung in Weltkoordinaten rotieren
    const dirWorld = {
        x: R[0][0]*dir[0] + R[0][1]*dir[1] + R[0][2]*dir[2],
        y: R[1][0]*dir[0] + R[1][1]*dir[1] + R[1][2]*dir[2],
        z: R[2][0]*dir[0] + R[2][1]*dir[1] + R[2][2]*dir[2]
    };

    // 5. Magnitude wieder draufpacken
    return {
        x: dirWorld.x * totalAcc,
        y: dirWorld.y * totalAcc,
        z: dirWorld.z * totalAcc
    };
}

function rotateVectorByQuat(v, q) {
    const [w, x, y, z] = q;
    // t = 2 * cross(q_vec, v)
    const t = {
        x: 2 * (y * v.z - z * v.y),
        y: 2 * (z * v.x - x * v.z),
        z: 2 * (x * v.y - y * v.x)
    };
    return {
        x: v.x + w * t.x + (y * t.z - z * t.y),
        y: v.y + w * t.y + (z * t.x - x * t.z),
        z: v.z + w * t.z + (x * t.y - y * t.x)
    };
}



// ---------------------------- CALIBRATION ----------------------------
function startCalibration() {
  calibrating = true;
  calibSamples = [];
  postMessage({ type: "ack", msg: "calibration started" });
}

function finishCalibration() {
  if (calibSamples.length === 0) return;

  // 1. Gyro-Bias berechnen
  let sumG = {x:0,y:0,z:0};
  let sumA = {x:0,y:0,z:0};
  for (const s of calibSamples) {
    sumG.x += s.gx; sumG.y += s.gy; sumG.z += s.gz;
    sumA.x += s.ax; sumA.y += s.ay; sumA.z += s.az;
  }
  const n = calibSamples.length;
  filter.gyroBias = { x: sumG.x/n, y: sumG.y/n, z: sumG.z/n };

  // 2. Acc-Bias optional
  if (CONFIG.USE_ACC_BIAS) {
    filter.accBias = { x: sumA.x/n, y: sumA.y/n, z: sumA.z/n };
  }

  // 3. Automatische Beta-Anpassung basierend auf Acc-Streuung
  const mags = calibSamples.map(s => Math.hypot(s.ax, s.ay, s.az));
  const meanMag = mags.reduce((a,b)=>a+b,0)/mags.length;
  const variance = mags.reduce((a,b)=>a + Math.pow(b - meanMag, 2),0)/mags.length;
  const stdAcc = Math.sqrt(variance);

  // Beta adaptiv: stabiler Sensor → höherer Beta
  // Max 0.2, Min 0.02 (kann angepasst werden)
  const beta = Math.max(0.02, Math.min(0.2, 0.2 - stdAcc*5));
  CONFIG.BETA = beta;

  calibrating = false;
  postMessage({ 
    type:"calibrated", 
    gyroBias: filter.gyroBias, 
    accBias: filter.accBias,
    autoBeta: CONFIG.BETA,
    stdAcc
  });
}

// ---------------------------- WORKER LOOP ----------------------------
onmessage = function(e) {
  const data = e.data;
  switch(data.type) {
    case "packet": {
      const tUs = data.time;
      const acc = {
        x: data.acc.x * CONFIG.G_TO_MS2 - filter.accBias.x,
        y: data.acc.y * CONFIG.G_TO_MS2 - filter.accBias.y,
        z: data.acc.z * CONFIG.G_TO_MS2 - filter.accBias.z,
      };
      const gyro = {
        x: data.gyro.x * (Math.PI/180/1000), // mDPS → rad/s
        y: data.gyro.y * (Math.PI/180/1000),
        z: data.gyro.z * (Math.PI/180/1000),
      };

      if (calibrating) {
        calibSamples.push({
          gx: gyro.x, gy: gyro.y, gz: gyro.z,
          ax: acc.x,  ay: acc.y,  az: acc.z
        });
        if (calibSamples.length >= CONFIG.CALIBRATION_SAMPLES) finishCalibration();
        return;
      }

      if (lastTimeUs !== null) {
        const dt = (tUs - lastTimeUs) * 1e-6; // µs → s
        madgwickUpdate(acc, gyro, dt);
      }
      lastTimeUs = tUs;
      lastAcc = acc;
      const euler = quatToEuler(filter.q);

// Beispiel in deinem FusionWorker bei der Ausgabe:
const rollDeg  = radToDeg(euler.roll);
const pitchDeg = radToDeg(euler.pitch);
const yawDeg   = radToDeg(euler.yaw);


const vectorsumme = Math.sqrt(Math.pow(lastAcc.x, 2) + Math.pow(lastAcc.y, 2) + Math.pow(lastAcc.z, 2));

      postMessage({ type:"state",
         tUs, quaternion: filter.q,
         euler: {
           roll: rollDeg,
           pitch: pitchDeg,
           yaw: yawDeg
         },
         tiltHeadingRoll: qToTiltHeadingRoll(filter.q), // kontinuierlich
         accWorld: rotateVectorByQuat(lastAcc, filter.q)
      });
      break;
    }

    case "startCalib":
      startCalibration();
      break;

    case "stopCalib":
      finishCalibration();
      break;
  }
};
