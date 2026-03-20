// fusion-worker-kalman-adaptive-r.js
importScripts('numeric.min.js');


const GYRO_SCALE = Math.PI/180000;
const ACC_SCALE = 1/1000;
const RAD_TO_DEG = 180 / Math.PI;

let lastOutputTimeUs = null;

const CONFIG = {
  Q: numeric.diag([1e-5,1e-5,1e-5,1e-5, 1e-7,1e-7,1e-7]), // Prozessrauschen
  R: numeric.diag([0.05,0.05,0.05]), // Initiales Messrauschen (wird kalibriert)
  CALIBRATION_SAMPLES: 800
};

// SPEICHER ALLOKATIONEN
const tmpVec4 = [0,0,0,0];
const tmpGyroVec = [0,0,0];

const tmpZ = [0,0,0];
const tmpGPred = [0,0,0];
const tmpY = [0,0,0];
const tmpH = new Array(3*7);
const tmpHt = new Array(7*3);






let kalman = {
  x: [1,0,0,0, 0,0,0], // [q0,q1,q2,q3, bgx,bgy,bgz]
  P: numeric.identity(7)
};

let lastTimeUs = null;
let calibrating = false;
let calibSamples = [];


function normalizeQ(q) {
  const norm = Math.sqrt(numeric.dot(q, q));
  if (norm === 0) return q;
  return numeric.div(q, norm);
}


function kalmanPredict(gyro, dt) {
  let [q0,q1,q2,q3,bgx,bgy,bgz] = kalman.x;
  tmpGyroVec[0] = gyro.x - bgx;
  tmpGyroVec[1] = gyro.y - bgy;
  tmpGyroVec[2] = gyro.z - bgz;

  tmpVec4[0] = 0.5 * (-q1*tmpGyroVec[0] - q2*tmpGyroVec[1] - q3*tmpGyroVec[2]);
  tmpVec4[1] = 0.5 * ( q0*tmpGyroVec[0] + q2*tmpGyroVec[2] - q3*tmpGyroVec[1]);
  tmpVec4[2] = 0.5 * ( q0*tmpGyroVec[1] - q1*tmpGyroVec[2] + q3*tmpGyroVec[0]);
  tmpVec4[3] = 0.5 * ( q0*tmpGyroVec[2] + q1*tmpGyroVec[1] - q2*tmpGyroVec[0]);

  let qNew = numeric.add([q0,q1,q2,q3], numeric.mul(tmpVec4, dt));
  qNew = normalizeQ(qNew);

  kalman.x[0] = qNew[0]; kalman.x[1] = qNew[1]; kalman.x[2] = qNew[2]; kalman.x[3] = qNew[3];
  kalman.x[4] = bgx; kalman.x[5] = bgy; kalman.x[6] = bgz;

  kalman.P = numeric.add(kalman.P, CONFIG.Q);
}


let y;
let H;
let gPred;
let z;
let Ht;
let S;
let S_inv;
let K;
let dx;
let qnorm;
let I = numeric.identity(7);

function kalmanUpdate(acc) {
  z = normalizeQ([acc.x, acc.y, acc.z]);
  let [q0,q1,q2,q3] = kalman.x;

  gPred = [
    2*(q1*q3 - q0*q2),
    2*(q0*q1 + q2*q3),
    q0*q0 - q1*q1 - q2*q2 + q3*q3
  ];

  y = numeric.sub(z, gPred);

  H = [
    [-2*q2, 2*q3, -2*q0, 2*q1, 0, 0, 0],
    [2*q1, 2*q0, 2*q3, 2*q2, 0, 0, 0],
    [2*q0, -2*q1, -2*q2, 2*q3, 0, 0, 0]
  ];

  Ht = numeric.transpose(H);
  S = numeric.add(numeric.dot(H, numeric.dot(kalman.P, Ht)), CONFIG.R);
  S_inv = numeric.inv(S);
  
  
  K = numeric.dot(kalman.P, numeric.dot(Ht, S_inv));
  dx = numeric.dot(K, y);

  kalman.x = numeric.add(kalman.x, dx);

  qnorm = Math.sqrt(kalman.x[0]*kalman.x[0] + kalman.x[1]*kalman.x[1] + kalman.x[2]*kalman.x[2] + kalman.x[3]*kalman.x[3]);
  kalman.x[0] /= qnorm;
  kalman.x[1] /= qnorm;
  kalman.x[2] /= qnorm;
  kalman.x[3] /= qnorm;

  I = numeric.identity(7);
  kalman.P = numeric.dot(numeric.sub(I, numeric.dot(K, H)), kalman.P);
}

function radToDeg(rad) {
  return rad * RAD_TO_DEG;
}


