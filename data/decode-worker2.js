//import {calibrateWithZPlusXYFixed, calibrateWithZPlusXYSuperSimple,simpleZCalibration, calibrateWithZPlusXYSimple, calibrateWithIdleDataOnly, calibrateWithZPlusXY,calibrateWithZPlusXY2, calibrateTwoAxesFlexible,applyCalibrationToAccel,calibrateWithZPlusXYStrict } from './imuCalibration.js';
//import { applyCalibrationToAccel } from './imuCalibration.js';
//const { vec3, quat, mat3 } = glMatrix;

const SAMPLE_SIZE = 7;
let ACCMULTIPLIER = 61 / 1000;
let GYROMULTIPLIER = 4.375;
// TEMP-Multiplier ggf. separat festlegen!
let TEMPMULTIPLIER = 1 / 1000;
let LSBSTEP = 25.3375;

// Persistente Variablen im Worker-Scope
let lastTimestamp = 0;
let currentTimestamp = 0;

let samplesSinceLastTsAcc = 0;
let samplesSinceLastTsGyro = 0;
let samplesSinceLastTsTemp = 0;

let timestampStepAcc = 0;
let timestampStepGyro = 0;
let timestampStepTemp = 0;

let samplescounted = 0;
let calibdata = null;
let calibrating1 = false;
let calibrating2 = false;
let gravity = 1000;
let accelCalibrationScale = 1;
let fusionquat = null;
let fusionacc = null;
let totalacc = null;

let cutgravity = false;
let total = 0;

let IMUOpt = {
  NONE: 0,
  AUTO: 1,
  WORLD_SIMPLE: 2,
  REFERENCE: 3,
  WORLD_AXIS: 4,
  TWOAXIS: 5,
};
IMUOrientation = IMUOpt.NONE;

//IMUOrientation = 1;

function decodeTag(byte0) {
  return (byte0 >> 3) & 0x1F;

}

let quatauto = null;
let quatworldsimple = null;
let quatworldaxis = null;
let quat2axis = null;
let referenceState = null;
let worldSimpleGyroState = null;
let postTransformEnabled = false;
let postQx = 0;
let postQy = 0;
let postQz = 0;
let postQw = 1;
let postQConjX = 0;
let postQConjY = 0;
let postQConjZ = 0;
let postQConjW = 1;
let inputPort = null;
let decodedBufferCount = 0;
let decodedSampleCount = 0;
let lastDecodeStatsSentAt = 0;
let downsamplingPort = null;
let motionPort = null;
let motionForwardingEnabled = false;

function forwardRawBatchToDownsampling(sensor, data) {
  if (!downsamplingPort || !Array.isArray(data) || data.length === 0) {
    return;
  }

  downsamplingPort.postMessage({
    type: 'batch',
    sensor,
    data,
  });
}

function forwardMotionBatch(acc, gyro) {
  if (!motionPort || !motionForwardingEnabled) {
    return;
  }

  const accSamples = Array.isArray(acc) ? acc : [];
  const gyroSamples = Array.isArray(gyro) ? gyro : [];
  if (!accSamples.length && !gyroSamples.length) {
    return;
  }

  motionPort.postMessage({
    type: 'batch',
    payload: {
      acc: accSamples,
      gyro: gyroSamples,
    },
  });
}

function maybeReportDecodeStats(replyPort) {
  if (!replyPort) {
    return;
  }

  const now = Date.now();
  if ((now - lastDecodeStatsSentAt) < 500) {
    return;
  }

  lastDecodeStatsSentAt = now;
  replyPort.postMessage({
    type: 'decodeStats',
    payload: {
      decodedBufferCount,
      decodedSampleCount,
    },
  });
}

let timeSyncOffset = 0;

