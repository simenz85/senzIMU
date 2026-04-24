import { RelativeKinematicViewport } from './relative-kinematic-viewport.js';
import { formatMicrosecondsToHMS } from '../utils/format-utils.js';

export function initRelativeAnalysisUI() {
    const btnDiffRms = document.getElementById('btnRelativDiffRms');
    const btnKinematic = document.getElementById('btnRelativKinematic');
    const btnTranslation = document.getElementById('btnRelativTranslation');
    const btnLissajous = document.getElementById('btnRelativLissajous');

    const tabDiffRms = document.getElementById('relativDiffRmsTab');
    const tabKinematic = document.getElementById('relativKinematicTab');
    const tabTranslation = document.getElementById('relativTranslationTab');
    const tabLissajous = document.getElementById('relativLissajousTab');

    const targetSelect = document.getElementById('relativSecondaryNodeSelect');

    function switchTab(activeBtn, activeTab) {
        // Reset buttons
        [btnDiffRms, btnKinematic, btnTranslation, btnLissajous].forEach(btn => {
            if (!btn) return;
            btn.style.background = 'transparent';
            btn.style.border = '1px solid rgba(255,255,255,0.2)';
            btn.style.color = '#aaa';
        });

        // Activate button
        if (activeBtn) {
            activeBtn.style.background = 'rgba(0, 150, 255, 0.2)';
            activeBtn.style.border = '1px solid #0096ff';
            activeBtn.style.color = '#fff';
        }

        // Hide all tabs
        if (tabDiffRms) tabDiffRms.style.display = 'none';
        if (tabKinematic) tabKinematic.style.display = 'none';
        if (tabTranslation) tabTranslation.style.display = 'none';
        if (tabLissajous) tabLissajous.style.display = 'none';

        if (activeTab) {
            activeTab.style.display = activeTab.id === 'relativKinematicTab' ? 'block' : 'flex';
            
            // Handle viewport resize trigger when switching to 3D tab
            if (activeTab.id === 'relativKinematicTab' && window.relativKinematicViewport) {
                window.relativKinematicViewport.setVisible(true);
            } else if (window.relativKinematicViewport) {
                window.relativKinematicViewport.setVisible(false);
            }
            
            if (activeTab.id === 'relativLissajousTab') {
                setTimeout(() => {
                    if (typeof window.resizeLissajousGlobally === 'function') {
                        window.resizeLissajousGlobally();
                    }
                }, 50);
            }
            
            // Redraw translation plot immediately to fix sizing issues
            if (activeTab.id === 'relativTranslationTab' && typeof differentialTranslationPlot !== 'undefined') {
                setTimeout(() => {
                    const host = document.getElementById('relativTranslationChart');
                    if (differentialTranslationPlot && host) {
                        const rect = host.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            differentialTranslationPlot.setSize({ width: rect.width, height: rect.height });
                        }
                    }
                }, 100);
            }

            if (activeTab.id === 'relativDiffRmsTab' && typeof differentialRmsPlot !== 'undefined') {
                setTimeout(() => {
                    const host = document.getElementById('relativDiffRmsChart');
                    if (differentialRmsPlot && host) {
                        const rect = host.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            differentialRmsPlot.setSize({ width: rect.width, height: rect.height });
                        }
                    }
                }, 100);
            }
        }
    }

    if (btnDiffRms) btnDiffRms.addEventListener('click', () => switchTab(btnDiffRms, tabDiffRms));
    if (btnKinematic) btnKinematic.addEventListener('click', () => switchTab(btnKinematic, tabKinematic));
    if (btnTranslation) btnTranslation.addEventListener('click', () => switchTab(btnTranslation, tabTranslation));
    if (btnLissajous) btnLissajous.addEventListener('click', () => switchTab(btnLissajous, tabLissajous));

    // Force default render pass for active tab post-init
    setTimeout(() => {
        if (btnKinematic && tabKinematic) {
            switchTab(btnKinematic, tabKinematic);
        }
    }, 100);

    // Globale Sidebar überwachen
    const navRelativAnalysis = document.getElementById('navRelativAnalysis');
    if (navRelativAnalysis) {
        navRelativAnalysis.addEventListener('click', () => {
            setTimeout(() => {
                if (btnKinematic && tabKinematic) {
                    // Simuliere einen Klick auf den Kinematik-Tab, wenn der Bereich geöffnet wird
                    // So ist garantiert, dass setVisible(true) greift und this.visible = true wird
                    switchTab(btnKinematic, tabKinematic);
                }
            }, 100);
        });
    }
}

export function updateRelativeAnalysisNodeSelector(activeSensors) {
    const select = document.getElementById('relativSecondaryNodeSelect');
    if (!select) return;

    // Keep current value if possible
    const currentValue = select.value;

    select.innerHTML = '';

    if (!activeSensors || activeSensors.length <= 1) {
        const option = document.createElement('option');
        option.value = "none";
        option.textContent = "- Warten auf CH2 -";
        select.appendChild(option);
        return;
    }

    // Add all nodes except Master and Hidden
    let validOptions = 0;
    activeSensors.forEach((node, idx) => {
        if (node.isMaster || node.isHiddenFromUI) return; 

        const option = document.createElement('option');
        option.value = node.ip;
        option.textContent = `CH${idx + 1} (${node.mac || node.ip})`;
        select.appendChild(option);
        validOptions++;
    });

    if (validOptions === 0) {
        select.innerHTML = '<option value="none">- Warten auf CH2 -</option>';
        return;
    }

    if (currentValue && Array.from(select.options).some(opt => opt.value === currentValue)) {
        select.value = currentValue;
    } else {
        // Fallback to first available active node
        if (select.options.length > 0) {
            select.value = select.options[0].value;
        }
    }
}

// ---------------------------------------------------------
// PHASE 2: Differential Vibration (RMS)
// ---------------------------------------------------------
let differentialRmsPlot = null;
let differentialRmsTimer = null;
let isDifferentialRmsPaused = false;

