function getRequiredPointCount(updateIntervalMs, durationSeconds, panOffsetUs) {
    const updatesPerSecond = 1000 / updateIntervalMs;
    const requiredDuration = durationSeconds + Math.max(0, Math.abs(panOffsetUs / 1000000));
    return Math.max(10, Math.ceil(updatesPerSecond * requiredDuration));
}

function readRmsSeriesFromBuffer(buffer, pointCount) {
    return {
        x: buffer.getFieldTypedArray('x', pointCount),
        y: buffer.getFieldTypedArray('y', pointCount),
        z: buffer.getFieldTypedArray('z', pointCount),
        total: buffer.getFieldTypedArray('total', pointCount),
        time: buffer.getFieldTypedArray('time', pointCount),
    };
}

export function alignPlotDataToSeriesCount(plot, rawData, fillValue = null) {
    if (!plot || !Array.isArray(rawData) || rawData.length === 0) {
        return rawData;
    }

    const isArrayLike = (v) => Array.isArray(v) || ArrayBuffer.isView(v);

    const expectedSeriesCount = Math.max(1, plot.series?.length || 0);
    const times = isArrayLike(rawData[0]) ? Array.from(rawData[0]) : [];
    const aligned = [times];

    for (let seriesIndex = 1; seriesIndex < expectedSeriesCount; seriesIndex++) {
        const sourceSeries = isArrayLike(rawData[seriesIndex]) ? rawData[seriesIndex] : [];
        const denseSeries = new Array(times.length);

        const sourceOffset = Math.max(0, sourceSeries.length - times.length);
        const fillOffset = Math.max(0, times.length - sourceSeries.length);

        for (let valueIndex = 0; valueIndex < times.length; valueIndex++) {
            if (valueIndex >= fillOffset) {
                const sourceIdx = sourceOffset + (valueIndex - fillOffset);
                const value = sourceSeries[sourceIdx];
                denseSeries[valueIndex] = value == null || Number.isFinite(value) ? value ?? fillValue : fillValue;
            } else {
                denseSeries[valueIndex] = fillValue;
            }
        }

        aligned.push(denseSeries);
    }

    return aligned;
}

export function applyPlotDataWithLockedY(plot, data) {
    const yMinBefore = plot?.scales?.y?.min;
    const yMaxBefore = plot?.scales?.y?.max;

    plot?.setData(alignPlotDataToSeriesCount(plot, data));

    if (plot?._yLocked && yMinBefore !== undefined && yMaxBefore !== undefined) {
        plot?.setScale('y', { min: yMinBefore, max: yMaxBefore });
    }
}

function dispatchLatestTimestamp(eventName, timestamps) {
    if (timestamps?.length > 0) {
        window.dispatchEvent(new CustomEvent(eventName, { detail: { latestTimestamp: timestamps[timestamps.length - 1] } }));
    }
}

export function createRmsWorkerRuntime({
    workerScript,
    existingWorker,
    logLabel,
    isPaused,
    targetBuffer,
    getPlot,
    getDurationSeconds,
    getPanOffsetUs,
    updateIntervalMs,
    eventName,
}) {
    existingWorker?.terminate();

    const worker = new Worker(workerScript);
    console.log(logLabel, worker);

    worker.onmessage = (event) => {
        if (isPaused()) {
            return;
        }

        const { rmsX, rmsY, rmsZ, rmsTotal, time } = event.data;
        targetBuffer.push([time, rmsX, rmsY, rmsZ, rmsTotal]);

        // Verhindere Single-Channel-Rendering, wenn der Multi-Sensor-Loop läuft
        if (window.activeSensors && window.activeSensors.length > 0) {
            return;
        }

        const pointCount = getRequiredPointCount(updateIntervalMs, getDurationSeconds(), getPanOffsetUs());
        const series = readRmsSeriesFromBuffer(targetBuffer, pointCount);
        const plot = getPlot();
        applyPlotDataWithLockedY(plot, [series.time, series.x, series.y, series.z, series.total]);
        dispatchLatestTimestamp(eventName, series.time);
    };

    return worker;
}