let sinr, cosr, roll, sinp, pitch, siny, cosy, yaw;
function quatToEuler(q) {
  let [w,x,y,z] = q;
  sinr = 2 * (w*x + y*z);
  cosr = 1 - 2*(x*x + y*y);
  roll = Math.atan2(sinr, cosr);

  sinp = 2 * (w*y - z*x);
  pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp)*Math.PI/2 : Math.asin(sinp);

  siny = 2 * (w*z + x*y);
  cosy = 1 - 2*(y*y + z*z);
  yaw = Math.atan2(siny, cosy);

  return {roll, pitch, yaw};
}

let w1, w2;

function quatMultiply(q1, q2) {
  w1 = q1[0], x1 = q1[1], y1 = q1[2], z1 = q1[3];
  w2 = q2[0], x2 = q2[1], y2 = q2[2], z2 = q2[3];

  return [
    w1*w2 - x1*x2 - y1*y2 - z1*z2,
    w1*x2 + x1*w2 + y1*z2 - z1*y2,
    w1*y2 - x1*z2 + y1*w2 + z1*x2,
    w1*z2 + x1*y2 - y1*x2 + z1*w2
  ];
}


let roll1, pitch1, yaw1;

function qToTiltHeadingRoll(q) {
  const [w,x,y,z] = q;

  // Berechnungen wiederverwenden
  roll1  = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y));
  pitch1 = Math.atan2(2*(w*y - z*x), 1 - 2*(y*y + x*x));
  yaw1   = Math.atan2(2*(w*z + x*y), 1 - 2*(z*z + y*y));

  return {roll: radToDeg(roll1), pitch: radToDeg(pitch1), yaw: radToDeg(yaw1)};
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

let siny1, cosy2

function getYawFromQuaternion(q) {
  let [w,x,y,z] = q;
  siny2 = 2 * (w*z + x*y);
  cosy2 = 1 - 2*(y*y + z*z);
  return Math.atan2(siny2, cosy2);
}

// globale temporäre Variablen für setQuaternionYaw
let sqy_w, sqy_x, sqy_y, sqy_z;
let sqy_sinRoll, sqy_cosRoll, sqy_roll;
let sqy_sinPitch, sqy_pitch;
let sqy_cy, sqy_sy, sqy_cp, sqy_sp, sqy_cr, sqy_sr;

function setQuaternionYaw(q, newYaw) {
  [sqy_w, sqy_x, sqy_y, sqy_z] = q;

  // Roll berechnen
  sqy_sinRoll = 2*(sqy_w*sqy_x + sqy_y*sqy_z);
  sqy_cosRoll = 1 - 2*(sqy_x*sqy_x + sqy_y*sqy_y);
  sqy_roll = Math.atan2(sqy_sinRoll, sqy_cosRoll);

  // Pitch berechnen
  sqy_sinPitch = 2*(sqy_w*sqy_y - sqy_z*sqy_x);
  sqy_pitch = Math.abs(sqy_sinPitch) >= 1 ? Math.sign(sqy_sinPitch)*Math.PI/2 : Math.asin(sqy_sinPitch);

  // Hilfsgrößen für Quaternion berechnen
  sqy_cy = Math.cos(newYaw*0.5);
  sqy_sy = Math.sin(newYaw*0.5);
  sqy_cp = Math.cos(sqy_pitch*0.5);
  sqy_sp = Math.sin(sqy_pitch*0.5);
  sqy_cr = Math.cos(sqy_roll*0.5);
  sqy_sr = Math.sin(sqy_roll*0.5);

  return [
    sqy_cr*sqy_cp*sqy_cy + sqy_sr*sqy_sp*sqy_sy,
    sqy_sr*sqy_cp*sqy_cy - sqy_cr*sqy_sp*sqy_sy,
    sqy_cr*sqy_sp*sqy_cy + sqy_sr*sqy_cp*sqy_sy,
    sqy_cr*sqy_cp*sqy_sy - sqy_sr*sqy_sp*sqy_cy
  ];
}


let myc_accnorm, myc_gyronorm, myc_quat,myc_yawCur, myc_qReset;

function maybeYawCorrection(acc, gyro) {
  myc_accNorm = Math.sqrt(acc.x*acc.x + acc.y*acc.y + acc.z*acc.z);
  myc_gyronorm = Math.sqrt(gyro.x*gyro.x + gyro.y*gyro.y + gyro.z*gyro.z);

  // Thresholds: ~0.03 g tolerance, ~1 deg/s in rad/s
  if(Math.abs(myc_accNorm-1.0) < 0.03 && myc_gyronorm < 0.017) {
    myc_quat = kalman.x.slice(0,4);
    myc_yawCur = getYawFromQuaternion(myc_quat);
    myc_qReset = setQuaternionYaw(myc_quat, myc_yawCur);
    kalman.x[0] = myc_qReset[0];
    kalman.x[1] = myc_qReset[1];
    kalman.x[2] = myc_qReset[2];
    kalman.x[3] = myc_qReset[3];
  }
}