export function initRelativeDiffRmsChart() {
    const host = document.getElementById('relativDiffRmsChart');
    if (!host) return;

    // Load uPlot script dynamically if needed, or assume it's loaded
    const opts = {
        width: host.clientWidth || 800,
        height: 400,
        title: "Differential ACC RMS (Node - Master)",
        cursor: { sync: { key: "rmsSync" } },
        scales: {
            x: { time: false },
            y: { range: (u, min, max) => [0, max > 100 ? max * 1.1 : 100] }
        },
        axes: [
            { grid: { stroke: "#333", width: 1 }, stroke: "#ccc" },
            { grid: { stroke: "#333", width: 1 }, stroke: "#ccc", size: 60, values: (u, vals) => (vals == null) ? [] : vals.map(v => (v != null) ? v.toFixed(1) + " mg" : "") }
        ],
        series: [
            {},
            { label: "Diff X", stroke: "rgba(255, 99, 132, 1)", width: 2 },
            { label: "Diff Y", stroke: "rgba(54, 162, 235, 1)", width: 2 },
            { label: "Diff Z", stroke: "rgba(255, 206, 86, 1)", width: 2 },
            { label: "Diff Total", stroke: "rgba(75, 192, 192, 1)", width: 2 }
        ]
    };

    if (typeof uPlot !== 'undefined') {
        // Initiale Größe vom Container (livechart-panel)
        const parent = host.parentElement;
        opts.width = parent.clientWidth > 0 ? parent.clientWidth : 800;
        opts.height = parent.clientHeight > 0 ? parent.clientHeight : 400;
        
        differentialRmsPlot = new uPlot(opts, [[0], [0], [0], [0], [0]], host);

        // ResizeObserver für automatische Anpassung im Flex-Layout
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === host && differentialRmsPlot) {
                    const rect = entry.contentRect;
                    if (rect.width > 0 && rect.height > 0) {
                        differentialRmsPlot.setSize({
                            width: rect.width,
                            height: rect.height
                        });
                    }
                }
            }
        });
        resizeObserver.observe(host);
    }

    const pauseBtn = document.getElementById('relativDiffRmsPauseBtn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            isDifferentialRmsPaused = !isDifferentialRmsPaused;
            pauseBtn.textContent = isDifferentialRmsPaused ? '▶ Play' : 'Pause';
            pauseBtn.innerHTML = isDifferentialRmsPaused ? '<i class="fas fa-play"></i> Play' : '<i class="fas fa-pause"></i> Pause';
        });
    }
}

let differentialTranslationPlot = null;
let isDifferentialTranslationPaused = false;
let diffChartPanOffset = 0;
let lastTimespanVal = "10";
const diffTranslationHistory = { 
    time: [], 
    rx: [], ry: [], rz: [],
    mx: [], my: [], mz: [],
    nx: [], ny: [], nz: []
};