function handleWorkerMessage(data, replyPort = null) {
  let event = { data };


  let arrayBuffer = event.data;
  if (arrayBuffer instanceof ArrayBuffer) {
    //console.warn("[DECODE-WORKER] Skipping invalid message " + String(event.data));


    let view = new DataView(arrayBuffer);
    let sampleCount = Math.floor(arrayBuffer.byteLength / SAMPLE_SIZE);
    decodedBufferCount += 1;
    decodedSampleCount += sampleCount;

    let acc = [];
    let gyro = [];
    let temp = [];
    let info = [];
    let acccalib = [];
    let accraw = [];
    let gyroraw = [];
    let gyrocalib = [];

    for (let i = 0; i < sampleCount; ++i) {
      const offset = i * SAMPLE_SIZE;
      const tag = decodeTag(view.getUint8(offset));

      switch (tag) {
        case 4: { // Timestamp-Frame
          const ts_raw = view.getUint32(offset + 1, true);

          const ts = ts_raw * LSBSTEP // Umwandlung in Mikrosekunden

          // Schrittweite für jede Datenart berechnen
          if (lastTimestamp !== 0) {
            // Schrittweite für jede Datenart berechnen (in Mikrosekunden)
            if (samplesSinceLastTsAcc > 0)
              timestampStepAcc = (ts - lastTimestamp) / samplesSinceLastTsAcc;

            if (samplesSinceLastTsGyro > 0)
              timestampStepGyro = (ts - lastTimestamp) / samplesSinceLastTsGyro;

            if (samplesSinceLastTsTemp > 0)
              timestampStepTemp = (ts - lastTimestamp) / samplesSinceLastTsTemp;
          }
          lastTimestamp = ts;
          currentTimestamp = ts;
          samplescounted = samplesSinceLastTsAcc;
          samplesSinceLastTsAcc = 0;
          samplesSinceLastTsGyro = 0;
          samplesSinceLastTsTemp = 0;
          break;
        }

        case 1: { // Gyro
          let x = view.getInt16(offset + 1, true) * GYROMULTIPLIER;
          let y = view.getInt16(offset + 3, true) * GYROMULTIPLIER;
          let z = view.getInt16(offset + 5, true) * GYROMULTIPLIER;
          const rawGyroX = x;
          const rawGyroY = y;
          const rawGyroZ = z;

          if (calibrating1) {
            gyrocalib.push({ x: rawGyroX, y: rawGyroY, z: rawGyroZ });
          }





          if (timestampStepGyro > 0) {
            currentTimestamp = lastTimestamp + samplesSinceLastTsGyro * timestampStepGyro;
          }

          if (IMUOrientation === IMUOpt.AUTO) {
            if (quatauto !== null && quatauto !== undefined) {
              const rotatedGyro = rotateVectorByQuat({ x, y, z }, quatauto);
              x = rotatedGyro.x;
              y = rotatedGyro.y;
              z = rotatedGyro.z;
            }
          }

          if (IMUOrientation === IMUOpt.WORLD_SIMPLE) {
            if (worldSimpleGyroState) {
              x = x - worldSimpleGyroState.x;
              y = y - worldSimpleGyroState.y;
              z = z - worldSimpleGyroState.z;
            }
            if (quatworldsimple !== null && quatworldsimple !== undefined) {
              [x, y, z] = applyCalibrationToAccelFast(x, y, z);
            }
          }

          if (IMUOrientation === IMUOpt.REFERENCE && referenceState?.gyro) {
            x = x - referenceState.gyro.x;
            y = y - referenceState.gyro.y;
            z = z - referenceState.gyro.z;
          }

          if (postTransformEnabled && IMUOrientation !== IMUOpt.NONE) {
            [x, y, z] = applyPostTransformFast(x, y, z);
          }

          gyroraw.push({ time: currentTimestamp + timeSyncOffset, x: rawGyroX, y: rawGyroY, z: rawGyroZ });
          gyro.push({ time: currentTimestamp + timeSyncOffset, x: x, y: y, z: z });
          samplesSinceLastTsGyro++;
          break;
        }

        case 2: { // Acc


          if (timestampStepAcc > 0) {
              currentTimestamp = lastTimestamp + samplesSinceLastTsAcc * timestampStepAcc;
          }


          let x = view.getInt16(offset + 1, true) * ACCMULTIPLIER;
          let y = view.getInt16(offset + 3, true) * ACCMULTIPLIER;
          let z = view.getInt16(offset + 5, true) * ACCMULTIPLIER;

          accraw.push({ time: currentTimestamp + timeSyncOffset, x: x, y: y, z: z });
          // SENDE ROHDATEN
          if (calibrating1) {
            acccalib.push({ x: x, y: y, z: z });
          }


          // AUTOORIENT
          if (IMUOrientation === IMUOpt.AUTO) {
            if (quatauto !== null && quatauto !== undefined) {
              
              fusionacc = rotateVectorByQuat({ x, y, z }, quatauto);
              if (postTransformEnabled) {
                [fusionacc.x, fusionacc.y, fusionacc.z] = applyPostTransformFast(fusionacc.x, fusionacc.y, fusionacc.z);
              }
              if (cutgravity === true) {
                [fusionacc.x, fusionacc.y, fusionacc.z] = subtractGravityFast(fusionacc.x, fusionacc.y, fusionacc.z);
              }
              total = Math.sqrt(fusionacc.x * fusionacc.x + fusionacc.y * fusionacc.y + fusionacc.z * fusionacc.z);
              
              acc.push({ time: currentTimestamp + timeSyncOffset, x: fusionacc.x, y: fusionacc.y, z: fusionacc.z, total: total });
              samplesSinceLastTsAcc++;
              break;
          }
        }

          // WORLD SIMPLE
          if (IMUOrientation === IMUOpt.WORLD_SIMPLE) {
            if (quatworldsimple !== null && quatworldsimple !== undefined) {
              [x, y, z] = applyCalibrationToAccelFast(x, y, z);
              if (postTransformEnabled) {
                [x, y, z] = applyPostTransformFast(x, y, z);
              }
              if (cutgravity === true) {
                [x, y, z] = subtractGravityFast(x, y, z);
              }
              total = Math.sqrt(x * x + y * y + z * z);
              acc.push({ time: currentTimestamp + timeSyncOffset, x: x, y: y, z: z, total: total });
              samplesSinceLastTsAcc++;
              break;
            }
          }

          if (IMUOrientation === IMUOpt.REFERENCE) {
            const referenceAccel = referenceState?.acc ?? referenceState;
            if (referenceAccel !== null) {
              x = x - referenceAccel.x;
              y = y - referenceAccel.y;
              z = z - referenceAccel.z;
              if (postTransformEnabled) {
                [x, y, z] = applyPostTransformFast(x, y, z);
              }
              total = Math.sqrt(x * x + y * y + z * z);
              acc.push({ time: currentTimestamp + timeSyncOffset, x: x, y: y, z: z, total: total });
              samplesSinceLastTsAcc++;
              break;
            }
          }




          if (postTransformEnabled && IMUOrientation !== IMUOpt.NONE) {
            [x, y, z] = applyPostTransformFast(x, y, z);
          }
          total = Math.sqrt(x * x + y * y + z * z);
          acc.push({ time: currentTimestamp + timeSyncOffset, x: x, y: y, z: z, total: total });
          samplesSinceLastTsAcc++;

          break;
        }

        case 3: { // Temp
          const x = view.getInt16(offset + 1, true) * TEMPMULTIPLIER + 25;

          if (timestampStepTemp > 0) {
            currentTimestamp = lastTimestamp + samplesSinceLastTsTemp * timestampStepTemp;
          }
          //console.log("TEMPVALUE: " + x);
          temp.push({ time: currentTimestamp + timeSyncOffset, value: x });
          samplesSinceLastTsTemp++;
          break;
        }


        case 30: {

          //#define CFG_ID_ACCELSAMPLERATE   100
          //#define CFG_ID_ACCELRANGE        101
          //#define CFG_ID_ACCELFILTER       102

          //#define CFG_ID_GYROSAMPLERATE    103
          //#define CFG_ID_GYRORANGE         104
          //#define CFG_ID_GYROFILTER        105

          //#define CFG_TEMPSAMPLERATE       106
          //#define CFG_ID_FRQFINE           107





          const subId = view.getUint8(offset + 1);
          const value = view.getUint16(offset + 2, true);

          switch (subId) {

            // Accelerometer

            case 100:
              info.push({ type: "ACCELRATE", value: value });
              console.log("Config: ACCEL RATE =", value);
              break;
            case 101:
              info.push({ type: "ACCELRANGE", value: value });
              console.log("Config: ACCEL RANGE =", value);


              switch (value) {
                case 2: ACCMULTIPLIER = 61 / 1000; console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
                case 4: ACCMULTIPLIER = 122 / 1000; console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
                case 8: ACCMULTIPLIER = 244 / 1000; console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
                case 16: ACCMULTIPLIER = 488 / 1000; console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
              }

              break;
            case 102:
              info.push({ type: "ACCELFILTER", value: value });
              console.log("Config: ACCEL FILTER =", value);
              break;
            // Gyrometer

            case 103:
              info.push({ type: "GYROSAMPLERATE", value: value });
              console.log("Config: GYRO SAMPLERATE =", value);
              break;
            case 104:
              info.push({ type: "GYRORANGE", value: value });
              console.log("Config: GYRO RANGE =", value);


              switch (value) {
                case 125: GYROMULTIPLIER = 4.375; console.log("GYROMULTI CHANGE " + GYROMULTIPLIER); break;
                case 250: GYROMULTIPLIER = 8.75; console.log("GYROMULTI CHANGE " + GYROMULTIPLIER); break;
                case 500: GYROMULTIPLIER = 17.5; console.log("GYROMULTI CHANGE " + GYROMULTIPLIER); break;
                case 1000: GYROMULTIPLIER = 35; console.log("GYROMULTI CHANGE " + GYROMULTIPLIER); break;
                case 2000: GYROMULTIPLIER = 70; console.log("GYROMULTI CHANGE " + GYROMULTIPLIER); break;
              }


              break;
            case 105:
              info.push({ type: "GYROFILTER", value: value });
              console.log("Config: GYRO FILTER =", value);
              break;
            case 106:
              info.push({ type: "TEMPSAMPLERATE", value: value });
              console.log("Config: TEMP SAMPLERATE =", value);
              break;

            case 107:
              // WICHTIG: Wenn der ESP den exakten LSB-Step (als float) schickt, 
              // darf man hier kein Uint16 nutzen (da sonst Nachkommastellen abgeschnitten werden).
              // Ein Float nimmt 4 Bytes ab offset + 2 ein.
              let exactValue = view.getFloat32(offset + 2, true);
              LSBSTEP = exactValue; // Umwandlung in Mikrosekunden
              console.log("Config: LSB STEP =", exactValue);
              break;
            default:
              console.warn("Unbekannte Config-SubID", subId, "Value", value);
          }
          break;
        }

        case 31: {
          // Reservierter/ungültiger Tag (z. B. 0xFF-Füllbytes) -> ignorieren
          break;
        }


        default:

          console.log("UNKOWN TAG " + tag + " (Value: " + view.getInt16(offset + 1, true) + ")");

          break;
      }
    }

    forwardRawBatchToDownsampling('acc', accraw);
    forwardRawBatchToDownsampling('gyro', gyroraw);
    forwardMotionBatch(acc, gyro);
    if (replyPort) {
      replyPort.postMessage({ type: 'ack' });
      maybeReportDecodeStats(replyPort);
    }
    postMessage({ acc, gyro, temp, info, acccalib, accraw, gyroraw, gyrocalib })
  }

  else if (event.data?.type === 'attachInputPort') {
    inputPort = event.data.port ?? event.ports?.[0] ?? null;
    if (!inputPort) {
      return;
    }

    inputPort.onmessage = (portEvent) => {
      handleWorkerMessage(portEvent.data, inputPort);
    };

    if (typeof inputPort.start === 'function') {
      inputPort.start();
    }

    inputPort.postMessage({ type: 'ready' });
  }

  else if (event.data?.type === 'attachDownsamplingPort') {
    downsamplingPort = event.data.port ?? event.ports?.[0] ?? null;
    if (downsamplingPort && typeof downsamplingPort.start === 'function') {
      downsamplingPort.start();
    }
  }

  else if (event.data?.type === 'attachMotionPort') {
    motionPort = event.data.port ?? event.ports?.[0] ?? null;
    if (motionPort && typeof motionPort.start === 'function') {
      motionPort.start();
    }
  }

  else if (event.data?.type === 'setMotionForwardingEnabled') {
    motionForwardingEnabled = Boolean(event.data.enabled);
  }

 // ORIENTIERUNGSMODUS AUSWÄHLEN
    else if (event.data.type === 'calibmode') {
      let payload = event.data.payload;

      if (payload.mode != null && payload.mode !== undefined) {
        const mode = Number(payload.mode);
        if (mode === IMUOpt.NONE) {IMUOrientation = IMUOpt.NONE;}
        if (mode === IMUOpt.AUTO) {IMUOrientation = IMUOpt.AUTO;}
        if (mode === IMUOpt.WORLD_SIMPLE) {IMUOrientation = IMUOpt.WORLD_SIMPLE;}
        if (mode === IMUOpt.REFERENCE) {IMUOrientation = IMUOpt.REFERENCE;}
      }
  }
 // KALIBRIERDATEN EMPFANGEN
    else if (event.data.type === 'calibdata') {
      let payload = event.data.payload;
     
      if (payload.type != null && payload.type !== undefined) {
        if (payload.type===1){quatauto = payload.quaternion}
        if (payload.type===2){quatworldsimple = payload.quaternion; updateCalibrationQuaternion(quatworldsimple)}  
        if (payload.type===3){quatworldaxis = payload.quaternion} 
        if (payload.type===4){quat2axis = payload.quaternion} 
        //console.log("[DECODE-WORKER] CALIBRATIONDATA:", quatauto);
      }
  }

  else if (event.data.type === 'calibcommand') {

    //console.log("[DECODE-WORKER] CALIBRATIONCOMMAND:", event.data);

    let payload = event.data.payload;
    //console.log("[DECODE-WORKER] CALIBRATIONCOMMAND:", event.data.payload);

    if (payload.calib1 === true) {
      // Start Calibration
      //console.log("[DECODE-WORKER] Calibration started");
      calibrating1 = true;
      calibrating2 = false;
      acccalib = [];
    }
    if (payload.calib1 === false) {
      // Stop Calibration
      //console.log("[DECODE-WORKER] Calibration stopped");
      calibrating1 = false;
      calibrating2 = false;
      acccalib = [];
    }
  }
  else if (event.data.type === 'setgravity') {
    cutgravity = event.data.payload.gravity;
    console.log("[DECODE-WORKER] Gravity set to:", cutgravity);
  }
  else if (event.data.type === 'gravity') {
    gravity = event.data.payload.gravity;
    console.log("[DECODE-WORKER] Gravity set to:", gravity);
  }
  else if (event.data.type === 'accelCalibrationScale') {
    const scale = Number(event.data?.payload?.scale);
    accelCalibrationScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    console.log("[DECODE-WORKER] Accel calibration scale set to:", accelCalibrationScale);
  }
  else if (event.data.type === 'referenceState') {
    const payload = event.data.payload;
    if (payload && Number.isFinite(payload.x) && Number.isFinite(payload.y) && Number.isFinite(payload.z)) {
      referenceState = {
        acc: { x: payload.x, y: payload.y, z: payload.z },
        gyro: Number.isFinite(payload.gx) && Number.isFinite(payload.gy) && Number.isFinite(payload.gz)
          ? { x: payload.gx, y: payload.gy, z: payload.gz }
          : null,
      };
      console.log("[DECODE-WORKER] Reference state set:", referenceState);
    }
  }

  else if (event.data.type === 'worldSimpleGyroState') {
    const payload = event.data.payload;
    if (payload && Number.isFinite(payload.x) && Number.isFinite(payload.y) && Number.isFinite(payload.z)) {
      worldSimpleGyroState = {
        x: Number(payload.x),
        y: Number(payload.y),
        z: Number(payload.z),
      };
      console.log("[DECODE-WORKER] World-simple gyro state set:", worldSimpleGyroState);
    } else {
      worldSimpleGyroState = null;
      console.log("[DECODE-WORKER] World-simple gyro state cleared");
    }
  }

  else if (event.data.type === 'postTransformQuaternion') {
    const payload = event.data.payload;
    const nextQuaternion = payload?.quaternion ?? payload;
    updatePostTransformQuaternion(nextQuaternion);
    console.log("[DECODE-WORKER] Post-transform quaternion set:", postTransformEnabled ? [postQx, postQy, postQz, postQw] : null);
  }


  else if (event.data.type === 'calibdata') {

    let payload = event.data.payload;

      if (payload.quaternion === null || payload.quaternion === undefined) {
        calibdata = undefined;
        return;
      }

      

    // Normalisieren auf Array [x, y, z, w]
    if (payload.quaternion) {
      // payload.quaternion könnte Float32Array sein
      calibdata = Array.from(payload.quaternion);
      fusionquat = Array.from(payload.quaternion)
      updateCalibrationQuaternion(calibdata);
    } else if (payload instanceof Float32Array || Array.isArray(payload)) {
      calibdata = Array.from(payload);
    } else {
      // payload ist evtl. Objekt {x, y, z, w}
      calibdata = [payload.x, payload.y, payload.z, payload.w];
    }

    //console.log("[DECODE-WORKER] Quaternion updated:", calibdata);
  }
  else if (event.data.type === 'time_sync') {
    if (lastTimestamp !== 0) {
      const newOffset = event.data.payload - lastTimestamp;
      if (timeSyncOffset === 0) {
         timeSyncOffset = newOffset;
      } else {
         timeSyncOffset = 0.9 * timeSyncOffset + 0.1 * newOffset;
      }
    }
  }
}

