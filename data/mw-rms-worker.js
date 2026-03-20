

class MadgwickAHRS {
  constructor(beta = 0.1, sampleFreq = 100) {
    this.beta = beta;
    this.sampleFreq = sampleFreq;
    this.q = [1, 0, 0, 0];
  }
  reset() { this.q = [1, 0, 0, 0]; }
  updateIMU(gx, gy, gz, ax, ay, az) {
    let q1 = this.q[0], q2 = this.q[1], q3 = this.q[2], q4 = this.q[3];
    const beta = this.beta;
    const sampleFreq = this.sampleFreq;
    let norm = ax * ax + ay * ay + az * az;
    if (norm === 0) return;
    norm = 1 / Math.sqrt(norm);
    ax *= norm; ay *= norm; az *= norm;
    const _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3, _2q4 = 2 * q4;
    const f1 = _2q2 * q4 - _2q1 * q3 - ax;
    const f2 = _2q1 * q2 + _2q3 * q4 - ay;
    const f3 = 1 - _2q2 * q2 - _2q3 * q3 - az;
    const J_11or24 = _2q3, J_12or23 = _2q4, J_13or22 = _2q1, J_14or21 = _2q2;
    const J_32 = 2 * J_14or21, J_33 = 2 * J_11or24;
    let s1 = (-J_14or21 * f2) + (J_11or24 * f1);
    let s2 = (J_12or23 * f1) + (J_13or22 * f2) - (J_32 * f3);
    let s3 = (J_12or23 * f2) - (J_33 * f3) - (J_13or22 * f1);
    let s4 = (J_14or21 * f1) + (J_11or24 * f2);
    norm = s1 * s1 + s2 * s2 + s3 * s3 + s4 * s4;
    if (norm === 0) return;
    norm = 1 / Math.sqrt(norm);
    s1 *= norm; s2 *= norm; s3 *= norm; s4 *= norm;
    let qDot1 = 0.5 * (-q2 * gx - q3 * gy - q4 * gz) - beta * s1;
    let qDot2 = 0.5 * (q1 * gx + q3 * gz - q4 * gy) - beta * s2;
    let qDot3 = 0.5 * (q1 * gy - q2 * gz + q4 * gx) - beta * s3;
    let qDot4 = 0.5 * (q1 * gz + q2 * gy - q3 * gx) - beta * s4;
    q1 += qDot1 * (1 / sampleFreq);
    q2 += qDot2 * (1 / sampleFreq);
    q3 += qDot3 * (1 / sampleFreq);
    q4 += qDot4 * (1 / sampleFreq);
    norm = q1 * q1 + q2 * q2 + q3 * q3 + q4 * q4;
    norm = 1 / Math.sqrt(norm);
    this.q[0] = q1 * norm;
    this.q[1] = q2 * norm;
    this.q[2] = q3 * norm;
    this.q[3] = q4 * norm;
  }
  getGravity() {
    const q = this.q;
    return [
      2 * (q[1] * q[3] - q[0] * q[2]),
      2 * (q[0] * q[1] + q[2] * q[3]),
      q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]
    ];
  }
  getQuaternion() {
    return this.q.slice();
  }
}

function calculateRMS(arr) {
  let sum = 0;
  for (const v of arr) sum += v * v;
  return Math.sqrt(sum / arr.length);
}

function lerpVector(t, t0, t1, v0, v1) {
  const alpha = (t - t0) / (t1 - t0);
  return {
    x: v0.x + alpha * (v1.x - v0.x),
    y: v0.y + alpha * (v1.y - v0.y),
    z: v0.z + alpha * (v1.z - v0.z)
  };
}

function interpolateGyro(t, gyroTimes, gyroValues) {
  if (t <= gyroTimes[0]) return gyroValues[0];
  if (t >= gyroTimes[gyroTimes.length - 1]) return gyroValues[gyroValues.length - 1];

  let left = 0, right = gyroTimes.length - 1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    if (gyroTimes[mid] === t) return gyroValues[mid];
    if (gyroTimes[mid] < t) left = mid + 1;
    else right = mid - 1;
  }
  const i1 = Math.max(0, right);
  const i2 = Math.min(gyroTimes.length - 1, left);
  return lerpVector(t, gyroTimes[i1], gyroTimes[i2], gyroValues[i1], gyroValues[i2]);
}