export function initRelativeTranslationChart() {
    const host = document.getElementById('relativTranslationChart');
    const legendHost = document.getElementById('relativTranslationChartLegendHost');
    if (!host) return;
    
    // Farbschemata X (Rot), Y (Grün), Z (Blau)
    const colorRX = "rgba(255, 71, 87, 1)", colorRM = "rgba(255, 71, 87, 0.4)";
    const colorGY = "rgba(46, 213, 115, 1)", colorGM = "rgba(46, 213, 115, 0.4)";
    const colorBZ = "rgba(30, 144, 255, 1)", colorBM = "rgba(30, 144, 255, 0.4)";

    const opts = {
        title: "Translation dX/dY/dZ [mm]",
        width: 800,
        height: 400,
        pxAlign: false,
        axes: [
            { 
                time: false,
                scale: "x",
                space: 64,
                size: 44,
                label: "Zeit (s)",
                grid: { show: true, stroke: "rgba(255,255,255,0.05)" }, 
                values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
                stroke: "#aaa"
            },
            { 
                grid: { show: true, stroke: "rgba(255,255,255,0.05)" }, 
                stroke: "#aaa",
                size: 80, // Verhindert abgeschnittene Beschriftung
                values: (u, vals) => (vals == null) ? [] : vals.map(v => (v != null) ? v.toFixed(3) + ' mm' : '')
            }
        ],
        scales: {
            x: {}, // LiveChart-Formatierung (Mikrosekunden, manuell gerendert)
            y: {
                auto: true,
                range: (u, min, max) => {
                    // Verhindere, dass setData() den manuellen Zoom des Users überschreibt
                    if (u._yLocked && u._yLockMin != null && u._yLockMax != null) {
                        return [u._yLockMin, u._yLockMax];
                    }
                    if (min == null || max == null || isNaN(min) || isNaN(max)) return [-0.1, 0.1];
                    const absMax = Math.max(Math.abs(min), Math.abs(max), 0.05);
                    return [-absMax * 1.5, absMax * 1.5]; // Symmetrische Y-Achse
                }
            }
        },
        hooks: {
            draw: [
                (u) => {
                    const yOverlay = document.getElementById('relativ-translation-y-axis-overlay');
                    const xOverlay = document.getElementById('relativ-translation-x-axis-overlay');
                    if (!u.root) return;
                    const wrap = u.root.querySelector('.u-wrap');
                    if (!wrap || !u.bbox) return;

                    const panel = u.root.closest('[style*="position: relative"]');
                    if (!panel) return;
                    
                    const panelRect = panel.getBoundingClientRect();
                    const wrapRect = wrap.getBoundingClientRect();
                    const wrapLeft = wrapRect.left - panelRect.left;
                    const wrapTop = wrapRect.top - panelRect.top;

                    if (yOverlay) {
                        yOverlay.style.left = `${Math.max(0, wrapLeft)}px`;
                        yOverlay.style.top = `${Math.max(0, wrapTop + u.bbox.top)}px`;
                        yOverlay.style.width = `${Math.max(0, u.bbox.left)}px`;
                        yOverlay.style.height = `${Math.max(0, u.bbox.height)}px`;
                        yOverlay.style.position = 'absolute';
                        yOverlay.style.cursor = 'ns-resize';
                        yOverlay.style.zIndex = '10';
                    }

                    if (xOverlay) {
                        const xTop = wrapTop + u.bbox.top + u.bbox.height + 10; // Push down by 10px to avoid ticks
                        const xHeight = Math.max(0, (wrapRect.bottom - panelRect.top) - (xTop - 10));
                        const xOverlayHeight = Math.max(20, xHeight); 
                        xOverlay.style.left = `${Math.max(0, wrapLeft + u.bbox.left)}px`;
                        xOverlay.style.top = `${Math.max(0, xTop)}px`;
                        xOverlay.style.width = `${Math.max(0, wrapRect.width - u.bbox.left)}px`;
                        xOverlay.style.height = `${xOverlayHeight}px`; 
                        xOverlay.style.position = 'absolute';
                        xOverlay.style.cursor = 'ew-resize';
                        xOverlay.style.zIndex = '10';
                        xOverlay.style.bottom = 'auto';
                        xOverlay.style.background = 'transparent';
                        if(!xOverlay.hasAttribute('title')) xOverlay.title = "X-Achse zoomen/pannen";
                    }
                }
            ],
            setSelect: [
                (u) => {
                    // Ignoriere einfache Klicks (width=0, height=0)
                    if (u.select.width > 0 || u.select.height > 0) {
                        // Reale Werte aus der Box berechnen
                        const leftVal = u.posToVal(u.select.left, 'x');
                        const rightVal = u.posToVal(u.select.left + u.select.width, 'x');
                        const topVal = u.posToVal(u.select.top, 'y');
                        const bottomVal = u.posToVal(u.select.top + u.select.height, 'y');

                        u._yLocked = true;
                        u._yLockMin = Math.min(topVal, bottomVal);
                        u._yLockMax = Math.max(topVal, bottomVal);

                        // Offset sichern für fließendes Auto-Pan bei gezoomtem X!
                        const latestTs = window.activeSensors?.[0]?.accBuffer?.getLast?.()?.time || 0;
                        if (latestTs > 0) {
                            diffTranslationHistory.diffChartPanOffset = rightVal - latestTs;
                            if (diffTranslationHistory.diffChartPanOffset > 0) diffTranslationHistory.diffChartPanOffset = 0;
                        }

                        const timespanSelect = document.getElementById('relativTranslationTimespan');
                        if (timespanSelect && timespanSelect.value !== "all") timespanSelect.value = "all";

                        // Box verschwinden lassen
                        u.setSelect({width: 0, height: 0}, false);
                        
                        // Zoom hart anwenden
                        u.setScale('x', { min: leftVal, max: rightVal });
                        u.setScale('y', { min: u._yLockMin, max: u._yLockMax });
                    }
                }
            ]
        },
        cursor: {
            sync: { key: "kinematicSync" },
            points: { show: false },
            drag: { x: true, y: true, setScale: true }
        },
        legend: { show: true, live: false, mount: (u, table) => { if (legendHost) { legendHost.appendChild(table); } } },
        series: [
            { 
                label: "Zeit", 
                value: (u, v) => v === null ? "-" : formatMicrosecondsToHMS(v, 5), 
                stroke: "transparent", fill: "transparent", points: {show: false} 
            },
            // Master (Hauptakteur 1)
            { label: "Mas X", stroke: colorRX, width: 2, show: true, points: { show: false } },
            { label: "Mas Y", stroke: colorGY, width: 2, show: true, points: { show: false } },
            { label: "Mas Z", stroke: colorBZ, width: 2, show: true, points: { show: false } },
            // Node (Hauptakteur 2)
            { label: "Nod X", stroke: "rgba(255,100,100,1)", width: 2, show: true, points: { show: false } }, // Helleres Rot
            { label: "Nod Y", stroke: "rgba(100,255,150,1)", width: 2, show: true, points: { show: false } }, // Helleres Grün
            { label: "Nod Z", stroke: "rgba(100,200,255,1)", width: 2, show: true, points: { show: false } }, // Helleres Blau
            // Relative (Draufgabe / Delta)
            { label: "Rel X", stroke: colorRM, fill: colorRM.replace('0.4', '0.15'), width: 1.5, dash: [4, 4], points: { show: false } },
            { label: "Rel Y", stroke: colorGM, fill: colorGM.replace('0.4', '0.15'), width: 1.5, dash: [4, 4], points: { show: false } },
            { label: "Rel Z", stroke: colorBM, fill: colorBM.replace('0.4', '0.15'), width: 1.5, dash: [4, 4], points: { show: false } }
        ]
    };

    if (typeof uPlot !== 'undefined') {
        const parent = host.parentElement;
        opts.width = parent.clientWidth > 0 ? parent.clientWidth : 800;
        opts.height = parent.clientHeight > 0 ? parent.clientHeight - 120 : 400; // Extra großer Rand für Legende / X-Achse
        
        let initialData = [...Array(10)].map(() => [0]); // 10 arrays of [0]
        differentialTranslationPlot = new uPlot(opts, initialData, host);

        const yOverlay = document.getElementById('relativ-translation-y-axis-overlay');
        const xOverlay = document.getElementById('relativ-translation-x-axis-overlay');

        if (yOverlay) {
            let isYPanning = false;
            let lastY = 0;
            
            yOverlay.addEventListener('wheel', e => {
                e.preventDefault();
                differentialTranslationPlot._yLocked = true;
                const factor = e.deltaY < 0 ? 0.85 : 1.15;
                const rect = yOverlay.getBoundingClientRect();
                const pointerPos = (e.clientY - rect.top) / rect.height;
                const currentScale = differentialTranslationPlot.scales.y;
                if (!currentScale) return;
                const range = currentScale.max - currentScale.min;
                const newRange = range * factor;
                const newMin = currentScale.min + range * pointerPos - newRange * pointerPos;
                differentialTranslationPlot._yLocked = true;
                differentialTranslationPlot._yLockMin = newMin;
                differentialTranslationPlot._yLockMax = newMin + newRange;
                differentialTranslationPlot.setScale('y', { min: newMin, max: newMin + newRange });
            });
            
            yOverlay.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                isYPanning = true;
                lastY = e.clientY;
                differentialTranslationPlot._yLocked = true;
                yOverlay.style.cursor = 'grabbing';
            });
            
            window.addEventListener('mousemove', e => {
                if (!isYPanning) return;
                e.preventDefault();
                const deltaY = lastY - e.clientY;
                lastY = e.clientY;
                
                const scale = differentialTranslationPlot.scales.y;
                if (!scale || scale.min === undefined) return;
                const range = scale.max - scale.min;
                const delta = -(deltaY / yOverlay.getBoundingClientRect().height) * range;
                differentialTranslationPlot._yLocked = true;
                differentialTranslationPlot._yLockMin = scale.min + delta;
                differentialTranslationPlot._yLockMax = scale.max + delta;
                differentialTranslationPlot.setScale('y', { min: scale.min + delta, max: scale.max + delta });
            });
            
            window.addEventListener('mouseup', () => {
                if (isYPanning) {
                    isYPanning = false;
                    yOverlay.style.cursor = 'ns-resize';
                }
            });
            
            yOverlay.addEventListener('dblclick', () => {
                differentialTranslationPlot._xLocked = false;
                differentialTranslationPlot._yLocked = false;
                differentialTranslationPlot.setScale('y', { auto: true });
                
                const timespanSelect = document.getElementById('relativTranslationTimespan');
                if (timespanSelect) {
                    timespanSelect.value = "10"; 
                }
            });
        }

        if (xOverlay) {
            let isXPanning = false;
            let lastX = 0;
            
            xOverlay.addEventListener('wheel', e => {
                e.preventDefault();
                // Kein xLocked mehr, stattdessen verschieben wir das Offset/range
                const timespanSelect = document.getElementById('relativTranslationTimespan');
                if (timespanSelect && timespanSelect.value !== "all") timespanSelect.value = "all";
                
                const factor = e.deltaY < 0 ? 0.85 : 1.15;
                const sc = differentialTranslationPlot.scales.x;
                if (!sc || sc.min === undefined) return;
                
                const rect = xOverlay.getBoundingClientRect();
                const pointerPos = (e.clientX - rect.left) / rect.width;
                const range = sc.max - sc.min;
                const newRange = Math.max(0.2, range * factor);
                
                // Right-edge locked zoom wie im Livechart
                const newMax = sc.max;
                const newMin = newMax - newRange;
                if (newMax - newMin < 1e-9) return;
                
                // Neues Offset berechnen, damit die nächste Tick-Aktualisierung den Zoom behält
                const latestTs = window.activeSensors?.[0]?.accBuffer?.getLast?.()?.time || 0;
                const currentTimestamp = latestTs;
                if (currentTimestamp > 0) {
                    diffTranslationHistory.diffChartPanOffset = newMax - currentTimestamp;
                    if (diffTranslationHistory.diffChartPanOffset > 0) diffTranslationHistory.diffChartPanOffset = 0;
                }
                
                differentialTranslationPlot.setScale('x', { min: newMin, max: newMax });
            });
            
            xOverlay.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                isXPanning = true;
                lastX = e.clientX;
                differentialTranslationPlot._xLocked = true;
                
                const timespanSelect = document.getElementById('relativTranslationTimespan');
                if (timespanSelect && timespanSelect.value !== "all") timespanSelect.value = "all";
                
                xOverlay.style.cursor = 'grabbing';
            });
            
            window.addEventListener('mousemove', e => {
                if (!isXPanning) return;
                e.preventDefault();
                const deltaX = e.clientX - lastX;
                lastX = e.clientX;
                
                const sc = differentialTranslationPlot.scales.x;
                if (!sc || sc.min === undefined) return;
                
                const range = sc.max - sc.min;
                const widthPx = xOverlay.getBoundingClientRect().width;
                const deltaSec = -(deltaX / widthPx) * range;
                
                diffTranslationHistory.diffChartPanOffset += deltaSec;
                if (diffTranslationHistory.diffChartPanOffset > 0) diffTranslationHistory.diffChartPanOffset = 0;
                
                differentialTranslationPlot.setScale('x', { min: sc.min + deltaSec, max: sc.max + deltaSec });
            });
            
            window.addEventListener('mouseup', () => {
                if (isXPanning) {
                    isXPanning = false;
                    xOverlay.style.cursor = 'ew-resize';
                }
            });
            
            xOverlay.addEventListener('dblclick', () => {
                diffChartPanOffset = 0;
                differentialTranslationPlot._xLocked = false;
                differentialTranslationPlot._yLocked = false;
                differentialTranslationPlot._yLockMin = null;
                differentialTranslationPlot._yLockMax = null;
                differentialTranslationPlot.setScale('y', { auto: true });
                
                const timespanSelect = document.getElementById('relativTranslationTimespan');
                if (timespanSelect) {
                    timespanSelect.value = "10"; // Hard-Reset auf 10s Window
                }
            });
        }

        // Binde den Full-Reset auch an die Hauptansicht (Mitte des Charts)
        setTimeout(() => {
            const over = differentialTranslationPlot.root.querySelector('.u-over');
            if (over) {
                over.addEventListener('dblclick', () => {
                    diffChartPanOffset = 0;
                    differentialTranslationPlot._xLocked = false;
                    differentialTranslationPlot._yLocked = false;
                    differentialTranslationPlot._yLockMin = null;
                    differentialTranslationPlot._yLockMax = null;
                    differentialTranslationPlot.setScale('y', { auto: true });
                    const ts = document.getElementById('relativTranslationTimespan');
                    if (ts) ts.value = "10";
                });
            }
        }, 100);

        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === host && differentialTranslationPlot) {
                    const rect = entry.contentRect;
                    if (rect.width > 0 && rect.height > 0) {
                        // Das host element bekommt durch flex-grow genau die verfügbare restliche Größe!
                        // uPlot darf jetzt 100% davon einnehmen.
                        differentialTranslationPlot.setSize({ width: rect.width, height: rect.height });
                        
                        // Sync Overlays
                        const wrap = differentialTranslationPlot.root.querySelector('.u-wrap');
                        const bbox = differentialTranslationPlot.bbox;
                        if (wrap && bbox) {
                            if (yOverlay) {
                                yOverlay.style.left = `${Math.max(0, host.offsetLeft + wrap.offsetLeft)}px`;
                                yOverlay.style.top = `${Math.max(0, host.offsetTop + wrap.offsetTop + bbox.top)}px`;
                                yOverlay.style.width = `${Math.max(0, bbox.left)}px`;
                                yOverlay.style.height = `${Math.max(0, bbox.height)}px`;
                                yOverlay.style.background = 'transparent';
                            }
                            if (xOverlay) {
                                const xTop = host.offsetTop + wrap.offsetTop + bbox.top + bbox.height + 10; // Push down by 10px
                                const xHeight = Math.max(0, rect.height - (wrap.offsetTop + bbox.top + bbox.height));
                                // Erstrecke das Overlay über die komplette Breite exklusive Y-Achse
                                xOverlay.style.left = `${Math.max(0, host.offsetLeft + wrap.offsetLeft + bbox.left)}px`;
                                xOverlay.style.top = `${Math.max(0, xTop)}px`;
                                xOverlay.style.width = `${Math.max(0, rect.width - (wrap.offsetLeft + bbox.left))}px`;
                                xOverlay.style.height = `${Math.max(20, xHeight)}px`;
                                xOverlay.style.background = 'transparent';
                            }
                        }
                    }
                }
            }
        });
        resizeObserver.observe(host); // WICHTIG: Beobachte das Host-DIV selbst!
    }

    const pauseBtn = document.getElementById('relativTranslationPauseBtn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            isDifferentialTranslationPaused = !isDifferentialTranslationPaused;
            pauseBtn.innerHTML = isDifferentialTranslationPaused ? '<i class="fas fa-play"></i> Play' : '<i class="fas fa-pause"></i> Pause';
        });
    }
}

