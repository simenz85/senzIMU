export function createChartInteractionRuntime(config) {
    function getLiveCharts() {
        return {
            chart: config.getChart(),
            gyroChart: config.getGyroChart(),
        };
    }

    function getRmsCharts() {
        return {
            rmsPlot: config.getRmsPlot(),
            gyroRmsPlot: config.getGyroRmsPlot(),
        };
    }

    function syncAxisOverlayPositions(chartInstance, panelId, yOverlayId, xOverlayId, y2OverlayId) {
        const panel = document.getElementById(panelId);
        const yOverlay = document.getElementById(yOverlayId);
        const xOverlay = document.getElementById(xOverlayId);
        const wrap = chartInstance?.root?.querySelector?.('.u-wrap');
        const bbox = chartInstance?.bbox;

        if (!panel || !yOverlay || !xOverlay || !wrap || !bbox) {
            return;
        }

        const panelRect = panel.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const wrapLeft = wrapRect.left - panelRect.left;
        const wrapTop = wrapRect.top - panelRect.top;

        yOverlay.style.left = `${Math.max(0, wrapLeft)}px`;
        yOverlay.style.top = `${Math.max(0, wrapTop + bbox.top)}px`;
        yOverlay.style.width = `${Math.max(0, bbox.left)}px`;
        yOverlay.style.height = `${Math.max(0, bbox.height)}px`;

        const xTop = wrapTop + bbox.top + bbox.height;
        const xHeight = Math.max(0, (wrapRect.bottom - panelRect.top) - xTop);
        const xOverlayHeight = Math.max(20, xHeight); // Allow enough height to comfortably cover labels
        xOverlay.style.left = `${Math.max(0, wrapLeft + bbox.left)}px`;
        xOverlay.style.top = `${Math.max(0, xTop)}px`;
        xOverlay.style.width = `${Math.max(0, bbox.width)}px`;
        xOverlay.style.height = `${xOverlayHeight}px`;
        xOverlay.style.bottom = 'auto';

        const y2Overlay = y2OverlayId ? document.getElementById(y2OverlayId) : null;
        if (y2Overlay) {
            const y2Left = wrapLeft + bbox.left + bbox.width;
            const y2Width = Math.max(0, wrapRect.width - (bbox.left + bbox.width));
            y2Overlay.style.left = `${Math.max(0, y2Left)}px`;
            y2Overlay.style.top = `${Math.max(0, wrapTop + bbox.top)}px`;
            y2Overlay.style.width = `${y2Width}px`;
            y2Overlay.style.height = `${Math.max(0, bbox.height)}px`;
        }
    }

    function updateAllChartPanelHeights() {
        config.updateLiveChartPanelHeights();
        config.updateFftRmsPanelHeights();
        config.updateGyroFftRmsPanelHeights();
    }

    function resizeLiveCharts() {
        config.getChart()?.setSize(config.getLiveChartSize());
        config.getGyroChart()?.setSize(config.getGyroChartSize());
    }

    function resizeFftRmsCharts() {
        config.getFftPlot()?.setSize(config.getFftChartSize());
        config.getRmsPlot()?.setSize(config.getRmsChartSize());
    }

    function resizeGyroFftRmsCharts() {
        config.getGyroFftPlot()?.setSize(config.getGyroFftChartSize());
        config.getGyroRmsPlot()?.setSize(config.getGyroRmsChartSize());
    }

    function resizeChartIfMeasured(chartInstance, getChartSize) {
        const size = getChartSize();
        if (chartInstance && size.width > 0 && size.height > 0) {
            chartInstance.setSize(size);
        }
    }

    function syncKnownAxisOverlays() {
        const { chart, gyroChart } = getLiveCharts();
        const { rmsPlot, gyroRmsPlot } = getRmsCharts();

        syncAxisOverlayPositions(chart, 'livechart2', 'y-axis-overlay', 'x-axis-overlay', 'y2-axis-overlay');
        syncAxisOverlayPositions(gyroChart, 'gyrochart', 'gyro-y-axis-overlay', 'gyro-x-axis-overlay', 'gyro-y2-axis-overlay');

        if (rmsPlot) {
            syncAxisOverlayPositions(rmsPlot, 'rmsPanel', 'rms-y-axis-overlay', 'rms-x-axis-overlay');
        }

        if (gyroRmsPlot) {
            syncAxisOverlayPositions(gyroRmsPlot, 'gyroRmsPanel', 'gyro-rms-y-axis-overlay', 'gyro-rms-x-axis-overlay');
        }
    }

    function syncTimeRangeUi(rangeUs) {
        let rangeSecs = rangeUs / 1000000;
        if (rangeSecs < 1) rangeSecs = 1;
        if (rangeSecs > 60) rangeSecs = 60;

        config.setCurrentTimeRange(rangeSecs);
        config.setDisplayDurationSeconds(rangeSecs);

        const timeSlider = document.getElementById('timeSlider');
        const timeValue = document.getElementById('timeValue');
        if (timeSlider) timeSlider.value = Math.round(rangeSecs);
        if (timeValue) timeValue.textContent = Math.round(rangeSecs);
    }

    function setSharedXScale(min, max, options = {}) {
        const { preserveY = true, syncUi = false } = options;
        const { chart, gyroChart } = getLiveCharts();
        
        let accYScales = {};
        if (preserveY && chart && chart.scales) {
            for (let key in chart.scales) {
                if (key.startsWith('y')) {
                    accYScales[key] = { min: chart.scales[key].min, max: chart.scales[key].max };
                }
            }
        }
        
        let gyroYScales = {};
        if (preserveY && gyroChart && gyroChart.scales) {
            for (let key in gyroChart.scales) {
                if (key.startsWith('y')) {
                    gyroYScales[key] = { min: gyroChart.scales[key].min, max: gyroChart.scales[key].max };
                }
            }
        }

        chart?.setScale('x', { min, max });
        gyroChart?.setScale('x', { min, max });

        if (preserveY && chart) {
            for (let key in accYScales) {
                const s = accYScales[key];
                if (s.min !== undefined && s.max !== undefined) {
                    chart.setScale(key, s);
                }
            }
        }
        if (preserveY && gyroChart) {
            for (let key in gyroYScales) {
                const s = gyroYScales[key];
                if (s.min !== undefined && s.max !== undefined) {
                    gyroChart.setScale(key, s);
                }
            }
        }
        
        if (syncUi) {
            syncTimeRangeUi(max - min);
        }
    }

    function getSharedXScale(sourceChart = config.getChart()) {
        const sourceScale = sourceChart?.scales?.x;
        if (sourceScale && Number.isFinite(sourceScale.min) && Number.isFinite(sourceScale.max)) {
            return sourceScale;
        }

        const fallbackScale = config.getChart()?.scales?.x;
        if (fallbackScale && Number.isFinite(fallbackScale.min) && Number.isFinite(fallbackScale.max)) {
            return fallbackScale;
        }

        return null;
    }

    function getCurrentSharedXWindow() {
        const scale = getSharedXScale(config.getChart());
        if (scale && Number.isFinite(scale.min) && Number.isFinite(scale.max)) {
            return { min: scale.min, max: scale.max };
        }
        return null;
    }

    function zoomSharedXAxis(factor, pointerPos, sourceChart = config.getChart()) {
        const scale = getSharedXScale(sourceChart);
        if (!scale) return;
        const range = scale.max - scale.min;
        const newRange = range * factor;
        const newMax = scale.max;
        const newMin = newMax - newRange;
        if (newMax - newMin < 1e-9) return;

        setSharedXScale(newMin, newMax, { preserveY: true, syncUi: true });
    }

    function panSharedXAxis(deltaPx, axisPxLength, sourceChart = config.getChart()) {
        if (axisPxLength === 0) return;
        const scale = getSharedXScale(sourceChart);
        if (!scale) return;

        const range = scale.max - scale.min;
        let deltaUs = -(deltaPx / axisPxLength) * range;
        let targetOffset = config.getLivePanOffset() + deltaUs;
        if (targetOffset > 0) {
            deltaUs -= targetOffset;
            targetOffset = 0;
        }

        config.setLivePanOffset(targetOffset);
        setSharedXScale(scale.min + deltaUs, scale.max + deltaUs, { preserveY: true, syncUi: false });
    }

    function zoomPlotYAxis(targetChart, factor, pointerPos, nailZero = false, scaleKey = 'y') {
        targetChart._yLocked = true;
        const scale = targetChart.scales[scaleKey];
        if (!scale || scale.min === undefined) return;
        const range = scale.max - scale.min;

        if (nailZero) {
            // Symmetrisch: beide Seiten gleichmaessig zoomen (fuer CH1-oben CH2-unten)
            const currentAbsMax = Math.max(Math.abs(scale.min), Math.abs(scale.max));
            let newAbsMax = currentAbsMax * factor;
            if (newAbsMax < 1e-9) newAbsMax = 1e-9;
            targetChart.setScale(scaleKey, { min: -newAbsMax, max: newAbsMax });
            return;
        }

        const newRange = range * factor;
        const newMin = scale.min + range * pointerPos - newRange * pointerPos;
        const newMax = newMin + newRange;
        if (newMax - newMin < 1e-9) return;
        targetChart.setScale(scaleKey, { min: newMin, max: newMax });
    }

    function panPlotYAxis(targetChart, deltaPx, axisPxLength, nailZero = false, scaleKey = 'y') {
        if (axisPxLength === 0) return;
        targetChart._yLocked = true;
        const scale = targetChart.scales[scaleKey];
        if (!scale || scale.min === undefined) return;
        const range = scale.max - scale.min;
        const delta = -(deltaPx / axisPxLength) * range;

        if (nailZero) {
            // Symmetrisch: beide Seiten gleichmaessig verschieben (pan = zoom-aequivalent)
            const currentAbsMax = Math.max(Math.abs(scale.min), Math.abs(scale.max));
            let newAbsMax = currentAbsMax + delta;
            if (newAbsMax < 1e-9) return;
            targetChart.setScale(scaleKey, { min: -newAbsMax, max: newAbsMax });
            return;
        }

        targetChart.setScale(scaleKey, { min: scale.min + delta, max: scale.max + delta });
    }

    function updateCursor(element, dragging, canDrag, axis) {
        if (dragging) {
            element.style.cursor = 'grabbing';
        } else if (canDrag) {
            element.style.cursor = axis === 'y' ? 'ns-resize' : 'ew-resize';
        } else {
            element.style.cursor = 'default';
        }
    }

    function bindYAxisOverlay(overlayId, targetChart, nailZero = false, scaleKey = 'y') {
        const yOverlay = document.getElementById(overlayId);
        if (!yOverlay || !targetChart) return;

        let isPanning = false;
        let lastY = 0;
        let originalOtherScales = {};

        yOverlay.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = yOverlay.getBoundingClientRect();
            const pointerPos = (event.clientY - rect.top) / rect.height;
            const factor = event.deltaY < 0 ? 0.85 : 1.15;
            
            const otherYScales = {};
            for (let key in targetChart.scales) {
                if (key.startsWith('y') && key !== scaleKey) {
                    otherYScales[key] = { min: targetChart.scales[key].min, max: targetChart.scales[key].max };
                }
            }

            const isThisChartSynced = targetChart === config.getChart() ? window.isAccYAxisSynced : window.isGyroYAxisSynced;

            if (targetChart.batch) {
                targetChart.batch(() => {
                    zoomPlotYAxis(targetChart, factor, pointerPos, nailZero, scaleKey);
                    
                    if (isThisChartSynced) {
                        const newScale = targetChart.scales[scaleKey];
                        for (let key in otherYScales) {
                            targetChart.setScale(key, { min: newScale.min, max: newScale.max });
                        }
                    } else {
                        for (let key in otherYScales) {
                            if (otherYScales[key].min !== undefined) {
                                targetChart.setScale(key, otherYScales[key]);
                            }
                        }
                    }
                });
            } else {
                zoomPlotYAxis(targetChart, factor, pointerPos, nailZero, scaleKey);
                
                if (isThisChartSynced) {
                    const newScale = targetChart.scales[scaleKey];
                    for (let key in otherYScales) {
                        targetChart.setScale(key, { min: newScale.min, max: newScale.max });
                    }
                } else {
                    for (let key in otherYScales) {
                        if (otherYScales[key].min !== undefined) {
                            targetChart.setScale(key, otherYScales[key]);
                        }
                    }
                }
            }
        }, { passive: false });

        yOverlay.addEventListener('dblclick', () => {
            targetChart._yLocked = false;
            // Also unlock all y scales
            for (let key in targetChart.scales) {
                if (key.startsWith('y')) {
                    if (targetChart === config.getChart() && key === 'y') {
                        targetChart.setScale(key, { min: -1100, max: 1100 });
                    } else {
                        targetChart.setScale(key, { auto: true });
                    }
                }
            }
            if (targetChart.data) {
                targetChart.setData(targetChart.data);
            }
        });

        yOverlay.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            isPanning = true;
            lastY = event.clientY;
            
            originalOtherScales = {};
            for (let key in targetChart.scales) {
                if (key.startsWith('y') && key !== scaleKey) {
                    originalOtherScales[key] = { min: targetChart.scales[key].min, max: targetChart.scales[key].max };
                }
            }
            
            updateCursor(yOverlay, true, true, 'y');
        });

        window.addEventListener('mousemove', (event) => {
            if (!isPanning) return;
            event.preventDefault();
            const deltaY = lastY - event.clientY;
            lastY = event.clientY;
            
            const isThisChartSynced = targetChart === config.getChart() ? window.isAccYAxisSynced : window.isGyroYAxisSynced;

            if (targetChart.batch) {
                targetChart.batch(() => {
                    panPlotYAxis(targetChart, deltaY, yOverlay.getBoundingClientRect().height, nailZero, scaleKey);
                    
                    if (isThisChartSynced) {
                        const newScale = targetChart.scales[scaleKey];
                        for (let key in originalOtherScales) {
                            targetChart.setScale(key, { min: newScale.min, max: newScale.max });
                        }
                    } else {
                        for (let key in originalOtherScales) {
                            if (originalOtherScales[key].min !== undefined) {
                                targetChart.setScale(key, originalOtherScales[key]);
                            }
                        }
                    }
                });
            } else {
                panPlotYAxis(targetChart, deltaY, yOverlay.getBoundingClientRect().height, nailZero, scaleKey);
                
                if (isThisChartSynced) {
                    const newScale = targetChart.scales[scaleKey];
                    for (let key in originalOtherScales) {
                        targetChart.setScale(key, { min: newScale.min, max: newScale.max });
                    }
                } else {
                    for (let key in originalOtherScales) {
                        if (originalOtherScales[key].min !== undefined) {
                            targetChart.setScale(key, originalOtherScales[key]);
                        }
                    }
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (!isPanning) return;
            isPanning = false;
            updateCursor(yOverlay, false, true, 'y');
        });

        yOverlay.addEventListener('mouseenter', () => !isPanning && updateCursor(yOverlay, false, true, 'y'));
        yOverlay.addEventListener('mouseleave', () => !isPanning && updateCursor(yOverlay, false, false, 'y'));
    }

    function bindSharedXAxisOverlay(overlayId, sourceChart) {
        const xOverlay = document.getElementById(overlayId);
        if (!xOverlay) return;

        let isPanning = false;
        let lastX = 0;

        xOverlay.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = xOverlay.getBoundingClientRect();
            const pointerPos = (event.clientX - rect.left) / rect.width;
            const factor = event.deltaY < 0 ? 0.85 : 1.15;
            zoomSharedXAxis(factor, pointerPos, sourceChart);
        }, { passive: false });

        xOverlay.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            isPanning = true;
            lastX = event.clientX;
            updateCursor(xOverlay, true, true, 'x');
        });

        window.addEventListener('mousemove', (event) => {
            if (!isPanning) return;
            event.preventDefault();
            const deltaX = event.clientX - lastX;
            lastX = event.clientX;
            panSharedXAxis(deltaX, xOverlay.getBoundingClientRect().width, sourceChart);
        });

        window.addEventListener('mouseup', () => {
            if (!isPanning) return;
            isPanning = false;
            updateCursor(xOverlay, false, true, 'x');
        });

        xOverlay.addEventListener('mouseenter', () => !isPanning && updateCursor(xOverlay, false, true, 'x'));
        xOverlay.addEventListener('mouseleave', () => !isPanning && updateCursor(xOverlay, false, false, 'x'));
    }

    function syncRmsTimeRangeUi(rangeUs, isGyro) {
        let rangeSecs = rangeUs / 1000000;
        if (rangeSecs < 1) rangeSecs = 1;

        if (isGyro) {
            config.setGyroRmsDurationSeconds(rangeSecs);
            const timeSlider = document.getElementById('gyroRmsTimeSlider');
            const timeValue = document.getElementById('gyroRmsTimeValue');
            if (timeSlider) timeSlider.value = Math.min(300, Math.round(rangeSecs));
            if (timeValue) timeValue.textContent = Math.round(rangeSecs);
            return;
        }

        config.setRmsDurationSeconds(rangeSecs);
        const timeSlider = document.getElementById('rmsTimeSlider');
        const timeValue = document.getElementById('rmsTimeValue');
        if (timeSlider) timeSlider.value = Math.min(300, Math.round(rangeSecs));
        if (timeValue) timeValue.textContent = Math.round(rangeSecs);
    }

    function bindRmsXAxisOverlay(overlayId, targetChart, isGyro) {
        const xOverlay = document.getElementById(overlayId);
        if (!xOverlay || !targetChart) return;

        let isPanning = false;
        let lastX = 0;

        const getOffset = () => isGyro ? config.getGyroRmsPanOffset() : config.getRmsPanOffset();
        const setOffset = (value) => {
            if (isGyro) {
                config.setGyroRmsPanOffset(value);
                return;
            }
            config.setRmsPanOffset(value);
        };

        xOverlay.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = xOverlay.getBoundingClientRect();
            const pointerPos = (event.clientX - rect.left) / rect.width;
            const factor = event.deltaY < 0 ? 0.85 : 1.15;
            const scale = targetChart.scales.x;
            const range = scale.max - scale.min;
            const newRange = range * factor;
            const newMax = scale.max;
            const newMin = newMax - newRange;
            if (newMax - newMin < 1e-9) return;

            syncRmsTimeRangeUi(newRange, isGyro);
            targetChart.setScale('x', { min: newMin, max: newMax });
        }, { passive: false });

        xOverlay.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            isPanning = true;
            lastX = event.clientX;
            updateCursor(xOverlay, true, true, 'x');
        });

        window.addEventListener('mousemove', (event) => {
            if (!isPanning) return;
            event.preventDefault();
            const deltaX = event.clientX - lastX;
            lastX = event.clientX;
            const axisPxLength = xOverlay.getBoundingClientRect().width;
            if (axisPxLength === 0) return;
            const scale = targetChart.scales.x;
            const range = scale.max - scale.min;
            let deltaUs = -(deltaX / axisPxLength) * range;
            let targetOffset = getOffset() + deltaUs;
            if (targetOffset > 0) {
                deltaUs -= targetOffset;
                targetOffset = 0;
            }
            setOffset(targetOffset);
            targetChart.setScale('x', { min: scale.min + deltaUs, max: scale.max + deltaUs });
        });

        window.addEventListener('mouseup', () => {
            if (!isPanning) return;
            isPanning = false;
            updateCursor(xOverlay, false, true, 'x');
        });

        xOverlay.addEventListener('mouseenter', () => !isPanning && updateCursor(xOverlay, false, true, 'x'));
        xOverlay.addEventListener('mouseleave', () => !isPanning && updateCursor(xOverlay, false, false, 'x'));
    }

    function setupInitialOverlayInteractions() {
        const { chart, gyroChart } = getLiveCharts();

        [
            [chart, 'accChartLegendHost'],
            [gyroChart, 'gyroChartLegendHost'],
        ].forEach(([chartInstance, legendHostId]) => {
            config.preserveScalesOnSeriesToggle(chartInstance);
            config.installManualLegendToggle(chartInstance, legendHostId);
        });

        bindYAxisOverlay('y-axis-overlay', chart, false, 'y');
        bindYAxisOverlay('y2-axis-overlay', chart, false, 'y2');
        bindYAxisOverlay('gyro-y-axis-overlay', gyroChart, false, 'y');
        bindYAxisOverlay('gyro-y2-axis-overlay', gyroChart, false, 'y2');
        bindSharedXAxisOverlay('x-axis-overlay', chart);
        bindSharedXAxisOverlay('gyro-x-axis-overlay', gyroChart);
        syncKnownAxisOverlays();

        const timestamps = config.getTimestamps();
        if (timestamps.length > 0) {
            const initialLatestTimestamp = timestamps[timestamps.length - 1];
            setSharedXScale(
                initialLatestTimestamp - (config.getDisplayDurationSeconds() * 1000000),
                initialLatestTimestamp,
                { preserveY: true, syncUi: true },
            );
        }
    }

    function createLiveChartResizeObserver() {
        return new ResizeObserver(() => {
            requestAnimationFrame(() => {
                resizeChartIfMeasured(config.getChart(), config.getLiveChartSize);
                resizeChartIfMeasured(config.getGyroChart(), config.getGyroChartSize);
                syncKnownAxisOverlays();
            });
        });
    }

    function observeChartPanels(resizeObserver) {
        ['livechart2', 'gyrochart', 'rmsPanel', 'gyroRmsPanel'].forEach((panelId) => {
            const panel = document.getElementById(panelId);
            if (panel) {
                resizeObserver.observe(panel);
            }
        });
    }

    function registerRuntimeAxisListeners() {
        window.addEventListener('liveDataUpdate', (event) => {
            const latest = event.detail.latestTimestamp;
            const chart = config.getChart();
            const currentVisibleRange = chart.scales.x.max - chart.scales.x.min;
            const desiredVisibleRange = config.getDisplayDurationSeconds() * 1000000;
            const visibleRange = Number.isFinite(currentVisibleRange) && currentVisibleRange > 0
                ? currentVisibleRange
                : desiredVisibleRange;
            if (!Number.isFinite(visibleRange) || visibleRange <= 0) return;

            if (Number.isFinite(config.getPanOffset()) && config.getPanOffset() !== config.getLivePanOffset()) {
                config.setLivePanOffset(config.getPanOffset());
            }

            if (config.getLivePanOffset() > -500000) {
                config.setLivePanOffset(0);
                setSharedXScale(latest - desiredVisibleRange, latest, { preserveY: true, syncUi: false });
                return;
            }

            setSharedXScale(
                latest - visibleRange + config.getLivePanOffset(),
                latest + config.getLivePanOffset(),
                { preserveY: true, syncUi: false }
            );
        });

        window.addEventListener('rmsDataUpdate', (event) => {
            const latest = event.detail.latestTimestamp;
            const rmsPlot = config.getRmsPlot();
            if (!rmsPlot) return;

            const currentVisibleRange = rmsPlot.scales.x.max - rmsPlot.scales.x.min;
            const desiredVisibleRange = config.getRmsDurationSeconds() * 1000000;
            const visibleRange = Number.isFinite(currentVisibleRange) && currentVisibleRange > 0
                ? currentVisibleRange
                : desiredVisibleRange;

            if (config.getRmsPanOffset() > -0.5) {
                config.setRmsPanOffset(0);
                rmsPlot.setScale('x', { min: latest - desiredVisibleRange, max: latest });
                return;
            }

            rmsPlot.setScale('x', {
                min: latest - visibleRange + config.getRmsPanOffset(),
                max: latest + config.getRmsPanOffset(),
            });
        });

        window.addEventListener('gyroRmsDataUpdate', (event) => {
            const latest = event.detail.latestTimestamp;
            const gyroRmsPlot = config.getGyroRmsPlot();
            if (!gyroRmsPlot) return;

            const currentVisibleRange = gyroRmsPlot.scales.x.max - gyroRmsPlot.scales.x.min;
            const desiredVisibleRange = config.getGyroRmsDurationSeconds() * 1000000;
            const visibleRange = Number.isFinite(currentVisibleRange) && currentVisibleRange > 0
                ? currentVisibleRange
                : desiredVisibleRange;

            if (config.getGyroRmsPanOffset() > -0.5) {
                config.setGyroRmsPanOffset(0);
                gyroRmsPlot.setScale('x', { min: latest - desiredVisibleRange, max: latest });
                return;
            }

            gyroRmsPlot.setScale('x', {
                min: latest - visibleRange + config.getGyroRmsPanOffset(),
                max: latest + config.getGyroRmsPanOffset(),
            });
        });

        config.getChart()?.over.addEventListener('dblclick', () => {
            config.setLivePanOffset(0);
            const lastTimestamp = config.getLastTimestamp();
            if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
                config.getChart()?.setScale('x', { min: lastTimestamp - (config.getDisplayDurationSeconds() * 1000000), max: lastTimestamp });
                syncTimeRangeUi(config.getDisplayDurationSeconds() * 1000000);
            } else {
                config.getChart()?.setScale('x', { auto: true });
            }
            config.getChart()?.setScale('y', { min: -1100, max: 1100 });
            for (let key in config.getChart()?.scales || {}) {
                if (key.startsWith('y') && key !== 'y') {
                    config.getChart()?.setScale(key, { auto: true });
                }
            }
        });

        config.getGyroChart()?.over.addEventListener('dblclick', () => {
            config.setLivePanOffset(0);
            const lastTimestamp = config.getLastTimestamp();
            if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
                config.getGyroChart()?.setScale('x', { min: lastTimestamp - (config.getDisplayDurationSeconds() * 1000000), max: lastTimestamp });
                syncTimeRangeUi(config.getDisplayDurationSeconds() * 1000000);
            } else {
                config.getGyroChart()?.setScale('x', { auto: true });
            }
            
            for (let key in config.getGyroChart()?.scales || {}) {
                if (key.startsWith('y')) {
                    config.getGyroChart()?.setScale(key, { min: -2000, max: 2000 });
                }
            }
        });

        [config.getRmsPlot(), config.getGyroRmsPlot()].forEach((plot, index) => {
            if (!plot?.over) return;
            plot.over.addEventListener('dblclick', () => {
                if (index === 1) {
                    config.setGyroRmsPanOffset(0);
                } else {
                    config.setRmsPanOffset(0);
                }
                plot.setScale('y', { auto: true });
            });
        });
    }

    return {
        bindRmsXAxisOverlay,
        bindSharedXAxisOverlay,
        bindYAxisOverlay,
        createLiveChartResizeObserver,
        getCurrentSharedXWindow,
        getSharedXScale,
        observeChartPanels,
        registerRuntimeAxisListeners,
        resizeChartIfMeasured,
        resizeFftRmsCharts,
        resizeGyroFftRmsCharts,
        resizeLiveCharts,
        setSharedXScale,
        setupInitialOverlayInteractions,
        syncAxisOverlayPositions,
        syncKnownAxisOverlays,
        syncTimeRangeUi,
        updateAllChartPanelHeights,
    };
}