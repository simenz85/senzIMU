importScripts('https://cdnjs.cloudflare.com/ajax/libs/numeric/1.2.6/numeric.min.js');

class MadgwickAHRS {
  constructor(beta = 0.06) { this.beta = beta; this.q = [1,0,0,0]; }
  reset() { this.q = [1,0,0,0]; }

  updateIMU(gx, gy, gz, ax, ay, az, dtSec) {
    if (!(dtSec>0)) return;
    let n = ax*ax + ay*ay + az*az;
    if(n>0 && isFinite(n)) { n=1/Math.sqrt(n); ax*=n; ay*=n; az*=n; } else { ax=ay=0; az=0; }

    let q1=this.q[0], q2=this.q[1], q3=this.q[2], q4=this.q[3];
    const beta=this.beta;

    let qDot1 = 0.5*(-q2*gx - q3*gy - q4*gz);
    let qDot2 = 0.5*(q1*gx + q3*gz - q4*gy);
    let qDot3 = 0.5*(q1*gy - q2*gz + q4*gx);
    let qDot4 = 0.5*(q1*gz + q2*gy - q3*gx);

    if(ax!==0 || ay!==0 || az!==0){
      const f1 = 2*(q2*q4 - q1*q3) - ax;
      const f2 = 2*(q1*q2 + q3*q4) - ay;
      const f3 = 2*(0.5 - q2*q2 - q3*q3) - az;

      const J_11or24=2*q3, J_12or23=2*q4, J_13or22=2*q1, J_14or21=2*q2;
      const J_32=2*J_14or21, J_33=2*J_11or24;

      let s1=J_14or21*f2 - J_11or24*f1;
      let s2=J_12or23*f1 + J_13or22*f2 - J_32*f3;
      let s3=J_12or23*f2 - J_33*f3 - J_13or22*f1;
      let s4=J_14or21*f1 + J_11or24*f2;

      let sn=Math.sqrt(s1*s1+s2*s2+s3*s3+s4*s4);
      if(sn>0 && isFinite(sn)){ sn=1/sn; s1*=sn; s2*=sn; s3*=sn; s4*=sn;
        qDot1 -= beta*s1; qDot2 -= beta*s2; qDot3 -= beta*s3; qDot4 -= beta*s4;
      }
    }

    q1 += qDot1*dtSec; q2 += qDot2*dtSec; q3 += qDot3*dtSec; q4 += qDot4*dtSec;

    let qn=Math.sqrt(q1*q1+q2*q2+q3*q3+q4*q4);
    if(!(qn>0) || !isFinite(qn)) return; qn=1/qn;

    this.q[0]=q1*qn; this.q[1]=q2*qn; this.q[2]=q3*qn; this.q[3]=q4*qn;
  }

  getGravity() {
    const q=this.q, w=q[0], x=q[1], y=q[2], z=q[3];
    return [2*(x*z - w*y), 2*(w*x + y*z), w*w - x*x - y*y + z*z];
  }

  getQuaternion() { return this.q.slice(); }
}

class SimpleKalmanFilter6D {
  constructor(dt) {
    this.dt = dt;
    this.x = [0,0,0,0,0,0];
    this.P = numeric.diag([0.01,0.01,0.01,0.01,0.01,0.01]);
    this.F = [
      [1,0,0,dt,0,0],
      [0,1,0,0,dt,0],
      [0,0,1,0,0,dt],
      [0,0,0,1,0,0],
      [0,0,0,0,1,0],
      [0,0,0,0,0,1]
    ];
    this.H = [
      [1,0,0,0,0,0],
      [0,1,0,0,0,0],
      [0,0,1,0,0,0]
    ];
    const qPos=0.0001, qVel=0.001;
    this.Q = numeric.diag([qPos,qPos,qPos,qVel,qVel,qVel]);
    const rPos=0.01;
    this.R = numeric.diag([rPos,rPos,rPos]);
  }
  predict() {
    this.x = numeric.dot(this.F,this.x);
    this.P = numeric.add(
      numeric.dot(this.F,numeric.dot(this.P,numeric.transpose(this.F))),
      this.Q
    );
  }
  update(z) {
    const y = numeric.sub(z, numeric.dot(this.H,this.x));
    const S = numeric.add(
      numeric.dot(this.H,numeric.dot(this.P,numeric.transpose(this.H))),
      this.R
    );
    const K = numeric.dot(
      numeric.dot(this.P,numeric.transpose(this.H)),
      numeric.inv(S)
    );
    this.x = numeric.add(this.x, numeric.dot(K,y));
    const I = numeric.identity(6);
    this.P = numeric.dot(numeric.sub(I,numeric.dot(K,this.H)), this.P);
  }
  getState() { return { position:this.x.slice(0,3), velocity:this.x.slice(3,6) }; }
}