function calculateDiffRms(masterNode, secondNode, windowSize) {
    // Falls einer der Buffer fehlt
    const masterBuffer = masterNode?.accBuffer;
    const nodeBuffer = secondNode?.accBuffer;
    if (!masterBuffer || !nodeBuffer) return { x: 0, y: 0, z: 0, total: 0 };
    
    // Wir holen uns die rohen X,Y,Z Arrays der letzten N Samples
    // ACHTUNG: Die Arrays könnten leicht zeitlich versetzt sein, aber für grobe RMS über 30ms ist das okay.
    const mx = masterBuffer.getFieldTypedArray('x', windowSize);
    const my = masterBuffer.getFieldTypedArray('y', windowSize);
    const mz = masterBuffer.getFieldTypedArray('z', windowSize);
    
    const nx = nodeBuffer.getFieldTypedArray('x', windowSize);
    const ny = nodeBuffer.getFieldTypedArray('y', windowSize);
    const nz = nodeBuffer.getFieldTypedArray('z', windowSize);
    
    const count = Math.min(mx.length, nx.length, windowSize);
    if (count === 0) return { x: 0, y: 0, z: 0, total: 0 };

    let sumSqX = 0, sumSqY = 0, sumSqZ = 0, sumSqTotal = 0;
    
    const noiseThreshold = Math.max(
        masterNode?.calibrationState?.accNoise || 15,
        secondNode?.calibrationState?.accNoise || 15
    );
    
    for (let i = 0; i < count; i++) {
        let dx = nx[i] - mx[i];
        let dy = ny[i] - my[i];
        let dz = nz[i] - mz[i];
        
        if (Math.abs(dx) < noiseThreshold) dx = 0;
        if (Math.abs(dy) < noiseThreshold) dy = 0;
        if (Math.abs(dz) < noiseThreshold) dz = 0;
        
        const dTotal = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        sumSqX += dx * dx;
        sumSqY += dy * dy;
        sumSqZ += dz * dz;
        sumSqTotal += dTotal * dTotal;
    }
    
    return {
        x: Math.sqrt(sumSqX / count),
        y: Math.sqrt(sumSqY / count),
        z: Math.sqrt(sumSqZ / count),
        total: Math.sqrt(sumSqTotal / count)
    };
}

