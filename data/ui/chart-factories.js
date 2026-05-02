export function createLegendMount(legendHostId) {
    return (u, table) => {
        document.getElementById(legendHostId)?.replaceChildren(table);
    };
}

function createTimeAxis({ formatRuntimeMicroseconds, label = "Zeit", space = 100, size = 44, valuePrecision = 0 } = {}) {
    return {
        time: false,
        scale: "x",
        space,
        size,
        label,
        grid: { show: true },
        values: (u, v) => v.map(t => formatRuntimeMicroseconds(t, valuePrecision)),
        stroke: "white"
    };
}

function createValueAxis({ label = "Wert", size = 56, tickFormatter = (u, v) => v.toFixed(2) } = {}) {
    return {
        scale: "y",
        size,
        label,
        grid: { show: true },
        ticks: { format: tickFormatter },
        stroke: "white"
    };
}

export function createLiveChartOptions({
    size,
    width,
    height,
    title,
    yRange,
    yTickSuffix,
    series,
    legendHostId,
    cursorUnit,
    formatRuntimeMicroseconds,
    createCursorPlugin,
}) {
    return {
        ...size,
        title,
        width,
        height,
        padding: [6, 8, 2, 2],
        axes: [
            createTimeAxis({ formatRuntimeMicroseconds, label: "Zeit (s)", space: 64, size: 44, valuePrecision: 0 }),
            createValueAxis({ label: "CH1", size: 56, tickFormatter: (u, v) => `${v.toFixed(2)} ${yTickSuffix}` }),
            {
                scale: "y",
                side: 1, // Right side
                size: 56,
                label: "CH2",
                grid: { show: false },
                ticks: { format: (u, v) => `${v.toFixed(2)} ${yTickSuffix}` },
                stroke: "white"
            }
        ],
        scales: {
            x: {},
            y: { range: yRange }
        },
        series: series?.map(s => ({ ...s, points: { show: false } })),
        cursor: {
            points: {},
            drag: { x: true, y: true, setScale: true }
        },
        legend: {
            mount: createLegendMount(legendHostId),
        },
        plugins: [createCursorPlugin(cursorUnit)],
    };
}

export function createRmsChartOptions({ size, title, yRange, series, legendHostId, formatRuntimeMicroseconds }) {
    return {
        ...size,
        title,
        width: Math.max(320, size.width || 800),
        height: Math.max(250, size.height || 500),
        scales: {
            x: {
                time: false,
                auto: false,
                values: (u, v) => v.map(t => formatRuntimeMicroseconds(t, 0)),
            },
            y: { auto: true, range: yRange }
        },
        axes: [
            createTimeAxis({ formatRuntimeMicroseconds, label: "Zeit", space: 100, size: 44, valuePrecision: 0 }),
            createValueAxis({ label: "Wert", size: 56, tickFormatter: (u, v) => v.toFixed(2) })
        ],
        series: series?.map(s => ({ ...s, points: { show: false } })),
        cursor: {
            drag: { x: true, y: true, setScale: true }
        },
        legend: {
            mount: createLegendMount(legendHostId),
        },
    };
}

export function createFftChartOptions({
    width,
    height,
    title,
    averageStroke,
    averageFill,
    currentStroke,
    legendHostId,
    axisStrokeFactory,
    cursorUnit,
    createCursorPlugin,
}) {
    return {
        title,
        width,
        height,
        scales: {
            x: {
                time: false,
                label: "Frequenz (Hz)",
                range: (u, min, max) => {
                    if (u._xLocked && u._xLockMin != null && u._xLockMax != null) {
                        return [u._xLockMin, u._xLockMax];
                    }
                    return [min, max];
                }
            },
            y: {
                range: (u, min, max) => [0, Math.max(500, (max == null ? 500 : max * 1.1))],
                label: "Magnitude"
            }
        },
        axes: [
            {
                stroke: axisStrokeFactory
            },
            {
                stroke: axisStrokeFactory
            },
        ],
        series: [
            { label: "Freq (Hz)" },
            {
                label: "Max Magnitude",
                stroke: null,
                width: 0,
                fill: "rgba(200,210,223,0.08)",
                points: { show: false },
                value: (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--')
            },
            {
                label: "Average Magnitude",
                stroke: averageStroke,
                width: 2,
                fill: averageFill,
                points: { show: false },
                value: (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--')
            },
            {
                label: "Current Magnitude",
                stroke: currentStroke,
                width: 1,
                points: { show: false },
                value: (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--')
            },
        ],
        legend: {
            mount: createLegendMount(legendHostId),
        },
        cursor: {
            sync: { key: 'fft_sync' },
            points: {},
            drag: { x: true, y: true, setScale: true }
        },
        hooks: {
            setSelect: [
                (u) => {
                    if (u.select.width > 0 || u.select.height > 0) {
                        u._xLocked = true;
                        u._xLockMin = u.posToVal(u.select.left, 'x');
                        u._xLockMax = u.posToVal(u.select.left + u.select.width, 'x');
                    }
                }
            ],
            ready: [
                (u) => {
                    u.root.addEventListener('dblclick', () => {
                        u._xLocked = false;
                        u._xLockMin = null;
                        u._xLockMax = null;
                        u.setScale('x', { auto: true });
                    });
                }
            ]
        },
        plugins: createCursorPlugin ? [createCursorPlugin(cursorUnit)] : [],
    };
}

export function preserveScalesOnSeriesToggle(chartInstance) {
    if (!chartInstance || typeof chartInstance.setSeries !== "function") {
        return;
    }

    const originalSetSeries = chartInstance.setSeries.bind(chartInstance);
    chartInstance.setSeries = (...args) => {
        // Backup ALL scales
        const lockedScales = {};
        for (let key in chartInstance.scales) {
             const sc = chartInstance.scales[key];
             if (sc && Number.isFinite(sc.min) && Number.isFinite(sc.max)) {
                 lockedScales[key] = { min: sc.min, max: sc.max };
             }
        }

        const restoreScales = () => {
             for (let key in lockedScales) {
                 chartInstance.setScale(key, lockedScales[key]);
             }
        };

        const result = originalSetSeries(...args);

        restoreScales();
        requestAnimationFrame(restoreScales);
        setTimeout(restoreScales, 0);
        setTimeout(restoreScales, 32);

        return result;
    };
}

export function installManualLegendToggle(chartInstance, legendHostId = null) {
    const legendRoot = legendHostId
        ? document.getElementById(legendHostId)?.querySelector?.(".u-legend")
        : chartInstance?.root?.querySelector?.(".u-legend");
    if (!legendRoot) {
        return;
    }

    legendRoot.addEventListener("click", (event) => {
        const headerCell = event.target.closest("th");
        const row = event.target.closest(".u-series");
        if (!headerCell || !row) {
            return;
        }

        const rows = Array.from(legendRoot.querySelectorAll(".u-series"));
        const seriesIndex = rows.indexOf(row);
        if (seriesIndex <= 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const series = chartInstance.series?.[seriesIndex];
        if (!series) {
            return;
        }

        chartInstance.setSeries(seriesIndex, { show: !series.show });
    }, true);
}