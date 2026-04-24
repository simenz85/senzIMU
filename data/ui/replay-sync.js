function buildReplayRmsSeries(data, windowSize, totalValueFactory = null) {
    if (!Array.isArray(data) || data.length < 4) {
        return null;
    }

    const [timestamps, axisX, axisY, axisZ, totalAxis] = data;
    const sampleCount = timestamps?.length || 0;
    if (sampleCount <= 0 || windowSize <= 0 || sampleCount < windowSize) {
        return null;
    }

    const step = Math.max(1, Math.floor(sampleCount / 3000));
    const rmsTimestamps = [];
    const rmsX = [];
    const rmsY = [];
    const rmsZ = [];
    const rmsTotal = [];

    for (let startIndex = 0; startIndex <= sampleCount - windowSize; startIndex += step) {
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let sumTotal = 0;

        for (let offset = 0; offset < windowSize; offset++) {
            const sampleIndex = startIndex + offset;
            const valueX = axisX?.[sampleIndex] || 0;
            const valueY = axisY?.[sampleIndex] || 0;
            const valueZ = axisZ?.[sampleIndex] || 0;
            const totalValue = totalValueFactory
                ? totalValueFactory(sampleIndex, data)
                : (totalAxis?.[sampleIndex] ?? Math.hypot(valueX, valueY, valueZ));

            sumX += valueX * valueX;
            sumY += valueY * valueY;
            sumZ += valueZ * valueZ;
            sumTotal += totalValue * totalValue;
        }

        rmsX.push(Math.sqrt(sumX / windowSize));
        rmsY.push(Math.sqrt(sumY / windowSize));
        rmsZ.push(Math.sqrt(sumZ / windowSize));
        rmsTotal.push(Math.sqrt(sumTotal / windowSize));
        rmsTimestamps.push(timestamps[startIndex + windowSize - 1]);
    }

    if (rmsTimestamps.length <= 0) {
        return null;
    }

    return [
        new Float64Array(rmsTimestamps),
        new Float32Array(rmsX),
        new Float32Array(rmsY),
        new Float32Array(rmsZ),
        new Float32Array(rmsTotal),
    ];
}

function alignPlotDataToSeriesCount(plot, rawData, fillValue = null) {
    if (!plot || !Array.isArray(rawData) || rawData.length === 0) {
        return rawData;
    }

    const expectedSeriesCount = Math.max(1, plot.series?.length || 0);
    const xValues = Array.isArray(rawData[0]) || ArrayBuffer.isView(rawData[0]) ? Array.from(rawData[0] || []) : [];
    const aligned = [xValues];

    for (let seriesIndex = 1; seriesIndex < expectedSeriesCount; seriesIndex++) {
        const sourceSeries = Array.isArray(rawData[seriesIndex]) || ArrayBuffer.isView(rawData[seriesIndex])
            ? rawData[seriesIndex]
            : [];
        const denseSeries = new Array(xValues.length);

        for (let valueIndex = 0; valueIndex < xValues.length; valueIndex++) {
            const value = sourceSeries[valueIndex];
            denseSeries[valueIndex] = value == null || Number.isFinite(value) ? value ?? fillValue : fillValue;
        }

        aligned.push(denseSeries);
    }

    return aligned;
}

function applyReplayRangeAndCursor(plot, absTimeUs, minX, maxX, skipScaleWhenYLocked = false) {
    if (!plot) {
        return;
    }

    const isYLocked = skipScaleWhenYLocked && plot.yLocked;
    if (!isYLocked) {
        const yMin = plot.scales.y?.min;
        const yMax = plot.scales.y?.max;
        plot.setScale('x', { min: minX, max: maxX });
        if (yMin !== undefined && yMax !== undefined) {
            plot.setScale('y', { min: yMin, max: yMax });
        }
    }

    const cursorLeft = plot.valToPos(absTimeUs, 'x');
    if (cursorLeft > 0) {
        plot.setCursor({ left: cursorLeft, top: plot.cursor.top || 10 });
    }
}

function findClosestHistoryIndex(timestamps, absTimeUs) {
    let bestIndex = timestamps.length - 1;
    let minDistance = Infinity;

    for (let index = 0; index < timestamps.length; index++) {
        const distance = Math.abs(timestamps[index] - absTimeUs);
        if (distance <= minDistance) {
            minDistance = distance;
            bestIndex = index;
        }
    }

    return bestIndex;
}

