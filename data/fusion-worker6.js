// fusion-worker-kalman-adaptive-pos.js
importScripts('numeric.min.js');

const GYRO_SCALE = Math.PI/180000;      // mdps -> rad/s für Quaternion
const ACC_SCALE = 1/1000;               // mg -> g für Quaternion/Euler
const ACC_SCALE_POS = 9.80665/1000;     // mg -> m/s² für Positionsintegration
const RAD_TO_DEG = 180 / Math.PI;

// ---------------------------- CONFIG ----------------------------
const CONFIG = {
  Q: numeric.diag([1e-5,1e-5,1e-5,1e-5,1e-7,1e-7,1e-7]),
  R: numeric.diag([0.05,0.05,0.05]),
  CALIBRATION_SAMPLES: 800
};

// ---------------------------- GLOBALE VARIABLEN ----------------------------

// Quaternion-Kalman
let kalman = {
  x: [1,0,0,0, 0,0,0],
  P: numeric.identity(7)
};

// Positions-Kalman
let kfPos = {
  x: [0,0,0,0,0,0], // px,py,pz,vx,vy,vz
  P: numeric.identity(6),
  Q: numeric.diag([1e-4,1e-4,1e-4,1e-3,1e-3,1e-3]),
  R: numeric.diag([0.01,0.01,0.01])
};

// Zeit
let lastTimeUs = null;
let lastOutputTimeUs = null;

// Kalibrierung
let calibrating = false;
let calibSamples = [];

// Euler
let sinr, cosr, roll, sinp, pitch, siny, cosy, yaw;
let roll1, pitch1, yaw1;
let siny1, cosy2;

// Quaternion-Hilfs
let w1,x1,y1,z1,w2,x2,y2,z2;

// ZUPT Hilfs
let myc_accNorm, myc_gyronorm, myc_quat, myc_yawCur, myc_qReset;

// IMU
let om_acc, om_gyro, om_tUs, om_euler, om_rollDeg, om_pitchDeg, om_yawDeg;

// TEMPORÄRE ARRAYS global
let tmpVec4 = [0,0,0,0];
let tmpGyroVec = [0,0,0];
let tmpZ = [0,0,0];
let tmpGPred = [0,0,0];
let tmpY = [0,0,0];
let tmpH = new Array(3*7);
let tmpHt = new Array(7*3);
let y, H, gPred, z, Ht, S, S_inv, K, dx, qnorm;
let I = numeric.identity(7);
let accWorld = [0,0,0];
let I6 = numeric.identity(6);
let tmpPos6 = [0,0,0,0,0,0];

// ---------------------------- FUNKTIONEN ----------------------------

function normalizeQ(q){
  const norm = Math.sqrt(numeric.dot(q,q));
  if(norm===0) return q;
  return numeric.div(q,norm);
}

function kalmanPredict(gyro, dt){
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

function kalmanUpdate(acc){
  z = normalizeQ([acc.x,acc.y,acc.z]);
  let [q0,q1,q2,q3] = kalman.x;

  gPred = [
    2*(q1*q3 - q0*q2),
    2*(q0*q1 + q2*q3),
    q0*q0 - q1*q1 - q2*q2 + q3*q3
  ];

  y = numeric.sub(z,gPred);

  H = [
    [-2*q2,2*q3,-2*q0,2*q1,0,0,0],
    [2*q1,2*q0,2*q3,2*q2,0,0,0],
    [2*q0,-2*q1,-2*q2,2*q3,0,0,0]
  ];

  Ht = numeric.transpose(H);
  S = numeric.add(numeric.dot(H,numeric.dot(kalman.P,Ht)), CONFIG.R);
  S_inv = numeric.inv(S);

  K = numeric.dot(kalman.P,numeric.dot(Ht,S_inv));
  dx = numeric.dot(K,y);
  kalman.x = numeric.add(kalman.x,dx);

  qnorm = Math.sqrt(kalman.x[0]**2 + kalman.x[1]**2 + kalman.x[2]**2 + kalman.x[3]**2);
  kalman.x[0]/=qnorm; kalman.x[1]/=qnorm; kalman.x[2]/=qnorm; kalman.x[3]/=qnorm;

  kalman.P = numeric.dot(numeric.sub(I,numeric.dot(K,H)), kalman.P);
}

function radToDeg(rad){ return rad * RAD_TO_DEG; }
function quatToEuler(q){
  let [w,x,y,z] = q;
  sinr = 2*(w*x + y*z); cosr = 1-2*(x*x + y*y); roll = Math.atan2(sinr, cosr);
  sinp = 2*(w*y - z*x); pitch = Math.abs(sinp)>=1 ? Math.sign(sinp)*Math.PI/2 : Math.asin(sinp);
  siny = 2*(w*z + x*y); cosy = 1-2*(y*y + z*z); yaw = Math.atan2(siny, cosy);
  return {roll, pitch, yaw};
}
function qToTiltHeadingRoll(q){
  const [w,x,y,z] = q;
  roll1  = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y));
  pitch1 = Math.atan2(2*(w*y - z*x), 1 - 2*(y*y + x*x));
  yaw1   = Math.atan2(2*(w*z + x*y), 1 - 2*(z*z + y*y));
  return {roll: radToDeg(roll1), pitch: radToDeg(pitch1), yaw: radToDeg(yaw1)};
}
function rotateVectorByQuat(v,q){
  const [w,x,y,z] = q;
  const t = { x:2*(y*v.z - z*v.y), y:2*(z*v.x - x*v.z), z:2*(x*v.y - y*v.x) };
  return { x:v.x + w*t.x + (y*t.z - z*t.y), y:v.y + w*t.y + (z*t.x - x*t.z), z:v.z + w*t.z + (x*t.y - y*t.x) };
}