// Wir speichern die letzten X sekunden für den Chart
const diffHistory = {
    time: [], x: [], y: [], z: [], total: []
};

const kinematicIntegrator = {
    master: { lastIdx: 0, vel: {x:0, y:0, z:0}, pos: {x:0, y:0, z:0}, grav: null, lastTime: 0 },
    second: { lastIdx: 0, vel: {x:0, y:0, z:0}, pos: {x:0, y:0, z:0}, grav: null, lastTime: 0 }
};

window.resetRelativeAnalysisBuffers = function() {
    diffHistory.time.length = 0;
    diffHistory.x.length = 0;
    diffHistory.y.length = 0;
    diffHistory.z.length = 0;
    diffHistory.total.length = 0;

    kinematicIntegrator.master = { lastIdx: 0, vel: {x:0, y:0, z:0}, pos: {x:0, y:0, z:0}, grav: null, lastTime: 0 };
    kinematicIntegrator.second = { lastIdx: 0, vel: {x:0, y:0, z:0}, pos: {x:0, y:0, z:0}, grav: null, lastTime: 0 };

    diffTranslationHistory.time.length = 0;
    diffTranslationHistory.rx.length = 0;
    diffTranslationHistory.ry.length = 0;
    diffTranslationHistory.rz.length = 0;
    diffTranslationHistory.mx.length = 0;
    diffTranslationHistory.my.length = 0;
    diffTranslationHistory.mz.length = 0;
    diffTranslationHistory.nx.length = 0;
    diffTranslationHistory.ny.length = 0;
    diffTranslationHistory.nz.length = 0;
};

function getPureAccState(node, stateKey) {
    const state = kinematicIntegrator[stateKey];
    const nodeBuf = node?.accBuffer;
    if (!nodeBuf) return { q: [1,0,0,0], p: {x:0, y:0, z:0} };
    const isReplay = window.isOfflineReplayMode;
    const NOISE_G_THRESHOLD = isReplay ? 0 : (node?.calibrationState?.accNoise || 15);

    const isRing = (typeof nodeBuf.getFieldTypedArray === 'function');
    const bufLen = isRing ? nodeBuf.length : nodeBuf.length;
    if (bufLen === 0) return { q: [1,0,0,0], p: {x:0, y:0, z:0} };

    // 2. Abstandsveränderung (Doppelintegration mit Highpass / Leaky Integrator)
    let newSamples = [];
    const minTime_uS = state.lastTime > 0 ? state.lastTime * 1000000 : 0;

    if (isRing) {
        if (bufLen > 0) {
            if (minTime_uS === 0) {
                // Init: Letzte 100 Samples
                const n = Math.min(100, bufLen);
                const xArr = nodeBuf.getFieldTypedArray('x', n);
                const yArr = nodeBuf.getFieldTypedArray('y', n);
                const zArr = nodeBuf.getFieldTypedArray('z', n);
                const tArr = nodeBuf.getFieldTypedArray('time', n);
                for(let i=0; i<n; i++) newSamples.push({t: tArr[i]/1000000, ax: xArr[i], ay: yArr[i], az: zArr[i]});
            } else {
                try {
                    const win = nodeBuf.getWindowByTime('time', minTime_uS, ['time', 'x', 'y', 'z']);
                    if (win && win.time) {
                        for(let i=0; i<win.time.length; i++) {
                            if (win.time[i] > minTime_uS && isFinite(win.time[i])) {
                                newSamples.push({t: win.time[i]/1000000, ax: win.x[i], ay: win.y[i], az: win.z[i]});
                            }
                        }
                    }
                } catch(e) {}
            }
        }
    } else {
        if (bufLen > 0) {
            if (minTime_uS === 0) {
                const startIdx = Math.max(0, bufLen - 100);
                for(let i=startIdx; i<bufLen; i++) {
                    if (nodeBuf[i]) newSamples.push({t: nodeBuf[i][0]/1000000, ax: nodeBuf[i][1], ay: nodeBuf[i][2], az: nodeBuf[i][3]});
                }
            } else {
                let temp = [];
                for(let i=bufLen - 1; i>=0; i--) {
                    const item = nodeBuf[i];
                    if (!item || !isFinite(item[0])) continue;
                    if (item[0] <= minTime_uS) break;
                    temp.push({t: item[0]/1000000, ax: item[1], ay: item[2], az: item[3]});
                }
                newSamples = temp.reverse();
            }
        }
    }

    // Fallback: Falls noch keine Schwerkraft erfasst, setze sie auf den allerersten Wert
    if (!state.grav) {
        if (newSamples.length > 0) {
            state.grav = { x: newSamples[0].ax, y: newSamples[0].ay, z: newSamples[0].az };
        } else {
            state.grav = {x: 0, y: 0, z: 1000}; 
        }
    }

    // Verhindere CPU Stall wenn Tab lange im Hintergrund war
    if (newSamples.length > 2000) {
        newSamples = newSamples.slice(newSamples.length - 2000);
    }
    
    // Scale faktor: mg -> m/s^2
    const scale = 9.81 / 1000;

    for (let i = 0; i < newSamples.length; i++) {
        const smp = newSamples[i];
        if (!isFinite(smp.ax) || !isFinite(smp.ay) || !isFinite(smp.az)) continue;
        
        let dt = smp.t - state.lastTime;
        if (dt <= 0 || dt > 0.1) dt = 0.0003;
        state.lastTime = smp.t;

        const dtMs = dt * 1000;

        // 1. DC-Offset (Schwerkraft & statische Kippung)
        // Aggressiverer EWMA Filter (ca. 5Hz Cutoff). Dieser tötet langsame Handbewegungen
        // und Rotations-Einströme (Gravity-Bleed) radikal ab, lässt aber Vibration durch!
        const alpha = 1 - Math.pow(0.995, dtMs); // dtMs normiert den EWMA
        state.grav.x = state.grav.x * (1 - alpha) + smp.ax * alpha;
        state.grav.y = state.grav.y * (1 - alpha) + smp.ay * alpha;
        state.grav.z = state.grav.z * (1 - alpha) + smp.az * alpha;

        // 2. Highpass-Beschleunigung (ohne Schwerkraft/DC-Anteil)
        let hx = smp.ax - state.grav.x;
        let hy = smp.ay - state.grav.y;
        let hz = smp.az - state.grav.z;
        
        // 3. NOISE GATE (Sensorrauschen dynamisch via Kalibrierung eliminieren)
        if (Math.abs(hx) < NOISE_G_THRESHOLD) hx = 0;
        if (Math.abs(hy) < NOISE_G_THRESHOLD) hy = 0;
        if (Math.abs(hz) < NOISE_G_THRESHOLD) hz = 0;
        
        hx *= scale; hy *= scale; hz *= scale;
        
        state.vel.x += hx * dt;
        state.vel.y += hy * dt;
        state.vel.z += hz * dt;
        
        // Leaky Velocity: Harte Dämpfung (zieht das Modell sofort zum Stillstand)
        const velDecay = Math.pow(0.99, dtMs);
        state.vel.x *= velDecay; state.vel.y *= velDecay; state.vel.z *= velDecay;
        
        state.pos.x += state.vel.x * dt;
        state.pos.y += state.vel.y * dt;
        state.pos.z += state.vel.z * dt;
        
        // Leaky Position: Gummi-Band Effekt, reißt die Node rigoros zur Mitte (0) zurück
        const posDecay = Math.pow(0.95, dtMs);
        state.pos.x *= posDecay; state.pos.y *= posDecay; state.pos.z *= posDecay;
    }

    // Orientierung aus der tiefpassgefilterten Schwerkraft (state.grav) berechnen!
    const pitch = Math.atan2(-state.grav.x, Math.sqrt(state.grav.y*state.grav.y + state.grav.z*state.grav.z));
    const roll  = Math.atan2(state.grav.y, state.grav.z);
    
    const quat = new globalThis.THREE.Quaternion().setFromEuler(new globalThis.THREE.Euler(pitch, roll, 0, 'ZYX'));
    const qArray = [quat.w, quat.x, quat.y, quat.z];

    return { q: qArray, p: state.pos };
}

