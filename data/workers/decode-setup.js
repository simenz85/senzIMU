import { accBuffer, gyroBuffer, tempBuffer } from "../charts/liveChart.js";

export let decodeWorker=new Worker("decode-worker.js");

import { accelSampleRateDD2, accelRangeDD2, accelFilterDD2,
         gyroSampleRateDD2, gyroRangeDD2, gyroFilterDD2,
         tempSampleRateDD2 } from "../ui/ui-setup.js";

export function setupDecodeWorker(){
  decodeWorker.onmessage=(e)=>{
    const {acc,gyro,temp,info}=e.data;
    if(acc)acc.forEach(s=>accBuffer.push([s.time,s.x,s.y,s.z]));
    if(gyro)gyro.forEach(s=>gyroBuffer.push([s.time,s.x,s.y,s.z]));
    if(temp)temp.forEach(s=>tempBuffer.push([s.time,s.value]));
    if(info)info.forEach(entry => {
        console.log("INFO BEKOMMEN: " + entry.type + "  " + entry.value);
        switch (entry.type) {
            case "ACCELRATE":
                accelSampleRateDD2.setValue(entry.value, true);
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