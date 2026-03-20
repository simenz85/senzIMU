// fusion-worker.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/numeric/1.2.6/numeric.min.js');

// ---------------------------- CONFIGURATION ----------------------------
const CONFIG = {
  // Madgwick wird nicht mehr genutzt, Eintrag bleibt für Kompatibilität
  BETA: 0.3,

  CALIBRATION_SAMPLES: 800,    // ca. 2s @200Hz
  G_TO_MS2: 1 / 1000.0,        // milli-g → "m/s²"-Skala wie bisher (ohne 9.80665)
  USE_ACC_BIAS: true,

  // Kalman: Grundrauschen (kann zur Laufzeit durch Kalibrierung angepasst werden)
  Q_GYRO: 1e-4,     // Prozessrauschen Winkel (rad²/s)
  Q_BIAS: 1e-6,     // Prozessrauschen Bias (rad²/s)
  R_ACC_ROLL: 0.03, // Messrauschen Roll (rad²)
  R_ACC_PITCH: 0.03 // Messrauschen Pitch (rad²)
};

let lastAcc = 0;

// ---------------------------- STATE ----------------------------
let filter = {
  // Quaternion halten wir für kompatible Outputs weiterhin vor (aus Euler erzeugt)
  q: [1, 0, 0, 0],
  gyroBias: { x: 0, y: 0, z: 0 },
  accBias: { x: 0, y: 0, z: 0 },
};

let lastTimeUs = null;

// --- Kalibrierung ---
let calibrating = false;
let calibSamples = [];

// ---------------------------- LINEAR ALGEBRA HELPERS ----------------------------
function radToDeg(rad) { return rad * 180 / Math.PI; }
function degToRad(deg) { return deg * Math.PI / 180; }

function normalize(v) {
  const n = Math.hypot(...v);
  return n > 0 ? v.map(x => x / n) : v.slice();
}

function matMul(A, B) { return numeric.dotMMbig(A, B); }
function matT(A) { return numeric.transpose(A); }
function matInv(A) { return numeric.inv(A); }
function matAdd(A, B) { return numeric.add(A, B); }
function matSub(A, B) { return numeric.sub(A, B); }
function matEye(n) { return numeric.identity(n); }
function matScale(A, s) { return numeric.mul(A, s); }

function matVec(A, v) {
  const m = A.length, n = A[0].length;
  const out = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}
function vecAdd(a, b) { return a.map((x, i) => x + b[i]); }
function vecSub(a, b) { return a.map((x, i) => x - b[i]); }

// ---------------------------- ORIENTATION HELPERS ----------------------------
function eulerToQuat(roll, pitch, yaw) {
  // ZYX (yaw-pitch-roll)
  const cr = Math.cos(roll/2), sr = Math.sin(roll/2);
  const cp = Math.cos(pitch/2), sp = Math.sin(pitch/2);
  const cy = Math.cos(yaw/2), sy = Math.sin(yaw/2);
  const w = cy*cp*cr + sy*cp*sr - cy*sp*sr + sy*sp*cr; // equivalent stable form
  const x = cr*cp*sy - sr*sp*cy + cr*sp*cy + sr*cp*sy; // but let's use standard closed form:
  // Sauberer Standard (überschreibt oben, um Verwechslung auszuschließen):
  const w2 = cr*cp*cy + sr*sp*sy;
  const x2 = sr*cp*cy - cr*sp*sy;
  const y2 = cr*sp*cy + sr*cp*sy;
  const z2 = cr*cp*sy - sr*sp*cy;
  return normalize([w2, x2, y2, z2]);
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
  const roll = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y));
  const pitch = Math.atan2(2*(w*y - z*x), 1 - 2*(y*y + x*x));
  const yaw = Math.atan2(2*(w*z + x*y), 1 - 2*(z*z + y*y));
  return { roll: radToDeg(roll), pitch: radToDeg(pitch), yaw: radToDeg(yaw) };
}