export function startRelativeDiffRmsRuntime() {
    if (differentialRmsTimer) clearInterval(differentialRmsTimer);
    
    // Ca. 30 Hz refresh
    differentialRmsTimer = setInterval(() => {
        const container = document.getElementById('relativeAnalysisArea');
        if (!container || container.style.display === 'none') return; // Nichts tun, wenn gesamtes Analyse-Areal zu ist
        
        const masterNode = window.activeSensors?.find(n => n.isMaster);
        const selNodeIp = document.getElementById('relativSecondaryNodeSelect')?.value;
        const secondNode = window.activeSensors?.find(n => n.ip === selNodeIp);
        
        if (!masterNode) return;

        const latestTs = masterNode?.accBuffer?.getLast?.()?.time || 0;
        
        // Block duplicates immediately to avoid wiping out the trail arrays during pause
        if (latestTs > 0) {
            if (latestTs === window.lastProcessedSampleTimeUs) {
                return;
            }
            if (latestTs < window.lastProcessedSampleTimeUs) {
                Object.keys(diffTranslationHistory).forEach(k => diffTranslationHistory[k].length = 0);
                Object.keys(diffHistory).forEach(k => diffHistory[k].length = 0);
                if (window.relativKinematicViewport) {
                    window.relativKinematicViewport.trailHistory.master.length = 0;
                    window.relativKinematicViewport.trailHistory.sNode.length = 0;
                    window.relativKinematicViewport.trailHistory.relNode.length = 0;
                }
            }
        }
        window.lastProcessedSampleTimeUs = latestTs;

        // ============================================
        // PHASE 1: KINEMATIK UPDATE (Immer berechnen für Translation Chart!)
        // ============================================
        // Abkopplung vom Kalman-Gyroskop. Reine Acc-Orientierung und Integration:
        const mState = getPureAccState(masterNode, 'master');
        const sState = getPureAccState(secondNode, 'second');

        const hasSecond = !!secondNode;

        if (window.relativKinematicViewport && window.relativKinematicViewport.visible) {
            const latestTs = masterNode?.accBuffer?.getLast?.()?.time;
            const refTime = latestTs ? latestTs / 1000000 : performance.now() / 1000;
            window.relativKinematicViewport.updateState(
                mState.q,
                sState.q,
                mState.p,
                sState.p,
                hasSecond,
                refTime
            );
        }

        // ============================================
        // PHASE 1.5: TRANSLATION CHART UPDATE
        // ============================================
        if (differentialTranslationPlot && !isDifferentialTranslationPaused) {
            const latestTs = masterNode?.accBuffer?.getLast?.()?.time || 0;
            const historyLen = diffTranslationHistory.time.length;
            const lastTs = historyLen > 0 ? diffTranslationHistory.time[historyLen - 1] : 0;
            
            // NUR NEUE PUNKTE PUSHEN! Verhindert Treppenstufen und senkrechte Linien bei UDP-Clumping
            if (latestTs > 0 && latestTs > lastTs) {
                const timestamp = latestTs;
                diffTranslationHistory.time.push(timestamp);
        
        // Relativ
        diffTranslationHistory.rx.push((sState.p.x - mState.p.x) * 1000);
        diffTranslationHistory.ry.push((sState.p.y - mState.p.y) * 1000);
        diffTranslationHistory.rz.push((sState.p.z - mState.p.z) * 1000);
        
        // Master
        diffTranslationHistory.mx.push((mState.p.x) * 1000);
        diffTranslationHistory.my.push((mState.p.y) * 1000);
        diffTranslationHistory.mz.push((mState.p.z) * 1000);
        
        // Node
        diffTranslationHistory.nx.push((sState.p.x) * 1000);
        diffTranslationHistory.ny.push((sState.p.y) * 1000);
        diffTranslationHistory.nz.push((sState.p.z) * 1000);
        
        const timespanSelect = document.getElementById('relativTranslationTimespan');
        let timespanVal = timespanSelect ? timespanSelect.value : "10";
        let rangeSecs = timespanVal === "all" ? 600 : parseInt(timespanVal);
        let rangeUs = rangeSecs * 1000000;
        
        // Behalte genug Punkte im Buffer (ca. 30 Hz Updaterate)
        const maxPoints = Math.max(500, rangeSecs * 30);
        if (diffTranslationHistory.time.length > maxPoints) {
            Object.keys(diffTranslationHistory).forEach(k => diffTranslationHistory[k].shift());
        }
        
        const translationTab = document.getElementById('relativTranslationTab');
        const isVisible = translationTab && translationTab.style.display !== 'none';

        // Rendere ins Chart, wenn sichtbar
        if (isVisible) {
            // Direkte Übergabe der absoluten Unix-Timestamps!
            differentialTranslationPlot.setData([
                diffTranslationHistory.time,
                diffTranslationHistory.mx, diffTranslationHistory.my, diffTranslationHistory.mz,
                diffTranslationHistory.nx, diffTranslationHistory.ny, diffTranslationHistory.nz,
                diffTranslationHistory.rx, diffTranslationHistory.ry, diffTranslationHistory.rz
            ]);
            
            
            if (timespanVal !== lastTimespanVal && timespanVal !== "all") {
               diffChartPanOffset = 0; 
               lastTimespanVal = timespanVal;
            } else if (timespanVal !== "all") {
               lastTimespanVal = timespanVal;
            }
            
            const scX = differentialTranslationPlot.scales.x;
            if (scX && scX.max !== undefined && scX.min !== undefined) {
                if (differentialTranslationPlot._xLocked) {
                    // Do not auto-pan if the user is explicitly dragging the chart
                } else {
                    let visibleRange = scX.max - scX.min;
                    
                    // Ignoriere NaN oder wilde initial bounds (weniger als 0.1 Sekunden = 100000us)
                    if (!isFinite(visibleRange) || visibleRange < 100000) visibleRange = rangeUs;
                    
                    // Wenn eine feste Zeitspanne gewählt ist, überschreiben wir die sichtbare Breite strikt
                    if (timespanVal !== "all") {
                        visibleRange = rangeUs;
                    }
                    
                    // Wenn wir nicht zoomen/pannen (all) und panOffset auf 0 ist (-0.5s = -500000us)
                    if (diffChartPanOffset > -500000) {
                        diffChartPanOffset = 0;
                        differentialTranslationPlot.setScale('x', { min: timestamp - visibleRange, max: timestamp });
                    } else {
                        differentialTranslationPlot.setScale('x', {
                            min: timestamp - visibleRange + diffChartPanOffset,
                            max: timestamp + diffChartPanOffset
                        });
                    }
                }
            }
            } // close if (latestTs > lastTs)
        }
    }

        // ============================================
        // PHASE 2: RMS UPDATE
        // ============================================
        const diffTab = document.getElementById('relativDiffRmsTab');
        if (diffTab && diffTab.style.display !== 'none' && differentialRmsPlot && !isDifferentialRmsPaused) {
            // Berechne RMS über die letzten 100 Samples (ca. 30ms bei 3.3kHz)
            const rms = calculateDiffRms(masterNode, secondNode, 100);
            
            // Füge Zeit (relativ) und Daten hinzu
            const latestTs = masterNode?.accBuffer?.getLast?.()?.time;
            const now = latestTs ? latestTs / 1000000 : performance.now() / 1000;
            
            // Verhindere Push gleicher Daten, wenn Replay pausiert ist
            if (diffHistory.time.length > 0 && diffHistory.time[diffHistory.time.length - 1] === now) {
                // Keine neuen Daten
            } else {
                diffHistory.time.push(now);
                diffHistory.x.push(rms.x);
                diffHistory.y.push(rms.y);
                diffHistory.z.push(rms.z);
                diffHistory.total.push(rms.total);
            }
            
            // Behalte nur die letzten 500 Punkte (ca. 16 Sekunden bei 30 Hz)
            if (diffHistory.time.length > 500) {
                diffHistory.time.shift();
                diffHistory.x.shift();
                diffHistory.y.shift();
                diffHistory.z.shift();
                diffHistory.total.shift();
            }
            
            // X-Achse normieren (beginnt bei 0 links, geht nach rechts ins negative, oder einfach relativ)
            const displayTime = diffHistory.time.map(t => t - now);
            
            differentialRmsPlot.setData([
                displayTime,
                diffHistory.x,
                diffHistory.y,
                diffHistory.z,
                diffHistory.total
            ]);
        }

        // ============================================
        // PHASE 4: LISSAJOUS UPDATE
        // ============================================
        const lissajousTab = document.getElementById('relativLissajousTab');
        if (lissajousTab && lissajousTab.style.display !== 'none' && window.lissajousCanvasCtx) {
            updateLissajousDraw(masterNode.accBuffer, secondNode?.accBuffer);
        }
        
    }, 33);
}

