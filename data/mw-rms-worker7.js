importScripts('https://cdnjs.cloudflare.com/ajax/libs/numeric/1.2.6/numeric.min.js');

// ---------------------------- CONFIGURATION ----------------------------
const CONFIG = {
    MAX_SAMPLES: 1000,
    MIN_SAMPLES: 10,
    TARGET_INTERVAL_US: 33000,
    CALIBRATION_SAMPLES: 2000,
    ZUPT_THRESHOLD: 0.025,
    MDPS_TO_RAD_S: 0.001 * (Math.PI / 180),
    G_TO_MS2: 9.81,
    DEFAULT_BETA: 0.06,
    KALMAN_DT: 1/833,
    Q_POS: 0.0001,
    Q_VEL: 0.001,
    R_POS: 0.01,
    MAX_DT_SEC: 0.05,
    MIN_DT_SEC: 0.0001
};

// ---------------------------- Madgwick AHRS ----------------------------
class MadgwickAHRS {
    constructor(beta = CONFIG.DEFAULT_BETA) { 
        this.beta = beta; 
        this.q = [1, 0, 0, 0];
        this.initialized = false;
    }
    reset() { this.q = [1, 0, 0, 0]; this.initialized = false; }
    updateIMU(gx, gy, gz, ax, ay, az, dt) {
        if (!(dt > 0)) return;

        // normalize acc
        let n = ax*ax + ay*ay + az*az;
        if(n>0 && isFinite(n)){ n=1/Math.sqrt(n); ax*=n; ay*=n; az*=n; }
        else ax=ay=az=0;

        let [q1,q2,q3,q4]=this.q;
        const beta=this.beta;

        let qDot1=0.5*(-q2*gx - q3*gy - q4*gz);
        let qDot2=0.5*(q1*gx + q3*gz - q4*gy);
        let qDot3=0.5*(q1*gy - q2*gx + q4*gx);
        let qDot4=0.5*(q1*gz + q2*gy - q3*gx);

        if(ax!==0 || ay!==0 || az!==0){
            const f1=2*(q2*q4 - q1*q3)-ax;
            const f2=2*(q1*q2 + q3*q4)-ay;
            const f3=2*(0.5 - q2*q2 - q3*q3)-az;

            const J_11or24=2*q3, J_12or23=2*q4, J_13or22=2*q1, J_14or21=2*q2;
            const J_32=2*J_14or21, J_33=2*J_11or24;

            let s1=J_14or21*f2 - J_11or24*f1;
            let s2=J_12or23*f1 + J_13or22*f2 - J_32*f3;
            let s3=J_12or23*f2 - J_33*f3 - J_13or22*f1;
            let s4=J_14or21*f1 + J_11or24*f2;

            let sn=Math.sqrt(s1*s1 + s2*s2 + s3*s3 + s4*s4);
            if(sn>0 && isFinite(sn)){ sn=1/sn; s1*=sn; s2*=sn; s3*=sn; s4*=sn; 
                qDot1-=beta*s1; qDot2-=beta*s2; qDot3-=beta*s3; qDot4-=beta*s4;
            }
        }

        q1+=qDot1*dt; q2+=qDot2*dt; q3+=qDot3*dt; q4+=qDot4*dt;

        let qn=Math.sqrt(q1*q1 + q2*q2 + q3*q3 + q4*q4);
        if(qn>0 && isFinite(qn)){ qn=1/qn; this.q=[q1*qn,q2*qn,q3*qn,q4*qn]; this.initialized=true; }
    }
    getQuaternion(){ return this.q.slice(); }
    isInitialized(){ return this.initialized; }
}

