export let wsWorker=new Worker("ws-worker.js");

export function setupWSWorker(decodeWorker){
  wsWorker.onmessage=(e)=>{
    const {type,payload}=e.data;
    if(type==="data"){ decodeWorker.postMessage(payload,[payload]); }
    if(type==="connected") console.log("WS verbunden");
  }
}

export function connectWebSocket(url="ws://192.168.4.1/ws"){
  wsWorker.postMessage({type:"connect",wsServerUrl:url});
}