console.log("START MW_RMS_WORKER");

const MAX_SAMPLES = 1000;
const MIN_SAMPLES = 10;
const TARGET_INTERVAL_US = 33000;

const accBuffer = [];
const accTsBuffer = [];

const gyroBuffer = [];
const gyroTsBuffer = [];

let madgwick = new MadgwickAHRS(0.1, 100);
madgwick.reset();

self.onmessage = function (e) {
 

  const data = e.data;

  if (data.type === 'acc') {
    const accSamples = data.payload;
    for (const s of accSamples) {
      accBuffer.push({x: s.x, y: s.y, z: s.z});
      accTsBuffer.push(s.time);
    }
    while (accBuffer.length > MAX_SAMPLES) {
      accBuffer.shift(); accTsBuffer.shift();
    }
  } else if (data.type === 'gyro') {
    const gyroSamples = data.payload;
    for (const s of gyroSamples) {
      gyroBuffer.push({x: s.x, y: s.y, z: s.z});
      gyroTsBuffer.push(s.time);
    }
    while (gyroBuffer.length > MAX_SAMPLES) {
      gyroBuffer.shift(); gyroTsBuffer.shift();
    }
  } else {
    self.postMessage({ error: "Unbekannter Nachrichtentyp" });
    return;
  }

  if (accBuffer.length < MIN_SAMPLES) return;

  let sampleCount = MIN_SAMPLES;
  for (let i = MIN_SAMPLES; i < accBuffer.length; i++) {
    if (accTsBuffer[i] - accTsBuffer[0] >= TARGET_INTERVAL_US) {
      sampleCount = i + 1;
      break;
    }
  }
  if (sampleCount > accBuffer.length) sampleCount = accBuffer.length;

  const batchAcc = accBuffer.slice(0, sampleCount);
  const batchAccTs = accTsBuffer.slice(0, sampleCount);

  if (sampleCount > 1) {
    const dtSec = (batchAccTs[sampleCount - 1] - batchAccTs[0]) / 1e6;
    madgwick.sampleFreq = sampleCount / dtSec;
  }

  const dynAccX = [];
  const dynAccY = [];
  const dynAccZ = [];

  for (let i = 0; i < sampleCount; i++) {
    const ax = batchAcc[i].x * 0.001;
    const ay = batchAcc[i].y * 0.001;
    const az = batchAcc[i].z * 0.001;

    const t = batchAccTs[i];
    const gyroInterpolated = interpolateGyro(t, gyroTsBuffer, gyroBuffer);

    madgwick.updateIMU(gyroInterpolated.x, gyroInterpolated.y, gyroInterpolated.z, ax, ay, az);

    const grav = madgwick.getGravity();

    dynAccX.push(ax - grav[0]);
    dynAccY.push(ay - grav[1]);
    dynAccZ.push(az - grav[2]);
  }

  const rmsX = calculateRMS(dynAccX);
  const rmsY = calculateRMS(dynAccY);
  const rmsZ = calculateRMS(dynAccZ);
  const rmsVec = Math.sqrt(rmsX * rmsX + rmsY * rmsY + rmsZ * rmsZ);

  const quat = madgwick.getQuaternion();

  console.log("RMS X:", rmsX);
  console.log("RMS Y:", rmsY);
  console.log("RMS Z:", rmsZ);
  console.log("RMS Vector:", rmsVec);
  console.log("Quaternion:", quat);
  console.log("Samples processed:", sampleCount);
  console.log("Timestamp:", batchAccTs[sampleCount - 1]/1000000/60);

  self.postMessage({
    rmsX,
    rmsY,
    rmsZ,
    rmsVec,
    quaternion: { w: quat[0], x: quat[1], y: quat[2], z: quat[3] },
    samplesProcessed: sampleCount,
    timestamp: (batchAccTs[sampleCount - 1])
  });

  accBuffer.splice(0, sampleCount);
  accTsBuffer.splice(0, sampleCount);
};
