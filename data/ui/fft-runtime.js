function setTextContent(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
    }
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

export function syncWaterfallRenderer({
    renderer,
    maxHzInputId,
    maxFreq,
    magnitudes,
    timestamp,
    timeString,
    clockTimeStr,
    lastMaxWindowKey,
    labelMaxId,
    labelMidId,
}) {
    if (!renderer?.active) {
        return;
    }

    const hzFilter = document.getElementById(maxHzInputId);
    const userMax = hzFilter ? parseInt(hzFilter.value, 10) : maxFreq;
    const actualMax = Math.min(maxFreq, userMax);
    renderer.setFrequencyBounds(maxFreq, actualMax);
    renderer.pushData(magnitudes, timestamp, timeString, clockTimeStr);

    if (window[lastMaxWindowKey] !== actualMax) {
        window[lastMaxWindowKey] = actualMax;
        setTextContent(labelMaxId, `${actualMax} Hz`);
        setTextContent(labelMidId, `${Math.round(actualMax / 2)} Hz`);
    }
}

export function updateSharedMultiFftData({ multiFftData, freqs, maxValues, meanValues, magnitudes, channelIndex }) {
    if (!multiFftData[0] || multiFftData[0].length === 0 || multiFftData[0].length !== freqs.length) {
        multiFftData[0] = Array.from(freqs);
    }

    const offset = channelIndex * 3 + 1;
    const sign = channelIndex % 2 === 1 ? -1 : 1; 

    multiFftData[offset] = Array.from(maxValues).map(v => v * sign);
    multiFftData[offset + 1] = Array.from(meanValues).map(v => v * sign);
    multiFftData[offset + 2] = Array.from(magnitudes).map(v => v * sign);
}

function getMagnitudeCeiling(seriesList, minimum = 500) {
    let ceiling = minimum;

    for (const series of seriesList) {
        if (!series || series.length === 0) {
            continue;
        }

        const seriesMax = Math.max(...series.map(Math.abs));
        if (Number.isFinite(seriesMax)) {
            ceiling = Math.max(ceiling, seriesMax * 1.2);
        }
    }

    return ceiling;
}

function getSharedFftCeiling(multiFftData, minimum = 500) {
    let ceiling = minimum;

    for (let index = 1; index < multiFftData.length; index += 3) {
        const series = multiFftData[index];
        if (!series || series.length === 0) {
            continue;
        }

        const seriesMax = Math.max(...series.map(Math.abs));
        if (Number.isFinite(seriesMax) && seriesMax > ceiling) {
            ceiling = seriesMax;
        }
    }

    return ceiling * 1.1;
}

export function updateSharedFftPlot({ plot, multiFftData, isScrubbing, fftDbOutput, peakBadgeId, freqs, magnitudes, updatePeakFrequencyBadge }) {
    if (!plot || isScrubbing) {
        return;
    }

    const ceiling = getSharedFftCeiling(multiFftData);
    
    // Fallback: Dynamische Zählung über das globale window-Objekt, da multiFftData nicht schrumpft
    const visibleCount = window.activeSensors ? window.activeSensors.filter(n => !n.isHiddenFromUI).length : 1;
    const hasMultipleChannels = visibleCount > 1;

    // Y-Achse skaliert dynamisch (auch während eines X-Zooms!)
    plot.setScale('y', {
        min: hasMultipleChannels ? -ceiling : 0,
        max: ceiling,
    });

    if (fftDbOutput) {
        plot.setScale('y', { min: hasMultipleChannels ? -100.0 : 0.0, max: 100.0 });
    }

    // X-Achse nur setzen, wenn der User nicht gezoomt hat und wir gültige Frequenzen haben
    if (!plot._xLocked && freqs && freqs.length > 0) {
        plot.setScale('x', { min: freqs[0], max: freqs[freqs.length - 1] });
    }

    // Wenn Single-Mode erzwungen wird, blende verwaiste Kanäle aus dem multiFftData aus (Slicing)
    const effectiveData = hasMultipleChannels ? multiFftData : multiFftData.slice(0, 4);

    // false = Verhindert, dass uPlot die manuellen Zoom-Scales wieder überschreibt
    plot.setData(alignPlotDataToSeriesCount(plot, effectiveData), false);
    updatePeakFrequencyBadge?.(peakBadgeId, freqs, effectiveData);
}

export function updateSingleFftPlot({
    plot,
    freqs,
    maxValues,
    meanValues,
    magnitudes,
    isScrubbing,
    fftDbOutput,
    peakBadgeId,
    updatePeakFrequencyBadge,
    toRegularArray,
}) {
    if (!plot || isScrubbing) {
        return;
    }

    // Y-Achse skaliert dynamisch (auch während eines X-Zooms!)
    plot.setScale('y', {
        min: 0,
        max: getMagnitudeCeiling([meanValues, maxValues, magnitudes]),
    });

    if (fftDbOutput) {
        plot.setScale('y', [0.0, 100.0]);
    }

    // X-Achse nur setzen, wenn der User nicht gezoomt hat und wir gültige Frequenzen haben
    if (!plot._xLocked && freqs && freqs.length > 0) {
        plot.setScale('x', { min: freqs[0], max: freqs[freqs.length - 1] });
    }

    // false = Verhindert, dass uPlot die manuellen Zoom-Scales überschreibt
    plot.setData(alignPlotDataToSeriesCount(plot, [
        toRegularArray(freqs),
        maxValues,
        toRegularArray(meanValues),
        toRegularArray(magnitudes),
    ]), false);
    updatePeakFrequencyBadge?.(peakBadgeId, freqs, magnitudes);
}