function startCalibration() {
  calibrating = true;
  calibSamples = [];
  postMessage({type:"ack", msg:"calibration started"});
}

let fc_sumG, fc_accSampels,fc_mean, fc_n;

function finishCalibration() {
  if(calibSamples.length === 0) return;

  fc_sumG = {x:0,y:0,z:0};
  fc_accSamples = {x:[], y:[], z:[]};

  for(const s of calibSamples){
    sumG.x += s.gx; sumG.y += s.gy; sumG.z += s.gz;
    fc_accSamples.x.push(s.ax);
    fc_accSamples.y.push(s.ay);
    fc_accSamples.z.push(s.az);
  }
  fc_n = calibSamples.length;

  kalman.x[4] = fc_sumG.x / fc_n;
  kalman.x[5] = fc_sumG.y / fc_n;
  kalman.x[6] = fc_sumG.z / fc_n;

  function variance(arr){
    fc_mean = arr.reduce((a,b) => a+b,0)/arr.length;
    return arr.reduce((a,b) => a + (b-fc_mean)*(b-fc_mean), 0)/arr.length;
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


// MATRIX FUNCTIONS

/* function identity7() {
  let I = new Array(49);
  for(let i=0; i<49; i++) I[i] = 0;
  for(let i=0; i<7; i++) I[i*7 + i] = 1;
  return I;
}

function matAdd7(A, B) {
  let out = new Array(49);
  for (let i = 0; i < 49; i++) {
    out[i] = A[i] + B[i];
  }
  return out;
}

function matSub7(A, B) {
  let out = new Array(49);
  for (let i = 0; i < 49; i++) {
    out[i] = A[i] - B[i];
  }
  return out;
}

function matMul7(A, B) {
  let out = new Array(49).fill(0);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      let sum = 0;
      for (let k = 0; k < 7; k++) {
        sum += A[r*7 + k] * B[k*7 + c];
      }
      out[r*7 + c] = sum;
    }
  }
  return out;
}
function matTranspose3x7(H) {
  let out = new Array(21);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 7; c++) {
      out[c*3 + r] = H[r*7 + c];
    }
  }
  return out;
}
function matMul7x3_3x3(A, B) {
  let out = new Array(21).fill(0);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += A[r*3 + k] * B[k*3 + c];
      }
      out[r*3 + c] = sum;
    }
  }
  return out;
}
function matMul3x7_7x3(A, B) {
  let out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 7; k++) {
        sum += A[r*7 + k] * B[k*3 + c];
      }
      out[r*3 + c] = sum;
    }
  }
  return out;
}
function mat3Inv(M) {
  let a=M[0], b=M[1], c=M[2],
      d=M[3], e=M[4], f=M[5],
      g=M[6], h=M[7], i=M[8];

  let det = a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g);
  if(Math.abs(det) < 1e-12) return null;

  let invDet = 1/det;

  return [
    (e*i - f*h)*invDet,
    (c*h - b*i)*invDet,
    (b*f - c*e)*invDet,
    (f*g - d*i)*invDet,
    (a*i - c*g)*invDet,
    (c*d - a*f)*invDet,
    (d*h - e*g)*invDet,
    (b*g - a*h)*invDet,
    (a*e - b*d)*invDet
  ];
}


 */











let om_acc, om_gyro,om_tUs, om_euler, om_rollDeg, om_pitchDeg, om_yaw_Deg;

onmessage = function(e){
  const data = e.data;

  switch(data.type){
    case "packet":{
      om_tUs = data.time;
     om_acc = {
        x: data.acc.x * ACC_SCALE,
        y: data.acc.y * ACC_SCALE,
        z: data.acc.z * ACC_SCALE,
      };
      om_gyro = {
        x: data.gyro.x * GYRO_SCALE,
        y: data.gyro.y * GYRO_SCALE,
        z: data.gyro.z * GYRO_SCALE,
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
        const dt = (om_tUs - lastTimeUs)*1e-6;
        kalmanPredict(om_gyro, dt);
        kalmanUpdate(om_acc);
        maybeYawCorrection(om_acc, om_gyro);
      }
      lastTimeUs = om_tUs;
if (lastOutputTimeUs === null || (tUs - lastOutputTimeUs) >= 50000) {
      om_euler = quatToEuler(kalman.x.slice(0,4));
      om_rollDeg = radToDeg(om_euler.roll);
      om_pitchDeg = radToDeg(om_euler.pitch);
      om_yawDeg = radToDeg(om_euler.yaw);

      postMessage({
        type:"state",
        om_tUs,
        quaternion: kalman.x.slice(0,4),
        euler: {roll: om_rollDeg, pitch: om_pitchDeg, yaw: om_yawDeg},
        tiltHeadingRoll: qToTiltHeadingRoll(kalman.x.slice(0,4)),
        accWorld: rotateVectorByQuat(om_acc, kalman.x.slice(0,4))
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
