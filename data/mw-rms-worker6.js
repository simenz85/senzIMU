importScripts('https://cdnjs.cloudflare.com/ajax/libs/numeric/1.2.6/numeric.min.js');

// ---------------------------- CONFIGURATION ----------------------------
const CONFIG = {
  MAX_SAMPLES: 1000,
  MIN_SAMPLES: 10,
  TARGET_INTERVAL_US: 33000,
  CALIBRATION_SAMPLES: 2000,
  ZUPT_THRESHOLD: 0.025, // ~0.025g = 0.245 m/s²
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
  
  reset() { 
    this.q = [1, 0, 0, 0]; 
    this.initialized = false;
  }

  updateIMU(gx, gy, gz, ax, ay, az, dtSec) {
    if (!(dtSec > 0)) return;
    
    // Normalize accelerometer measurement
    let n = ax * ax + ay * ay + az * az;
    if (n > 0 && isFinite(n)) { 
      n = 1 / Math.sqrt(n); 
      ax *= n; 
      ay *= n; 
      az *= n; 
    } else { 
      ax = ay = az = 0; 
    }

    let q1 = this.q[0], q2 = this.q[1], q3 = this.q[2], q4 = this.q[3];
    const beta = this.beta;

    // Rate of change of quaternion from gyroscope
    let qDot1 = 0.5 * (-q2 * gx - q3 * gy - q4 * gz);
    let qDot2 = 0.5 * (q1 * gx + q3 * gz - q4 * gy);
    let qDot3 = 0.5 * (q1 * gy - q2 * gz + q4 * gx);
    let qDot4 = 0.5 * (q1 * gz + q2 * gy - q3 * gx);

    // Compute feedback only if accelerometer measurement valid
    if (ax !== 0 || ay !== 0 || az !== 0) {
      const f1 = 2 * (q2 * q4 - q1 * q3) - ax;
      const f2 = 2 * (q1 * q2 + q3 * q4) - ay;
      const f3 = 2 * (0.5 - q2 * q2 - q3 * q3) - az;

      // Jacobian matrix
      const J_11or24 = 2 * q3, J_12or23 = 2 * q4, J_13or22 = 2 * q1, J_14or21 = 2 * q2;
      const J_32 = 2 * J_14or21, J_33 = 2 * J_11or24;

      // Gradient descent algorithm corrective step
      let s1 = J_14or21 * f2 - J_11or24 * f1;
      let s2 = J_12or23 * f1 + J_13or22 * f2 - J_32 * f3;
      let s3 = J_12or23 * f2 - J_33 * f3 - J_13or22 * f1;
      let s4 = J_14or21 * f1 + J_11or24 * f2;

      // Normalize step magnitude
      let sn = Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3 + s4 * s4);
      if (sn > 0 && isFinite(sn)) {
        sn = 1 / sn; 
        s1 *= sn; 
        s2 *= sn; 
        s3 *= sn; 
        s4 *= sn;
        
        // Apply feedback to rate of change of quaternion
        qDot1 -= beta * s1; 
        qDot2 -= beta * s2; 
        qDot3 -= beta * s3; 
        qDot4 -= beta * s4;
      }
    }

    // Integrate rate of change of quaternion
    q1 += qDot1 * dtSec; 
    q2 += qDot2 * dtSec; 
    q3 += qDot3 * dtSec; 
    q4 += qDot4 * dtSec;

    // Normalize quaternion
    let qn = Math.sqrt(q1 * q1 + q2 * q2 + q3 * q3 + q4 * q4);
    if (qn > 0 && isFinite(qn)) {
      qn = 1 / qn;
      this.q[0] = q1 * qn; 
      this.q[1] = q2 * qn; 
      this.q[2] = q3 * qn; 
      this.q[3] = q4 * qn;
      this.initialized = true;
    }
  }

  getQuaternion() { return this.q.slice(); }
  isInitialized() { return this.initialized; }

  getGravity() {
    const q = this.q, w = q[0], x = q[1], y = q[2], z = q[3];
    return [2 * (x * z - w * y), 2 * (w * x + y * z), w * w - x * x - y * y + z * z];
  }
}