// ---------------------------- Simple Kalman Filter ----------------------------
class SimpleKalmanFilter6D {
    constructor(dt=CONFIG.KALMAN_DT){
        this.dt=dt;
        this.x=[0,0,0,0,0,0];
        this.P=numeric.diag([0.01,0.01,0.01,0.01,0.01,0.01]);
        this.F=[
            [1,0,0,dt,0,0],
            [0,1,0,0,dt,0],
            [0,0,1,0,0,dt],
            [0,0,0,1,0,0],
            [0,0,0,0,1,0],
            [0,0,0,0,0,1]
        ];
        this.H=[[1,0,0,0,0,0],[0,1,0,0,0,0],[0,0,1,0,0,0]];
        this.Q=numeric.diag([CONFIG.Q_POS,CONFIG.Q_POS,CONFIG.Q_POS,CONFIG.Q_VEL,CONFIG.Q_VEL,CONFIG.Q_VEL]);
        this.R=numeric.diag([CONFIG.R_POS,CONFIG.R_POS,CONFIG.R_POS]);
        this.initialized=false;
    }
    predict(){ this.x=numeric.dot(this.F,this.x); this.P=numeric.add(numeric.dot(this.F,numeric.dot(this.P,numeric.transpose(this.F))),this.Q); this.initialized=true; }
    update(z){ const y=numeric.sub(z,numeric.dot(this.H,this.x)); const S=numeric.add(numeric.dot(this.H,numeric.dot(this.P,numeric.transpose(this.H))),this.R); const K=numeric.dot(numeric.dot(this.P,numeric.transpose(this.H)),numeric.inv(S)); this.x=numeric.add(this.x,numeric.dot(K,y)); const I=numeric.identity(6); this.P=numeric.dot(numeric.sub(I,numeric.dot(K,this.H)),this.P); }
    getState(){ return { position:this.x.slice(0,3), velocity:this.x.slice(3,6) }; }
    isInitialized(){ return this.initialized; }
    reset(){ this.x=[0,0,0,0,0,0]; this.P=numeric.diag([0.01,0.01,0.01,0.01,0.01,0.01]); this.initialized=false; }
}

// ---------------------------- HELPERS ----------------------------
function clamp(v,min,max){ return Math.min(Math.max(v,min),max); }
function calculateRMS(arr){ if(!arr.length)return 0; return Math.sqrt(arr.reduce((a,v)=>a+v*v,0)/arr.length); }
function rotateVectorByQuaternion(v,q){ const {x,y,z}=v; const w=q[0], qx=q[1], qy=q[2], qz=q[3]; const tx=2*(qy*z - qz*y), ty=2*(qz*x - qx*z), tz=2*(qx*y - qy*x); return { x:x + w*tx + (qy*tz - qz*ty), y:y + w*ty + (qz*tx - qx*tz), z:z + w*tz + (qx*ty - qy*tx) }; }
function interpolateGyro(t, times, vals){ if(!times.length || !vals.length) return {x:0,y:0,z:0}; if(t<=times[0]) return vals[0]; if(t>=times[times.length-1]) return vals[vals.length-1]; let l=0,r=times.length-1; while(l<=r){ const m=(l+r)>>1; if(times[m]===t) return vals[m]; if(times[m]<t) l=m+1; else r=m-1; } const i1=Math.max(0,r), i2=Math.min(times.length-1,l); const a=(t-times[i1])/(times[i2]-times[i1]); return { x:vals[i1].x + a*(vals[i2].x-vals[i1].x), y:vals[i1].y + a*(vals[i2].y-vals[i1].y), z:vals[i1].z + a*(vals[i2].z-vals[i1].z) }; }
function validateIMUData(samples){ return Array.isArray(samples) && samples.every(s=>s && typeof s.x==='number' && typeof s.y==='number' && typeof s.z==='number' && typeof s.time==='number'); }
function quaternionToEuler(q){ const [w,x,y,z]=q; const ysqr=y*y; const t0=+2.0*(w*x + y*z); const t1=+1.0 - 2.0*(x*x + ysqr); const roll=Math.atan2(t0,t1); let t2=+2.0*(w*y - z*x); t2=t2>1?1:t2; t2=t2<-1?-1:t2; const pitch=Math.asin(t2); const t3=+2.0*(w*z + x*y); const t4=+1.0 - 2.0*(ysqr + z*z); const yaw=Math.atan2(t3,t4); return { roll:roll*180/Math.PI, pitch:pitch*180/Math.PI, yaw:yaw*180/Math.PI }; }