function calculateRMS(arr){ if(!arr.length) return 0; return Math.sqrt(arr.reduce((acc,v)=>acc+v*v,0)/arr.length); }

function quaternionToEuler(q){
  const w=q[0], x=q[1], y=q[2], z=q[3];
  const sinr_cosp=2*(w*x+y*z), cosr_cosp=1-2*(x*x+y*y);
  const roll=Math.atan2(sinr_cosp,cosr_cosp);
  let sinp=2*(w*y - z*x); if(sinp>1) sinp=1; else if(sinp<-1) sinp=-1;
  const pitch=Math.asin(sinp);
  const siny_cosp=2*(w*z + x*y), cosy_cosp=1-2*(y*y+z*z);
  const yaw=Math.atan2(siny_cosp,cosy_cosp);
  return { roll:roll*180/Math.PI, pitch:pitch*180/Math.PI, yaw:yaw*180/Math.PI };
}

function lerpVector(t,t0,t1,v0,v1){
  const alpha=(t-t0)/(t1-t0);
  return { x:v0.x + alpha*(v1.x-v0.x), y:v0.y + alpha*(v1.y-v0.y), z:v0.z + alpha*(v1.z-v0.z) };
}

function interpolateGyro(t,gyroTimes,gyroValues){
  if(!gyroTimes.length||!gyroValues.length) return {x:0,y:0,z:0};
  if(t<=gyroTimes[0]) return gyroValues[0];
  if(t>=gyroTimes[gyroTimes.length-1]) return gyroValues[gyroValues.length-1];
  let left=0,right=gyroTimes.length-1;
  while(left<=right){
    const mid=(left+right)>>1;
    if(gyroTimes[mid]===t) return gyroValues[mid];
    if(gyroTimes[mid]<t) left=mid+1; else right=mid-1;
  }
  const i1=Math.max(0,right), i2=Math.min(gyroTimes.length-1,left);
  return lerpVector(t,gyroTimes[i1],gyroTimes[i2],gyroValues[i1],gyroValues[i2]);
}

function accelToEuler(ax,ay,az){
  const roll=Math.atan2(ay,az)*180/Math.PI;
  const pitch=Math.atan2(-ax,Math.sqrt(ay*ay+az*az))*180/Math.PI;
  return { roll,pitch,yaw:0 };
}

const MAX_SAMPLES=1000, MIN_SAMPLES=10, TARGET_INTERVAL_US=33000, MDPS_TO_RAD_S=0.001*(Math.PI/180);

const accBuffer=[], accTsBuffer=[], gyroBuffer=[], gyroTsBuffer=[];

let madgwick=new MadgwickAHRS(); madgwick.reset();
let kalmanFilter=null;

let calibAccX=0, calibAccY=0, calibAccZ=0;
let calibGyroX=0, calibGyroY=0, calibGyroZ=0;
let calibSampleCount=0;
const CALIBRATION_SAMPLES=2000; 
let isCalibrating=true;