onmessage = function (event) {
  handleWorkerMessage(event.data, null);
};

function applyCalibrationToAccel1(accelData, calibdata) {
  //console.log("[DEBUG] accelData:", accelData);
  //console.log("[DEBUG] calibdata:", calibdata);

  try {
    const vx = accelData[0];
    const vy = accelData[1];
    const vz = accelData[2];

    //console.log("[DEBUG] accel components:", vx, vy, vz);

    // calibdata ist jetzt Array [x, y, z, w]
    //console.log("[DEBUG] Trying to assign quaternion components...");
    const x = calibdata[0];
    const y = calibdata[1];
    const z = calibdata[2];
    const w = calibdata[3];
    //console.log("[DEBUG] quaternion components:", x, y, z, w);

    // v als Quaternion mit w=0
    const qv = [vx, vy, vz, 0];

    // q * v * q^-1
    const qvMult = quaternionMultiply([x, y, z, w], qv);
    const qConj = [-x, -y, -z, w];
    const result = quaternionMultiply(qvMult, qConj);

    //console.log("[DEBUG] calibrated result:", result);
    return [result[0], result[1], result[2]];
  } catch (err) {
    //console.error("[ERROR] applyCalibrationToAccel failed:", err);
    throw err;
  }
}

function quaternionMultiply(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];

  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

