import { accBuffer, gyroBuffer, tempBuffer } from "../charts/liveChart.js";

export let decodeWorker=new Worker("decode-worker.js");

import { accelSampleRateDD2, accelRangeDD2, accelFilterDD2,
         gyroSampleRateDD2, gyroRangeDD2, gyroFilterDD2,
         tempSampleRateDD2 } from "../ui/ui-setup.js";

export function setupDecodeWorker(){
  decodeWorker.onmessage=(e)=>{
    const {acc,gyro,temp,info}=e.data;
    if(acc) {
      acc.forEach(s => {
        let sampleX = s.x, sampleY = s.y, sampleZ = s.z, sampleTotal = Math.sqrt(s.x*s.x + s.y*s.y + s.z*s.z);
        if (window.accRawBuffer) window.accRawBuffer.push([s.time, s.x, s.y, s.z, sampleTotal]);
        if (typeof window.buildLiveAccelerationSample === 'function') {
             const cSmp = window.buildLiveAccelerationSample(null, s) || s;
             if(cSmp.total === undefined) cSmp.total = Math.sqrt(cSmp.x*cSmp.x + cSmp.y*cSmp.y + cSmp.z*cSmp.z);
             sampleX = cSmp.x; sampleY = cSmp.y; sampleZ = cSmp.z; sampleTotal = cSmp.total; 
        }
        accBuffer.push([s.time, sampleX, sampleY, sampleZ, sampleTotal]);
        if (window.feedImpactTestData) {
            window.feedImpactTestData(sampleX, sampleY, sampleZ, s.time);
        }
      });
    }
    if(gyro) {
      gyro.forEach(s => {
        let sampleX = s.x, sampleY = s.y, sampleZ = s.z, sampleTotal = Math.sqrt(s.x*s.x + s.y*s.y + s.z*s.z);
        if (window.gyroRawBuffer) window.gyroRawBuffer.push([s.time, s.x, s.y, s.z, sampleTotal]);
        if (typeof window.buildLiveGyroSample === 'function') {
             const cSmp = window.buildLiveGyroSample(null, s) || s;
             sampleX = cSmp.x; sampleY = cSmp.y; sampleZ = cSmp.z;
        }
        gyroBuffer.push([s.time, sampleX, sampleY, sampleZ]);
      });
    }
    if(temp)temp.forEach(s=>tempBuffer.push([s.time,s.value]));
    if(info)info.forEach(entry => {
        console.log("INFO BEKOMMEN: " + entry.type + "  " + entry.value);
        switch (entry.type) {
            case "ACCELRATE":
                accelSampleRateDD2.setValue(entry.value, true);
                window.currentSampleRate = entry.value;
                break;
            case "ACCELRANGE":
                accelRangeDD2.setValue(entry.value, true);
                break;
            case "ACCELFILTER":
                accelFilterDD2.setValue(entry.value, true);
                break;

            case "GYROFILTER":
                gyroFilterDD2.setValue(entry.value, true);
                break;
            case "GYROSAMPLERATE":
                gyroSampleRateDD2.setValue(entry.value, true);
                break;

            case "GYRORANGE":
                gyroRangeDD2.setValue(entry.value, true);
                break;
            case "TEMPSAMPLERATE":
                tempSampleRateDD2.setValue(entry.value, true);
                break;

            default:
                console.warn("Unbekannte Config-SubID");
        }
    });
  };
}
  console.log("[Main] Decode Worker gestartet");