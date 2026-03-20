const SAMPLE_SIZE = 7;
let ACCMULTIPLIER = 61/1000;
let GYROMULTIPLIER = 4.375;
// TEMP-Multiplier ggf. separat festlegen!
let TEMPMULTIPLIER = 1/1000;
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
let gravity = 0;

let samplescounted = 0

function decodeTag(byte0) {
  return (byte0 >> 3) & 0x1F;

}


/* // 🟢 Intervall: jede Sekunde aktuelle Steps und Sample-Zähler loggen
setInterval(() => {
  console.log(
    `[TS-STEP] ACC: ${timestampStepAcc.toFixed(3)} µs  ` +
    `(Samples seit letztem Timestamp: ${samplescounted})`,
    ` | GYRO: ${timestampStepGyro.toFixed(3)} µs  ` +
    `(Samples: ${samplesSinceLastTsGyro})`,
    ` | TEMP: ${timestampStepTemp.toFixed(3)} µs  ` +
    `(Samples: ${samplesSinceLastTsTemp})`
  );
}, 1000); */



onmessage = function (event) {
  let arrayBuffer = event.data;
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    console.warn("[DECODE-WORKER] Skipping invalid message " + String(event.data));
    return;
  }

  let view = new DataView(arrayBuffer);
  let sampleCount = arrayBuffer.byteLength / SAMPLE_SIZE;

  let acc = [];
  let gyro = [];
  let temp = [];
  let info = [];

  for (let i = 0; i < sampleCount; ++i) {
    const offset = i * SAMPLE_SIZE;
    const tag = decodeTag(view.getUint8(offset));    

    switch (tag) {
      case 4: { // Timestamp-Frame
        const ts_raw = (view.getUint8(offset + 4) << 24) |
                       (view.getUint8(offset + 3) << 16) |
                       (view.getUint8(offset + 2) << 8)  |
                        view.getUint8(offset + 1);

        const ts = ts_raw * LSBSTEP // Umwandlung in Mikrosekunden

        // Schrittweite für jede Datenart berechnen
        if (lastTimestamp !== 0) {
          // Schrittweite für jede Datenart berechnen (in Mikrosekunden)
          if (samplesSinceLastTsAcc > 0)
            timestampStepAcc = (ts - lastTimestamp)  / samplesSinceLastTsAcc ;

          if (samplesSinceLastTsGyro > 0)
            timestampStepGyro = (ts - lastTimestamp)  / samplesSinceLastTsGyro;

          if (samplesSinceLastTsTemp > 0)
            timestampStepTemp = (ts - lastTimestamp)  / samplesSinceLastTsTemp;
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
        const x = view.getInt16(offset + 1, true) * GYROMULTIPLIER;
        const y = view.getInt16(offset + 3, true) * GYROMULTIPLIER;
        const z = view.getInt16(offset + 5, true) * GYROMULTIPLIER;

        if (timestampStepGyro > 0) {
          currentTimestamp = lastTimestamp + samplesSinceLastTsGyro * timestampStepGyro;
        }

        gyro.push({ time: currentTimestamp, x: x , y: y , z: z  });
        samplesSinceLastTsGyro++;
        break;
      }

      case 2: { // Acc
        const x = view.getInt16(offset + 1, true) * ACCMULTIPLIER;
        const y = view.getInt16(offset + 3, true) * ACCMULTIPLIER;
        const z = view.getInt16(offset + 5, true) * ACCMULTIPLIER;

        const total = Math.sqrt(x * x + y * y + z * z);

        if (timestampStepAcc > 0) {
          currentTimestamp = lastTimestamp + samplesSinceLastTsAcc * timestampStepAcc;
        }

        acc.push({ time: currentTimestamp, x: x , y: y, z: z, total: total });
        samplesSinceLastTsAcc++;
        
        break;
      }

      case 3: { // Temp
        const x = view.getInt16(offset + 1, true) * TEMPMULTIPLIER + 25;

        if (timestampStepTemp > 0) {
          currentTimestamp = lastTimestamp + samplesSinceLastTsTemp * timestampStepTemp;
        }
        //console.log("TEMPVALUE: " + x);
        temp.push({ time: currentTimestamp, value: x });
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


                  switch (value){
                      case 2: ACCMULTIPLIER = 61 / 1000;console.log("Config: accelmultichange =", ACCMULTIPLIER); break; 
                      case 4: ACCMULTIPLIER = 122 / 1000;console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
                      case 8: ACCMULTIPLIER = 244 / 1000;console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
                      case 16: ACCMULTIPLIER = 488 / 1000;console.log("Config: accelmultichange =", ACCMULTIPLIER); break;
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


                  switch (value){
                      case 125: GYROMULTIPLIER = 4.375 ; console.log("GYROMULTI CHANGE " + GYROMULTIPLIER); break;
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
                  LSBSTEP = value ; // Umwandlung in Mikrosekunden
                  console.log("Config: LSB STEP =", value);
                  break;
              default:
                  console.warn("Unbekannte Config-SubID", subId, "Value", value);
          }
          break;
      }


      default:

      console.log("UNKOWN TAG " + tag + " (Value: " + view.getInt16(offset + 1, true) + ")");

        break;
    }
  }

  postMessage({ acc, gyro, temp, info });
};


















/*

const SAMPLE_SIZE = 7;

onmessage = function (event) {
  let arrayBuffer = event.data;

  if (!(arrayBuffer instanceof ArrayBuffer)) {
    console.warn("[DECODE-WORKER] Skipping invalid message " + String(event.data));
    return;
  }

console.log("ARRAY BUFFER LENGTH:", arrayBuffer.byteLength );

  let view = new DataView(arrayBuffer);
  let sampleCount = arrayBuffer.byteLength / SAMPLE_SIZE;

/*   // Debug-Ausgabe der ersten 10 Werte
  for (let i = 0; i < Math.min(10, sampleCount); i++) {
    let offset = i * SAMPLE_SIZE;
    let ts_raw = view.getFloat32(offset, true);
    let id = view.getUint8(offset + 4);
    let val1 = view.getFloat32(offset + 8, true);
    let val2 = view.getFloat32(offset + 12, true);
    let val3 = view.getFloat32(offset + 16, true);

    console.log(
      `[Sample ${i}] ts_raw: ${ts_raw}, id: ${id}, val1: ${val1}, val2: ${val2}, val3: ${val3}`
    );
  } 

  let acc = [];
  let gyro = [];
  let temp = [];

  for (let i = 0; i < sampleCount-1; i++) {
    let offset = i * SAMPLE_SIZE;
    let ts_raw = i/SAMPLE_SIZE; //view.getFloat32(offset, true);
    let id = view.getUint8(offset);
    let val1 = view.getFloat32(offset + 1, true);
    let val2 = view.getFloat32(offset + 3, true);
    let val3 = view.getFloat32(offset + 5, true);

    let timestamp = ts_raw * 0.025;
    let scale = id === 3 ? 1.0 : 0.001;

if (i==0) {
  console.log("First sample - ID:", id, "Values:", val1, val2, val3);
}

    if (id === 1 || id === 2) {
      let sampleObj = {
        time: timestamp,
        x: val1 * scale,
        y: val2 * scale,
        z: val3 * scale
      };
      if (id === 2) {
        acc.push(sampleObj);
      } else if (id === 1) {
        gyro.push(sampleObj);
      }
    } else if (id === 3) {
      temp.push({
        time: timestamp,
        value: val1 * scale
      });
    }
  }

  //console.log("DC_WOKER " + String(acc.length) + " PUSHED   " + String(sampleCount) + " SAMPLES");

  postMessage({
    acc,
    gyro,
    temp
  });
};

//const SAMPLE_SIZE = 20;

/* onmessage = function (event) {
  let arrayBuffer = event.data;

  if (!(arrayBuffer instanceof ArrayBuffer)) {
    console.warn("[DECODE-WORKER] Skipping invalid message " + String(event.data));
    return;
  }

  let view = new DataView(arrayBuffer);
  let sampleCount = arrayBuffer.byteLength / SAMPLE_SIZE;

/*   // Debug-Ausgabe der ersten 10 Werte
  for (let i = 0; i < Math.min(10, sampleCount); i++) {
    let offset = i * SAMPLE_SIZE;
    let ts_raw = view.getFloat32(offset, true);
    let id = view.getUint8(offset + 4);
    let val1 = view.getFloat32(offset + 8, true);
    let val2 = view.getFloat32(offset + 12, true);
    let val3 = view.getFloat32(offset + 16, true);

    console.log(
      `[Sample ${i}] ts_raw: ${ts_raw}, id: ${id}, val1: ${val1}, val2: ${val2}, val3: ${val3}`
    );
  } 

  let acc = [];
  let gyro = [];
  let temp = [];

  for (let i = 0; i < sampleCount; i++) {
    let offset = i * SAMPLE_SIZE;
    let ts_raw = view.getFloat32(offset, true);
    let id = view.getUint8(offset + 4);
    let val1 = view.getFloat32(offset + 8, true);
    let val2 = view.getFloat32(offset + 12, true);
    let val3 = view.getFloat32(offset + 16, true);

    let timestamp = ts_raw * 0.025;
    let scale = id === 3 ? 1.0 : 0.001;

    if (id === 1 || id === 2) {
      let sampleObj = {
        time: timestamp,
        x: val1 * scale,
        y: val2 * scale,
        z: val3 * scale
      };
      if (id === 2) {
        acc.push(sampleObj);
      } else if (id === 1) {
        gyro.push(sampleObj);
      }
    } else if (id === 3) {
      temp.push({
        time: timestamp,
        value: val1 * scale
      });
    }
  }

  //console.log("DC_WOKER " + String(acc.length) + " PUSHED   " + String(sampleCount) + " SAMPLES");

  postMessage({
    acc,
    gyro,
    temp
  });
};
 */


// VERSION 1

/* // decode-worker.js

const SAMPLE_SIZE = 20;

onmessage = function (event) {
    let arrayBuffer = event.data;

    if (!(arrayBuffer instanceof ArrayBuffer)) {
        console.warn("[DECODE-WORKER] Skipping invalid message " +String(event.data));
        return;
    }

    //console.log("[DECODE-WORKER] Received buffer:", arrayBuffer.byteLength, "bytes");

    let view = new DataView(arrayBuffer);
    let result = [];
    let sampleCount = arrayBuffer.byteLength / SAMPLE_SIZE;

    for (let i = 0; i < sampleCount; i++) {
        let offset = i * SAMPLE_SIZE;
        let ts_raw = view.getFloat32(offset, true);
        let id = view.getUint8(offset + 4);
        let val1 = view.getFloat32(offset + 8, true);
        let val2 = view.getFloat32(offset + 12, true);
        let val3 = view.getFloat32(offset + 16, true);
        let timestamp = ts_raw * 0.025; // 0.000025
        let scale = id === 3 ? 1.0 : 0.001;

//console.log("TSRAW " + String(ts_raw));
//console.log("TIMESTAMP" + String(timestamp));

        result.push({
        timestamp,
        id,
        value1: val1 * scale,
        value2: val2 * scale,
        value3: val3 * scale
        });


        // result.push({
        //     timestamp_raw: ts_raw,
        //     id,
        //     value1_raw: val1,
        //     value2_raw: val2,
        //     value3_raw: val3,
        //     timestamp,
        //     value1: val1 * scale,
        //     value2: val2 * scale,
        //     value3: val3 * scale
        // });
    }

    //console.log("[DECODE-WORKER] Decoded", result.length, "samples");
    postMessage(result);
}; */