// ---------------------------------------------------------
// PHASE 3: KINEMATIK (INITIALIZATION)
// ---------------------------------------------------------
export function initRelativeKinematicViewport() {
    // Wait until THREE is ready or script2 loaded
    setTimeout(() => {
        window.relativKinematicViewport = new RelativeKinematicViewport({ rootId: 'relativKinematicTab' });
    }, 500);
}

// ---------------------------------------------------------
// PHASE 4: LISSAJOUS (INITIALIZATION & LOGIC)
// ---------------------------------------------------------
let lissajousCtx = null;
let lissajousCanvas = null;

export function initRelativeLissajousChart() {
    const parent = document.getElementById('relativLissajousTab');
    if (!parent) return;

    // Remove center alignment so the tab can fully stretch vertically and horizontally!
    parent.style.alignItems = "stretch";
    parent.style.justifyContent = "stretch";

    parent.innerHTML = `
        <div style="flex-grow: 1; width: 100%; height: 100%; display:flex; flex-direction:column; align-items:center; position:relative; background: #0b0f19; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow:hidden;">
            <div style="position:absolute; top: 10px; left: 10px; color:#aaa; font-family:monospace; font-size: 14px; z-index: 10;">
                Phasen-Lissajous X-Achse (Node vs Master)<br>
                <span style="color:red; font-size:12px;">X-Achse: Master</span> | <span style="color:cyan; font-size:12px;">Y-Achse: Node</span>
            </div>
            <canvas id="lissajousCanvas" style="display:block; width:100%; height:100%; position:absolute; top:0; left:0;"></canvas>
        </div>
    `;

    setTimeout(() => {
        lissajousCanvas = document.getElementById('lissajousCanvas');
        if (lissajousCanvas) {
            lissajousCtx = lissajousCanvas.getContext('2d');
            window.lissajousCanvasCtx = lissajousCtx;
            resizeLissajous();
            window.addEventListener('resize', resizeLissajous);
        }
    }, 100);
}

function resizeLissajous() {
    if (!lissajousCanvas) return;
    const parent = lissajousCanvas.parentElement;
    if (parent.clientWidth === 0 || parent.clientHeight === 0) return; // Prevent collapse if hidden
    lissajousCanvas.width = parent.clientWidth;
    lissajousCanvas.height = parent.clientHeight;
}
window.resizeLissajousGlobally = resizeLissajous;