// ---------------------------- POSITION KALMAN ----------------------------
function kalmanPosPredict(dt, acc){
  tmpPos6[0] = kfPos.x[0] + kfPos.x[3]*dt + 0.5*acc[0]*dt*dt;
  tmpPos6[1] = kfPos.x[1] + kfPos.x[4]*dt + 0.5*acc[1]*dt*dt;
  tmpPos6[2] = kfPos.x[2] + kfPos.x[5]*dt + 0.5*acc[2]*dt*dt;
  tmpPos6[3] = kfPos.x[3] + acc[0]*dt;
  tmpPos6[4] = kfPos.x[4] + acc[1]*dt;
  tmpPos6[5] = kfPos.x[5] + acc[2]*dt;
  kfPos.x = tmpPos6.slice();

  // P vorher propagieren (vereinfachte Linearisierung)
  let F = [
    1,0,0,dt,0,0,
    0,1,0,0,dt,0,
    0,0,1,0,0,dt,
    0,0,0,1,0,0,
    0,0,0,0,1,0,
    0,0,0,0,0,1
  ];
  kfPos.P = numeric.add(numeric.dot(F,numeric.dot(kfPos.P,numeric.transpose(F))), kfPos.Q);
}
function kalmanPosUpdateZUPT(){
  let H = [
    0,0,0,1,0,0,
    0,0,0,0,1,0,
    0,0,0,0,0,1
  ];
  let Ht = numeric.transpose([[0,0,0,1,0,0],[0,0,0,0,1,0],[0,0,0,0,0,1]]);
  let S = numeric.add(numeric.dot(H,numeric.dot(kfPos.P,Ht)), kfPos.R);
  let K = numeric.dot(kfPos.P,numeric.dot(Ht,numeric.inv(S)));
  let y = [-kfPos.x[3],-kfPos.x[4],-kfPos.x[5]]; // Geschwindigkeit = 0
  kfPos.x = numeric.add(kfPos.x,numeric.dot(K,y));
  kfPos.P = numeric.dot(numeric.sub(I6,numeric.dot(K,H)), kfPos.P);
}

// ---------------------------- YAW CORRECTION ----------------------------
function maybeYawCorrection(acc, gyro){
  myc_accNorm = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
  myc_gyronorm = Math.sqrt(gyro.x**2 + gyro.y**2 + gyro.z**2);
  if(Math.abs(myc_accNorm-1.0)<0.03 && myc_gyronorm<0.017){
    myc_quat = kalman.x.slice(0,4);
    myc_yawCur = Math.atan2(2*(myc_quat[0]*myc_quat[3]+myc_quat[1]*myc_quat[2]),1-2*(myc_quat[2]**2+myc_quat[3]**2));
    myc_qReset = setQuaternionYaw(myc_quat,myc_yawCur);
    kalman.x[0] = myc_qReset[0]; kalman.x[1] = myc_qReset[1]; kalman.x[2] = myc_qReset[2]; kalman.x[3] = myc_qReset[3];
  }
}