function buildReplayFftData(renderer, bestIndex, sampleRate, averageWindowSize) {
    const magnitudes = renderer.history?.[bestIndex];
    if (!magnitudes) {
        return null;
    }

    const frequencies = new Array(magnitudes.length);
    for (let index = 0; index < magnitudes.length; index++) {
        frequencies[index] = index * sampleRate / (magnitudes.length * 2);
    }

    const averagedMagnitudes = new Float32Array(magnitudes.length);
    const peakMagnitudes = new Float32Array(magnitudes.length);
    peakMagnitudes.fill(-Infinity);

    for (let historyIndex = 0; historyIndex <= bestIndex; historyIndex++) {
        const historySlice = renderer.history?.[historyIndex];
        if (!historySlice) {
            continue;
        }
        for (let binIndex = 0; binIndex < magnitudes.length; binIndex++) {
            if (historySlice[binIndex] > peakMagnitudes[binIndex]) {
                peakMagnitudes[binIndex] = historySlice[binIndex];
            }
        }
    }

    const startIndex = Math.max(0, bestIndex - averageWindowSize + 1);
    let sampleCount = 0;
    for (let historyIndex = startIndex; historyIndex <= bestIndex; historyIndex++) {
        const historySlice = renderer.history?.[historyIndex];
        if (!historySlice) {
            continue;
        }
        for (let binIndex = 0; binIndex < magnitudes.length; binIndex++) {
            averagedMagnitudes[binIndex] += historySlice[binIndex];
        }
        sampleCount++;
    }

    if (sampleCount > 0) {
        for (let binIndex = 0; binIndex < magnitudes.length; binIndex++) {
            averagedMagnitudes[binIndex] /= sampleCount;
        }
    }

    return [
        frequencies,
        Array.from(averagedMagnitudes),
        Array.from(peakMagnitudes),
        Array.from(magnitudes),
    ];
}

function syncReplayFftPlot({ renderer, plot, absTimeUs, sampleRate, averageWindowSize, updateTimestamp = false, isOfflineReplayMode = false }) {
    const timestamps = renderer?.timestamps;
    if (!renderer || !timestamps || timestamps.length <= 0) {
        return;
    }

    const bestIndex = findClosestHistoryIndex(timestamps, absTimeUs);
    if (plot) {
        const plotData = buildReplayFftData(renderer, bestIndex, sampleRate, averageWindowSize);
        if (plotData) {
            plot.setData(alignPlotDataToSeriesCount(plot, plotData));
        }

        if (updateTimestamp) {
            const timestampElement = document.getElementById('timestamp');
            const clockText = renderer.clockStrings?.[bestIndex];
            if (timestampElement && clockText) {
                timestampElement.textContent = clockText;
            }
        }
    }

    if (isOfflineReplayMode) {
        renderer.scrollOffset = Math.max(0, renderer.history.length - 1 - bestIndex);
        if (renderer.active) {
            renderer.renderHistory();
            renderer.updateLabels();
            renderer.syncScrollbar();
        }
    }
}

function setElementText(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
    }
}

export function applyStaticReplayData({
    accData,
    gyroData,
    startTimeUs,
    endTimeUs,
    chart,
    rmsPlot,
    gyroChart,
    gyroRmsPlot,
    rmsWindowSize,
}) {
    const windowSize = rmsWindowSize > 0 ? rmsWindowSize : 100;

    if (accData && chart) {
        chart.setData(alignPlotDataToSeriesCount(chart, accData));
        chart.setScale('x', { min: startTimeUs, max: endTimeUs });

        if (rmsPlot) {
            const rmsData = buildReplayRmsSeries(accData, windowSize);
            if (rmsData) {
                rmsPlot.setData(alignPlotDataToSeriesCount(rmsPlot, rmsData));
                rmsPlot.setScale('x', { min: startTimeUs, max: endTimeUs });
            }
        }
    }

    if (gyroData && gyroChart) {
        gyroChart.setData(alignPlotDataToSeriesCount(gyroChart, gyroData));
        gyroChart.setScale('x', { min: startTimeUs, max: endTimeUs });

        if (gyroRmsPlot) {
            const gyroRmsData = buildReplayRmsSeries(
                gyroData,
                windowSize,
                (sampleIndex, [, axisX, axisY, axisZ]) => Math.hypot(axisX?.[sampleIndex] || 0, axisY?.[sampleIndex] || 0, axisZ?.[sampleIndex] || 0),
            );
            if (gyroRmsData) {
                gyroRmsPlot.setData(alignPlotDataToSeriesCount(gyroRmsPlot, gyroRmsData));
                gyroRmsPlot.setScale('x', { min: startTimeUs, max: endTimeUs });
            }
        }
    }
}