// ---------------------------- GLOBAL STATE ----------------------------
const accBuffer=[], accTsBuffer=[], gyroBuffer=[], gyroTsBuffer=[];
let madgwick=new MadgwickAHRS(), kalmanFilter=null;
let calibAccX=0, calibAccY=0, calibAccZ=0, calibGyroX=0, calibGyroY=0, calibGyroZ=0, calibSampleCount=0;
let isCalibrating=true, isSystemInitialized=false;

// ---------------------------- SYSTEM FUNCTIONS ----------------------------
function resetSystem(){ madgwick.reset(); kalmanFilter=null; accBuffer.length=0; accTsBuffer.length=0; gyroBuffer.length=0; gyroTsBuffer.length=0; isSystemInitialized=false; isCalibrating=true; calibAccX=calibAccY=calibAccZ=0; calibGyroX=calibGyroY=calibGyroZ=0; calibSampleCount=0; }
function startCalibration(){ isCalibrating=true; calibAccX=calibAccY=calibAccZ=0; calibGyroX=calibGyroY=calibGyroZ=0; calibSampleCount=0; }
function completeCalibration(){ calibAccX/=calibSampleCount; calibAccY/=calibSampleCount; calibAccZ/=calibSampleCount; calibGyroX/=calibSampleCount; calibGyroY/=calibSampleCount; calibGyroZ/=calibSampleCount; isCalibrating=false; isSystemInitialized=true; self.postMessage({ calibrationComplete:true, biases:{ accX:calibAccX, accY:calibAccY, accZ:calibAccZ, gyroX:calibGyroX, gyroY:calibGyroY, gyroZ:calibGyroZ }}); }

// ---------------------------- PROCESS IMU DATA ----------------------------
function processIMUData(){
    let batchSize=Math.min(accBuffer.length, CONFIG.MAX_SAMPLES);
    if(!kalmanFilter) kalmanFilter=new SimpleKalmanFilter6D();

    const dynX=[], dynY=[], dynZ=[];
    let lastTs=null;

    for(let i=0;i<batchSize;i++){
        const ax=(accBuffer[i].x*0.001)-calibAccX*0.001;
        const ay=(accBuffer[i].y*0.001)-calibAccY*0.001;
        const az=(accBuffer[i].z*0.001)-calibAccZ*0.001;
        const t=accTsBuffer[i];

        const g=interpolateGyro(t, gyroTsBuffer, gyroBuffer);
        const gx=(g.x||0)*CONFIG.MDPS_TO_RAD_S, gy=(g.y||0)*CONFIG.MDPS_TO_RAD_S, gz=(g.z||0)*CONFIG.MDPS_TO_RAD_S;

        let dt=0;
        if(lastTs!==null){ dt=(t-lastTs)/1e6; dt=clamp(dt, CONFIG.MIN_DT_SEC, CONFIG.MAX_DT_SEC); }
        lastTs=t;

        if(dt>0) madgwick.updateIMU(gx,gy,gz,ax,ay,az,dt);

        const q=madgwick.getQuaternion();
        const aWorld=rotateVectorByQuaternion({x:ax,y:ay,z:az}, q);
        const dyn={ x:aWorld.x, y:aWorld.y, z:aWorld.z-1.0 };

        dynX.push(dyn.x); dynY.push(dyn.y); dynZ.push(dyn.z);

        const magDyn=Math.sqrt(dyn.x*dyn.x + dyn.y*dyn.y + dyn.z*dyn.z);
        if(magDyn<CONFIG.ZUPT_THRESHOLD && kalmanFilter.isInitialized()){ kalmanFilter.x[3]=0; kalmanFilter.x[4]=0; kalmanFilter.x[5]=0; }
    }

    kalmanFilter.predict();
    const fState=kalmanFilter.getState();
    kalmanFilter.update(fState.position);

    const rmsX=calculateRMS(dynX);
    const rmsY=calculateRMS(dynY);
    const rmsZ=calculateRMS(dynZ);
    const rmsVec=Math.sqrt(rmsX*rmsX + rmsY*rmsY + rmsZ*rmsZ);

    const quat=madgwick.getQuaternion();
    const euler=quaternionToEuler(quat);

    // ---------------------------- OUTPUT ----------------------------
    self.postMessage({
        rmsWorld: { x_g:rmsX, y_g:rmsY, z_g:rmsZ, vec_g:rmsVec },
        rmsWorld_m_s2: { x:rmsX*CONFIG.G_TO_MS2, y:rmsY*CONFIG.G_TO_MS2, z:rmsZ*CONFIG.G_TO_MS2, vec:rmsVec*CONFIG.G_TO_MS2 },
        quaternion: { w:quat[0], x:quat[1], y:quat[2], z:quat[3] },
        euler,
        position: { x:fState.position[0], y:fState.position[1], z:fState.position[2] },
        velocity: { x:fState.velocity[0], y:fState.velocity[1], z:fState.velocity[2] },
        diagnostics: { samplesProcessed:batchSize, madgwickConverged:madgwick.isInitialized(), kalmanInitialized:kalmanFilter.isInitialized(), bufferSizes:{ acc:accBuffer.length, gyro:gyroBuffer.length } }
    });

    accBuffer.splice(0,batchSize);
    accTsBuffer.splice(0,batchSize);
    if(gyroBuffer.length>CONFIG.MAX_SAMPLES*2){ const excess=gyroBuffer.length-CONFIG.MAX_SAMPLES; gyroBuffer.splice(0,excess); gyroTsBuffer.splice(0,excess); }
}

