const SAMPLE_SIZE = 7;

// Multiplikatoren & Schritte
let ACCMULTIPLIER = 61 / 1000;
let GYROMULTIPLIER = 4.375;
let TEMPMULTIPLIER = 1 / 1000;
let LSBSTEP = 25.3375;

// Worker State
let lastTimestamp = 0;
let currentTimestamp = 0;
let samplesSinceLast = { acc: 0, gyro: 0, temp: 0 };
let timestampStep = { acc: 0, gyro: 0, temp: 0 };
let calibQuat = null;

// Hilfsfunktionen
function applyCalibration(x, y, z) {
    if (!calibQuat) return [x, y, z];
    const [qx, qy, qz, qw] = calibQuat;
    const qv = [x, y, z, 0];
    const qConj = [-qx, -qy, -qz, qw];
    const temp = quaternionMultiply([qx, qy, qz, qw], qv);
    const result = quaternionMultiply(temp, qConj);
    return [result[0], result[1], result[2]];
}

function quaternionMultiply(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw*bx + ax*bw + ay*bz - az*by,
        aw*by - ax*bz + ay*bw + az*bx,
        aw*bz + ax*by - ay*bx + az*bw,
        aw*bw - ax*bx - ay*by - az*bz
    ];
}

function updateCalibrationQuaternion(array) {
    calibQuat = Array.from(array);
}

// Tag-Decoding
function decodeTag(byte0) {
  return (byte0 >> 3) & 0x1F;

}

// Worker Message Handler
onmessage = function(event) {
    if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data);
        const sampleCount = event.data.byteLength / SAMPLE_SIZE;

        const acc = [], gyro = [], temp = [], info = [];

        for (let i = 0; i < sampleCount; i++) {
            const offset = i * SAMPLE_SIZE;
            const byte0 = view.getUint8(offset);
            const tag = decodeTag(byte0);

            if (tag === 1) { // Gyro
                const x = view.getInt16(offset+1,true) * GYROMULTIPLIER;
                const y = view.getInt16(offset+3,true) * GYROMULTIPLIER;
                const z = view.getInt16(offset+5,true) * GYROMULTIPLIER;
                currentTimestamp = lastTimestamp + samplesSinceLast.gyro * timestampStep.gyro;
                gyro.push({ time: currentTimestamp, x, y, z });
                samplesSinceLast.gyro++;
            }
            else if (tag === 2) { // Acc
                let x = view.getInt16(offset+1,true) * ACCMULTIPLIER;
                let y = view.getInt16(offset+3,true) * ACCMULTIPLIER;
                let z = view.getInt16(offset+5,true) * ACCMULTIPLIER;

                //if (calibQuat) [x, y, z] = applyCalibration(x, y, z);

                const total = Math.sqrt(x*x + y*y + z*z);
                currentTimestamp = lastTimestamp + samplesSinceLast.acc * timestampStep.acc;
                acc.push({ time: currentTimestamp, x, y, z, total });
                samplesSinceLast.acc++;
            }
            else if (tag === 3) { // Temp
                const x = view.getInt16(offset+1,true) * TEMPMULTIPLIER + 25;
                currentTimestamp = lastTimestamp + samplesSinceLast.temp * timestampStep.temp;
                temp.push({ time: currentTimestamp, value: x });
                samplesSinceLast.temp++;
            }
            else if (tag === 4) { // Timestamp
                const ts_raw = view.getUint32(offset + 1, true);
                const ts = ts_raw * LSBSTEP;

                if (lastTimestamp !== 0) {
                    for (let k in timestampStep) {
                        if (samplesSinceLast[k] > 0)
                            timestampStep[k] = (ts - lastTimestamp) / samplesSinceLast[k];
                    }
                }
                lastTimestamp = currentTimestamp = ts;
                for (let k in samplesSinceLast) samplesSinceLast[k] = 0;
            }
            else if (tag === 30) { // Config
                
                
                const subId = view.getUint8(offset+1);
                const value = view.getUint16(offset+2,true);

console.log("SUB ID " + subId + " VALUE " + value)

                switch(subId) {
                    case 100: ACCMULTIPLIER = {2:61,4:122,8:244,16:488}[value]/1000; break;
                    case 101: ACCMULTIPLIER = {2:61,4:122,8:244,16:488}[value]/1000; break;
                    case 104: GYROMULTIPLIER = {125:4.375,250:8.75,500:17.5,1000:35,2000:70}[value]; break;
                    case 107: LSBSTEP = value; break;
                }
                info.push({subId,value});
            }
        }

        postMessage({ acc, gyro, temp, info });
    }
    else if (event.data.type === 'calibdata') {
        const payload = event.data.payload;
        if (payload.quaternion) updateCalibrationQuaternion(payload.quaternion);
        else if (Array.isArray(payload) || payload instanceof Float32Array) updateCalibrationQuaternion(payload);
        else updateCalibrationQuaternion([payload.x, payload.y, payload.z, payload.w]);
    }
};