// ---------------------------- Kalman Filter (6D) ----------------------------
class SimpleKalmanFilter6D {
  constructor(dt = CONFIG.KALMAN_DT) {
    this.dt = dt;
    this.x = [0, 0, 0, 0, 0, 0]; // [pos_x, pos_y, pos_z, vel_x, vel_y, vel_z]
    this.P = numeric.diag([0.01, 0.01, 0.01, 0.01, 0.01, 0.01]);
    
    // State transition matrix
    this.F = [
      [1, 0, 0, dt, 0, 0],
      [0, 1, 0, 0, dt, 0],
      [0, 0, 1, 0, 0, dt],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 1]
    ];
    
    // Observation matrix
    this.H = [
      [1, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0]
    ];
    
    // Process noise covariance
    this.Q = numeric.diag([CONFIG.Q_POS, CONFIG.Q_POS, CONFIG.Q_POS, CONFIG.Q_VEL, CONFIG.Q_VEL, CONFIG.Q_VEL]);
    
    // Measurement noise covariance
    this.R = numeric.diag([CONFIG.R_POS, CONFIG.R_POS, CONFIG.R_POS]);
    
    this.initialized = false;
  }
  
  predict() {
    this.x = numeric.dot(this.F, this.x);
    this.P = numeric.add(
      numeric.dot(this.F, numeric.dot(this.P, numeric.transpose(this.F))),
      this.Q
    );
    this.initialized = true;
  }
  
  update(z) {
    const y = numeric.sub(z, numeric.dot(this.H, this.x));
    const S = numeric.add(
      numeric.dot(this.H, numeric.dot(this.P, numeric.transpose(this.H))),
      this.R
    );
    const K = numeric.dot(numeric.dot(this.P, numeric.transpose(this.H)), numeric.inv(S));
    this.x = numeric.add(this.x, numeric.dot(K, y));
    const I = numeric.identity(6);
    this.P = numeric.dot(numeric.sub(I, numeric.dot(K, this.H)), this.P);
  }
  
  getState() { 
    return { 
      position: this.x.slice(0, 3), 
      velocity: this.x.slice(3, 6) 
    }; 
  }
  
  isInitialized() { return this.initialized; }
  
  reset() {
    this.x = [0, 0, 0, 0, 0, 0];
    this.P = numeric.diag([0.01, 0.01, 0.01, 0.01, 0.01, 0.01]);
    this.initialized = false;
  }
}

// ---------------------------- HELPER FUNCTIONS ----------------------------
function calculateRMS(arr) { 
  if (!arr.length) return 0; 
  return Math.sqrt(arr.reduce((acc, v) => acc + v * v, 0) / arr.length); 
}

function quaternionToEuler(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  
  let sinp = 2 * (w * y - z * x);
  if (sinp > 1) sinp = 1;
  else if (sinp < -1) sinp = -1;
  const pitch = Math.asin(sinp);
  
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);
  
  return { 
    roll: roll * 180 / Math.PI, 
    pitch: pitch * 180 / Math.PI, 
    yaw: yaw * 180 / Math.PI 
  };
}

function rotateVectorByQuaternion(v, q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  
  // t = 2 * cross(q_vec, v)
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  
  // v' = v + w * t + cross(q_vec, t)
  const vx = v.x + w * tx + (y * tz - z * ty);
  const vy = v.y + w * ty + (z * tx - x * tz);
  const vz = v.z + w * tz + (x * ty - y * tx);
  
  return { x: vx, y: vy, z: vz };
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
  if (!gyroTimes.length || !gyroValues.length) return { x: 0, y: 0, z: 0 };
  if (t <= gyroTimes[0]) return gyroValues[0];
  if (t >= gyroTimes[gyroTimes.length - 1]) return gyroValues[gyroValues.length - 1];
  
  let left = 0, right = gyroTimes.length - 1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    if (gyroTimes[mid] === t) return gyroValues[mid];
    if (gyroTimes[mid] < t) left = mid + 1;
    else right = mid - 1;
  }
  
  const i1 = Math.max(0, right), i2 = Math.min(gyroTimes.length - 1, left);
  return lerpVector(t, gyroTimes[i1], gyroTimes[i2], gyroValues[i1], gyroValues[i2]);
}

function accelToEuler(ax, ay, az) {
  const roll = Math.atan2(ay, az) * 180 / Math.PI;
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * 180 / Math.PI;
  return { roll, pitch, yaw: 0 };
}