export function bindRmsControlsRuntime({
    sliderId,
    valueId,
    pauseButtonId,
    recordButtonId,
    screenshotButtonId,
    chartId,
    getDuration,
    setDuration,
    getPaused,
    setPaused,
    isRecording,
    toggleRecording,
    html2canvasRef,
}) {
    const timeSlider = document.getElementById(sliderId);
    const timeValue = document.getElementById(valueId);
    const pauseBtn = document.getElementById(pauseButtonId);
    const recordBtn = document.getElementById(recordButtonId);
    const screenshotBtn = document.getElementById(screenshotButtonId);
    const chartContainer = document.getElementById(chartId);

    if (timeSlider && timeValue) {
        timeSlider.value = String(Math.round(getDuration()));
        timeValue.textContent = String(Math.round(getDuration()));

        timeSlider.addEventListener('input', () => {
            const nextDuration = parseInt(timeSlider.value, 10);
            setDuration(nextDuration);
            timeValue.textContent = String(nextDuration);
        });
    }

    if (pauseBtn) {
        pauseBtn.textContent = getPaused() ? '▶' : 'Pause';
        pauseBtn.addEventListener('click', () => {
            const nextPaused = !getPaused();
            setPaused(nextPaused);
            pauseBtn.textContent = nextPaused ? '▶' : 'Pause';
        });
    }

    if (recordBtn) {
        recordBtn.innerHTML = isRecording() ? '⏹' : '🔴';
        recordBtn.addEventListener('click', () => {
            if (typeof toggleRecording === 'function') {
                toggleRecording();
            }
        });
    }

    if (screenshotBtn && chartContainer && html2canvasRef) {
        screenshotBtn.addEventListener('click', () => {
            html2canvasRef(chartContainer).then((canvas) => {
                const link = document.createElement('a');
                link.download = `${chartId}_${new Date().toISOString()}.png`;
                link.href = canvas.toDataURL();
                link.click();
            });
        });
    }

    if (chartContainer) {
        chartContainer.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const factor = event.deltaY < 0 ? 0.85 : 1.15;
            let nextDuration = getDuration() * factor;

            if (nextDuration < 1) nextDuration = 1;
            if (nextDuration > 300) nextDuration = 300;

            setDuration(nextDuration);

            if (timeSlider) timeSlider.value = String(Math.round(nextDuration));
            if (timeValue) timeValue.textContent = String(Math.round(nextDuration));
        }, { passive: false, capture: true });
    }
}

export function startMultiSensorRmsUpdatesRuntime({
    existingTimerId,
    getPlot,
    getNodesToProcess,
    updateIntervalMs,
    windowSize,
    getDurationSeconds,
    getPanOffsetUs,
    eventName,
}) {
    if (existingTimerId !== null) {
        clearInterval(existingTimerId);
    }

    return setInterval(() => {
        const plot = getPlot();
        if (!plot) {
            return;
        }

        const nodesToProcess = getNodesToProcess();

        nodesToProcess.forEach((node) => {
            const sourceBuffer = node.accBuffer;
            const worker = node.rmsWorker;
            if (!sourceBuffer || !worker) {
                return;
            }

            const lastSample = sourceBuffer.getLast();
            if (!lastSample) {
                return;
            }

            const rmsXInput = new Float32Array(sourceBuffer.getFieldTypedArray('x', windowSize));
            const rmsYInput = new Float32Array(sourceBuffer.getFieldTypedArray('y', windowSize));
            const rmsZInput = new Float32Array(sourceBuffer.getFieldTypedArray('z', windowSize));
            const rmsTotalInput = new Float32Array(sourceBuffer.getFieldTypedArray('total', windowSize));

            worker.postMessage({
                x: rmsXInput,
                y: rmsYInput,
                z: rmsZInput,
                total: rmsTotalInput,
                time: lastSample.time,
            }, [rmsXInput.buffer, rmsYInput.buffer, rmsZInput.buffer, rmsTotalInput.buffer]);
        });

        const pointCount = getRequiredPointCount(updateIntervalMs, getDurationSeconds(), getPanOffsetUs());
        const multiData = [];

        nodesToProcess.forEach((node) => {
            const buffer = node.rmsBuffer;
            if (!buffer) {
                return;
            }

            // Zeit-Array vom ersten Node mit gültigem Buffer setzen
            if (multiData[0] === undefined) {
                multiData[0] = buffer.getFieldTypedArray('time', pointCount);
            }

            /**
             * @summary CH1 positiv (oben), CH2+ negiert (Spiegel unter Null).
             * Float32Array-Loop ist O(n), kein GC-Druck, kein Spread.
             */
            const offset = node.channelIndex * 4 + 1;
            if (node.channelIndex === 0) {
                multiData[offset]     = buffer.getFieldTypedArray('x',     pointCount);
                multiData[offset + 1] = buffer.getFieldTypedArray('y',     pointCount);
                multiData[offset + 2] = buffer.getFieldTypedArray('z',     pointCount);
                multiData[offset + 3] = buffer.getFieldTypedArray('total', pointCount);
            } else {
                const neg = (src) => {
                    const out = new Float32Array(src.length);
                    for (let j = 0; j < src.length; j++) out[j] = -src[j];
                    return out;
                };
                multiData[offset]     = neg(buffer.getFieldTypedArray('x',     pointCount));
                multiData[offset + 1] = neg(buffer.getFieldTypedArray('y',     pointCount));
                multiData[offset + 2] = neg(buffer.getFieldTypedArray('z',     pointCount));
                multiData[offset + 3] = neg(buffer.getFieldTypedArray('total', pointCount));
            }
        });

        if (multiData.length > 0 && multiData[0] && multiData[0].length > 0) {
            applyPlotDataWithLockedY(plot, multiData);
            dispatchLatestTimestamp(eventName, multiData[0]);
        }
    }, updateIntervalMs);
}

