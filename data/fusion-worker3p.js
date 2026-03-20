// fusion-worker-kalman-adaptive-r.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/numeric/1.2.6/numeric.min.js');


let lastOutputTimeUs = null;

const CONFIG = {
  Q: numeric.diag([1e-5,1e-5,1e-5,1e-5, 1e-7,1e-7,1e-7]), // Prozessrauschen
  R: numeric.diag([0.05,0.05,0.05]), // Initiales Messrauschen (wird kalibriert)
  CALIBRATION_SAMPLES: 800
};

let kalman = {
  x: [1,0,0,0, 0,0,0], // [q0,q1,q2,q3, bgx,bgy,bgz]
  P: numeric.identity(7)
};

let lastTimeUs = null;
let calibrating = false;
let calibSamples = [];

function normalizeQ(q) {
  let n = Math.hypot(...q);
  return n === 0 ? q : q.map(x => x / n);
}

function kalmanPredict(gyro, dt) {
  let [q0,q1,q2,q3,bgx,bgy,bgz] = kalman.x;
  let wx = gyro.x - bgx, wy = gyro.y - bgy, wz = gyro.z - bgz;

  let dq = [
    0.5 * (-q1*wx - q2*wy - q3*wz),
    0.5 * ( q0*wx + q2*wz - q3*wy),
    0.5 * ( q0*wy - q1*wz + q3*wx),
    0.5 * ( q0*wz + q1*wy - q2*wx)
  ].map(v => v*dt);

  let qNew = [q0+dq[0], q1+dq[1], q2+dq[2], q3+dq[3]];
  qNew = normalizeQ(qNew);

  kalman.x = [qNew[0],qNew[1],qNew[2],qNew[3], bgx, bgy, bgz];
  kalman.P = numeric.add(kalman.P, CONFIG.Q);
}

function kalmanUpdate(acc) {
  let z = normalizeQ([acc.x, acc.y, acc.z]);

  let [q0,q1,q2,q3] = kalman.x;

  let gPred = [
    2*(q1*q3 - q0*q2),
    2*(q0*q1 + q2*q3),
    q0*q0 - q1*q1 - q2*q2 + q3*q3
  ];

  let y = numeric.sub(z, gPred);

  let H = [
    [-2*q2, 2*q3, -2*q0, 2*q1, 0,0,0],
    [2*q1, 2*q0, 2*q3, 2*q2, 0,0,0],
    [2*q0, -2*q1, -2*q2, 2*q3, 0,0,0]
  ];

  let S = numeric.add(numeric.dot(H, numeric.dot(kalman.P, numeric.transpose(H))), CONFIG.R);
  let K = numeric.dot(kalman.P, numeric.dot(numeric.transpose(H), numeric.inv(S)));
  let dx = numeric.dot(K, y);

  kalman.x = numeric.add(kalman.x, dx);

  let qnorm = Math.hypot(kalman.x[0], kalman.x[1], kalman.x[2], kalman.x[3]);
  kalman.x[0] /= qnorm;
  kalman.x[1] /= qnorm;
  kalman.x[2] /= qnorm;
  kalman.x[3] /= qnorm;

  let I = numeric.identity(7);
  kalman.P = numeric.dot(numeric.sub(I, numeric.dot(K,H)), kalman.P);
}

function radToDeg(rad) {
  return rad * 180 / Math.PI;
}

function quatToEuler(q) {
  let [w,x,y,z] = q;
  let sinr = 2 * (w*x + y*z);
  let cosr = 1 - 2*(x*x + y*y);
  let roll = Math.atan2(sinr, cosr);

  let sinp = 2 * (w*y - z*x);
  let pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp)*Math.PI/2 : Math.asin(sinp);

  let siny = 2 * (w*z + x*y);
  let cosy = 1 - 2*(y*y + z*z);
  let yaw = Math.atan2(siny, cosy);

  return {roll, pitch, yaw};
}

function qToTiltHeadingRoll(q) {
  const [w,x,y,z] = q;
  const roll = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y));
  const pitch = Math.atan2(2*(w*y - z*x), 1 - 2*(y*y + x*x));
  const yaw = Math.atan2(2*(w*z + x*y), 1 - 2*(z*z + y*y));
  return {roll: radToDeg(roll), pitch: radToDeg(pitch), yaw: radToDeg(yaw)};
}

function rotateVectorByQuat(v, q) {
  const [w,x,y,z] = q;
  const t = {
    x: 2*(y*v.z - z*v.y),
    y: 2*(z*v.x - x*v.z),
    z: 2*(x*v.y - y*v.x)
  };
  return {
    x: v.x + w*t.x + (y*t.z - z*t.y),
    y: v.y + w*t.y + (z*t.x - x*t.z),
    z: v.z + w*t.z + (x*t.y - y*t.x)
  };
}

function getYawFromQuaternion(q) {
  let [w,x,y,z] = q;
  let siny = 2 * (w*z + x*y);
  let cosy = 1 - 2*(y*y + z*z);
  return Math.atan2(siny, cosy);
}