function validateIMUData(samples, expectedFields = ['x', 'y', 'z', 'time']) {
  if (!Array.isArray(samples)) return false;
  return samples.every(sample => 
    sample && expectedFields.every(field => typeof sample[field] === 'number')
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------- GLOBAL STATE ----------------------------
const accBuffer = [], accTsBuffer = [], gyroBuffer = [], gyroTsBuffer = [];

let madgwick = new MadgwickAHRS();
let kalmanFilter = null;

let calibAccX = 0, calibAccY = 0, calibAccZ = 0;
let calibGyroX = 0, calibGyroY = 0, calibGyroZ = 0;
let calibSampleCount = 0;
let isCalibrating = true;
let isSystemInitialized = false;

// ---------------------------- WORKER MESSAGE HANDLING ----------------------------
self.onmessage = function(e) {
  const data = e.data;

  // Handle configuration changes
  if (data.type === 'configure') {
    Object.assign(CONFIG, data.config);
    if (madgwick && data.config.DEFAULT_BETA !== undefined) {
      madgwick.beta = data.config.DEFAULT_BETA;
    }
    self.postMessage({ status: "configuration_updated", config: CONFIG });
    return;
  }

  // Handle system reset
  if (data.type === 'reset') {
    resetSystem();
    self.postMessage({ status: "system_reset" });
    return;
  }

  // Handle calibration request
  if (data.type === 'calibrate') {
    startCalibration();
    self.postMessage({ status: "calibration_started" });
    return;
  }

  // Handle status request
  if (data.type === 'status') {
    self.postMessage({
      status: "system_status",
      isCalibrating,
      isSystemInitialized,
      calibrationProgress: isCalibrating ? (calibSampleCount / CONFIG.CALIBRATION_SAMPLES) * 100 : 100,
      madgwickInitialized: madgwick ? madgwick.isInitialized() : false,
      kalmanInitialized: kalmanFilter ? kalmanFilter.isInitialized() : false,
      bufferSizes: {
        acc: accBuffer.length,
        gyro: gyroBuffer.length
      }
    });
    return;
  }

  // Validate data messages
  if ((data.type === 'acc' || data.type === 'gyro') && !validateIMUData(data.payload)) {
    self.postMessage({ error: `Invalid ${data.type} data format` });
    return;
  }

  // Handle accelerometer data
  if (data.type === 'acc') {
    const accSamples = data.payload;
    
    if (isCalibrating) {
      for (const s of accSamples) { 
        calibAccX += s.x; 
        calibAccY += s.y; 
        calibAccZ += s.z; 
        calibSampleCount++; 
      }
      
      if (calibSampleCount >= CONFIG.CALIBRATION_SAMPLES) {
        completeCalibration();
      }
      return;
    }
    
    // Add to buffer with validation
    for (const s of accSamples) { 
      if (isFinite(s.x) && isFinite(s.y) && isFinite(s.z) && isFinite(s.time)) {
        accBuffer.push({ 
          x: s.x - calibAccX, 
          y: s.y - calibAccY, 
          z: s.z - calibAccZ 
        }); 
        accTsBuffer.push(s.time); 
      }
    }
    
    // Maintain buffer size
    while (accBuffer.length > CONFIG.MAX_SAMPLES) { 
      accBuffer.shift(); 
      accTsBuffer.shift(); 
    }
  } 
  
  // Handle gyroscope data
  else if (data.type === 'gyro') {
    const gyroSamples = data.payload;
    
    if (isCalibrating) {
      for (const s of gyroSamples) { 
        if (isFinite(s.x) && isFinite(s.y) && isFinite(s.z)) {
          calibGyroX += s.x; 
          calibGyroY += s.y; 
          calibGyroZ += s.z; 
        }
      }
      return;
    }
    
    // Add to buffer with validation
    for (const s of gyroSamples) { 
      if (isFinite(s.x) && isFinite(s.y) && isFinite(s.z) && isFinite(s.time)) {
        gyroBuffer.push({ 
          x: s.x - calibGyroX, 
          y: s.y - calibGyroY, 
          z: s.z - calibGyroZ 
        }); 
        gyroTsBuffer.push(s.time); 
      }
    }
    
    // Maintain buffer size
    while (gyroBuffer.length > CONFIG.MAX_SAMPLES) { 
      gyroBuffer.shift(); 
      gyroTsBuffer.shift(); 
    }
  } 
  
  else {
    self.postMessage({ error: "Unknown message type", type: data.type });
    return;
  }

  // Process data if we have enough samples and system is calibrated
  if (!isCalibrating && accBuffer.length >= CONFIG.MIN_SAMPLES) {
    processIMUData();
  }
};

// ---------------------------- SYSTEM FUNCTIONS ----------------------------
function resetSystem() {
  madgwick.reset();
  kalmanFilter = null;
  accBuffer.length = 0;
  accTsBuffer.length = 0;
  gyroBuffer.length = 0;
  gyroTsBuffer.length = 0;
  isSystemInitialized = false;
  isCalibrating = true;
  calibAccX = calibAccY = calibAccZ = 0;
  calibGyroX = calibGyroY = calibGyroZ = 0;
  calibSampleCount = 0;
}

function startCalibration() {
  isCalibrating = true;
  calibAccX = calibAccY = calibAccZ = 0;
  calibGyroX = calibGyroY = calibGyroZ = 0;
  calibSampleCount = 0;
}

function completeCalibration() {
  calibAccX /= calibSampleCount;
  calibAccY /= calibSampleCount;
  calibAccZ /= calibSampleCount;
  calibGyroX /= calibSampleCount;
  calibGyroY /= calibSampleCount;
  calibGyroZ /= calibSampleCount;
  
  isCalibrating = false;
  isSystemInitialized = true;
  
  self.postMessage({ 
    calibrationComplete: true, 
    biases: { 
      accX: calibAccX, 
      accY: calibAccY, 
      accZ: calibAccZ, 
      gyroX: calibGyroX, 
      gyroY: calibGyroY, 
      gyroZ: calibGyroZ 
    } 
  });
}

function processIMUData() {
  // Determine batch size based on target interval
  let sampleCount = 0;
  for (let i = CONFIG.MIN_SAMPLES - 1; i < accBuffer.length; i++) {
    if (accTsBuffer[i] - accTsBuffer[0] >= CONFIG.TARGET_INTERVAL_US) {
      sampleCount = i + 1;
      break;
    }
  }
  
  if (sampleCount === 0 || sampleCount > accBuffer.length) {
    sampleCount = Math.min(accBuffer.length, CONFIG.MAX_SAMPLES);
  }

  const batchAcc = accBuffer.slice(0, sampleCount);
  const batchAccTs = accTsBuffer.slice(0, sampleCount);

  // Initialize Kalman filter if needed
  if (!kalmanFilter) {
    kalmanFilter = new SimpleKalmanFilter6D();
  }

  // Arrays for dynamic acceleration in world frame
  const dynWorldX = [], dynWorldY = [], dynWorldZ = [];
  let lastFusionTsUs = null;
  let eulerFromAccel = null;
  let madgwickConverged = madgwick.isInitialized();

  // Process each sample in the batch
  for (let i = 0; i < sampleCount; i++) {
    const ax = batchAcc[i].x * 0.001; // Convert to g
    const ay = batchAcc[i].y * 0.001;
    const az = batchAcc[i].z * 0.001;
    const t = batchAccTs[i];

    // Interpolate gyro data
    const gInterp = interpolateGyro(t, gyroTsBuffer, gyroBuffer);
    const gx = (gInterp.x || 0) * CONFIG.MDPS_TO_RAD_S;
    const gy = (gInterp.y || 0) * CONFIG.MDPS_TO_RAD_S;
    const gz = (gInterp.z || 0) * CONFIG.MDPS_TO_RAD_S;

    // Calculate time delta
    let dtSec = 0;
    if (lastFusionTsUs !== null) {
      dtSec = (t - lastFusionTsUs) / 1e6;
      dtSec = clamp(dtSec, CONFIG.MIN_DT_SEC, CONFIG.MAX_DT_SEC);
    }
    lastFusionTsUs = t;

    // Update Madgwick filter
    if (dtSec > 0) {
      madgwick.updateIMU(gx, gy, gz, ax, ay, az, dtSec);
      madgwickConverged = madgwick.isInitialized();
    }

    // Get current orientation
    const q = madgwick.getQuaternion();

    // Transform acceleration to world frame
    const aSensor = { x: ax, y: ay, z: az };
    const aWorld = rotateVectorByQuaternion(aSensor, q);

    // Remove gravity component
    const dynWorld = { 
      x: aWorld.x - 0.0, 
      y: aWorld.y - 0.0, 
      z: aWorld.z - 1.0 
    };

    dynWorldX.push(dynWorld.x);
    dynWorldY.push(dynWorld.y);
    dynWorldZ.push(dynWorld.z);

    // Zero Velocity Update (ZUPT)
    const magDyn = Math.sqrt(dynWorld.x * dynWorld.x + dynWorld.y * dynWorld.y + dynWorld.z * dynWorld.z);
    if (magDyn < CONFIG.ZUPT_THRESHOLD && kalmanFilter.isInitialized()) {
      kalmanFilter.x[3] = 0; // velocity x
      kalmanFilter.x[4] = 0; // velocity y
      kalmanFilter.x[5] = 0; // velocity z
    }

    // Store Euler from accel for the last sample
    if (i === sampleCount - 1) {
      eulerFromAccel = accelToEuler(ax, ay, az);
    }
  }

  // Kalman filter prediction and update
  kalmanFilter.predict();
  const filteredPos = kalmanFilter.getState().position;
  kalmanFilter.update(filteredPos);
  const filteredState = kalmanFilter.getState();

  // Calculate RMS values
  const rmsWorldX_g = calculateRMS(dynWorldX);
  const rmsWorldY_g = calculateRMS(dynWorldY);
  const rmsWorldZ_g = calculateRMS(dynWorldZ);
  const rmsWorldVec_g = Math.sqrt(rmsWorldX_g * rmsWorldX_g + rmsWorldY_g * rmsWorldY_g + rmsWorldZ_g * rmsWorldZ_g);

  // Convert to m/s²
  const rmsWorldX_ms2 = rmsWorldX_g * CONFIG.G_TO_MS2;
  const rmsWorldY_ms2 = rmsWorldY_g * CONFIG.G_TO_MS2;
  const rmsWorldZ_ms2 = rmsWorldZ_g * CONFIG.G_TO_MS2;
  const rmsWorldVec_ms2 = rmsWorldVec_g * CONFIG.G_TO_MS2;

  // Get orientation
  const quat = madgwick.getQuaternion();
  const euler = quaternionToEuler(quat);

  // Send results
  self.postMessage({
    rmsWorld: { 
      x_g: rmsWorldX_g, 
      y_g: rmsWorldY_g, 
      z_g: rmsWorldZ_g, 
      vec_g: rmsWorldVec_g 
    },
    rmsWorld_m_s2: { 
      x: rmsWorldX_ms2, 
      y: rmsWorldY_ms2, 
      z: rmsWorldZ_ms2, 
      vec: rmsWorldVec_ms2 
    },
    quaternion: { 
      w: quat[0], 
      x: quat[1], 
      y: quat[2], 
      z: quat[3] 
    },
    euler, 
    eulerFromAccel,
    position: { 
      x: filteredState.position[0], 
      y: filteredState.position[1], 
      z: filteredState.position[2] 
    },
    velocity: { 
      x: filteredState.velocity[0], 
      y: filteredState.velocity[1], 
      z: filteredState.velocity[2] 
    },
    diagnostics: {
      samplesProcessed: sampleCount,
      timestamp: batchAccTs[sampleCount - 1],
      madgwickConverged,
      kalmanInitialized: kalmanFilter.isInitialized(),
      bufferSizes: {
        acc: accBuffer.length,
        gyro: gyroBuffer.length
      }
    }
  });

  // Remove processed samples
  accBuffer.splice(0, sampleCount);
  accTsBuffer.splice(0, sampleCount);
  
  // Clean up gyro buffer if it's getting too large
  if (gyroBuffer.length > CONFIG.MAX_SAMPLES * 2) {
    const excess = gyroBuffer.length - CONFIG.MAX_SAMPLES;
    gyroBuffer.splice(0, excess);
    gyroTsBuffer.splice(0, excess);
  }
}

// Initialize system
resetSystem();
self.postMessage({ status: "worker_initialized", config: CONFIG });