export function startGyroRmsUpdatesRuntime({
    existingTimerId,
    getPlot,
    getNodesToProcess,
    updateIntervalMs,
    windowSize,
    getDurationSeconds,
    getPanOffsetUs,
    eventName,
}) {
    if (existingTimerId !== null) {
        clearInterval(existingTimerId);
    }

    return setInterval(() => {
        const plot = getPlot();
        if (!plot) {
            return;
        }

        const nodesToProcess = getNodesToProcess();

        nodesToProcess.forEach((node) => {
            const sourceBuffer = node.gyroBuffer;
            const worker = node.gyroRmsWorker;
            if (!sourceBuffer || !worker) {
                return;
            }

            const lastSample = sourceBuffer.getLast();
            if (!lastSample) {
                return;
            }

            const arrX = sourceBuffer.getFieldTypedArray('x', windowSize);
            const arrY = sourceBuffer.getFieldTypedArray('y', windowSize);
            const arrZ = sourceBuffer.getFieldTypedArray('z', windowSize);
            const arrTotal = new Float32Array(arrX.length);

            for (let index = 0; index < arrX.length; index++) {
                const x = arrX[index] || 0;
                const y = arrY[index] || 0;
                const z = arrZ[index] || 0;
                arrTotal[index] = Math.sqrt(x * x + y * y + z * z);
            }

            const rmsXInput = new Float32Array(arrX);
            const rmsYInput = new Float32Array(arrY);
            const rmsZInput = new Float32Array(arrZ);
            const rmsTotalInput = new Float32Array(arrTotal);

            worker.postMessage({
                x: rmsXInput,
                y: rmsYInput,
                z: rmsZInput,
                total: rmsTotalInput,
                time: lastSample.time,
            }, [rmsXInput.buffer, rmsYInput.buffer, rmsZInput.buffer, rmsTotalInput.buffer]);
        });

        const pointCount = getRequiredPointCount(updateIntervalMs, getDurationSeconds(), getPanOffsetUs());
        const multiData = [];

        nodesToProcess.forEach((node) => {
            const buffer = node.gyroRmsBuffer;
            if (!buffer) {
                return;
            }

            if (multiData[0] === undefined) {
                multiData[0] = buffer.getFieldTypedArray('time', pointCount);
            }

            const offset = node.channelIndex * 4 + 1;
            if (node.channelIndex === 0) {
                multiData[offset]     = buffer.getFieldTypedArray('x',     pointCount);
                multiData[offset + 1] = buffer.getFieldTypedArray('y',     pointCount);
                multiData[offset + 2] = buffer.getFieldTypedArray('z',     pointCount);
                multiData[offset + 3] = buffer.getFieldTypedArray('total', pointCount);
            } else {
                const neg = (src) => {
                    const out = new Float32Array(src.length);
                    for (let j = 0; j < src.length; j++) out[j] = -src[j];
                    return out;
                };
                multiData[offset]     = neg(buffer.getFieldTypedArray('x',     pointCount));
                multiData[offset + 1] = neg(buffer.getFieldTypedArray('y',     pointCount));
                multiData[offset + 2] = neg(buffer.getFieldTypedArray('z',     pointCount));
                multiData[offset + 3] = neg(buffer.getFieldTypedArray('total', pointCount));
            }
        });

        if (multiData.length > 0 && multiData[0] && multiData[0].length > 0) {
            applyPlotDataWithLockedY(plot, multiData);
            if (eventName && typeof window.dispatchEvent === 'function') {
                dispatchLatestTimestamp(eventName, multiData[0]);
            }
        }
    }, updateIntervalMs);
}