// ---------------------------- CALIBRATION ----------------------------
function startCalibration(){ calibrating=true; calibSamples=[]; postMessage({type:"ack",msg:"calibration started"}); }
function finishCalibration(){ calibrating=false; postMessage({type:"calibrated"}); }

// ---------------------------- WORKER ----------------------------
onmessage = function(e){
  const data = e.data;
  switch(data.type){
    case "packet":{
      om_tUs = data.time;
      om_acc = {x:data.acc.x*ACC_SCALE,y:data.acc.y*ACC_SCALE,z:data.acc.z*ACC_SCALE};
      om_gyro = {x:data.gyro.x*GYRO_SCALE,y:data.gyro.y*GYRO_SCALE,z:data.gyro.z*GYRO_SCALE};

      if(calibrating){
        calibSamples.push({gx:data.gyro.x,gy:data.gyro.y,gz:data.gyro.z,ax:data.acc.x,ay:data.acc.y,az:data.acc.z});
        if(calibSamples.length>=CONFIG.CALIBRATION_SAMPLES) finishCalibration();
        return;
      }

      if(lastTimeUs!==null){
        const dt = (om_tUs-lastTimeUs)*1e-6;
        kalmanPredict(om_gyro,dt);
        kalmanUpdate(om_acc);
        maybeYawCorrection(om_acc, om_gyro);

        // Beschleunigung für Position in m/s²
        accWorld[0] = om_acc.x*ACC_SCALE_POS;
        accWorld[1] = om_acc.y*ACC_SCALE_POS;
        accWorld[2] = om_acc.z*ACC_SCALE_POS;

        accWorld = Object.values(rotateVectorByQuat({x:accWorld[0],y:accWorld[1],z:accWorld[2]}, kalman.x.slice(0,4)));

        kalmanPosPredict(dt, accWorld);

        // ZUPT
        const accMag = Math.sqrt(accWorld[0]**2+accWorld[1]**2+accWorld[2]**2);
        if(Math.abs(accMag-9.80665)<0.3 && Math.sqrt(om_gyro.x**2+om_gyro.y**2+om_gyro.z**2)<0.017){
          kalmanPosUpdateZUPT();
        }
      }
      lastTimeUs = om_tUs;

      if(lastOutputTimeUs===null || (om_tUs-lastOutputTimeUs)>=50000){
        om_euler = quatToEuler(kalman.x.slice(0,4));
        om_rollDeg = radToDeg(om_euler.roll);
        om_pitchDeg = radToDeg(om_euler.pitch);
        om_yawDeg = radToDeg(om_euler.yaw);

        postMessage({
          type:"state",
          om_tUs,
          quaternion: kalman.x.slice(0,4),
          euler:{roll:om_rollDeg,pitch:om_pitchDeg,yaw:om_yawDeg},
          tiltHeadingRoll:qToTiltHeadingRoll(kalman.x.slice(0,4)),
          accWorld:{x:accWorld[0],y:accWorld[1],z:accWorld[2]},
          velocity:{x:kfPos.x[3],y:kfPos.x[4],z:kfPos.x[5]},
          position:{x:kfPos.x[0],y:kfPos.x[1],z:kfPos.x[2]}
        });
        lastOutputTimeUs = om_tUs;
      }
      break;
    }
    case "startCalib": startCalibration(); break;
    case "stopCalib": finishCalibration(); break;
  }
};

// ---------------------------- HELPER ----------------------------
function setQuaternionYaw(q,newYaw){
  let [w,x,y,z] = q;
  let sinRoll = 2*(w*x + y*z), cosRoll = 1-2*(x*x + y*y), roll=Math.atan2(sinRoll,cosRoll);
  let sinPitch = 2*(w*y - z*x), pitch = Math.abs(sinPitch)>=1?Math.sign(sinPitch)*Math.PI/2:Math.asin(sinPitch);
  let cy=Math.cos(newYaw*0.5), sy=Math.sin(newYaw*0.5), cp=Math.cos(pitch*0.5), sp=Math.sin(pitch*0.5), cr=Math.cos(roll*0.5), sr=Math.sin(roll*0.5);
  return [cr*cp*cy + sr*sp*sy, sr*cp*cy - cr*sp*sy, cr*sp*cy + sr*cp*sy, cr*cp*sy - sr*sp*cy];
}