// ---------------------------- MESSAGE HANDLING ----------------------------
self.onmessage=function(e){
    const data=e.data;
    if(data.type==='configure'){ Object.assign(CONFIG,data.config); if(data.config.DEFAULT_BETA!==undefined) madgwick.beta=data.config.DEFAULT_BETA; return; }
    if(data.type==='reset'){ resetSystem(); return; }
    if(data.type==='calibrate'){ startCalibration(); return; }

    if((data.type==='acc'||data.type==='gyro') && !validateIMUData(data.payload)){ self.postMessage({error:`Invalid ${data.type} data`}); return; }

    if(data.type==='acc'){
        const samples=data.payload;
        if(isCalibrating){ for(const s of samples){ calibAccX+=s.x; calibAccY+=s.y; calibAccZ+=s.z; calibSampleCount++; } if(calibSampleCount>=CONFIG.CALIBRATION_SAMPLES) completeCalibration(); return; }
        for(const s of samples){ accBuffer.push({x:s.x,y:s.y,z:s.z}); accTsBuffer.push(s.time); }
        while(accBuffer.length>CONFIG.MAX_SAMPLES){ accBuffer.shift(); accTsBuffer.shift(); }
    } else if(data.type==='gyro'){
        const samples=data.payload;
        if(isCalibrating){ for(const s of samples){ calibGyroX+=s.x; calibGyroY+=s.y; calibGyroZ+=s.z; } return; }
        for(const s of samples){ gyroBuffer.push({x:s.x,y:s.y,z:s.z}); gyroTsBuffer.push(s.time); }
        while(gyroBuffer.length>CONFIG.MAX_SAMPLES){ gyroBuffer.shift(); gyroTsBuffer.shift(); }
    }

    if(!isCalibrating && accBuffer.length>=CONFIG.MIN_SAMPLES) processIMUData();
}

// ---------------------------- INIT ----------------------------
resetSystem();
self.postMessage({status:"worker_initialized", config:CONFIG});