function setQuaternionYaw(q, newYaw) {
  let [w,x,y,z] = q;
  let sinr = 2*(w*x + y*z);
  let cosr = 1 - 2*(x*x + y*y);
  let roll = Math.atan2(sinr, cosr);
  let sinp = 2*(w*y - z*x);
  let pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp)*Math.PI/2 : Math.asin(sinp);

  let cy = Math.cos(newYaw*0.5);
  let sy = Math.sin(newYaw*0.5);
  let cp = Math.cos(pitch*0.5);
  let sp = Math.sin(pitch*0.5);
  let cr = Math.cos(roll*0.5);
  let sr = Math.sin(roll*0.5);

  return [
    cr*cp*cy + sr*sp*sy,
    sr*cp*cy - cr*sp*sy,
    cr*sp*cy + sr*cp*sy,
    cr*cp*sy - sr*sp*cy
  ];
}

function maybeYawCorrection(acc, gyro) {
  const accNorm = Math.sqrt(acc.x*acc.x + acc.y*acc.y + acc.z*acc.z);
  const gyroNorm = Math.sqrt(gyro.x*gyro.x + gyro.y*gyro.y + gyro.z*gyro.z);

  // Thresholds: ~0.03 g tolerance, ~1 deg/s in rad/s
  if(Math.abs(accNorm-1.0) < 0.03 && gyroNorm < 0.017) {
    let q = kalman.x.slice(0,4);
    let yawCur = getYawFromQuaternion(q);
    let qReset = setQuaternionYaw(q, yawCur);
    kalman.x[0] = qReset[0];
    kalman.x[1] = qReset[1];
    kalman.x[2] = qReset[2];
    kalman.x[3] = qReset[3];
  }
}

function startCalibration() {
  calibrating = true;
  calibSamples = [];
  postMessage({type:"ack", msg:"calibration started"});
}

function finishCalibration() {
  if(calibSamples.length === 0) return;

  let sumG = {x:0,y:0,z:0};
  let accSamples = {x:[], y:[], z:[]};

  for(const s of calibSamples){
    sumG.x += s.gx; sumG.y += s.gy; sumG.z += s.gz;
    accSamples.x.push(s.ax);
    accSamples.y.push(s.ay);
    accSamples.z.push(s.az);
  }
  const n = calibSamples.length;

  kalman.x[4] = sumG.x / n;
  kalman.x[5] = sumG.y / n;
  kalman.x[6] = sumG.z / n;

  function variance(arr){
    const mean = arr.reduce((a,b) => a+b,0)/arr.length;
    return arr.reduce((a,b) => a + (b-mean)*(b-mean), 0)/arr.length;
  }

  CONFIG.R = numeric.diag([
    variance(accSamples.x),
    variance(accSamples.y),
    variance(accSamples.z)
  ]);

  calibrating = false;

  postMessage({
    type:"calibrated",
    gyroBias:{x:kalman.x[4], y:kalman.x[5], z:kalman.x[6]},
    accVar:[CONFIG.R[0][0], CONFIG.R[1][1], CONFIG.R[2][2]]
  });
}

onmessage = function(e){
  const data = e.data;

  switch(data.type){
    case "packet":{
      const tUs = data.time;
      const acc = {
        x: data.acc.x / 1000.0,
        y: data.acc.y / 1000.0,
        z: data.acc.z / 1000.0,
      };
      const gyro = {
        x: data.gyro.x * (Math.PI/180/1000),
        y: data.gyro.y * (Math.PI/180/1000),
        z: data.gyro.z * (Math.PI/180/1000),
      };

      if(calibrating){
        calibSamples.push({
          gx: gyro.x, gy: gyro.y, gz: gyro.z,
          ax: acc.x, ay: acc.y, az: acc.z
        });
        if(calibSamples.length >= CONFIG.CALIBRATION_SAMPLES) finishCalibration();
        return;
      }

      if(lastTimeUs !== null){
        const dt = (tUs - lastTimeUs)*1e-6;
        kalmanPredict(gyro, dt);
        kalmanUpdate(acc);
        maybeYawCorrection(acc, gyro);
      }
      lastTimeUs = tUs;
if (lastOutputTimeUs === null || (tUs - lastOutputTimeUs) >= 50000) {
      const euler = quatToEuler(kalman.x.slice(0,4));
      const rollDeg = radToDeg(euler.roll);
      const pitchDeg = radToDeg(euler.pitch);
      const yawDeg = radToDeg(euler.yaw);

      postMessage({
        type:"state",
        tUs,
        quaternion: kalman.x.slice(0,4),
        euler: {roll: rollDeg, pitch: pitchDeg, yaw: yawDeg},
        tiltHeadingRoll: qToTiltHeadingRoll(kalman.x.slice(0,4)),
        accWorld: rotateVectorByQuat(acc, kalman.x.slice(0,4))
      });
    }
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