function rotateVectorByQuat(v, q) {
  const [w, x, y, z] = q;
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

// ---------------------------- KALMAN FILTER ----------------------------
// State: [roll, pitch, yaw, bx, by, bz]
let kf = {
  x: [0, 0, 0, 0, 0, 0],
  P: matScale(matEye(6), 1e-2),
  Q: (() => {
    const Q = matEye(6);
    Q[0][0] = CONFIG.Q_GYRO;
    Q[1][1] = CONFIG.Q_GYRO;
    Q[2][2] = CONFIG.Q_GYRO;
    Q[3][3] = CONFIG.Q_BIAS;
    Q[4][4] = CONFIG.Q_BIAS;
    Q[5][5] = CONFIG.Q_BIAS;
    return Q;
  })(),
  R: [
    [CONFIG.R_ACC_ROLL, 0],
    [0, CONFIG.R_ACC_PITCH]
  ]
};

function kalmanPredict(gyro, dt) {
  const x = kf.x;
  const bx = x[3], by = x[4], bz = x[5];

  const gx = gyro.x - bx;
  const gy = gyro.y - by;
  const gz = gyro.z - bz;

  // Zustand vorhersagen (Euler-Integration)
  const x_pred = [
    x[0] + gx * dt,   // roll
    x[1] + gy * dt,   // pitch
    x[2] + gz * dt,   // yaw
    x[3],             // bx
    x[4],             // by
    x[5]              // bz
  ];

  // Übergangsmatrix F (linearisierte Ableitungen)
  const F = matEye(6);
  F[0][3] = -dt; // d(roll)/d(bx)
  F[1][4] = -dt; // d(pitch)/d(by)
  F[2][5] = -dt; // d(yaw)/d(bz)

  // Kovarianz
  const Ft = matT(F);
  const P_pred = matAdd(matMul(F, matMul(kf.P, Ft)), kf.Q);

  kf.x = x_pred;
  kf.P = P_pred;
}

function kalmanUpdate(acc) {
  // Messung aus Acc (Schwerkraft): Roll & Pitch
  const ax = acc.x, ay = acc.y, az = acc.z;
  if (ax === 0 && ay === 0 && az === 0) return;

  const rollMeas  = Math.atan2(ay, az);
  const pitchMeas = Math.atan2(-ax, Math.sqrt(ay*ay + az*az));
  const z = [rollMeas, pitchMeas];

  // Messmatrix H (nur roll, pitch beobachtbar)
  const H = [
    [1, 0, 0, 0, 0, 0], // roll
    [0, 1, 0, 0, 0, 0]  // pitch
  ];

  const z_pred = [kf.x[0], kf.x[1]];
  const y = vecSub(z, z_pred); // Innovation

  const HT = matT(H);
  const S = matAdd(matMul(H, matMul(kf.P, HT)), kf.R);
  const K = matMul(kf.P, matMul(HT, matInv(S))); // 6x2

  // x = x + K*y
  const Ky = matVec(K, y);
  kf.x = vecAdd(kf.x, Ky);

  // P = (I - K H) P
  const I = matEye(6);
  const KH = matMul(K, H);
  kf.P = matMul(matSub(I, KH), kf.P);
}

function getEulerDeg() {
  return {
    roll:  radToDeg(kf.x[0]),
    pitch: radToDeg(kf.x[1]),
    yaw:   radToDeg(kf.x[2])
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

  // Gyro- und Acc-Bias
  let sumG = {x:0,y:0,z:0};
  let sumA = {x:0,y:0,z:0};
  for (const s of calibSamples) {
    sumG.x += s.gx; sumG.y += s.gy; sumG.z += s.gz;
    sumA.x += s.ax; sumA.y += s.ay; sumA.z += s.az;
  }
  const n = calibSamples.length;
  filter.gyroBias = { x: sumG.x/n, y: sumG.y/n, z: sumG.z/n };

  if (CONFIG.USE_ACC_BIAS) {
    filter.accBias = { x: sumA.x/n, y: sumA.y/n, z: sumA.z/n };
  }

  // Acc-Magnitude-Streuung → Messrauschen R adaptieren
  const mags = calibSamples.map(s => Math.hypot(s.ax, s.ay, s.az));
  const meanMag = mags.reduce((a,b)=>a+b,0)/mags.length;
  const variance = mags.reduce((a,b)=>a + Math.pow(b - meanMag, 2),0)/mags.length;
  const stdAcc = Math.sqrt(variance);

  // Heuristik: höhere Streuung → höheres R
  const baseR = 0.02; // rad²
  const k = 3.0;      // Skalierung
  const Rval = Math.max(0.005, baseR + k * stdAcc);
  kf.R = [
    [Rval, 0],
    [0, Rval]
  ];

  // Initialisiere Kalman-State-Bias mit Kalibrierwerten
  kf.x[3] = filter.gyroBias.x;
  kf.x[4] = filter.gyroBias.y;
  kf.x[5] = filter.gyroBias.z;

  calibrating = false;
  postMessage({
    type: "calibrated",
    gyroBias: filter.gyroBias,
    accBias: filter.accBias,
    autoBeta: null,    // aus Kompatibilitätsgründen vorhanden, aber nicht verwendet
    stdAcc,
    tunedR: Rval
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
        kalmanPredict(gyro, dt);
        kalmanUpdate(acc);
      }
      lastTimeUs = tUs;
      lastAcc = acc;

      // Quaternion aus (geglätteten) Euler erzeugen für Kompatibilität
      filter.q = eulerToQuat(kf.x[0], kf.x[1], kf.x[2]);

      const eulerDeg = getEulerDeg();

      // (Optional) Vektorsumme, falls du sie nutzt
      // const vectorsumme = Math.hypot(lastAcc.x, lastAcc.y, lastAcc.z);

      postMessage({
        type: "state",
        tUs,
        quaternion: filter.q,
        euler: {
          roll: eulerDeg.roll,
          pitch: eulerDeg.pitch,
          yaw: eulerDeg.yaw
        },
        tiltHeadingRoll: qToTiltHeadingRoll(filter.q),
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
