importScripts('numeric.min.js');

const GYRO_SCALE = Math.PI / 180000;
const ACC_SCALE = 1 / 1000;
const RAD_TO_DEG = 180 / Math.PI;
const MIN_ACC_NORM = 1e-6;
const MAX_DT_SECONDS = 0.05;
const OUTPUT_INTERVAL_US = 50_000;

const CONFIG = {
  processNoise: numeric.diag([1e-5, 1e-5, 1e-5, 1e-5, 1e-7, 1e-7, 1e-7]),
  measurementNoise: numeric.diag([0.05, 0.05, 0.05]),
  calibrationSamples: 800,
};

const filterState = {
  x: [1, 0, 0, 0, 0, 0, 0],
  P: numeric.identity(7),
};

const runtimeState = {
  lastPacketTimeUs: null,
  lastOutputTimeUs: null,
  calibrating: false,
  calibrationSamples: [],
};

function normalizeQuaternion(quaternion) {
  const norm = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    return [1, 0, 0, 0];
  }

  return quaternion.map((value) => value / norm);
}

function normalizeVector3(vector) {
  const norm = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(norm) || norm < MIN_ACC_NORM) {
    return null;
  }

  return {
    x: vector.x / norm,
    y: vector.y / norm,
    z: vector.z / norm,
  };
}

function clampDt(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.min(seconds, MAX_DT_SECONDS);
}

function quaternionToEuler(quaternion) {
  const [w, x, y, z] = quaternion;

  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr, cosr);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy);

  return { roll, pitch, yaw };
}

function quaternionToTiltHeadingRoll(quaternion) {
  const euler = quaternionToEuler(quaternion);
  return {
    roll: euler.roll * RAD_TO_DEG,
    pitch: euler.pitch * RAD_TO_DEG,
    yaw: euler.yaw * RAD_TO_DEG,
  };
}

function rotateVectorByQuaternion(vector, quaternion) {
  const [w, x, y, z] = quaternion;
  const tx = 2 * (y * vector.z - z * vector.y);
  const ty = 2 * (z * vector.x - x * vector.z);
  const tz = 2 * (x * vector.y - y * vector.x);

  return {
    x: vector.x + w * tx + (y * tz - z * ty),
    y: vector.y + w * ty + (z * tx - x * tz),
    z: vector.z + w * tz + (x * ty - y * tx),
  };
}

function predictWithGyro(gyro, dtSeconds) {
  const [q0, q1, q2, q3, bgx, bgy, bgz] = filterState.x;
  const gx = gyro.x - bgx;
  const gy = gyro.y - bgy;
  const gz = gyro.z - bgz;

  const qDot = [
    0.5 * (-q1 * gx - q2 * gy - q3 * gz),
    0.5 * (q0 * gx + q2 * gz - q3 * gy),
    0.5 * (q0 * gy - q1 * gz + q3 * gx),
    0.5 * (q0 * gz + q1 * gy - q2 * gx),
  ];

  const nextQuaternion = normalizeQuaternion(numeric.add([q0, q1, q2, q3], numeric.mul(qDot, dtSeconds)));
  filterState.x[0] = nextQuaternion[0];
  filterState.x[1] = nextQuaternion[1];
  filterState.x[2] = nextQuaternion[2];
  filterState.x[3] = nextQuaternion[3];
  filterState.P = numeric.add(filterState.P, CONFIG.processNoise);
}