// Globale Variablen im Worker (einmal pro Quaternion-Update)
let qx, qy, qz, qw;    // aktuelle Quaternion
let qConjX, qConjY, qConjZ, qConjW; // Inverse der Quaternion

// Wird aufgerufen, wenn neue Quaternion empfangen wird
function updateCalibrationQuaternion(calibArray) {
  qx = calibArray[0];
  qy = calibArray[1];
  qz = calibArray[2];
  qw = calibArray[3];

  // Konjugierte Quaternion (Inverse, da Norm = 1)
  qConjX = -qx;
  qConjY = -qy;
  qConjZ = -qz;
  qConjW = qw;



  //qConjX = qx;
  //qConjY = qy;
  //qConjZ = qz;
  //qConjW = qw;


}

function normalizeQuaternionArray(quaternion) {
  const source = Array.isArray(quaternion)
    ? quaternion
    : [quaternion?.x, quaternion?.y, quaternion?.z, quaternion?.w];

  if (!source || source.length < 4) {
    return null;
  }

  const values = source.slice(0, 4).map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const length = Math.hypot(values[0], values[1], values[2], values[3]);
  if (length < 1e-12) {
    return null;
  }

  return values.map((value) => value / length);
}

function updatePostTransformQuaternion(quaternion) {
  const normalizedQuaternion = normalizeQuaternionArray(quaternion);
  if (!normalizedQuaternion) {
    postTransformEnabled = false;
    postQx = 0;
    postQy = 0;
    postQz = 0;
    postQw = 1;
    postQConjX = 0;
    postQConjY = 0;
    postQConjZ = 0;
    postQConjW = 1;
    return;
  }

  if (Math.abs(normalizedQuaternion[0]) <= 1e-6
    && Math.abs(normalizedQuaternion[1]) <= 1e-6
    && Math.abs(normalizedQuaternion[2]) <= 1e-6
    && Math.abs(normalizedQuaternion[3] - 1) <= 1e-6) {
    postTransformEnabled = false;
    postQx = 0;
    postQy = 0;
    postQz = 0;
    postQw = 1;
    postQConjX = 0;
    postQConjY = 0;
    postQConjZ = 0;
    postQConjW = 1;
    return;
  }

  postTransformEnabled = true;
  postQx = normalizedQuaternion[0];
  postQy = normalizedQuaternion[1];
  postQz = normalizedQuaternion[2];
  postQw = normalizedQuaternion[3];
  postQConjX = -postQx;
  postQConjY = -postQy;
  postQConjZ = -postQz;
  postQConjW = postQw;
}