function updateLissajousDraw(masterBuf, nodeBuf) {
    if (!lissajousCtx || !lissajousCanvas) return;
    const width = lissajousCanvas.width;
    const height = lissajousCanvas.height;

    // Draw background (fade out old lines slightly for cool phosphor effect)
    lissajousCtx.fillStyle = 'rgba(11, 15, 25, 0.2)';
    lissajousCtx.fillRect(0, 0, width, height);

    // Draw axes
    lissajousCtx.strokeStyle = 'rgba(255,255,255,0.1)';
    lissajousCtx.beginPath();
    lissajousCtx.setLineDash([5, 5]);
    lissajousCtx.moveTo(0, height/2); lissajousCtx.lineTo(width, height/2);
    lissajousCtx.moveTo(width/2, 0); lissajousCtx.lineTo(width/2, height);
    lissajousCtx.stroke();
    lissajousCtx.setLineDash([]);

    if (!nodeBuf) {
        lissajousCtx.fillStyle = 'rgba(255, 71, 87, 0.7)';
        lissajousCtx.font = '14px monospace';
        lissajousCtx.textAlign = 'center';
        lissajousCtx.fillText('Warten auf 2. Sensor...', width/2, height/2 + 20);
        return;
    }

    const mNewest = masterBuf.getLast()?.time || 0;
    const nNewest = nodeBuf.getLast()?.time || 0;
    
    if (mNewest <= 0 || nNewest <= 0) return;

    // Wir rufen die letzten ~1000 Samples ab (entspricht ca. 300ms)
    const windowSize = 1000;
    const mWindow = masterBuf.getWindowFromIndex(Math.max(0, masterBuf.length - windowSize), ['time', 'x']);
    const nWindow = nodeBuf.getWindowFromIndex(Math.max(0, nodeBuf.length - (windowSize + 200)), ['time', 'x']);

    const mTime = mWindow.time;
    const mx = mWindow.x;
    const nTime = nWindow.time;
    const nx = nWindow.x;

    if (!mTime || !nTime || mTime.length < 10 || nTime.length < 10) {
        lissajousCtx.fillStyle = 'rgba(255, 71, 87, 0.7)';
        lissajousCtx.font = '14px monospace';
        lissajousCtx.textAlign = 'center';
        lissajousCtx.fillText('Puffere Daten...', width/2, height/2 + 20);
        return; 
    }

    // Die Zeitstempel der Sensoren (Uptime) driften extrem weit auseinander! 
    // Wir synchronisieren sie virtuell, indem wir für beide das Ende auf "0" setzen (Relative Time in die Vergangenheit).
    const mMaxTime = mTime[mTime.length - 1];
    const nMaxTime = nTime[nTime.length - 1];

    // Arrays für synchrone Zeitpaare
    const alignedX = new Float32Array(mTime.length);
    const alignedY = new Float32Array(mTime.length);
    let validCount = 0;
    let meanX = 0;
    let meanY = 0;
    
    let nIdx = 0;
    const nodeLength = nTime.length;
    
    // Two-Pointer Synchronization anhang relativer Age-Metrik
    for (let i = 0; i < mTime.length; i++) {
        if (mTime[i] <= 0) continue;
        
        // Relatives Alter dieses Master-Samples (z.B. -150000 µs = -150ms)
        const mtRel = mTime[i] - mMaxTime;
        
        // Finde das dazu passende Node-Sample
        while (nIdx < nodeLength && (nTime[nIdx] - nMaxTime) < mtRel) {
            nIdx++;
        }
        
        if (nIdx === 0 || nIdx >= nodeLength) continue; 
        
        const t1Rel = nTime[nIdx - 1] - nMaxTime;
        const t2Rel = nTime[nIdx] - nMaxTime;
        
        // Verhindern von falschen Interpolationen über große Gaps (100ms)
        if (t2Rel - t1Rel > 100000 || mtRel - t1Rel > 100000) continue; 

        let dt = t2Rel - t1Rel;
        let portion = (dt > 0) ? (mtRel - t1Rel) / dt : 0;
        
        // Node Wert linear interpolieren
        const nv = nx[nIdx - 1] * (1 - portion) + nx[nIdx] * portion;
        
        alignedX[validCount] = mx[i];
        alignedY[validCount] = nv;
        meanX += mx[i];
        meanY += nv;
        validCount++;
    }
    
    // Fallback falls die Latenzen massiv auseinander liegen – extrem selten, aber sicherheitshalber:
    if (validCount < 10) {
        lissajousCtx.fillStyle = 'rgba(255, 71, 87, 0.7)';
        lissajousCtx.font = '14px monospace';
        lissajousCtx.textAlign = 'center';
        lissajousCtx.fillText('Warte auf Datenüberlappung (Latenz)...', width/2, height/2 + 20);
        return; 
    }
    
    meanX /= validCount;
    meanY /= validCount;
    
    // Auto-Scaling (Dynamic Bounds) berechnen
    let localAbsMax = 0;
    for (let i = 0; i < validCount; i++) {
        localAbsMax = Math.max(localAbsMax, Math.abs(alignedX[i] - meanX), Math.abs(alignedY[i] - meanY));
    }
    
    if (!window.lissajousMaxMg || isNaN(window.lissajousMaxMg)) window.lissajousMaxMg = 100;
    
    // Auto-Scale Decay: Wächst sofort, schrumpft langsam (für Oszilloskop-Dynamik)
    if (localAbsMax > window.lissajousMaxMg) {
        window.lissajousMaxMg = localAbsMax;
    } else {
        window.lissajousMaxMg = window.lissajousMaxMg * 0.99 + Math.max(localAbsMax, 100) * 0.01;
    }
    
    const maxMg = window.lissajousMaxMg * 1.25; // 25% Rand

    lissajousCtx.strokeStyle = 'rgba(0, 255, 255, 0.9)'; // Cyan Laser-Trace
    lissajousCtx.lineWidth = 1.5;
    lissajousCtx.lineJoin = "round";
    lissajousCtx.beginPath();

    for (let i = 0; i < validCount; i++) {
        // Highpass (Mean Subtraction)
        const rx = alignedX[i] - meanX;
        const ry = alignedY[i] - meanY;
        
        // Map to Canvas
        const px = (rx / maxMg) * (width / 2) + (width / 2);
        const py = -(ry / maxMg) * (height / 2) + (height / 2);

        if (i === 0) lissajousCtx.moveTo(px, py);
        else lissajousCtx.lineTo(px, py);
    }
    lissajousCtx.stroke();
    
    // Glow-Effekt (zweite dicke Linie mit geringer Deckkraft)
    lissajousCtx.strokeStyle = 'rgba(0, 255, 255, 0.15)'; 
    lissajousCtx.lineWidth = 4;
    lissajousCtx.stroke();
    
    // Min/Max Skala in die Ecken zeichnen
    lissajousCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    lissajousCtx.font = '10px monospace';
    lissajousCtx.textAlign = 'right';
    lissajousCtx.fillText(Math.round(maxMg) + ' mg', width - 10, height/2 - 10);
    lissajousCtx.textAlign = 'center';
    lissajousCtx.fillText(Math.round(maxMg) + ' mg', width/2, 20);
}