function updateWithAccelerometer(acc) {
  const normalizedAcc = normalizeVector3(acc);
  if (!normalizedAcc) {
    return false;
  }

  const [q0, q1, q2, q3] = filterState.x;
  const measurement = [normalizedAcc.x, normalizedAcc.y, normalizedAcc.z];
  const gravityPrediction = [
    2 * (q1 * q3 - q0 * q2),
    2 * (q0 * q1 + q2 * q3),
    q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3,
  ];

  const innovation = numeric.sub(measurement, gravityPrediction);
  const H = [
    [-2 * q2, 2 * q3, -2 * q0, 2 * q1, 0, 0, 0],
    [2 * q1, 2 * q0, 2 * q3, 2 * q2, 0, 0, 0],
    [2 * q0, -2 * q1, -2 * q2, 2 * q3, 0, 0, 0],
  ];

  const Ht = numeric.transpose(H);
  const S = numeric.add(numeric.dot(H, numeric.dot(filterState.P, Ht)), CONFIG.measurementNoise);
  const K = numeric.dot(filterState.P, numeric.dot(Ht, numeric.inv(S)));
  const correction = numeric.dot(K, innovation);

  filterState.x = numeric.add(filterState.x, correction);
  const normalizedQuaternion = normalizeQuaternion(filterState.x.slice(0, 4));
  filterState.x[0] = normalizedQuaternion[0];
  filterState.x[1] = normalizedQuaternion[1];
  filterState.x[2] = normalizedQuaternion[2];
  filterState.x[3] = normalizedQuaternion[3];

  const identity = numeric.identity(7);
  filterState.P = numeric.dot(numeric.sub(identity, numeric.dot(K, H)), filterState.P);
  return true;
}

function getYawFromQuaternion(quaternion) {
  const [w, x, y, z] = quaternion;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

function setQuaternionYaw(quaternion, newYaw) {
  const [w, x, y, z] = quaternion;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const sinPitch = 2 * (w * y - z * x);
  const pitch = Math.abs(sinPitch) >= 1 ? Math.sign(sinPitch) * (Math.PI / 2) : Math.asin(sinPitch);

  const cy = Math.cos(newYaw * 0.5);
  const sy = Math.sin(newYaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}

function maybeApplyStationaryYawHold(acc, gyro) {
  const accNorm = Math.hypot(acc.x, acc.y, acc.z);
  const gyroNorm = Math.hypot(gyro.x, gyro.y, gyro.z);
  if (Math.abs(accNorm - 1) >= 0.03 || gyroNorm >= 0.017) {
    return;
  }

  const quaternion = filterState.x.slice(0, 4);
  const yaw = getYawFromQuaternion(quaternion);
  const adjusted = setQuaternionYaw(quaternion, yaw);
  filterState.x[0] = adjusted[0];
  filterState.x[1] = adjusted[1];
  filterState.x[2] = adjusted[2];
  filterState.x[3] = adjusted[3];
}

function resetTiming() {
  runtimeState.lastPacketTimeUs = null;
  runtimeState.lastOutputTimeUs = null;
}

function startCalibration() {
  runtimeState.calibrating = true;
  runtimeState.calibrationSamples = [];
  resetTiming();
  postMessage({ type: 'ack', msg: 'calibration started' });
}

function buildCalibrationStateFromSamples(samples) {
  if (!samples.length) {
    return null;
  }

  const gyroBias = { x: 0, y: 0, z: 0 };
  const accAxisSamples = { x: [], y: [], z: [] };
  for (const sample of samples) {
    gyroBias.x += sample.gx;
    gyroBias.y += sample.gy;
    gyroBias.z += sample.gz;
    accAxisSamples.x.push(sample.ax);
    accAxisSamples.y.push(sample.ay);
    accAxisSamples.z.push(sample.az);
  }

  const count = samples.length;
  gyroBias.x /= count;
  gyroBias.y /= count;
  gyroBias.z /= count;

  const variance = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + ((value - mean) * (value - mean)), 0) / values.length;
  };

  const accVar = [
    variance(accAxisSamples.x),
    variance(accAxisSamples.y),
    variance(accAxisSamples.z),
  ];

  return { gyroBias, accVar };
}

