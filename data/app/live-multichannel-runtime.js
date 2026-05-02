import { applyCalibrationToAccel } from '../imuCalibration.js';
import { updateSharedMultiFftData, syncWaterfallRenderer } from '../ui/fft-runtime.js';
import { buildSettingsColumnForNode } from '../ui/ui-setup.js';
import { formatRuntimeMicroseconds } from '../utils/format-utils.js';

function ensureRuntimeGlobals() {
    if (!Array.isArray(window.activeSensors)) {
        window.activeSensors = [];
    }
    if (!Array.isArray(window.multiChartData)) {
        window.multiChartData = [];
    }
    if (!Array.isArray(window.multiFftData)) {
        window.multiFftData = [];
    }
}

export function createLiveMultichannelRuntime(config) {
    ensureRuntimeGlobals();

    let chartUpdateRunning = false;
    let lastChartUpdate = 0;
    let updateIntervalMs = config.initialChartUpdateIntervalMs ?? 50;

    function setupFusionPipeline() {
        const downsamplingWorker = config.getDownsamplingWorker?.();
        const fusionWorker = config.getFusionWorker?.();
        const decodeWorker = config.getDecodeWorker?.();
        if (!downsamplingWorker || !fusionWorker || !decodeWorker) {
            return;
        }

        downsamplingWorker.postMessage({ type: 'init' });
        downsamplingWorker.onmessage = (event) => {
            fusionWorker.postMessage(event.data);
        };

        fusionWorker.onmessage = (event) => {
            const message = event.data;
            if (!message || typeof message !== 'object') {
                return;
            }
            if (message.type === 'ack') {
                return;
            }
            if (message.type === 'calibrated') {
                console.info('Fusion-Kalibrierung abgeschlossen.');
                return;
            }
            if (!message.tiltHeadingRoll || !message.accWorld) {
                return;
            }

            config.setBootOverlayState?.('ready', 'Dashboard bereit', 'Sensorstream aktiv.');
            decodeWorker.postMessage({ type: 'calibdata', payload: { type: 1, quaternion: message.quaternion } });
            
            const ausrichtungArr = Array.isArray(message.quaternion) ? message.quaternion.slice() : Array.from(message.quaternion || []);
            config.setAusrichtung?.(ausrichtungArr);
            
            if (globalThis.activeSensors) {
                const mNode = globalThis.activeSensors.find(n => n.isMaster);
                if (mNode) {
                    mNode.orientationState = { 
                        quaternionXYZW: ausrichtungArr,
                        positionXYZ: message.position || null
                    };
                }
            }

            if (config.getCurrentOrientationMode?.() === 1) {
                config.syncViewportBaseQuaternion?.({ silent: true });
            }
        };
    }

    function setupWSWorker() {
        const wsWorker = config.getWsWorker?.();
        const decodeWorker = config.getDecodeWorker?.();
        if (!wsWorker || !decodeWorker) {
            return;
        }

        wsWorker.onmessage = (event) => {
            const { type, payload } = event.data;
            const telemetryState = config.getTelemetryState?.() || {};

            if (type === 'data') {
                if (payload instanceof ArrayBuffer) {
                    telemetryState.recentFrames += 1;
                    telemetryState.recentBytes += payload.byteLength || 0;
                    config.renderTelemetry?.();
                    config.clearBootOverlayReadyTimer?.();
                    config.setBootOverlayState?.('ready', 'Dashboard bereit', 'Sensordaten empfangen.');
                    decodeWorker.postMessage(payload, [payload]);
                }
            } else if (type === 'connected') {
                console.log('WebSocket verbunden.', payload?.url || '');
                config.updateTelemetry?.({ wsState: 'verbunden' });
                config.setBootOverlayState?.(
                    'loading',
                    'WebSocket verbunden',
                    payload?.url ? `Sensordaten werden initialisiert. ${payload.url}` : 'Sensordaten werden initialisiert.'
                );
                config.scheduleBootOverlayReadyFallback?.();
            } else if (type === 'espStats') {
                if (payload && payload.syncedEspTime !== undefined) {
                    decodeWorker.postMessage({ type: 'time_sync', payload: payload.syncedEspTime });
                }
                config.updateTelemetry?.({
                    activeClients: payload?.activeClients ?? telemetryState.activeClients,
                    sensorPackets: payload?.sensorPackets ?? telemetryState.sensorPackets,
                    wsErrors: payload?.wsSendErrors ?? telemetryState.wsErrors,
                    frameLimitPackets: payload?.frameLimitPackets ?? telemetryState.frameLimitPackets,
                    inflightWs: payload?.inflightWs ?? telemetryState.inflightWs,
                    cpuLoad: payload?.cpuLoadPct ?? telemetryState.cpuLoad,
                    cpuTemp: payload?.cpuTempC ?? telemetryState.cpuTemp,
                    freeHeap: payload?.freeHeap ?? telemetryState.freeHeap,
                    minHeap: payload?.minFreeHeap ?? telemetryState.minHeap,
                    largestHeap: payload?.largestHeapBlock ?? telemetryState.largestHeap,
                    psramAvailable: Boolean(payload?.psramAvailable ?? telemetryState.psramAvailable),
                    psramTotal: payload?.psramTotal ?? telemetryState.psramTotal,
                    freePsram: payload?.freePsram ?? telemetryState.freePsram,
                    minPsram: payload?.minFreePsram ?? telemetryState.minPsram,
                    largestPsram: payload?.largestPsramBlock ?? telemetryState.largestPsram,
                    drops: payload?.streamDroppedBytes ?? telemetryState.drops,
                    backlogPeak: payload?.streamBacklogPeak ?? telemetryState.backlogPeak,
                });
            } else if (type === 'workerStats') {
                if (typeof payload?.forwardedBinaryFrames === 'number') {
                    config.updateTelemetry?.({ framesPerSecond: payload.forwardedBinaryFrames });
                }
            } else if (type === 'node_registered') {
                console.log('Neuer Node registriert, lade Kanäle neu:', payload);
                if (typeof window.discoverNodes === 'function') {
                    window.discoverNodes();
                }
            } else if (type === 'closed') {
                config.clearBootOverlayReadyTimer?.();
                console.warn('WebSocket getrennt.', payload || '');
                config.updateTelemetry?.({ wsState: 'getrennt', activeClients: 0 });
                const closeHint = payload?.url
                    ? `${payload.url} (code=${payload.code ?? 'n/a'}${payload?.reason ? `, reason=${payload.reason}` : ''})`
                    : 'Verbindung zum ESP wird erneut aufgebaut.';
                config.setBootOverlayState?.('loading', 'WebSocket getrennt', closeHint);
            } else if (type === 'error') {
                config.clearBootOverlayReadyTimer?.();
                console.error('WebSocket-Fehler:', payload);
                config.updateTelemetry?.({ wsState: 'fehler' });
                const errorHint = typeof payload === 'string'
                    ? payload
                    : [payload?.message, payload?.url, payload?.readyState != null ? `readyState=${payload.readyState}` : null]
                        .filter(Boolean)
                        .join(' | ');
                config.setBootOverlayState?.('loading', 'WebSocket-Fehler', errorHint || 'Verbindung zum ESP fehlgeschlagen.');
            }
        };
    }

    function startChartUpdates() {
        function updateLoop(now) {
            if (!chartUpdateRunning) {
                return;
            }
            if (window.isOfflineReplayMode) {
                requestAnimationFrame(updateLoop);
                return;
            }

            if (now - lastChartUpdate >= updateIntervalMs) {
                config.updateDashboard?.();
                lastChartUpdate = now;
            }

            requestAnimationFrame(updateLoop);
        }

        chartUpdateRunning = true;
        lastChartUpdate = performance.now();
        requestAnimationFrame(updateLoop);
    }

    function stopChartUpdates() {
        chartUpdateRunning = false;
    }

    function setChartUpdateInterval(nextIntervalMs) {
        if (Number.isFinite(nextIntervalMs) && nextIntervalMs > 0) {
            updateIntervalMs = nextIntervalMs;
        }
    }

    function processSensorBatch(data, channelIndex = 0, nodeDef = null) {
        const { acc, gyro, temp, info, acccalib, accraw, gyroraw, gyrocalib } = data;
        const motionWorker = config.getMotionWorker?.();
        const downsamplingWorker = config.getDownsamplingWorker?.();
        const accRawBuffer = config.getAccRawBuffer?.();
        const gyroRawBuffer = config.getGyroRawBuffer?.();
        const accBufferCalib = config.getAccBufferCalib?.();
        const gyroBufferCalib = config.getGyroBufferCalib?.();
        const accBuffer = config.getAccBuffer?.();
        const gyroBuffer = config.getGyroBuffer?.();
        const tempBuffer = config.getTempBuffer?.();

        if (config.isMotionViewEnabled?.() && ((accraw && accraw.length > 0) || (gyroraw && gyroraw.length > 0))) {
            const motionAccSamples = Array.isArray(accraw) && accraw.length > 0
                ? accraw.map((sample, index) => config.buildMotionAccelerationSample?.(sample, acc?.[index]) || acc?.[index] || sample)
                : (Array.isArray(acc) ? acc.map((sample) => config.buildMotionAccelerationSample?.(sample, sample) || sample) : []);
            motionWorker?.postMessage({
                type: 'batch',
                payload: {
                    acc: motionAccSamples,
                    gyro: Array.isArray(gyroraw) ? gyroraw : [],
                },
            });
        }

        if (accraw && accraw.length > 0) {
            if (config.isFusionPipelineEnabled?.()) {
                downsamplingWorker?.postMessage({
                    type: 'batch',
                    sensor: 'acc',
                    data: accraw.map(sample => ({ x: sample.x, y: sample.y, z: sample.z, time: sample.time })),
                });
            }

            for (const sample of accraw) {
                const totalAcc = Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
                accRawBuffer?.push([sample.time, sample.x, sample.y, sample.z, totalAcc]);

                if (window.sonificationEnabled) {
                    const totalVibration = totalAcc;
                    window.audioHighPass = 0.995 * (window.audioHighPass + totalVibration - window.audioPrevZ);
                    window.audioPrevZ = totalVibration;
                    let out = window.audioHighPass / 50.0;
                    if (out > 1.0) out = 1.0;
                    else if (out < -1.0) out = -1.0;
                    window.audioRingBuffer[window.audioWriteIdx] = out;
                    window.audioWriteIdx = (window.audioWriteIdx + 1) % window.audioRingBuffer.length;
                }

                if (config.isReferenceCaptureActive?.()) {
                    accBufferCalib?.push([sample.x, sample.y, sample.z]);
                }
            }
        }

        if (gyroraw && gyroraw.length > 0) {
            if (config.isFusionPipelineEnabled?.()) {
                downsamplingWorker?.postMessage({
                    type: 'batch',
                    sensor: 'gyro',
                    data: gyroraw.map(sample => ({ x: sample.x, y: sample.y, z: sample.z, time: sample.time })),
                });
            }

            for (const sample of gyroraw) {
                gyroRawBuffer?.push([sample.time, sample.x, sample.y, sample.z]);
                if (config.isReferenceCaptureActive?.()) {
                    gyroBufferCalib?.push([sample.x, sample.y, sample.z]);
                }
            }
        }

        if (gyrocalib && gyrocalib.length > 0 && config.isWorldSimpleGyroCaptureActive?.()) {
            for (const sample of gyrocalib) {
                gyroBufferCalib?.push([sample.x, sample.y, sample.z]);
            }
        }

        if (acccalib && acccalib.length > 0) {
            for (const sample of acccalib) {
                accBufferCalib?.push([sample.x, sample.y, sample.z]);
            }
        }

        if (acc && acc.length > 0) {
            const batchTimes = new Float64Array(acc.length);
            const batchXs = new Float32Array(acc.length);
            const batchYs = new Float32Array(acc.length);
            const batchZs = new Float32Array(acc.length);
            const batchTotals = new Float32Array(acc.length);

            if (window.insertIntoMultiChart && window.activeSensors && window.activeSensors.length > 0) {
                window.insertIntoMultiChart(channelIndex, acc);
            }

            const targetBuffer = (nodeDef && nodeDef.accBuffer) ? nodeDef.accBuffer : accBuffer;
            for (let index = 0; index < acc.length; index++) {
                const sample = config.buildLiveAccelerationSample?.(accraw?.[index], acc[index]) || acc[index];
                targetBuffer?.push([sample.time, sample.x, sample.y, sample.z, sample.total]);
                batchTimes[index] = sample.time;
                batchXs[index] = sample.x;
                batchYs[index] = sample.y;
                batchZs[index] = sample.z;
                batchTotals[index] = sample.total;

                window.feedImpactTestData?.(sample.x, sample.y, sample.z, sample.time);

                if (config.isRecording?.()) {
                    config.getRecordedAccRows?.()?.push(config.createAccRecordingRow?.(sample));
                    if ((config.getRecordedAccRows?.()?.length || 0) >= config.maxRecordedRows) {
                        console.log('Max rows reached (ACC). Triggering intermediate download.');
                        config.downloadRecordedCsv?.(true);
                    }
                }
            }

            if (config.isAccFilterEnabled?.()) {
                config.dispatchStreamingFilterBatch?.('acc', {
                    times: batchTimes,
                    xs: batchXs,
                    ys: batchYs,
                    zs: batchZs,
                    totals: batchTotals,
                });
            }
        }

        if (gyro && gyro.length > 0) {
            const batchTimes = new Float64Array(gyro.length);
            const batchXs = new Float32Array(gyro.length);
            const batchYs = new Float32Array(gyro.length);
            const batchZs = new Float32Array(gyro.length);

            for (let index = 0; index < gyro.length; index++) {
                const sample = config.buildLiveGyroSample?.(gyroraw?.[index], gyro[index]) || gyro[index];
                const targetGyroBuffer = (nodeDef && nodeDef.gyroBuffer) ? nodeDef.gyroBuffer : config.getGyroBuffer?.();
                targetGyroBuffer?.push([sample.time, sample.x, sample.y, sample.z]);
                batchTimes[index] = sample.time;
                batchXs[index] = sample.x;
                batchYs[index] = sample.y;
                batchZs[index] = sample.z;

                if (config.isRecording?.()) {
                    config.getRecordedGyroRows?.()?.push(config.createGyroRecordingRow?.(sample));
                    if ((config.getRecordedGyroRows?.()?.length || 0) >= config.maxRecordedRows) {
                        console.log('Max rows reached (GYRO). Triggering intermediate download.');
                        config.downloadRecordedCsv?.(true);
                    }
                }
            }

            if (config.isGyroFilterEnabled?.()) {
                config.dispatchStreamingFilterBatch?.('gyro', {
                    times: batchTimes,
                    xs: batchXs,
                    ys: batchYs,
                    zs: batchZs,
                });
            }
        }

        if (temp && temp.length > 0) {
            for (const sample of temp) {
                tempBuffer?.push([sample.time, sample.value]);
            }
        }

        if (info && info.length > 0) {
            const dropdowns = config.getDropdownRefs?.() || {};
            info.forEach((entry) => {
                console.log('INFO BEKOMMEN: ' + entry.type + '  ' + entry.value);
                switch (entry.type) {
                    case 'ACCELRATE':
                        dropdowns.accelSampleRateDD2?.setValue(entry.value, true);
                        break;
                    case 'ACCELRANGE':
                        dropdowns.accelRangeDD2?.setValue(entry.value, true);
                        break;
                    case 'ACCELFILTER':
                        dropdowns.accelFilterDD2?.setValue(entry.value, true);
                        break;
                    case 'GYROFILTER':
                        dropdowns.gyroFilterDD2?.setValue(entry.value, true);
                        break;
                    case 'GYROSAMPLERATE':
                        dropdowns.gyroSampleRateDD2?.setValue(entry.value, true);
                        break;
                    case 'GYRORANGE':
                        dropdowns.gyroRangeDD2?.setValue(entry.value, true);
                        break;
                    case 'TEMPSAMPLERATE':
                        dropdowns.tempSampleRateDD2?.setValue(entry.value, true);
                        break;
                    default:
                        console.warn('Unbekannte Config-SubID');
                }
            });
        }
    }

    function setupDecodeWorker() {
        const decodeWorker = config.getDecodeWorker?.();
        if (!decodeWorker) {
            return;
        }

        decodeWorker.onmessage = (event) => {
            processSensorBatch(event.data);
        };
    }

    function setGyroFftSensorCount(n) {
        const gyroFftPlot = config.getGyroFftPlot?.();
        const UPlotCtor = globalThis.uPlot;
        if (!gyroFftPlot || !UPlotCtor) {
            return;
        }

        const baseColors = [
            { max: 'rgba(200,210,223,0.08)', avg: '#FFD600', cur: 'rgba(122,187,255,0.45)' }, // CH1
            { max: 'rgba(77,166,255,0.08)',  avg: '#4da6ff', cur: 'rgba(77,166,255,0.45)' },  // CH2
            { max: 'rgba(0,255,0,0.08)',     avg: '#50c878', cur: 'rgba(80,200,120,0.45)' },  // CH3
            { max: 'rgba(224,64,251,0.08)',  avg: '#e040fb', cur: 'rgba(224,64,251,0.45)' },  // CH4
        ];

        const newSeries = [{ label: 'Freq (Hz)' }];
        for (let index = 0; index < n; index++) {
            const colorSet = baseColors[index % 4];
            const valFormatter = (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--');
            newSeries.push({ label: `CH${index + 1} Max`, stroke: null, width: 0, fill: colorSet.max, points: { show: false }, value: valFormatter });
            newSeries.push({ label: `CH${index + 1} Avg`, stroke: colorSet.avg, width: 2, fill: colorSet.avg.replace(')', ', 0.3)').replace('rgb', 'rgba'), points: { show: false }, value: valFormatter });
            newSeries.push({ label: `CH${index + 1} Live`, stroke: colorSet.cur, width: 1, points: { show: false }, value: valFormatter });
        }

        const nextOptions = {
            title: 'Gyro FFT Multi-Channel',
            width: gyroFftPlot.width,
            height: gyroFftPlot.height,
            scales: { x: { time: false }, y: { auto: true } },
            axes: [
                { scale: 'x', label: 'Hz' },
                { scale: 'y', label: 'Mag' },
            ],
            series: newSeries,
            legend: { mount: (u, table) => { document.getElementById('gyroFftChartLegendHost')?.replaceChildren(table); } },
        };

        const parent = gyroFftPlot.root.parentNode;
        gyroFftPlot.destroy();
        const nextPlot = new UPlotCtor(nextOptions, Array(n * 3 + 1).fill().map(() => []), parent);
        config.setGyroFftPlot?.(nextPlot);
    }

    function setFftSensorCount(n) {
        const fftPlot = config.getFftPlot?.();
        const UPlotCtor = globalThis.uPlot;
        if (!fftPlot || !UPlotCtor) {
            return;
        }

        const baseColors = [
            { max: 'rgba(200,210,223,0.08)', avg: '#FFD600', cur: 'rgba(122,187,255,0.45)' }, // CH1
            { max: 'rgba(77,166,255,0.08)',  avg: '#4da6ff', cur: 'rgba(77,166,255,0.45)' },  // CH2
            { max: 'rgba(0,255,0,0.08)',     avg: '#50c878', cur: 'rgba(80,200,120,0.45)' },  // CH3
            { max: 'rgba(224,64,251,0.08)',  avg: '#e040fb', cur: 'rgba(224,64,251,0.45)' },  // CH4
        ];

        const newSeries = [{ label: 'Freq (Hz)' }];
        for (let index = 0; index < n; index++) {
            const colorSet = baseColors[index % 4];
            const valFormatter = (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--');
            newSeries.push({ label: `CH${index + 1} Max`, stroke: null, width: 0, fill: colorSet.max, points: { show: false }, value: valFormatter });
            newSeries.push({ label: `CH${index + 1} Avg`, stroke: colorSet.avg, width: 2, fill: colorSet.avg.replace(')', ', 0.3)').replace('rgb', 'rgba'), points: { show: false }, value: valFormatter });
            newSeries.push({ label: `CH${index + 1} Live`, stroke: colorSet.cur, width: 1, points: { show: false }, value: valFormatter });
        }

        const nextOptions = {
            title: 'ACC FFT Multi-Channel',
            width: fftPlot.width,
            height: fftPlot.height,
            scales: { 
                x: { time: false }, 
                y: { 
                    range: (u, min, max) => [0, Math.max(500, (max == null ? 500 : max * 1.1))] 
                } 
            },
            axes: [
                { scale: 'x', label: 'Hz' },
                { scale: 'y', label: 'Mag' },
            ],
            series: newSeries,
            legend: { mount: (u, table) => { document.getElementById('fftChartLegendHost')?.replaceChildren(table); } },
        };

        const parent = fftPlot.root.parentNode;
        fftPlot.destroy();
        const nextPlot = new UPlotCtor(nextOptions, Array(n * 3 + 1).fill().map(() => []), parent);
        config.setFftPlot?.(nextPlot);
    }

    function setRmsSensorCount(n) {
        const rmsPlot = config.getRmsPlot?.();
        const UPlotCtor = globalThis.uPlot;
        if (!rmsPlot || !UPlotCtor) {
            return;
        }

        const baseColors = [
            { x: '#FFD600', y: '#ec3030ff', z: '#7ABBFFff', max: '#14c53bff', maxFill: 'rgba(20,197,59,0.2)' },   // CH1 (Z=hellblau)
            { x: '#997A00', y: '#8C1C1Cff', z: '#3D6FCCff', max: '#0B7523ff', maxFill: 'rgba(11,117,35,0.2)' },   // CH2: CH1 ~60%
            { x: '#50c878', y: '#81c784',   z: '#2e8b57',   max: '#32cd32',   maxFill: 'rgba(50,205,50,0.2)' },   // CH3
            { x: '#e040fb', y: '#ea80fc',   z: '#aa00ff',   max: '#d500f9',   maxFill: 'rgba(213,0,249,0.2)' },   // CH4
        ];

        const newSeries = [{ label: 'Zeit', value: (u, value) => formatRuntimeMicroseconds(value, 2) }];
        for (let index = 0; index < n; index++) {
            const colorSet = baseColors[index % 4];
            newSeries.push({ label: `CH${index + 1} X (mg)`, stroke: colorSet.x, points: { show: false } });
            newSeries.push({ label: `CH${index + 1} Y (mg)`, stroke: colorSet.y, points: { show: false } });
            newSeries.push({ label: `CH${index + 1} Z (mg)`, stroke: colorSet.z, points: { show: false } });
            newSeries.push({ label: `CH${index + 1} Total`, stroke: colorSet.max, fill: colorSet.maxFill, points: { show: false } });
        }

        const nextOptions = {
            ...rmsPlot.opts,
            title: 'ACC RMS Multi-Channel',
            series: newSeries,
        };

        const parent = rmsPlot.root.parentNode;
        rmsPlot.destroy();
        const nextPlot = new UPlotCtor(nextOptions, Array(n * 4 + 1).fill().map(() => []), parent);
        config.setRmsPlot?.(nextPlot);
    }

    class SensorNode {
        constructor(nodeInfo, channelIndex) {
            const normalizedNode = typeof nodeInfo === 'string' ? { ip: nodeInfo, mac: '', isMaster: false } : (nodeInfo || {});
            this.ip = normalizedNode.ip || '';
            this.mac = normalizedNode.mac || '';
            this.sensorId = this.mac || this.ip;
            this.isMaster = Boolean(normalizedNode.isMaster);
            this.channelIndex = channelIndex;
            this.gravityCutEnabled = false;
            this.orientationMode = 0;
            this.calibrationState = null;
            this.referenceSampleData = [];

            const MultiRingBuffer2Ref = config.MultiRingBuffer2 || globalThis.MultiRingBuffer2;
            const MultiRingBufferRef = globalThis.MultiRingBuffer;
            if (typeof MultiRingBuffer2Ref !== 'undefined') {
                this.accBuffer = new MultiRingBuffer2Ref([Float64Array, Float32Array, Float32Array, Float32Array, Float32Array], 12000, ['time', 'x', 'y', 'z', 'total']);
                this.rmsBuffer = new MultiRingBuffer2Ref([Float64Array, Float32Array, Float32Array, Float32Array, Float32Array], 20000, ['time', 'x', 'y', 'z', 'total']);
                this.gyroBuffer = new MultiRingBuffer2Ref([Float64Array, Float32Array, Float32Array, Float32Array], 12000, ['time', 'x', 'y', 'z']);
            } else if (typeof MultiRingBufferRef !== 'undefined') {
                this.accBuffer = new MultiRingBufferRef(12000);
            }

            this.fftMaxBuffer = [];
            this.avgFftBuffer = [];
            this.gyroFftMaxBuffer = [];
            this.gyroAvgFftBuffer = [];

            this.decodeWorker = new Worker('decode-worker2.js');
            this.wsWorker = new Worker('ws-worker.js');
            this.fftWorker = new Worker('fft-worker.js');
            this.rmsWorker = new Worker('rms-worker.js');
            this.gyroFftWorker = new Worker('fft-worker.js');

            console.log(`[SensorNode] CH${channelIndex + 1} Pipeline (Decoding, Websocket, FFT, RMS) initialisiert auf ${this.sensorId}`);

            this.fftWorker.onmessage = (event) => {
                const { freqs, mags } = event.data;
                if (!freqs || !mags) {
                    return;
                }

                config.bufferFFTResult?.(mags, this.fftMaxBuffer, config.fftRingSize);
                const maxValues = config.computeMaxFFTValues?.(this.fftMaxBuffer);
                config.bufferAverageFFT?.(mags, this.avgFftBuffer, config.averageCount);
                const meanValues = config.computeAverageFFT?.(this.avgFftBuffer);

                updateSharedMultiFftData({
                    multiFftData: window.multiFftData,
                    freqs,
                    maxValues,
                    meanValues,
                    magnitudes: mags,
                    channelIndex: this.channelIndex,
                });

                window.latestWaterfallMags = window.latestWaterfallMags || [];
                window.latestWaterfallMags[this.channelIndex] = mags;

                const primaryActiveIndex = window.activeSensors.findIndex(node => !node.isHiddenFromUI && !node.wasDisconnected);
                const driveIndex = primaryActiveIndex !== -1 ? primaryActiveIndex : 0;

                if (this.channelIndex === driveIndex && window.waterfallRenderer) {
                    let combinedMags = window.activeSensors
                        .map((node, i) => (!node.isHiddenFromUI && !node.wasDisconnected) ? (window.latestWaterfallMags[i] || new Float32Array(mags.length)) : null)
                        .filter(mag => mag !== null);

                    if (combinedMags.length === 0) {
                        combinedMags = [new Float32Array(mags.length)];
                    }

                    if (window.waterfallRenderer._lastChannelCount !== undefined && window.waterfallRenderer._lastChannelCount !== combinedMags.length) {
                        window.waterfallRenderer.clear();
                    }
                    window.waterfallRenderer._lastChannelCount = combinedMags.length;

                    syncWaterfallRenderer({
                         renderer: window.waterfallRenderer,
                         maxHzInputId: 'waterfallMaxHz',
                         maxFreq: Math.max(...freqs),
                         magnitudes: combinedMags,
                         timestamp: event.data.timestamp,
                         timeString: event.data.timeString,
                         clockTimeStr: event.data.clockTimeStr,
                         lastMaxWindowKey: 'waterfallLastMax',
                         labelMaxId: 'wfLblMax',
                         labelMidId: 'wfLblMid',
                    });
                }
            };

            this.rmsWorker.onmessage = (event) => {
                if (config.isRmsPaused?.() || !this.rmsBuffer) {
                    return;
                }
                const { rmsX, rmsY, rmsZ, rmsTotal, time } = event.data;
                this.rmsBuffer.push([time, rmsX, rmsY, rmsZ, rmsTotal]);
            };

            this.gyroFftWorker.onmessage = (event) => {
                const { freqs, mags } = event.data;
                if (!freqs || !mags) {
                    return;
                }

                config.bufferFFTResult?.(mags, this.gyroFftMaxBuffer, config.gyroFftRingSize || 20);
                const maxValues = config.computeMaxFFTValues?.(this.gyroFftMaxBuffer);
                config.bufferAverageFFT?.(mags, this.gyroAvgFftBuffer, config.gyroAverageCount || 10);
                const meanValues = config.computeAverageFFT?.(this.gyroAvgFftBuffer);

                updateSharedMultiFftData({
                    multiFftData: window.multiGyroFftData,
                    freqs,
                    maxValues,
                    meanValues,
                    magnitudes: mags,
                    channelIndex: this.channelIndex,
                });

                window.latestGyroWaterfallMags = window.latestGyroWaterfallMags || [];
                window.latestGyroWaterfallMags[this.channelIndex] = mags;

                const primaryActiveIndex = window.activeSensors.findIndex(node => !node.isHiddenFromUI && !node.wasDisconnected);
                const driveIndex = primaryActiveIndex !== -1 ? primaryActiveIndex : 0;

                if (this.channelIndex === driveIndex && window.gyroWaterfallRenderer) {
                    let combinedGyroMags = window.activeSensors
                        .map((node, i) => (!node.isHiddenFromUI && !node.wasDisconnected) ? (window.latestGyroWaterfallMags[i] || new Float32Array(mags.length)) : null)
                        .filter(mag => mag !== null);

                    if (combinedGyroMags.length === 0) {
                        combinedGyroMags = [new Float32Array(mags.length)];
                    }

                    if (window.gyroWaterfallRenderer._lastChannelCount !== undefined && window.gyroWaterfallRenderer._lastChannelCount !== combinedGyroMags.length) {
                        window.gyroWaterfallRenderer.clear();
                    }
                    window.gyroWaterfallRenderer._lastChannelCount = combinedGyroMags.length;

                    syncWaterfallRenderer({
                         renderer: window.gyroWaterfallRenderer,
                         maxHzInputId: 'gyroWaterfallMaxHz',
                         maxFreq: Math.max(...freqs),
                         magnitudes: combinedGyroMags,
                         timestamp: event.data.timestamp,
                         timeString: event.data.timeString,
                         clockTimeStr: event.data.clockTimeStr,
                         lastMaxWindowKey: 'gyroWaterfallLastMax',
                         labelMaxId: 'gwfLblMax',
                         labelMidId: 'gwfLblMid',
                    });
                }
            };
        }

        connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = `${protocol}//${this.ip}/ws`;
            console.log(`[SensorNode CH${this.channelIndex + 1}] Verbinde zu: ${url}`);

            this.wsWorker.postMessage({ type: 'connect', wsServerUrl: url });

            this.wsWorker.onmessage = (event) => {
                const { type, payload, subId, value } = event.data;
                
                if (type === 'data' || type === 'espStats') {
                    this.lastDataMs = performance.now();
                }

                if (type === 'data' && payload instanceof ArrayBuffer) {
                    if (window.incrementTelemetryNodeFrames) {
                        window.incrementTelemetryNodeFrames(this.channelIndex, payload.byteLength || 0);
                    }
                    this.decodeWorker.postMessage(payload, [payload]);
                } else if (type === 'config') {
                    if (!window.sensorConfigs) window.sensorConfigs = {};
                    if (!window.sensorConfigs[this.sensorId]) window.sensorConfigs[this.sensorId] = {};
                    window.sensorConfigs[this.sensorId][subId] = value;
                    console.log(`[SensorNode CH${this.channelIndex + 1}] Config empfangen (${this.sensorId}): ${subId}=${value}`);
                } else if (type === 'espStats') {
                    if (payload && payload.syncedEspTime !== undefined) {
                        this.decodeWorker.postMessage({ type: 'time_sync', payload: payload.syncedEspTime });
                    }
                    if (window.updateTelemetryNode) {
                        window.updateTelemetryNode(this.channelIndex, payload);
                    }
                } else if (type === 'connected') {
                    console.log(`[SensorNode CH${this.channelIndex + 1}] Websocket verbunden an ${this.ip}`);
                    if (window.updateTelemetryNodeWsState) {
                        window.updateTelemetryNodeWsState(this.channelIndex, 'verbunden');
                    }
                } else if (type === 'error' || type === 'closed') {
                    console.warn(`[SensorNode CH${this.channelIndex + 1}] Websocket Error/Closed:`, event.data);
                    if (window.updateTelemetryNodeWsState) {
                        window.updateTelemetryNodeWsState(this.channelIndex, type === 'error' ? 'fehler' : 'getrennt');
                    }
                }
            };

            this.decodeWorker.onmessage = (event) => {
                const { acc, acccalib, gyro, gyrocalib } = event.data;
                const accBufferCalib = config.getAccBufferCalib?.();
                const gyroBufferCalib = config.getGyroBufferCalib?.();
                if (!acc || acc.length === 0) {
                    if (Math.random() < 0.05) {
                        console.warn(`[SensorNode CH${this.channelIndex + 1}] Decoder lieferte leeres ACC Array`);
                    }
                }

                if (acccalib && acccalib.length > 0) {
                    for (const sample of acccalib) {
                        accBufferCalib?.push([sample.x, sample.y, sample.z]);
                    }
                }
                
                if (gyrocalib && gyrocalib.length > 0) {
                    for (const sample of gyrocalib) {
                        if (gyroBufferCalib) gyroBufferCalib.push([sample.x, sample.y, sample.z]);
                    }
                }

                if (acc && acc.length > 0) {
                    if (window.insertIntoMultiChart) {
                        window.insertIntoMultiChart(this.channelIndex, acc);
                    }

                    if (this.accBuffer) {
                        for (let index = 0; index < acc.length; index++) {
                            let sample = acc[index];
                            sample = config.buildNodeAccelerationSample?.(sample, this) || (window.buildNodeAccelerationSample ? window.buildNodeAccelerationSample(sample, this) : sample);
                            const total = sample.total || Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
                            this.accBuffer.push([sample.time, sample.x, sample.y, sample.z, total]);
                        }
                    }
                }

                if (gyro && gyro.length > 0) {
                    if (this.gyroBuffer) {
                        for (let index = 0; index < gyro.length; index++) {
                            let sample = gyro[index];
                            sample = config.buildLiveGyroSample?.(sample, sample) || sample;
                            this.gyroBuffer.push([sample.time, sample.x, sample.y, sample.z]);
                        }
                    }
                }
            };
        }
    }

    function getNodeByIp(ip) {
        return window.activeSensors ? window.activeSensors.find(node => node.ip === ip) : null;
    }

    function setNodeOrientationMode(ip, mode) {
        const node = getNodeByIp(ip);
        if (!node) {
            return;
        }

        node.orientationMode = mode;
        console.log(`[Node ${ip}] Orientation = ${mode}`);
        if (node.isMaster && typeof window.setOrientationMode === 'function') {
            window.setOrientationMode(mode);
        }
    }

    function toggleNodeGravityCut(ip) {
        const node = getNodeByIp(ip);
        if (!node) {
            return false;
        }

        node.gravityCutEnabled = !node.gravityCutEnabled;
        console.log(`[Node ${ip}] Gravity Cut = ${node.gravityCutEnabled}`);
        if (node.isMaster && typeof window.setGravityCutEnabled === 'function') {
            window.setGravityCutEnabled(node.gravityCutEnabled);
        }
        return node.gravityCutEnabled;
    }

    function openNodeCalibrationPopup(ip) {
        const node = getNodeByIp(ip);
        if (!node) {
            return;
        }

        window.pendingCalibrationIp = ip;
        config.openPopup?.();

        const popupTitle = document.querySelector('.popup-header h2');
        if (popupTitle) {
            popupTitle.innerText = `Sensorkalibrierung (${ip})`;
        }
    }

    function buildNodeAccelerationSample(raw, node) {
        if (!raw) {
            return null;
        }
        if (node.isMaster && typeof config.buildLiveAccelerationSample === 'function') {
            return config.buildLiveAccelerationSample(null, raw) || raw;
        }

        const calibrated = { time: raw.time, x: raw.x, y: raw.y, z: raw.z, total: raw.total };
        if (node.calibrationState && node.calibrationState.scale) {
            calibrated.x *= node.calibrationState.scale;
            calibrated.y *= node.calibrationState.scale;
            calibrated.z *= node.calibrationState.scale;
        }

        if (node.orientationMode !== 0 && node.calibrationState && node.calibrationState.quat) {
            const rotated = applyCalibrationToAccel(raw, node.calibrationState.quat);
            calibrated.x = rotated[0];
            calibrated.y = rotated[1];
            calibrated.z = rotated[2];
        }

        if (node.gravityCutEnabled) {
            calibrated.z -= 1000.0;
        }

        calibrated.total = Math.sqrt(calibrated.x * calibrated.x + calibrated.y * calibrated.y + calibrated.z * calibrated.z);
        return calibrated;
    }

    async function discoverNodes() {
        const nodesList = document.getElementById('nodesList');
        if (!nodesList) {
            return;
        }

        try {
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
            let apiHost = window.location.hostname;
            if (!apiHost || apiHost === 'localhost' || apiHost === '127.0.0.1') {
                apiHost = '192.168.4.1';
            }

            const response = await fetch(`${protocol}//${apiHost}/api/nodes`);
            const rawNodes = await response.json();
            const nodes = Array.isArray(rawNodes)
                ? rawNodes.map((entry, index) => {
                    if (typeof entry === 'string') {
                        return { ip: entry, mac: '', isMaster: index === 0 };
                    }
                    return {
                        ip: entry?.ip || '',
                        mac: entry?.mac || '',
                        isMaster: Boolean(entry?.isMaster),
                    };
                }).filter(node => node.ip)
                : [];

            nodesList.innerHTML = '';

            if (window.activeSensors) {
                window.activeSensors.forEach((node) => {
                    if (node.isMaster) return; // Globale Master-Worker NICHT zerstören!
                    
                    if (node.wsWorker) {
                        node.wsWorker.postMessage({ type: 'disconnect' });
                        node.wsWorker.terminate();
                    }
                    node.decodeWorker?.terminate();
                    node.fftWorker?.terminate();
                    node.rmsWorker?.terminate();
                    node.gyroFftWorker?.terminate();
                    node.gyroRmsWorker?.terminate();
                });
            }
            window.activeSensors = [];

            const settingsTargetSelect = document.getElementById('settingsSensorTarget');
            const sensorTabsContainer = document.getElementById('sensorTabsContainer');
            const multiNodeSettingsHost = document.getElementById('multiNodeSettingsHost');
            if (settingsTargetSelect) settingsTargetSelect.innerHTML = '';
            if (sensorTabsContainer) sensorTabsContainer.innerHTML = '';
            if (multiNodeSettingsHost) multiNodeSettingsHost.innerHTML = '';

            nodes.forEach((nodeInfo, index) => {
                const nodeIp = nodeInfo.ip;
                const nodeMac = nodeInfo.mac || '';
                const isMasterNode = Boolean(nodeInfo.isMaster);
                const channelName = isMasterNode ? 'CH1 (Master)' : `CH${index + 1}`;
                const tabColor = ['#FFD600', '#4da6ff', '#50c878', '#e040fb'][index % 4];

                if (typeof buildSettingsColumnForNode === 'function') {
                    buildSettingsColumnForNode(nodeIp, channelName, tabColor, nodeMac);
                }

                if (settingsTargetSelect) {
                    const option = document.createElement('option');
                    option.value = nodeIp;
                    option.textContent = channelName;
                    option.dataset.sensorMac = nodeMac;
                    settingsTargetSelect.appendChild(option);
                }

                if (sensorTabsContainer) {
                    const tabButton = document.createElement('button');
                    tabButton.textContent = channelName;
                    tabButton.dataset.ip = nodeIp;
                    tabButton.style.flex = '1';
                    tabButton.style.padding = '6px 2px';
                    tabButton.style.border = 'none';
                    tabButton.style.borderRadius = '4px';
                    tabButton.style.cursor = 'pointer';
                    tabButton.style.fontWeight = 'bold';
                    tabButton.style.fontSize = '0.75rem';
                    tabButton.style.transition = 'all 0.2s';

                    if (index === 0) {
                        tabButton.style.background = tabColor;
                        tabButton.style.color = '#000';
                        tabButton.classList.add('active-sensor-tab');
                    } else {
                        tabButton.style.background = 'transparent';
                        tabButton.style.color = tabColor;
                        tabButton.style.border = `1px solid ${tabColor}`;
                        tabButton.classList.remove('active-sensor-tab');
                    }

                    tabButton.addEventListener('click', () => {
                        Array.from(sensorTabsContainer.children).forEach((button) => {
                            const buttonColor = button.style.color === 'rgb(0, 0, 0)' ? button.style.background : button.style.borderColor;
                            button.style.background = 'transparent';
                            button.style.color = buttonColor;
                            button.style.border = `1px solid ${buttonColor}`;
                            button.classList.remove('active-sensor-tab');
                        });
                        tabButton.style.background = tabColor;
                        tabButton.style.color = '#000';
                        tabButton.style.border = 'none';
                        tabButton.classList.add('active-sensor-tab');

                        if (settingsTargetSelect) {
                            settingsTargetSelect.value = nodeIp;
                            settingsTargetSelect.dispatchEvent(new Event('change'));
                        }
                    });

                    sensorTabsContainer.appendChild(tabButton);
                }

                const infoRow = document.createElement('div');
                infoRow.style.padding = '4px 8px';
                infoRow.style.background = 'rgba(255,255,255,0.05)';
                infoRow.style.borderRadius = '4px';
                infoRow.style.display = 'flex';
                infoRow.style.justifyContent = 'space-between';
                infoRow.style.alignItems = 'center';

                const color = ['#FFD600', '#4da6ff', '#50c878', '#e040fb'][index % 4];
                infoRow.innerHTML = `
                <span style="color:${color}; font-weight:bold;">CH ${index + 1} <span style="font-size:0.6rem;opacity:0.6;">(● Live)</span></span>
                <span style="font-family:monospace;">${nodeMac || nodeIp}</span>
            `;
                nodesList.appendChild(infoRow);

                let node;
                if (isMasterNode) {
                    node = {
                        ip: nodeIp,
                        mac: nodeMac,
                        sensorId: nodeMac || nodeIp,
                        isMaster: true,
                        channelIndex: index,
                        accBuffer: config.getAccBuffer?.(),
                        fftWorker: config.getFftWorker?.(),
                        rmsWorker: config.getRmsWorker?.(),
                    };
                } else {
                    node = new SensorNode(nodeInfo, index);
                }
                window.activeSensors.push(node);

                if (!isMasterNode) {
                    node.connect();
                }
            });

            config.rebuildAccChartForSensorCount?.(nodes.length);
            window.multiChartData = Array(nodes.length * 3 + 1).fill().map(() => []);

            setFftSensorCount(nodes.length);
            window.multiFftData = Array(nodes.length * 3 + 1).fill().map(() => []);
            setGyroFftSensorCount(nodes.length);
            window.multiGyroFftData = Array(nodes.length * 3 + 1).fill().map(() => []);
            setRmsSensorCount(nodes.length);
        } catch (error) {
            nodesList.innerHTML = '<div style="color:#ff6b6b;font-size:0.75rem;">Nodes nicht erreichbar.</div>';
            console.error('Discovery Error:', error);
        }
    }

    function connectWebSocket() {
        discoverNodes();
        document.getElementById('btnDiscoverNodes')?.addEventListener('click', discoverNodes);

        setInterval(async () => {
            if (window.isOfflineReplayMode) return;
            try {
                const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
                let apiHost = window.location.hostname;
                if (!apiHost || apiHost === 'localhost' || apiHost === '127.0.0.1') {
                    apiHost = '192.168.4.1';
                }

                const response = await fetch(`${protocol}//${apiHost}/api/nodes`);
                const rawNodes = await response.json();
                const validNodes = Array.isArray(rawNodes)
                    ? rawNodes.map((entry, index) => {
                        if (typeof entry === 'string') {
                            return { ip: entry, mac: '', isMaster: index === 0 };
                        }
                        return {
                            ip: entry?.ip || '',
                            mac: entry?.mac || '',
                            isMaster: Boolean(entry?.isMaster),
                        };
                    }).filter(node => node.ip)
                    : [];

                let changed = false;
                if (!window.activeSensors || validNodes.length !== window.activeSensors.length) {
                    changed = true;
                } else {
                    for (let i = 0; i < validNodes.length; i++) {
                        if (validNodes[i].ip !== window.activeSensors[i].ip || validNodes[i].mac !== window.activeSensors[i].mac) {
                            changed = true;
                            break;
                        }
                    }
                }
                if (changed) {
                    console.log('Topology change detected. Triggering discoverNodes().');
                    discoverNodes();
                }
            } catch (e) {
                // ignore
            }
        }, 3000);

        const wsWorker = config.getWsWorker?.();
        if (!wsWorker) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams(window.location.search);
        const customWsHost = config.sanitizeCustomWsHost?.(params.get('ws')) || config.getPersistedCustomWsHost?.();
        const previewHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '']);
        const defaultEspHost = '192.168.4.1';
        const hasExplicitDevPort = window.location.port !== '' && !['80', '443'].includes(window.location.port);
        const isLocalPreview = previewHosts.has(window.location.hostname)
            || (hasExplicitDevPort && window.location.hostname !== defaultEspHost);

        let url;
        if (customWsHost) {
            const normalizedHost = customWsHost.replace(/^wss?:\/\//, '').replace(/\/$/, '');
            url = `${protocol}//${normalizedHost}/ws`;
        } else if (isLocalPreview) {
            url = `ws://${defaultEspHost}/ws`;
        } else {
            url = `${protocol}//${location.host}/ws`;
        }

        console.log('[WS] Verbinde zu Master WebSocket:', url);
        wsWorker.postMessage({ type: 'connect', wsServerUrl: url });
    }

    setupFusionPipeline();

    return {
        buildNodeAccelerationSample,
        connectWebSocket,
        discoverNodes,
        getNodeByIp,
        openNodeCalibrationPopup,
        processSensorBatch,
        setChartUpdateInterval,
        setFftSensorCount,
        setNodeOrientationMode,
        setRmsSensorCount,
        setupDecodeWorker,
        setupWSWorker,
        startChartUpdates,
        stopChartUpdates,
        toggleNodeGravityCut,
    };
}