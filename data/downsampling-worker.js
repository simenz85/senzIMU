// downsample-worker.js

let accBuffer = [];
let gyroBuffer = [];
let tempBuffer = [];
let inputPort = null;
let fusionEnabled = true;

const TARGET_DT_US = 5000; // 200 Hz
let lastEmitUs = 0;

let fusionWorker = null;

function resetDownsamplingState() {
    accBuffer = [];
    gyroBuffer = [];
    tempBuffer = [];
    lastEmitUs = 0;
}

function handleDownsamplingMessage(msg) {
    if (!msg) {
        return;
    }

    if (msg.type === "attachInputPort") {
        inputPort = msg.port ?? null;
        if (!inputPort) {
            return;
        }

        inputPort.onmessage = (portEvent) => {
            handleDownsamplingMessage(portEvent.data);
        };

        if (typeof inputPort.start === 'function') {
            inputPort.start();
        }
        return;
    }

    if (msg.type === "setFusionEnabled") {
        fusionEnabled = Boolean(msg.enabled);
        if (!fusionEnabled) {
            resetDownsamplingState();
        }
        return;
    }

    if (msg.type === "reset") {
        resetDownsamplingState();
        return;
    }

    if (msg?.type === "init") {
        fusionWorker = msg.fusionWorker ?? null;
        return;
    }

    if (!fusionEnabled) {
        return;
    }

    if(msg.type === "batch"){
        switch(msg.sensor){
            case "acc":
                accBuffer.push(...msg.data);
                break;
            case "gyro":
                gyroBuffer.push(...msg.data);
                break;
            case "temp":
                tempBuffer.push(...msg.data);
                break;
        }
    }

    processDownsample();
}

onmessage = (e) => {
    handleDownsamplingMessage(e.data);
};

let intervalEnd, accSamples, gyroSamples, accMean, gyroMean;

function processDownsample() {
    //if (!fusionWorker) return;
    if (accBuffer.length === 0 || gyroBuffer.length === 0) return;

    // Initialisierung
    if (lastEmitUs === 0) {
        lastEmitUs = Math.min(accBuffer[0].time, gyroBuffer[0].time);
    }

    while (true) {
        intervalEnd = lastEmitUs + TARGET_DT_US;

        // Prüfen ob wir genug Samples haben
        if (accBuffer[accBuffer.length - 1].time < intervalEnd ||
            gyroBuffer[gyroBuffer.length - 1].time < intervalEnd) {
            break; // noch nicht genug Daten
        }

        // Alle Samples bis intervalEnd sammeln
        accSamples = [];
        while (accBuffer.length && accBuffer[0].time <= intervalEnd) {
            accSamples.push(accBuffer.shift());
        }
        gyroSamples = [];
        while (gyroBuffer.length && gyroBuffer[0].time <= intervalEnd) {
            gyroSamples.push(gyroBuffer.shift());
        }

        if (accSamples.length === 0 || gyroSamples.length === 0) {
            lastEmitUs += TARGET_DT_US;
            continue;
        }

        accMean = {
            x: accSamples.reduce((s, v) => s + v.x, 0) / accSamples.length,
            y: accSamples.reduce((s, v) => s + v.y, 0) / accSamples.length,
            z: accSamples.reduce((s, v) => s + v.z, 0) / accSamples.length
        };

        gyroMean = {
            x: gyroSamples.reduce((s, v) => s + v.x, 0) / gyroSamples.length,
            y: gyroSamples.reduce((s, v) => s + v.y, 0) / gyroSamples.length,
            z: gyroSamples.reduce((s, v) => s + v.z, 0) / gyroSamples.length
        };

/*         self.postMessage({
            time: intervalEnd,
            acc: accMean,
            gyro: gyroMean
        }); */


            postMessage({
        type: "packet",
        
            time: intervalEnd,
            acc: accMean,
            gyro: gyroMean
        
    });




        lastEmitUs = intervalEnd;
    }
}