function applyCalibrationState(calibrationState) {
  if (!calibrationState) {
    return false;
  }

  const gyroBias = calibrationState.gyroBias;
  const accVar = calibrationState.accVar;
  if (!gyroBias || !Array.isArray(accVar) || accVar.length < 3) {
    return false;
  }

  const bgx = Number(gyroBias.x);
  const bgy = Number(gyroBias.y);
  const bgz = Number(gyroBias.z);
  const varX = Number(accVar[0]);
  const varY = Number(accVar[1]);
  const varZ = Number(accVar[2]);
  if (![bgx, bgy, bgz, varX, varY, varZ].every(Number.isFinite)) {
    return false;
  }

  filterState.x[4] = bgx;
  filterState.x[5] = bgy;
  filterState.x[6] = bgz;
  CONFIG.measurementNoise = numeric.diag([
    Math.max(varX, 1e-6),
    Math.max(varY, 1e-6),
    Math.max(varZ, 1e-6),
  ]);
  return true;
}

function finishCalibration() {
  if (!runtimeState.calibrationSamples.length) {
    runtimeState.calibrating = false;
    return;
  }

  const calibrationState = buildCalibrationStateFromSamples(runtimeState.calibrationSamples);
  runtimeState.calibrating = false;
  runtimeState.calibrationSamples = [];
  resetTiming();

  if (!applyCalibrationState(calibrationState)) {
    return;
  }

  postMessage({
    type: 'calibrated',
    gyroBias: calibrationState.gyroBias,
    accVar: calibrationState.accVar,
  });
}

function emitState(timeUs, acc) {
  if (runtimeState.lastOutputTimeUs !== null && (timeUs - runtimeState.lastOutputTimeUs) < OUTPUT_INTERVAL_US) {
    return;
  }

  const quaternion = filterState.x.slice(0, 4);
  const euler = quaternionToEuler(quaternion);
  postMessage({
    type: 'state',
    om_tUs: timeUs,
    quaternion,
    euler: {
      roll: euler.roll * RAD_TO_DEG,
      pitch: euler.pitch * RAD_TO_DEG,
      yaw: euler.yaw * RAD_TO_DEG,
    },
    tiltHeadingRoll: quaternionToTiltHeadingRoll(quaternion),
    accWorld: rotateVectorByQuaternion(acc, quaternion),
  });
  runtimeState.lastOutputTimeUs = timeUs;
}

function handlePacket(packet) {
  const timeUs = Number(packet?.time);
  const acc = {
    x: Number(packet?.acc?.x || 0) * ACC_SCALE,
    y: Number(packet?.acc?.y || 0) * ACC_SCALE,
    z: Number(packet?.acc?.z || 0) * ACC_SCALE,
  };
  const gyro = {
    x: Number(packet?.gyro?.x || 0) * GYRO_SCALE,
    y: Number(packet?.gyro?.y || 0) * GYRO_SCALE,
    z: Number(packet?.gyro?.z || 0) * GYRO_SCALE,
  };

  if (!Number.isFinite(timeUs)) {
    return;
  }

  if (runtimeState.calibrating) {
    runtimeState.calibrationSamples.push({
      gx: gyro.x,
      gy: gyro.y,
      gz: gyro.z,
      ax: acc.x,
      ay: acc.y,
      az: acc.z,
    });

    if (runtimeState.calibrationSamples.length >= CONFIG.calibrationSamples) {
      finishCalibration();
    }
    return;
  }

  if (runtimeState.lastPacketTimeUs !== null) {
    const dtSeconds = clampDt((timeUs - runtimeState.lastPacketTimeUs) * 1e-6);
    if (dtSeconds) {
      predictWithGyro(gyro, dtSeconds);
      if (updateWithAccelerometer(acc)) {
        maybeApplyStationaryYawHold(acc, gyro);
      }
    }
  }

  runtimeState.lastPacketTimeUs = timeUs;
  emitState(timeUs, acc);
}

onmessage = (event) => {
  const data = event.data || {};

  switch (data.type) {
    case 'packet':
      handlePacket(data);
      break;
    case 'startCalib':
      startCalibration();
      break;
    case 'stopCalib':
      finishCalibration();
      break;
    case 'setCalibrationState':
      if (applyCalibrationState(data.payload)) {
        resetTiming();
      }
      break;
    default:
      break;
  }
};
