export let wsWorker=new Worker("ws-worker.js");

export function setupWSWorker(decodeWorker){
  wsWorker.onmessage=(e)=>{
    const {type, payload, subId, value}=e.data;
    if(type==="data"){ decodeWorker.postMessage(payload,[payload]); }
    if(type==="connected") console.log("WS verbunden");
    if(type==="config"){
        if (!window.sensorConfigs) window.sensorConfigs = {};
        if (!window.sensorConfigs["192.168.4.1"]) window.sensorConfigs["192.168.4.1"] = {};
        window.sensorConfigs["192.168.4.1"][subId] = value;
    }
  }
}

export function connectWebSocket(url="ws://192.168.4.1/ws"){
  wsWorker.postMessage({type:"connect",wsServerUrl:url});
}