function applyPostTransformFast(x, y, z) {
  const tx = postQw * x + postQy * z - postQz * y;
  const ty = postQw * y + postQz * x - postQx * z;
  const tz = postQw * z + postQx * y - postQy * x;
  const tw = -postQx * x - postQy * y - postQz * z;

  return [
    tw * postQConjX + tx * postQConjW + ty * postQConjZ - tz * postQConjY,
    tw * postQConjY + ty * postQConjW + tz * postQConjX - tx * postQConjZ,
    tw * postQConjZ + tz * postQConjW + tx * postQConjY - ty * postQConjX,
  ];
}

function subtractGravityFast(x, y, z) {
  const normalizedGravity = Number.isFinite(gravity) && gravity > 0 ? gravity : 1000;
  const gravityVector = postTransformEnabled
    ? applyPostTransformFast(0, 0, -normalizedGravity)
    : [0, 0, -normalizedGravity];

  return [
    x - gravityVector[0],
    y - gravityVector[1],
    z - gravityVector[2],
  ];
}

// Hochperformante, in-place Kalibrierung
function applyCalibrationToAccelFast(x, y, z) {
  // v als Quaternion w=0
  const vx = x, vy = y, vz = z, vw = 0;

  // q * v
  const tx = qw * vx + qy * vz - qz * vy + qx * vw;
  const ty = qw * vy + qz * vx - qx * vz + qy * vw;
  const tz = qw * vz + qx * vy - qy * vx + qz * vw;
  const tw = qw * vw - qx * vx - qy * vy - qz * vz;

  // * q^-1
  const rx = tw * qConjX + tx * qConjW + ty * qConjZ - tz * qConjY;
  const ry = tw * qConjY + ty * qConjW + tz * qConjX - tx * qConjZ;
  const rz = tw * qConjZ + tz * qConjW + tx * qConjY - ty * qConjX;

  return [rx * accelCalibrationScale, ry * accelCalibrationScale, rz * accelCalibrationScale];
}

function rotateVectorByQuat(v, q) {
  //const [w,x,y,z] = q;

  const w = q[0], x = q[1], y = q[2], z = q[3];



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