self.onmessage=function(e){
  const data=e.data;

  if(data.type==='acc'){
    const accSamples=data.payload;
    if(!Array.isArray(accSamples)){ self.postMessage({error:"acc payload kein Array"}); return; }
    if(isCalibrating){
      for(const s of accSamples){ calibAccX+=s.x; calibAccY+=s.y; calibAccZ+=s.z; calibSampleCount++; }
      if(calibSampleCount>=CALIBRATION_SAMPLES){
        calibAccX/=calibSampleCount; calibAccY/=calibSampleCount; calibAccZ/=calibSampleCount;
        calibGyroX/=calibSampleCount; calibGyroY/=calibSampleCount; calibGyroZ/=calibSampleCount;
        isCalibrating=false;
        self.postMessage({ calibrationComplete:true, biases:{ accX:calibAccX, accY:calibAccY, accZ:calibAccZ, gyroX:calibGyroX, gyroY:calibGyroY, gyroZ:calibGyroZ }});
      }
      return;
    }
    for(const s of accSamples){ accBuffer.push({ x:s.x-calibAccX, y:s.y-calibAccY, z:s.z-calibAccZ }); accTsBuffer.push(s.time); }
    while(accBuffer.length>MAX_SAMPLES){ accBuffer.shift(); accTsBuffer.shift(); }
  } else if(data.type==='gyro'){
    const gyroSamples=data.payload;
    if(!Array.isArray(gyroSamples)) { self.postMessage({error:"gyro payload kein Array"}); return; }
    if(isCalibrating){ for(const s of gyroSamples){ calibGyroX+=s.x; calibGyroY+=s.y; calibGyroZ+=s.z; } return; }
    for(const s of gyroSamples){ gyroBuffer.push({ x:s.x-calibGyroX, y:s.y-calibGyroY, z:s.z-calibGyroZ }); gyroTsBuffer.push(s.time); }
    while(gyroBuffer.length>MAX_SAMPLES){ gyroBuffer.shift(); gyroTsBuffer.shift(); }
  } else if(data.type==='calibrate'){
    isCalibrating=true; calibAccX=calibAccY=calibAccZ=0; calibGyroX=calibGyroY=calibGyroZ=0; calibSampleCount=0;
    return;
  } else { self.postMessage({error:"Unbekannter Nachrichtentyp"}); return; }

  if(accBuffer.length<MIN_SAMPLES) return;

  // Batch
  let sampleCount=0;
  for(let i=MIN_SAMPLES-1;i<accBuffer.length;i++){ if(accTsBuffer[i]-accTsBuffer[0]>=TARGET_INTERVAL_US){ sampleCount=i+1; break; } }
  if(sampleCount===0) return; if(sampleCount>accBuffer.length) sampleCount=accBuffer.length;

  const batchAcc=accBuffer.slice(0,sampleCount), batchAccTs=accTsBuffer.slice(0,sampleCount);

  if(!kalmanFilter) kalmanFilter=new SimpleKalmanFilter6D(0.01);

  const dynAccX=[], dynAccY=[], dynAccZ=[];
  let lastFusionTsUs=null, eulerFromAccel=null;

  for(let i=0;i<sampleCount;i++){
    const ax=batchAcc[i].x*0.001, ay=batchAcc[i].y*0.001, az=batchAcc[i].z*0.001;
    const t=batchAccTs[i];
    const gInterp=interpolateGyro(t,gyroTsBuffer,gyroBuffer);
    const gx=(gInterp.x||0)*MDPS_TO_RAD_S, gy=(gInterp.y||0)*MDPS_TO_RAD_S, gz=(gInterp.z||0)*MDPS_TO_RAD_S;

    let dtSec=0;
    if(lastFusionTsUs!=null){ dtSec=(t-lastFusionTsUs)/1e6; if(!(dtSec>0)||dtSec>0.05){ lastFusionTsUs=t; continue; } if(dtSec<1e-4) dtSec=1e-4; }
    lastFusionTsUs=t;

    if(dtSec>0) madgwick.updateIMU(gx,gy,gz,ax,ay,az,dtSec);

    const grav=madgwick.getGravity();
    const dax=ax-grav[0], day=ay-grav[1], daz=az-grav[2];
    dynAccX.push(dax); dynAccY.push(day); dynAccZ.push(daz);

    const magAcc=Math.sqrt(dax*dax + day*day + daz*daz);
    const ZUPT_THRESHOLD=0.015;
    if(magAcc<ZUPT_THRESHOLD) { kalmanFilter.x[3]=0; kalmanFilter.x[4]=0; kalmanFilter.x[5]=0; }

    if(i===sampleCount-1) eulerFromAccel=accelToEuler(ax,ay,az);
  }

  kalmanFilter.predict();
  const filteredPos=kalmanFilter.getState().position;
  kalmanFilter.update(filteredPos); 

  const filteredState=kalmanFilter.getState();
  const rmsX=calculateRMS(dynAccX), rmsY=calculateRMS(dynAccY), rmsZ=calculateRMS(dynAccZ);
  const rmsVec=Math.sqrt(rmsX*rmsX+rmsY*rmsY+rmsZ*rmsZ);
  const quat=madgwick.getQuaternion();
  const euler=quaternionToEuler(quat);

  self.postMessage({
    rmsX,rmsY,rmsZ,rmsVec,
    quaternion:{ w:quat[0], x:quat[1], y:quat[2], z:quat[3] },
    euler,eulerFromAccel,
    position:{ x:filteredState.position[0], y:filteredState.position[1], z:filteredState.position[2] },
    velocity:{ x:filteredState.velocity[0], y:filteredState.velocity[1], z:filteredState.velocity[2] },
    samplesProcessed: sampleCount,
    timestamp: batchAccTs[sampleCount-1]
  });

  accBuffer.splice(0,sampleCount); accTsBuffer.splice(0,sampleCount);
};