export function updateReplayDashboard({
    absTimeUs,
    accSample: accSamples,
    gyroSample: gyroSamples,
    replayRecordingDate,
    displayDurationSeconds,
    replayStartTimeUs,
    chart,
    gyroChart,
    rmsPlot,
    gyroRmsPlot,
    accVectorViewport,
    buildViewportAccelerationSamples,
    buildViewportGyroSamples,
    waterfallRenderer,
    gyroWaterfallRenderer,
    fftPlot,
    gyroFftPlot,
    currentSampleRate,
    nAvg,
    isOfflineReplayMode,
}) {
    const timestampDateElement = document.getElementById('timestampDate');
    if (timestampDateElement) {
        if (replayRecordingDate) {
            timestampDateElement.style.display = 'block';
            timestampDateElement.textContent = replayRecordingDate;
        } else {
            timestampDateElement.style.display = 'none';
            timestampDateElement.textContent = '';
        }
    }

    // For multi-channel, we pull the first active channel for the numeric readouts (Dynamic Master)
    const masterAcc = Array.isArray(accSamples) ? (accSamples.find(s => s !== null && typeof s !== 'undefined') || null) : accSamples;
    if (masterAcc) {
        setElementText('accX', masterAcc.x.toFixed(1));
        setElementText('accY', masterAcc.y.toFixed(1));
        setElementText('accZ', masterAcc.z.toFixed(1));
        if (accVectorViewport && buildViewportAccelerationSamples) {
            accVectorViewport.setAccelerationSamples(buildViewportAccelerationSamples(masterAcc, masterAcc));
        }
    }

    const masterGyro = Array.isArray(gyroSamples) ? (gyroSamples.find(s => s !== null && typeof s !== 'undefined') || null) : gyroSamples;
    if (masterGyro) {
        setElementText('gyroX', masterGyro.x.toFixed(1));
        setElementText('gyroY', masterGyro.y.toFixed(1));
        setElementText('gyroZ', masterGyro.z.toFixed(1));
        if (accVectorViewport && buildViewportGyroSamples) {
            accVectorViewport.setGyroSamples(buildViewportGyroSamples(masterGyro, masterGyro));
        }
    }

    const durationUs = (displayDurationSeconds ?? 5) * 1000 * 1000;
    let minX = absTimeUs - durationUs;
    let maxX = absTimeUs;
    if (minX < (replayStartTimeUs || 0)) {
        minX = replayStartTimeUs || 0;
        maxX = minX + durationUs;
    }

    applyReplayRangeAndCursor(chart, absTimeUs, minX, maxX, true);
    applyReplayRangeAndCursor(gyroChart, absTimeUs, minX, maxX, true);
    applyReplayRangeAndCursor(rmsPlot, absTimeUs, minX, maxX, false);
    applyReplayRangeAndCursor(gyroRmsPlot, absTimeUs, minX, maxX, false);

    const sampleRate = currentSampleRate > 0 ? currentSampleRate : 1000;
    const averageWindowSize = nAvg ?? 10;

    syncReplayFftPlot({
        renderer: waterfallRenderer,
        plot: fftPlot,
        absTimeUs,
        sampleRate,
        averageWindowSize,
        updateTimestamp: true,
        isOfflineReplayMode,
    });

    syncReplayFftPlot({
        renderer: gyroWaterfallRenderer,
        plot: gyroFftPlot,
        absTimeUs,
        sampleRate,
        averageWindowSize,
        updateTimestamp: false,
        isOfflineReplayMode,
    });
}