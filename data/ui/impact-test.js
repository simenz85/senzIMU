// c:\SENZIMU_github_sicherung\data\ui\impact-test.js

let state = 'IDLE'; // IDLE, ARMED, TRIGGERED, ANALYZING
let triggerThresholdRaw = 4000; // 4g in mg
let base_x = null, base_y = null, base_z = null;
let bufferSize = 2048;
let captureX = new Float32Array(bufferSize);
let captureY = new Float32Array(bufferSize);
let captureZ = new Float32Array(bufferSize);
let captureTime = new Float32Array(bufferSize);
let captureIndex = 0;

const preBufferSize = 100;
let preX = new Float32Array(preBufferSize);
let preY = new Float32Array(preBufferSize);
let preZ = new Float32Array(preBufferSize);
let preTime = new Float32Array(preBufferSize);
let preBufferIndex = 0;
let preBufferCount = 0;

let chartInstance = null;
let rpmChartContainer;
let rpmChartInstance = null;

// UI Elements
let btnArm;
let statusStr;
let resultsCard;
let impactTablesContainer;
let peakFreqDisplay;
let chartContainer;
let timeChartContainer;
let timeChartInstance = null;
let fluteSelect;
let fluteCustom;
let autoRestartCb;
let maxRpmInput;
let savedProfiles = { workpiece: { samples: [], peaks: [], freqs: [], mags: [] }, tool: { samples: [], peaks: [], freqs: [], mags: [] } };
let impactModeRadios;
let impactTargetRadios;
let btnImpactClear;
let impactFluteContainer;
let impactViewFilterRadios;
let lblImpactCountWp;
let lblImpactCountTool;
let btnImpactPdf;

function createCursorTooltipPlugin(unitX) {
    let tooltip;
    function init(u) {
        let over = u.root.querySelector(".u-over");
        over.style.cursor = "crosshair";
        tooltip = document.createElement("div");
        tooltip.style.position = "absolute";
        tooltip.style.background = "rgba(24, 28, 36, 0.85)";
        tooltip.style.color = "#FFD600";
        tooltip.style.padding = "4px 8px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "12px";
        tooltip.style.fontFamily = "monospace";
        tooltip.style.border = "1px solid rgba(255, 214, 0, 0.3)";
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.zIndex = "100";
        tooltip.style.whiteSpace = "nowrap";
        over.appendChild(tooltip);
        
        over.addEventListener("mouseenter", () => { tooltip.style.display = "block"; });
        over.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
    }
    
    function setCursor(u) {
        const { left, top } = u.cursor;
        if (top < 0 || left < 0) {
            if (tooltip) tooltip.style.display = "none";
            return;
        }

        const valX = u.posToVal(left, "x");
        const valY = u.posToVal(top, "y");
        tooltip.innerHTML = `<strong>X:</strong> ${valX.toFixed(1)} ${unitX}<br/><strong>Y:</strong> ${valY.toFixed(2)}`;
        tooltip.style.display = "block";

        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
        let posX = left + 15;
        let posY = top - tooltipHeight / 2;

        if (posX + tooltipWidth > u.bbox.width) {
            posX = left - tooltipWidth - 15;
        }

        tooltip.style.left = Math.round(posX) + "px";
        tooltip.style.top = Math.round(posY) + "px";
    }

    return { hooks: { init: [init], setCursor: [setCursor] } };
}

function wheelZoomPlugin(factor = 0.85) {
    return {
        hooks: {
            ready: u => {
                u.root.addEventListener("wheel", e => {
                    let overRect = u.root.querySelector(".u-over").getBoundingClientRect();
                    
                    let mx = e.clientX;
                    let my = e.clientY;
                    
                    // Maus-Position bestimmen
                    let isYAxis = mx < overRect.left;
                    let isXAxis = my > overRect.bottom;
                    
                    if (!isYAxis && !isXAxis) {
                        return; // Achsen nicht berührt -> Normales Page-Scrolling zulassen
                    }

                    e.preventDefault();
                    
                    let zoomDir = e.deltaY < 0 ? factor : 1/factor;

                    if (isYAxis) {
                        let sc = u.scales.y;
                        let range = sc.max - sc.min;
                        if (!range) return;
                        
                        let pointerPos = (my - overRect.top) / overRect.height;
                        pointerPos = Math.max(0, Math.min(1, pointerPos));
                        
                        let valAtCursor = sc.max - pointerPos * range;
                        let nRange = range * zoomDir;
                        let nMax = valAtCursor + (sc.max - valAtCursor) * zoomDir;
                        let nMin = nMax - nRange;
                        
                        u.setScale("y", { min: nMin, max: nMax });
                    } 
                    else if (isXAxis) {
                        let sc = u.scales.x;
                        let range = sc.max - sc.min;
                        if (!range) return;
                        
                        let pointerPos = (mx - overRect.left) / overRect.width;
                        pointerPos = Math.max(0, Math.min(1, pointerPos));
                        
                        let valAtCursor = sc.min + pointerPos * range;
                        let nRange = range * zoomDir;
                        let nMin = valAtCursor - (valAtCursor - sc.min) * zoomDir;
                        let nMax = nMin + nRange;
                        
                        u.setScale("x", { min: nMin, max: nMax });
                    }
                }, { passive: false });

                // Cursor-Aktualisierung beim Hovern über die Achsen
                u.root.addEventListener("mousemove", e => {
                    let overRect = u.root.querySelector(".u-over").getBoundingClientRect();
                    let mx = e.clientX;
                    let my = e.clientY;
                    
                    let isYAxis = mx < overRect.left;
                    let isXAxis = my > overRect.bottom;
                    
                    if (isYAxis) {
                        u.root.style.cursor = "ns-resize";
                    } else if (isXAxis) {
                        u.root.style.cursor = "ew-resize";
                    } else {
                        u.root.style.cursor = ""; // Standard uPlot Cursor für Plot-Fläche (Crosshair)
                    }
                });

                u.root.addEventListener("mouseleave", () => {
                    u.root.style.cursor = "";
                });
            }
        }
    };
}

window.rebuildFftChart = function() {
    if (!chartContainer) chartContainer = document.getElementById('impactChartContainer');
    if (!chartContainer || chartContainer.clientWidth === 0) return;

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
    
    let showX = document.getElementById('impactAxisX') ? document.getElementById('impactAxisX').checked : true;
    let showY = document.getElementById('impactAxisY') ? document.getElementById('impactAxisY').checked : true;
    let showZ = document.getElementById('impactAxisZ') ? document.getElementById('impactAxisZ').checked : true;

    let seriesConfig = [ {} ]; // X-Achse
    let chartData = [];

    let xFreqs = new Float32Array(2048);
    for(let i=0; i<2048; i++) xFreqs[i] = i; 

    if (typeof savedProfiles !== 'undefined') {
        if (savedProfiles.workpiece.samples.length > 0) {
            xFreqs = savedProfiles.workpiece.samples[0].freqs;
        } else if (savedProfiles.tool.samples.length > 0) {
            xFreqs = savedProfiles.tool.samples[0].freqs;
        }
    }
    chartData.push(xFreqs);
    
    let viewMode = 'combined';
    const filterRadios = document.querySelectorAll('input[name="impactViewFilter"]');
    if (filterRadios) filterRadios.forEach(r => { if(r.checked) viewMode = r.value; });

    let wpSamples = (viewMode === 'combined' || viewMode === 'workpiece') && savedProfiles && savedProfiles.workpiece ? savedProfiles.workpiece.samples : [];
    let toolSamples = (viewMode === 'combined' || viewMode === 'tool') && savedProfiles && savedProfiles.tool ? savedProfiles.tool.samples : [];

    if (wpSamples.length === 0 && toolSamples.length === 0) {
        seriesConfig.push({ label: "Werkstück Total", stroke: "#ffd600", width: 2 });
        seriesConfig.push({ label: "Werkzeug Total", stroke: "#4da6ff", width: 2 });
        chartData.push(new Float32Array(xFreqs.length));
        chartData.push(new Float32Array(xFreqs.length));
    } else {
        // Einzel-Hits leicht transparent einzeichnen (Historie) -> Immer basierend auf Total Mags
        for (let i = 0; i < wpSamples.length; i++) {
            let op = 1.0 - (wpSamples.length - 1 - i) * 0.15;
            if (op < 0.2) op = 0.2;
            let m = wpSamples[i].mags || new Float32Array(xFreqs.length);
            seriesConfig.push({ label: `WP Hit #${i+1}`, stroke: `rgba(255, 214, 0, ${op * 0.4})`, width: 1 });
            chartData.push(m);
        }

        for (let i = 0; i < toolSamples.length; i++) {
            let op = 1.0 - (toolSamples.length - 1 - i) * 0.15;
            if (op < 0.2) op = 0.2;
            let m = toolSamples[i].mags || new Float32Array(xFreqs.length);
            seriesConfig.push({ label: `Tool Hit #${i+1}`, stroke: `rgba(77, 166, 255, ${op * 0.4})`, width: 1 });
            chartData.push(m);
        }

        let configs = [];
        if ((viewMode === 'combined' || viewMode === 'workpiece') && savedProfiles.workpiece.freqs) configs.push({ key: 'workpiece', label: 'WP', colorTotal: '#ffd600', colorX: '#ff4a4a', colorY: '#4caf50', colorZ: '#4da6ff', dash: [] });
        if ((viewMode === 'combined' || viewMode === 'tool') && savedProfiles.tool.freqs) configs.push({ key: 'tool', label: 'WZ', colorTotal: '#4da6ff', colorX: '#ff8a8a', colorY: '#8bc34a', colorZ: '#8addff', dash: [10, 5] });

        for (let c of configs) {
             let p = savedProfiles[c.key];
             if (!p.freqs || p.freqs.length === 0) continue;
             
             if (showX && p.magsX) {
                 seriesConfig.push({ label: `${c.label} AVG (X)`, stroke: c.colorX, width: 2.5, dash: c.dash });
                 chartData.push(p.magsX);
             }
             if (showY && p.magsY) {
                 seriesConfig.push({ label: `${c.label} AVG (Y)`, stroke: c.colorY, width: 2.5, dash: c.dash });
                 chartData.push(p.magsY);
             }
             if (showZ && p.magsZ) {
                 seriesConfig.push({ label: `${c.label} AVG (Z)`, stroke: c.colorZ, width: 2.5, dash: c.dash });
                 chartData.push(p.magsZ);
             }
             // Wenn explizit nur Total gewünscht ist (alte Daten) oder wenn keine der Checkboxen aktiv ist
             if ((!p.magsX && p.mags) || (!showX && !showY && !showZ)) {
                 seriesConfig.push({ label: `${c.label} AVG (Total)`, stroke: c.colorTotal, width: 2.5, dash: c.dash });
                 chartData.push(p.mags || new Float32Array(xFreqs.length));
             }
        }
    }

    const opts = {
        width: chartContainer.clientWidth,
        height: 250,
        axes: [
            { stroke: "#fff", grid: { stroke: "#333" } },
            { scale: "y", stroke: "#fff", grid: { stroke: "#333" } }
        ],
        series: seriesConfig,
        scales: {
            "x": { time: false },
            "y": { auto: true }
        },
        cursor: { 
            drag: { x: true, y: true, setScale: true } 
        },
        plugins: [createCursorTooltipPlugin("Hz"), wheelZoomPlugin()]
    };

    chartInstance = new uPlot(opts, chartData, chartContainer);
};

function initChart() {
    if (chartInstance) return;
    
    window.rebuildFftChart();

    timeChartContainer = document.getElementById('impactTimeChartContainer');
    if (timeChartContainer) {
        // Initialer leerer Chart
        rebuildTimeChart(1666);
    }


    rpmChartContainer = document.getElementById('rpmChartContainer');
    if(rpmChartContainer) {
        const rpmOpts = {
            width: rpmChartContainer.clientWidth,
            height: 250,
            axes: [
                { label: "U/min", stroke: "#fff", grid: { stroke: "#333" } },
                { scale: "y", stroke: "#fff", grid: { stroke: "#333" } }
            ],
            series: [
                {},
                {
                    label: "Resonanz-Gefahr",
                    stroke: "#ff4a4a",
                    fill: "rgba(255, 74, 74, 0.4)",
                    width: 2,
                },
                {
                    label: "Optimaler Bereich",
                    stroke: "#4caf50",
                    fill: "rgba(76, 175, 80, 0.4)",
                    width: 2,
                }
            ],
            scales: {
                "x": { time: false },
                "y": { auto: true }
            },
            cursor: { 
                drag: { x: true, y: true, setScale: true } 
            },
            plugins: [createCursorTooltipPlugin("U/min"), wheelZoomPlugin()]
        };
        
        const N = 3001;
        const rpmData = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
        for(let i=0; i<N; i++) rpmData[0][i] = i * (30000 / (N - 1));
        
        rpmChartInstance = new uPlot(rpmOpts, rpmData, rpmChartContainer);
    }
}

export function initImpactTest() {
    const btnTab = document.getElementById('navImpactTest');
    if (btnTab) {
        btnTab.addEventListener('click', function() {
            showDashboardSection('impactTestArea');
        });
    }

    btnArm = document.getElementById('btnArmImpactV2');
    statusStr = document.getElementById('impactStatusStr');
    peakFreqDisplay = document.getElementById('impactPeakFreqDisplay');
    resultsCard = document.getElementById('impactResultsCard');
    impactTablesContainer = document.getElementById('impactTablesContainer');
    
    lblImpactCountWp = document.getElementById('lblImpactCountWp');
    lblImpactCountTool = document.getElementById('lblImpactCountTool');

    fluteSelect = document.getElementById('impactFluteCount');
    fluteCustom = document.getElementById('impactFluteCountCustom');

    autoRestartCb = document.getElementById('impactAutoRestart');
    
    if(btnArm) btnArm.addEventListener('click', () => {
        if (state === 'IDLE' || state === 'DONE' || state === 'TRIGGERED' || state === 'ANALYZING') armTrigger();
        else resetTrigger();
    });

    const btnClear = document.getElementById('btnImpactClear');



    const btnSaveSession = document.getElementById('btnSaveSession');
    const btnLoadSession = document.getElementById('btnLoadSession');
    const impactFileInput = document.getElementById('impactFileInput');
    
    impactTargetRadios = document.querySelectorAll('input[name="impactTarget"]');
    
    impactViewFilterRadios = document.querySelectorAll('input[name="impactViewFilter"]');
    if (impactViewFilterRadios) {
        impactViewFilterRadios.forEach(r => r.addEventListener('change', displayResults));
    }
    
    if (document.getElementById('impactAxisX')) document.getElementById('impactAxisX').addEventListener('change', window.rebuildFftChart);
    if (document.getElementById('impactAxisY')) document.getElementById('impactAxisY').addEventListener('change', window.rebuildFftChart);
    if (document.getElementById('impactAxisZ')) document.getElementById('impactAxisZ').addEventListener('change', window.rebuildFftChart);
    
    impactModeRadios = document.querySelectorAll('input[name="impactMode"]');
    impactFluteContainer = document.getElementById('impactFluteContainer');
    lblImpactCountWp = document.getElementById('lblImpactCountWp');
    lblImpactCountTool = document.getElementById('lblImpactCountTool');
    btnImpactPdf = document.getElementById('btnImpactPdf');
    let sliderTrigger = document.getElementById('impactTriggerThresholdV2');
    let lblTriggerVal = document.getElementById('lblImpactTriggerValue');
    if (sliderTrigger && lblTriggerVal) {
        sliderTrigger.addEventListener('input', (e) => {
            let g = parseFloat(e.target.value);
            lblTriggerVal.textContent = g + "g";
            triggerThresholdRaw = g * 1000; // in mg
        });
    }

    if (btnImpactPdf) {
        btnImpactPdf.addEventListener('click', () => {
            // --- 1. ZOOM RESET ---
            const resetChartZoom = (inst) => {
                if(inst && inst.data && inst.data[0] && inst.data[0].length > 0) {
                    let xData = inst.data[0];
                    inst.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
                }
            };
            resetChartZoom(timeChartInstance);
            resetChartZoom(chartInstance);
            resetChartZoom(rpmChartInstance);

            // Kurz warten, bis Canvas durch Scale-Reset neu gezeichnet wurden
            setTimeout(() => {
                const now = new Date();
                let flutes = 2;
                if(fluteSelect && fluteSelect.value !== 'custom') flutes = parseInt(fluteSelect.value);
                else if(fluteCustom) flutes = parseInt(fluteCustom.value);

                // --- 2. NATIVE DRUCK UMGEBUNG AUFBAUEN ---
                const printContainer = document.createElement('div');
                printContainer.id = 'senzimu-print-report';
                printContainer.style.width = '100%'; 
                printContainer.style.backgroundColor = '#ffffff';
                printContainer.style.color = '#000000';
                printContainer.style.padding = '0';
                printContainer.style.fontFamily = 'Arial, sans-serif';

                // CSS Injektion: Verstecke das Dashboard, zeige nur den Report beim Drucken!
                const printStyle = document.createElement('style');
                printStyle.id = 'senzimu-print-styles';
                printStyle.textContent = `
                    @media print {
                        body > :not(#senzimu-print-report) { display: none !important; }
                        body { background: white !important; margin: 0; padding: 0; }
                        #senzimu-print-report { display: block !important; position: static !important; }
                        @page { size: auto; margin: 15mm; }
                    }
                    #senzimu-print-report { display: none; } /* Unsichtbar auf dem Bildschirm */
                `;
                document.head.appendChild(printStyle);

                let operationMode = 'fraesen';
                const modBtns = document.querySelectorAll('input[name="impactMode"]');
                if(modBtns) modBtns.forEach(r => { if(r.checked) operationMode = r.value; });

                let htmlStr = `
                    <div style="border-bottom: 2px solid #ffd600; padding-bottom: 10px; margin-bottom: 20px;">
                        <h1 style="color: #333; margin: 0;">Senz<span style="color:#ffd600;">IMU</span> Diagnose-Bericht</h1>
                        <h3 style="color: #666; margin: 5px 0 0 0;">Modalanalyse (${operationMode === 'drehen' ? 'Drehen' : 'Fräsen'})</h3>
                        <div style="margin-top: 10px; font-size: 0.9em; color: #555;">
                            <strong>Datum & Uhrzeit:</strong> ${now.toLocaleString()}<br/>
                            <strong>Trigger-Schwelle:</strong> ${triggerThresholdRaw / 1000} g<br/>
                            ${operationMode !== 'drehen' ? `<strong>Zähnezahl (Z):</strong> ${flutes}` : ''}
                        </div>
                    </div>
                `;
                
                // Inject SSV Results permanently for turning
                if (operationMode === 'drehen') {
                    let s_amp = document.getElementById('ssvResultAmp') ? document.getElementById('ssvResultAmp').textContent : '--';
                    let s_fre = document.getElementById('ssvResultFreq') ? document.getElementById('ssvResultFreq').textContent : '--';
                    htmlStr += `
                    <div style="margin-bottom:20px; background:#f4f4f4; padding:15px; border-left:5px solid #4caf50;">
                        <h2 style="margin-top:0; color:#333;">Optimale SSV-Prozessparameter (Drehen):</h2>
                        <div style="font-size:1.3em;">
                            <strong>SSV Amplitude:</strong> <span style="color:#4caf50;">${s_amp}</span><br/>
                            <strong>SSV Frequenz (f_m):</strong> <span style="color:#4caf50;">${s_fre}</span>
                        </div>
                    </div>`;
                }

                // --- 3. GRAPHICS & LEGENDS ---
                const getChartImg = (instance, title, legendHtml) => {
                    if (!instance || !instance.ctx) return '';
                    const base64 = instance.ctx.canvas.toDataURL("image/png");
                    return `
                        <div style="margin-bottom: 30px; page-break-inside: avoid;">
                            <h4 style="margin: 0 0 5px 0; color: #333; font-size: 1.1em;">${title}</h4>
                            <div style="background: #111; padding: 10px; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
                                <img src="${base64}" style="width: 100%; height: auto; display: block;" />
                            </div>
                            <div style="margin-top: 8px; font-size: 0.85em; color: #444; border-left: 3px solid #ccc; padding-left: 8px;">
                                ${legendHtml}
                            </div>
                        </div>
                    `;
                };

                htmlStr += getChartImg(timeChartInstance, "Rohsignal (Zeitanalyse)", "<strong>Legende:</strong> <span style='color:#b89900; font-weight:bold;'>Gelb = Werkstück</span> | <span style='color:#0066cc; font-weight:bold;'>Blau = Werkzeug</span> (Transparente Linien = Historie)");
                htmlStr += getChartImg(chartInstance, "Frequenzspektrum (FFT)", "<strong>Legende:</strong> <span style='color:#b89900; font-weight:bold;'>Gelb = Werkstück</span> | <span style='color:#0066cc; font-weight:bold;'>Blau = Werkzeug</span>");
                
                if (operationMode === 'fraesen') {
                    htmlStr += getChartImg(rpmChartInstance, "Spindeldrehzahl Risiko-Analyse", "<strong>Legende:</strong> <span style='color:#cc0000; font-weight:bold;'>Rot = Resonanz-Gefahr</span> | <span style='color:#008800; font-weight:bold;'>Grün = Optimaler Bereich</span>");
                }

                // --- 4. EXPLICIT TABLES GENERATION ---
                const harmonische = [1.0, 0.5, 0.3333, 0.25];
                const kNames = ["1. Ordnung", "2. Ordnung", "3. Ordnung", "4. Ordnung"];
                
                function buildPdfTable(title, peaksList, meanDecay) {
                    if (!peaksList || peaksList.length === 0) return '';
                    let sectionHtml = `
                    <div style="margin-bottom: 25px; page-break-inside: avoid; border: 1px solid #ddd; background: #fff; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h4 style="margin:0 0 10px 0; color:#000; border-bottom: 1px solid #ccc; padding-bottom:5px;">${title}`;
                    
                    if(meanDecay !== undefined && meanDecay > 0 && peaksList.length > 0) {
                        let avgD = (47679 / (peaksList[0].freq * meanDecay));
                        let decayText = (avgD >= 4.0) ? "HERVORRAGEND" : (avgD >= 1.5) ? "GUT" : (avgD >= 0.5) ? "KRITISCH" : "GEFÄHRLICH";
                        sectionHtml += `<span style="display:block; font-size:0.85em; color:#555; font-weight:normal; margin-top:4px;">Dämpfungsmaß D: <strong>${avgD.toFixed(2)} % (${decayText})</strong></span>`;
                    }
                    sectionHtml += `</h4>
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85em; color: #000;">
                            <thead>
                                <tr>
                                    <th style="border-bottom: 2px solid #555; text-align: left; padding: 4px;">Harmonische</th>
                                    <th style="border-bottom: 2px solid #555; text-align: left; padding: 4px;">Eingriffsfrequenz</th>
                                    ${operationMode !== 'drehen' ? `<th style="border-bottom: 2px solid #555; text-align: left; padding: 4px;">Avoid (U/min)</th>` : ''}
                                </tr>
                            </thead>
                            <tbody>`;
                    
                    let displayPeaks = [...peaksList].sort((a,b) => b.mag - a.mag).slice(0, 3);
                    displayPeaks.forEach((p, pIdx) => {
                        let stdStr = (p.std !== undefined && p.std > 0) ? ` (±${p.std.toFixed(2)})` : '';
                        sectionHtml += `<tr><td colspan="3" style="background: #f5f5f5; border-bottom: 1px solid #ccc; padding: 6px; font-weight:bold; color:#333;">Peak ${pIdx+1}: ${p.freq.toFixed(1)} Hz <span style="font-weight:normal; font-size:0.9em;">(Magnitude: ${p.mag.toFixed(1)}${stdStr})</span></td></tr>`;
                        for(let i=0; i<4; i++) {
                            let k = harmonische[i];
                            let f_anregung = p.freq * k;
                            let rpm = f_anregung * 60 / flutes;
                            sectionHtml += `
                                <tr>
                                    <td style="padding: 4px; border-bottom: 1px solid #eee;">${kNames[i]}</td>
                                    <td style="padding: 4px; border-bottom: 1px solid #eee;">${f_anregung.toFixed(1)} Hz</td>
                                    ${operationMode !== 'drehen' ? `<td style="padding: 4px; border-bottom: 1px solid #eee; font-weight:bold;">~${Math.round(rpm)}</td>` : ''}
                                </tr>
                            `;
                        }
                    });
                    sectionHtml += `</tbody></table></div>`;
                    return sectionHtml;
                }

                htmlStr += `<h3 style="border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-top: 30px; color: #333; page-break-before: auto;">Identifizierte Resonanzen</h3>`;
                
                // FORCE BOTH TABLES IF DATA EXISTS
                let hasTables = false;
                if(savedProfiles && savedProfiles.workpiece && savedProfiles.workpiece.peaks && savedProfiles.workpiece.peaks.length > 0) {
                    htmlStr += buildPdfTable("📊 Werkstück Resonanzen", savedProfiles.workpiece.peaks, savedProfiles.workpiece.meanDecayMs);
                    hasTables = true;
                }
                if(savedProfiles && savedProfiles.tool && savedProfiles.tool.peaks && savedProfiles.tool.peaks.length > 0) {
                    htmlStr += buildPdfTable("⚙️ Werkzeug Resonanzen", savedProfiles.tool.peaks, savedProfiles.tool.meanDecayMs);
                    hasTables = true;
                }
                if(!hasTables) {
                    htmlStr += `<p style="color:#666;"><em>Noch keine Messergebnisse vorhanden.</em></p>`;
                }

                printContainer.innerHTML = htmlStr;
                document.body.appendChild(printContainer);
                
                // --- 5. Nativer Web-Print aufrufen ---
                setTimeout(() => {
                    window.print();
                    
                    // Cleanup nach Beenden des Druckdialogs
                    setTimeout(() => {
                        if(printContainer.parentNode) printContainer.parentNode.removeChild(printContainer);
                        if(printStyle.parentNode) printStyle.parentNode.removeChild(printStyle);
                    }, 1000); 
                }, 500); 
            }, 100); 
        });
    }

    window.addEventListener('resize', () => {
        if (chartInstance && chartContainer && chartContainer.clientWidth > 0) {
            chartInstance.setSize({ width: chartContainer.clientWidth, height: 250 });
        }
        if (timeChartInstance && timeChartContainer && timeChartContainer.clientWidth > 0) {
            timeChartInstance.setSize({ width: timeChartContainer.clientWidth, height: 250 });
        }
        if (rpmChartInstance && rpmChartContainer && rpmChartContainer.clientWidth > 0) {
            rpmChartInstance.setSize({ width: rpmChartContainer.clientWidth, height: 250 });
        }
    });

    if (!btnArm) return; 

    function triggerCalculation() {
        if (fluteSelect) {
            if (fluteSelect.value === 'custom') {
                if (fluteCustom) fluteCustom.style.display = 'inline-block';
            } else {
                if (fluteCustom) fluteCustom.style.display = 'none';
            }
        }
        displayResults();
    }

    if (fluteSelect) {
        fluteSelect.addEventListener('change', triggerCalculation);
    }
    if (fluteCustom) {
        fluteCustom.addEventListener('input', triggerCalculation);
    }
    
    if (impactModeRadios) {
        impactModeRadios.forEach(r => r.addEventListener('change', (e) => {
            const rpmWrapper = document.getElementById('rpmChartWrapper');
            if (e.target.value === 'drehen') {
                impactFluteContainer.style.display = 'none';
                if (rpmWrapper) rpmWrapper.style.display = 'none';
            } else {
                impactFluteContainer.style.display = 'flex';
                if (rpmWrapper) rpmWrapper.style.display = 'block';
            }
            triggerCalculation();
        }));
    }
    
    if (impactViewFilterRadios) {
        impactViewFilterRadios.forEach(r => r.addEventListener('change', triggerCalculation));
    }
    
    const btnImpactClearEl = document.getElementById('btnImpactClear');
    if (btnImpactClearEl) {
        btnImpactClearEl.addEventListener('click', () => {
            savedProfiles = { workpiece: { samples: [], peaks: [], freqs: [], mags: [] }, tool: { samples: [], peaks: [], freqs: [], mags: [] } };
            if(lblImpactCountWp) lblImpactCountWp.textContent = '(0)';
            if(lblImpactCountTool) lblImpactCountTool.textContent = '(0)';
            if (typeof window.rebuildFftChart === 'function') {
                window.rebuildFftChart();
            }
            if (typeof rebuildTimeChart === 'function') {
                rebuildTimeChart();
            }
            triggerCalculation();
            statusStr.textContent = "STATUS: Memory leergemacht";
        });
    }



    document.getElementById('navImpactTest').addEventListener('click', () => {
        // Andere Bereiche ausblenden (rudimentäres Routing)
        document.getElementById('liveChartarea').style.display = 'none';
        
        const vectorAlignArea = document.getElementById('vectorAlignArea');
        if(vectorAlignArea) vectorAlignArea.style.display = 'none';
        
        const motionViewportArea = document.getElementById('motionViewportArea');
        if(motionViewportArea) motionViewportArea.style.display = 'none';

        document.getElementById('impactTestArea').style.display = 'block';

        if (!chartInstance) initChart();
        
        // Dispatch event für eventuelle externe Listener
        window.dispatchEvent(new CustomEvent('dashboardTabChanged', { detail: { sectionId: 'impactTestArea' } }));
    });
}

function armTrigger() {
    let rawRate = window.currentSampleRate || 1660;
    if (typeof accelSampleRateDD2 !== 'undefined' && accelSampleRateDD2.getValue && accelSampleRateDD2.getValue() > 0) {
        rawRate = accelSampleRateDD2.getValue();
    }
    
    // Wir wollen ca. 0.8 bis 1.0 Sekunden echte Aufnahmezeit für max 1.25 Hz Frequenzauflösung
    let targetSamples = rawRate * 0.8;
    bufferSize = Math.pow(2, Math.ceil(Math.log2(targetSamples))); 
    if (bufferSize < 512) bufferSize = 512;
    if (bufferSize > 8192) bufferSize = 8192; // Max 8192 aus Performance-Gründen (bei 6.6kHz = 1.23 sek)

    captureX = new Float32Array(bufferSize);
    captureY = new Float32Array(bufferSize);
    captureZ = new Float32Array(bufferSize);
    captureTime = new Float32Array(bufferSize);

    state = 'ARMING';
    captureIndex = 0;
    preBufferIndex = 0;
    preBufferCount = 0;
    base_x = null; base_y = null; base_z = null;
    
    btnArm.textContent = "Arming... (Wait)";
    btnArm.style.background = '#ff9800'; 
    btnArm.classList.remove('armed');
    statusStr.textContent = `STATUS: ARMING (Bias wird gelernt...)`;
    
    // 1 Sekunde warten, bis sich der Schreibtisch vom Klicken beruhigt hat
    setTimeout(() => {
        if (state === 'ARMING') {
            state = 'ARMED';
            let gThreshold = (triggerThresholdRaw / 1000).toFixed(1);
            btnArm.textContent = "Cancel (Armed)";
            btnArm.classList.add('armed');
            btnArm.style.background = '';
            statusStr.textContent = `STATUS: ARMED (> ${gThreshold}g | Puffer: ${bufferSize})`;
        }
    }, 1000);
}

function resetTrigger() {
    state = 'IDLE';
    btnArm.textContent = "Start Test (Arm Trigger)";
    btnArm.classList.remove('armed');
    statusStr.textContent = "STATUS: IDLE";
}

// Global an window binden, damit script2.js (der WebSocket Handler) hier reinschießen kann
window.feedImpactTestData = function(ax, ay, az, timeUs) {
    if (state === 'IDLE' || state === 'ANALYZING') return;

    if (state === 'ARMING') {
        if (base_x === null) {
            base_x = ax; base_y = ay; base_z = az;
        } else {
            // Starker Tiefpass lernt die exakte Ruhelage während der Wartezeit
            base_x = (0.05 * ax) + (0.95 * base_x);
            base_y = (0.05 * ay) + (0.95 * base_y);
            base_z = (0.05 * az) + (0.95 * base_z);
        }
        return; // Noch nicht triggern
    }

    if (state === 'ARMED') {
        // Bias bleibt jetzt während dem Armed und Triggering komplett EINGEFROREN, 
        // um das Signal des Hammerschlags nicht versehentlich wegzufiltern!
        
        let dx = ax - base_x;
        let dy = ay - base_y;
        let dz = az - base_z;

        // Vektor Magnitude für das Triggern (dx, dy, dz sind bereits in mg!)
        let dynamicChange = Math.sqrt(dx*dx + dy*dy + dz*dz); // Performance optimized instead of Math.hypot

        if (dynamicChange > triggerThresholdRaw) {
            state = 'TRIGGERED';
            statusStr.textContent = "STATUS: TRIGGERED (Recording...)";
            btnArm.style.background = '#4caf50';
            btnArm.textContent = "REC!";
            
            // Kopiere Pre-Trigger-Puffer in den Capture-Buffer
            let copyCount = Math.min(preBufferCount, preBufferSize);
            for(let i=0; i<copyCount; i++) {
                let j = (preBufferIndex - copyCount + i + preBufferSize) % preBufferSize;
                captureX[captureIndex] = preX[j];
                captureY[captureIndex] = preY[j];
                captureZ[captureIndex] = preZ[j];
                captureTime[captureIndex] = preTime[j];
                captureIndex++;
            }
            
            captureX[captureIndex] = dx;
            captureY[captureIndex] = dy;
            captureZ[captureIndex] = dz;
            captureTime[captureIndex] = timeUs || 0;
            captureIndex++;
        } else {
            // Schreibe fortlaufend in den Ringpuffer
            preX[preBufferIndex] = dx;
            preY[preBufferIndex] = dy;
            preZ[preBufferIndex] = dz;
            preTime[preBufferIndex] = timeUs || 0;
            preBufferIndex = (preBufferIndex + 1) % preBufferSize;
            if (preBufferCount < preBufferSize) preBufferCount++;
        }
    } 
    else if (state === 'TRIGGERED') {
        captureX[captureIndex] = ax - base_x;
        captureY[captureIndex] = ay - base_y;
        captureZ[captureIndex] = az - base_z;
        captureTime[captureIndex] = timeUs || 0;
        captureIndex++;

        if (captureIndex >= bufferSize) {
            state = 'ANALYZING';
            statusStr.textContent = "STATUS: ANALYZING";
            btnArm.classList.remove('armed');
            btnArm.style.background = '';
            btnArm.textContent = "Start Test (Arm Trigger)";
            processData();
        }
    }
}

window.recalculateImpactAverages = function(targetKey) {
    let targetArea = savedProfiles[targetKey];
    let N = targetArea.samples.length;
    
    if (N === 0) {
        targetArea.meanDecayMs = 0;
        targetArea.freqs = new Float32Array(0);
        targetArea.mags = new Float32Array(0);
        targetArea.peaks = [];
        
        if (targetKey === 'workpiece' && lblImpactCountWp) lblImpactCountWp.textContent = `(0)`;
        if (targetKey === 'tool' && lblImpactCountTool) lblImpactCountTool.textContent = `(0)`;
        
        if (typeof window.rebuildFftChart === 'function') window.rebuildFftChart();
        
        let srate = window.currentSampleRate || 1666;
        if(typeof rebuildTimeChart === 'function') rebuildTimeChart(srate);
        if(typeof displayResults === 'function') displayResults();
        return;
    }
    
    let freqs = targetArea.samples[0].freqs;
    let avgMagsX = new Float32Array(freqs.length);
    let avgMagsY = new Float32Array(freqs.length);
    let avgMagsZ = new Float32Array(freqs.length);
    let avgMagsTotal = new Float32Array(freqs.length);
    let stdMags = new Float32Array(freqs.length);
    let sumDecay = 0;
    
    for (let s = 0; s < N; s++) sumDecay += (targetArea.samples[s].decay || 0);
    targetArea.meanDecayMs = sumDecay / N;
    
    for (let i = 0; i < freqs.length; i++) {
        let sumX = 0, sumY = 0, sumZ = 0;
        for (let s = 0; s < N; s++) {
             // Fallback for legacy items in memory
             if (targetArea.samples[s].magsX) {
                 sumX += targetArea.samples[s].magsX[i];
                 sumY += targetArea.samples[s].magsY[i];
                 sumZ += targetArea.samples[s].magsZ[i];
             } else {
                 sumZ += targetArea.samples[s].mags[i];
             }
        }
        avgMagsX[i] = sumX / N;
        avgMagsY[i] = sumY / N;
        avgMagsZ[i] = sumZ / N;
        avgMagsTotal[i] = Math.sqrt(avgMagsX[i]*avgMagsX[i] + avgMagsY[i]*avgMagsY[i] + avgMagsZ[i]*avgMagsZ[i]);
    }
    
    for (let i = 0; i < freqs.length; i++) {
        let sumSq = 0;
        for (let s = 0; s < N; s++) {
            let total = targetArea.samples[s].magsX ? Math.sqrt(Math.pow(targetArea.samples[s].magsX[i], 2) + Math.pow(targetArea.samples[s].magsY[i], 2) + Math.pow(targetArea.samples[s].magsZ[i], 2)) : targetArea.samples[s].mags[i];
            sumSq += Math.pow(total - avgMagsTotal[i], 2);
        }
        stdMags[i] = Math.sqrt(sumSq / N);
    }
    
    targetArea.freqs = freqs;
    targetArea.mags = avgMagsTotal;
    targetArea.magsX = avgMagsX;
    targetArea.magsY = avgMagsY;
    targetArea.magsZ = avgMagsZ;
    let avgMags = avgMagsTotal;
    
    let peaks = [];
    for (let i = 2; i < avgMags.length - 2; i++) { 
        if (avgMags[i] > avgMags[i-1] && avgMags[i] > avgMags[i+1] && avgMags[i] > avgMags[i-2] && avgMags[i] > avgMags[i+2]) {
            if (avgMags[i] > 1.0) { 
                peaks.push({ freq: freqs[i], mag: avgMags[i], std: stdMags[i] });
            }
        }
    }
    
    peaks.sort((a, b) => b.mag - a.mag);
    
    // --> GRUNDSCHWINGUNGS-KORREKTUR (HARMONIC DOWN-SHIFT) <--
    // Falls die lauteste Schwingung eine Harmonische ist (z.B. 60Hz), priorisieren 
    // wir die tiefere Grundschwingung (z.B. 30Hz), da diese physisch deutlich gefährlicher ist.
    if (peaks.length > 1) {
        let maxPeak = peaks[0];
        let searchDepth = Math.min(peaks.length, 5); // Check top 5 peaks
        
        for (let i = 1; i < searchDepth; i++) {
            let candidate = peaks[i];
            if (candidate.freq < maxPeak.freq - 2.0) { 
                let ratio = maxPeak.freq / candidate.freq;
                let isIntegerMultiple = Math.abs(ratio - Math.round(ratio)) < 0.15;
                
                if (isIntegerMultiple && Math.round(ratio) >= 2 && Math.round(ratio) <= 3) {
                    if (candidate.mag > (maxPeak.mag * 0.40)) {
                        peaks[0] = candidate;
                        peaks[i] = maxPeak;
                        break; 
                    }
                }
            }
        }
    }
    
    let currentTopPeaks = peaks.slice(0, 3);
    
    if (currentTopPeaks.length === 0) {
        let maxMag = 0, peakIdx = 0;
        for (let i = 1; i < avgMags.length; i++) {
            if (avgMags[i] > maxMag) { maxMag = avgMags[i]; peakIdx = i; }
        }
        currentTopPeaks = [{ freq: freqs[peakIdx] || 0, mag: maxMag, std: stdMags[peakIdx] || 0 }];
    }
    targetArea.peaks = currentTopPeaks;
    
    if (targetKey === 'workpiece' && lblImpactCountWp) lblImpactCountWp.textContent = `(${N})`;
    if (targetKey === 'tool' && lblImpactCountTool) lblImpactCountTool.textContent = `(${N})`;
    
    if (typeof window.rebuildFftChart === 'function') window.rebuildFftChart();
    
    let srate = window.currentSampleRate || 1666;
    if(typeof rebuildTimeChart === 'function') rebuildTimeChart(srate);
    if(typeof displayResults === 'function') displayResults();
};

window.removeImpactHit = function(targetKey, index) {
    if (savedProfiles[targetKey] && savedProfiles[targetKey].samples) {
        savedProfiles[targetKey].samples.splice(index, 1);
        window.recalculateImpactAverages(targetKey);
    }
};

function processData() {
    // 2. FFT Worker starten (nur einmalig instanziieren um HTTP Spam und ESP32 Socket Limit zu verhindern)
    if (!window.sharedImpactFftWorker) {
        window.sharedImpactFftWorker = new Worker('fft-worker.js');
    }
    const worker = window.sharedImpactFftWorker;
    
    // ECHTE PHYSIKALISCHE SAMPLERATE BERECHNEN UM W-LAN SCHWANKUNGEN ZU IGNORIEREN!
    let srate = window.currentSampleRate || 1666; 
    let durationUs = captureTime[bufferSize - 1] - captureTime[0];
    if (durationUs > 0) {
        let exactSrate = (bufferSize - 1) / (durationUs / 1000000.0);
        if (exactSrate > 10) srate = exactSrate;
        console.log(`[ImpactTest] Hardware dt: ${(durationUs/1000.0).toFixed(1)}ms für ${bufferSize} Samples. Physikalische S-Rate: ${exactSrate.toFixed(2)} Hz. Verwendet: ${srate.toFixed(2)} Hz`);
    } else {
        console.warn(`[ImpactTest] WARNUNG: durationUs ist ${durationUs}! Vertraue auf WLAN-Rate ${srate.toFixed(2)} Hz.`);
    }
    
    let cleanX = new Float32Array(bufferSize);
    let cleanY = new Float32Array(bufferSize);
    let cleanZ = new Float32Array(bufferSize);
    let avgX = 0, avgY = 0, avgZ = 0;
    
    for(let i=0;i<bufferSize;i++) { avgX += captureX[i]; avgY += captureY[i]; avgZ += captureZ[i]; }
    avgX /= bufferSize; avgY /= bufferSize; avgZ /= bufferSize;
    
    let maxValTotal = 0, maxIdx = 0;
    for(let i=0;i<bufferSize;i++) {
        cleanX[i] = captureX[i] - avgX;
        cleanY[i] = captureY[i] - avgY;
        cleanZ[i] = captureZ[i] - avgZ;
        let v = Math.sqrt(cleanX[i]*cleanX[i] + cleanY[i]*cleanY[i] + cleanZ[i]*cleanZ[i]);
        if(v > maxValTotal) { maxValTotal = v; maxIdx = i; }
    }
    
    // Dämpfungs-Ausschwingzeit (T_decay) berechnen
    let thresh = maxValTotal * 0.05; // 5% der max Amplitude
    let lastExceedIdx = bufferSize - 1;
    while(lastExceedIdx > maxIdx) {
        if (Math.sqrt(Math.pow(cleanX[lastExceedIdx], 2) + Math.pow(cleanY[lastExceedIdx], 2) + Math.pow(cleanZ[lastExceedIdx], 2)) > thresh) break;
        lastExceedIdx--;
    }
    let decaySamples = (lastExceedIdx <= maxIdx + 1) ? 0 : (lastExceedIdx - maxIdx);
    let runDecayMs = (decaySamples / srate) * 1000;

    let timeBufferTotal = new Float32Array(bufferSize);
    let rawTime = new Float32Array(bufferSize);
    let rawX = new Float32Array(bufferSize);
    let rawY = new Float32Array(bufferSize);
    let rawZ = new Float32Array(bufferSize);
    for(let i=0;i<bufferSize;i++) {
        rawTime[i] = (i / srate) * 1000.0;
        rawX[i] = cleanX[i];
        rawY[i] = cleanY[i];
        rawZ[i] = cleanZ[i];
        timeBufferTotal[i] = Math.sqrt(cleanX[i]*cleanX[i] + cleanY[i]*cleanY[i] + cleanZ[i]*cleanZ[i]);
    }

    let results = {};
    let activeTarget = 'workpiece';
    if (impactTargetRadios) impactTargetRadios.forEach(r => { if(r.checked) activeTarget = r.value; });

    worker.onmessage = (e) => {
        const freqs = e.data.freqs;
        const mags = e.data.mags;
        const axis = e.data.axis;
        results[axis] = mags;

        if (results['X'] && results['Y'] && results['Z']) {
            let targetArea = savedProfiles[activeTarget];
            
            let len = freqs.length;
            let magsTotal = new Float32Array(len);
            for(let i = 0; i < len; i++) {
                magsTotal[i] = Math.sqrt(
                    results['X'][i] * results['X'][i] + 
                    results['Y'][i] * results['Y'][i] + 
                    results['Z'][i] * results['Z'][i]
                );
            }
            
            targetArea.samples.push({ 
                freqs: freqs, 
                magsX: results['X'], magsY: results['Y'], magsZ: results['Z'], 
                mags: magsTotal,
                decay: runDecayMs, 
                rawTime: rawTime,
                rawX: rawX, rawY: rawY, rawZ: rawZ,
                magsTotalTime: timeBufferTotal
            });

            window.recalculateImpactAverages(activeTarget);
            displayResults();
            
            if (autoRestartCb && autoRestartCb.checked) {
                setTimeout(() => { if (state === 'IDLE' || state === 'ANALYZING' || state === 'DONE') armTrigger(); }, 2000);
            }
        }
    };

    // Startimpuls aus FFT ausschließen, um das Ergebnis auf die reine Abklingkurve zu fokussieren.
    let cutoffIdx = maxIdx + Math.floor(srate * 0.002); // ca. 2ms nach dem Peak
    if (cutoffIdx >= bufferSize) cutoffIdx = bufferSize - 1;
    for(let i = 0; i <= cutoffIdx; i++) {
        cleanX[i] = 0;
        cleanY[i] = 0;
        cleanZ[i] = 0;
    }

    worker.postMessage({ buffer: cleanX.buffer, sampleRate: srate, windowType: 'RECTANGULAR', dcCutoff: true, fftDBoutput: false, axis: 'X' }, [cleanX.buffer]);
    worker.postMessage({ buffer: cleanY.buffer, sampleRate: srate, windowType: 'RECTANGULAR', dcCutoff: true, fftDBoutput: false, axis: 'Y' }, [cleanY.buffer]);
    worker.postMessage({ buffer: cleanZ.buffer, sampleRate: srate, windowType: 'RECTANGULAR', dcCutoff: true, fftDBoutput: false, axis: 'Z' }, [cleanZ.buffer]);
}

function displayResults() {
    state = 'DONE';
    statusStr.textContent = "STATUS: DONE";
    if (resultsCard) resultsCard.style.display = 'block';
    
    let viewMode = 'combined';
    if (impactViewFilterRadios) {
        impactViewFilterRadios.forEach(r => { if(r.checked) viewMode = r.value; });
    }

    let evaluatePeaks = [];
    if (viewMode === 'combined') {
        evaluatePeaks = [...savedProfiles.workpiece.peaks, ...savedProfiles.tool.peaks];
    } else if (viewMode === 'workpiece') {
        evaluatePeaks = [...savedProfiles.workpiece.peaks];
    } else if (viewMode === 'tool') {
        evaluatePeaks = [...savedProfiles.tool.peaks];
    }
    
    if (evaluatePeaks.length === 0) {
        if (peakFreqDisplay) peakFreqDisplay.textContent = "-- Hz";
        if (resultsCard) resultsCard.style.display = 'none';
        if (impactTablesContainer) impactTablesContainer.innerHTML = '';
        if (rpmChartInstance) {
            let emptyX = new Float32Array(301);
            for(let i=0; i<=300; i++) emptyX[i] = i * 100;
            rpmChartInstance.setData([emptyX, new Float32Array(301), new Float32Array(301)]);
        }
        return;
    }
    
    evaluatePeaks.sort((a,b) => b.mag - a.mag);
    
    const mainPeak = evaluatePeaks[0];
    if (peakFreqDisplay) peakFreqDisplay.textContent = mainPeak.freq.toFixed(1) + " Hz (Mag: " + mainPeak.mag.toFixed(1) + ")";

    // Automatisches Eintragen der stärksten Peaks beider Systeme in den Rechner
    let primaryDecay = 0;
    let fw = '';
    let ft = '';
    
    if (viewMode === 'combined') {
        let wpHigh = savedProfiles.workpiece.peaks.length > 0 ? savedProfiles.workpiece.peaks.reduce((a,b) => a.mag > b.mag ? a : b) : null;
        let toolHigh = savedProfiles.tool.peaks.length > 0 ? savedProfiles.tool.peaks.reduce((a,b) => a.mag > b.mag ? a : b) : null;
        
        if (wpHigh) fw = wpHigh.freq.toFixed(1);
        if (toolHigh) ft = toolHigh.freq.toFixed(1);
        
        primaryDecay = wpHigh ? (savedProfiles.workpiece.meanDecayMs || 0) : 0;
    } else if (viewMode === 'workpiece') {
        if (savedProfiles.workpiece.peaks.length > 0) fw = savedProfiles.workpiece.peaks[0].freq.toFixed(1);
        primaryDecay = savedProfiles.workpiece.meanDecayMs || 0;
    } else if (viewMode === 'tool') {
        if (savedProfiles.tool.peaks.length > 0) ft = savedProfiles.tool.peaks[0].freq.toFixed(1);
        primaryDecay = savedProfiles.tool.meanDecayMs || 0;
    }
    
    if (window.loadSSVParam) {
        window.loadSSVParam(fw, ft, primaryDecay, true);
    }

    let mode = 'fraesen';
    if (impactModeRadios) {
        impactModeRadios.forEach(r => { if(r.checked) mode = r.value; });
    }
    
    let flutes = 1;
    if (mode === 'drehen') {
        flutes = 1;
    } else {
        if (fluteSelect) {
            flutes = fluteSelect.value === 'custom' ? (fluteCustom ? parseInt(fluteCustom.value, 10) : 4) : parseInt(fluteSelect.value, 10);
        }
        if (!flutes || flutes < 1) flutes = 4; // Fallback
    }
    
    let html = '';
    const harmonische = [1.0, 0.5, 0.3333, 0.25];
    const kNames = ["1. Ordnung", "2. Ordnung", "3. Ordnung", "4. Ordnung"];
    
    function buildTableSection(title, targetArea, color, targetKey) {
        if (!targetArea.peaks || targetArea.peaks.length === 0) return '';
        
        let avgPeak = targetArea.peaks[0];
        let avgDecay = targetArea.meanDecayMs || 0;
        
        // Immer ALLE Samples anzeigen; Scrollbar im Container sorgt für die Nutzbarkeit
        let visibleSamples = targetArea.samples;
        
        // --- Outlier Detection Precomputation ---
        let hitOutliers = [];
        for (let i = 0; i < visibleSamples.length; i++) {
            let sample = visibleSamples[i];
            let sMag = 0, sFreq = 0;
            let sMagX = 0, sMagY = 0, sMagZ = 0;
            let peakIdx = -1;
            
            let sPeaks = [];
            for(let j=2; j<sample.mags.length-2; j++) {
                if (sample.mags[j] > sample.mags[j-1] && sample.mags[j] > sample.mags[j+1] &&
                    sample.mags[j] > sample.mags[j-2] && sample.mags[j] > sample.mags[j+2]) {
                    if (sample.mags[j] > 1.0) {
                        sPeaks.push({ freq: sample.freqs[j], mag: sample.mags[j], idx: j });
                    }
                }
            }
            
            sPeaks.sort((a, b) => b.mag - a.mag);
            
            if (sPeaks.length > 1) {
                let maxPk = sPeaks[0];
                for (let k = 1; k < Math.min(sPeaks.length, 5); k++) {
                    let cand = sPeaks[k];
                    if (cand.freq < maxPk.freq - 2.0) {
                        let ratio = maxPk.freq / cand.freq;
                        if (Math.abs(ratio - Math.round(ratio)) < 0.15 && Math.round(ratio) >= 2 && Math.round(ratio) <= 3) {
                            if (cand.mag > maxPk.mag * 0.40) {
                                sPeaks[0] = cand;
                                sPeaks[k] = maxPk;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (sPeaks.length > 0) {
                peakIdx = sPeaks[0].idx;
            } else {
                for(let j=2; j<sample.mags.length-2; j++) {
                    if (sample.mags[j] > sMag) {
                        sMag = sample.mags[j];
                        peakIdx = j;
                    }
                }
            }
            
            if (peakIdx !== -1) {
                sMag = sample.mags[peakIdx];
                sFreq = sample.freqs[peakIdx];
                sMagX = sample.magsX ? sample.magsX[peakIdx] : 0;
                sMagY = sample.magsY ? sample.magsY[peakIdx] : 0;
                sMagZ = sample.magsZ ? sample.magsZ[peakIdx] : 0;
            }
            
            let isOutlier = false;
            // 10% Frequenztoleranz oder 2.0x STD-Abweichung (Magnitude)
            if (sFreq > 0 && Math.abs(sFreq - avgPeak.freq) > (avgPeak.freq * 0.10)) isOutlier = true;
            if (sMag > 0 && avgPeak.std > 0 && Math.abs(sMag - avgPeak.mag) > (2.0 * avgPeak.std)) isOutlier = true;
            
            let decayMs = sample.decay || 0;
            let dRatio = (sFreq > 0 && decayMs > 0) ? (47679 / (sFreq * decayMs)) : 0;
            
            hitOutliers.push({sFreq, sMag, sMagX, sMagY, sMagZ, decayMs, dRatio, isOutlier});
        }
        
        let sectionHtml = `<div style="flex: 1; min-width: 300px; max-width: 100%; overflow-x: auto; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;">
            <table class="impact-result-table" style="width: 100%; text-align:center; white-space: nowrap;">
                <thead>
                    <tr><th colspan="${visibleSamples.length + 2}" style="background:#222; color:${color}; font-size:1.1em; padding-top:15px; border-top:1px solid #444; border-bottom: 2px solid ${color};">${title} (Dominante Frequenz)</th></tr>
                    <tr>
                        <th style="background:#333; text-align:left; position: sticky; left: 0; z-index: 2;">Parameter</th>`;
        
        for (let i = 0; i < visibleSamples.length; i++) {
            let bg = hitOutliers[i].isOutlier ? '#4a2a2a' : '#2a2a2a';
            let warnIcon = hitOutliers[i].isOutlier ? ' <span title="Ausreißer-Warnung!">⚠️</span>' : '';
            sectionHtml += `<th style="background:${bg}; padding: 8px 15px;">Hit ${i + 1}${warnIcon} <span onclick="window.removeImpactHit('${targetKey}', ${i})" style="color:#ff4a4a; cursor:pointer; font-size:1.2em; font-weight:bold; margin-left:8px;" title="Diesen Schlag löschen">✖</span></th>`;
        }
        
        sectionHtml += `<th style="background:#444; border-left: 2px solid #555; color:#fff; position: sticky; right: 0; z-index: 2; padding: 0 15px;">Mittelwert</th>
                    </tr>
                </thead>
                <tbody>`;
                
        // Zeile 1: Frequenz
        sectionHtml += `<tr><td style="font-weight:bold; color:#ccc; text-align:left; position: sticky; left: 0; background: #1a1a1a; z-index: 1;">Resonanz (Hz) <span onclick="document.getElementById('resonanceHelpOverlay').style.display='flex'" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:#4da6ff; color:#000; font-size:11px; margin-left:6px;" title="Erklärung anzeigen">?</span></td>`;
        for (let i = 0; i < visibleSamples.length; i++) {
            let bg = hitOutliers[i].isOutlier ? 'background:#3a1a1a;' : '';
            sectionHtml += `<td style="${bg}">${hitOutliers[i].sFreq.toFixed(1)}</td>`;
        }
        sectionHtml += `<td style="font-weight:bold; border-left: 2px solid #555; position: sticky; right: 0; background: #1a1a1a; z-index: 1;">${avgPeak.freq.toFixed(1)}</td></tr>`;
        
        // Zeile 2: Magnitude
        sectionHtml += `<tr><td style="font-weight:bold; color:#ccc; text-align:left; position: sticky; left: 0; background: #1a1a1a; z-index: 1;">Magnitude (g) <span onclick="document.getElementById('magnitudeHelpOverlay').style.display='flex'" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:#ff9800; color:#000; font-size:11px; margin-left:6px;" title="Erklärung anzeigen">?</span></td>`;
        for (let i = 0; i < visibleSamples.length; i++) {
            let bg = hitOutliers[i].isOutlier ? 'background:#3a1a1a;' : '';
            sectionHtml += `<td style="${bg}">${hitOutliers[i].sMag.toFixed(1)}</td>`;
        }
        let stdStr = (avgPeak.std !== undefined && avgPeak.std > 0) ? `<br><span style="font-size:0.8em; color:#888;">(±${avgPeak.std.toFixed(1)})</span>` : '';
        sectionHtml += `<td style="font-weight:bold; border-left: 2px solid #555; position: sticky; right: 0; background: #1a1a1a; z-index: 1;">${avgPeak.mag.toFixed(1)}${stdStr}</td></tr>`;
        
        let avgBin = targetArea.freqs.length > 1 ? Math.round(avgPeak.freq / (targetArea.freqs[1] - targetArea.freqs[0])) : 0;
        let avgMaxX = targetArea.magsX ? targetArea.magsX[avgBin] : 0;
        let avgMaxY = targetArea.magsY ? targetArea.magsY[avgBin] : 0;
        let avgMaxZ = targetArea.magsZ ? targetArea.magsZ[avgBin] : 0;
        
        let axesOpts = [
            { id: 'sMagX', name: 'Magnitude X', color: '#ff4a4a', d: avgMaxX },
            { id: 'sMagY', name: 'Magnitude Y', color: '#4caf50', d: avgMaxY },
            { id: 'sMagZ', name: 'Magnitude Z', color: '#4da6ff', d: avgMaxZ }
        ];
        
        for (let ax of axesOpts) {
            sectionHtml += `<tr><td style="font-weight:normal; color:${ax.color}; font-size:0.9em; padding-left:20px; text-align:left; position: sticky; left: 0; background: #1a1a1a; z-index: 1;">↳ ${ax.name}</td>`;
            for (let i = 0; i < visibleSamples.length; i++) {
                let bg = hitOutliers[i].isOutlier ? 'background:#3a1a1a;' : '';
                let val = hitOutliers[i][ax.id] || 0;
                sectionHtml += `<td style="${bg}; color:${ax.color}; font-size:0.9em;">${val.toFixed(1)}</td>`;
            }
            let avgVal = ax.d || 0;
            sectionHtml += `<td style="font-weight:bold; color:${ax.color}; font-size:0.9em; border-left: 2px solid #555; position: sticky; right: 0; background: #1a1a1a; z-index: 1;">${avgVal.toFixed(1)}</td></tr>`;
        }
        
        // Zeile 3: Dämpfung (Lehr'sches Dämpfungsmaß D)
        sectionHtml += `<tr><td style="font-weight:bold; color:#ccc; text-align:left; position: sticky; left: 0; background: #1a1a1a; z-index: 1;">Dämpfung D (%) <span onclick="document.getElementById('dampingHelpOverlay').style.display='flex'" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:#4da6ff; color:#000; font-size:11px; margin-left:6px;" title="Erklärung anzeigen">?</span></td>`;
        for (let i = 0; i < visibleSamples.length; i++) {
            let bg = hitOutliers[i].isOutlier ? 'background:#3a1a1a;' : '';
            let dRatio = hitOutliers[i].dRatio;
            sectionHtml += `<td style="${bg}">${dRatio > 0 ? dRatio.toFixed(2) : '--'}</td>`;
        }
        
        let avgD = (avgPeak.freq > 0 && avgDecay > 0) ? (47679 / (avgPeak.freq * avgDecay)) : 0;
        let decayText = "--";
        let dColor = "#aaa";
        if (avgD > 0) {
            decayText = (avgD >= 4.0) ? "HERVORRAGEND" : (avgD >= 1.5) ? "GUT" : (avgD >= 0.5) ? "KRITISCH" : "GEFÄHRLICH";
            dColor = (avgD >= 4.0) ? "#4caf50" : (avgD >= 1.5) ? "#8bc34a" : (avgD >= 0.5) ? "#ff9800" : "#ff4a4a";
        }
        
        sectionHtml += `<td style="font-weight:bold; border-left: 2px solid #555; color:${dColor}; position: sticky; right: 0; background: #1a1a1a; z-index: 1;">${avgD > 0 ? avgD.toFixed(2) : '--'} <div style="font-size:0.7em;">${decayText}</div></td></tr>`;
        
        // Harmonics
        for(let i=0; i<4; i++) {
            let k = harmonische[i];
            let labelParts = mode === 'drehen' ? `Drehzahl (U/min)` : `Spindel (U/min)`;
            
            sectionHtml += `<tr><td style="font-weight:normal; color:#bbb; text-align:left; position: sticky; left: 0; background: #1a1a1a; z-index: 1;">${kNames[i]} ${labelParts}</td>`;
            for (let s = 0; s < visibleSamples.length; s++) {
                let bg = hitOutliers[s].isOutlier ? 'background:#3a1a1a;' : '';
                let rpm = (hitOutliers[s].sFreq * k * 60) / flutes;
                sectionHtml += `<td style="${bg}; color:#ccc;">${hitOutliers[s].sFreq > 0 ? Math.round(rpm) : '--'}</td>`;
            }
            let rpmAvg = (avgPeak.freq * k * 60) / flutes;
            sectionHtml += `<td style="font-weight:bold; border-left: 2px solid #555; position: sticky; right: 0; background: #1a1a1a; z-index: 1; color:#fff;">${Math.round(rpmAvg)}</td></tr>`;
        }

        // SSV Loader
        let clkStr = `if(window.loadSSVParam) window.loadSSVParam('${avgPeak.freq.toFixed(1)}', '', ${avgDecay || 0})`;
        if (title.indexOf('Werkzeug') !== -1) clkStr = `if(window.loadSSVParam) window.loadSSVParam('', '${avgPeak.freq.toFixed(1)}', ${avgDecay || 0})`;

        sectionHtml += `<tr class="selectable-peak-row" onclick="${clkStr}" style="cursor:pointer; transition:background 0.2s;"><td colspan="${visibleSamples.length + 2}" style="background: rgba(255,255,255,0.05); text-align:center; padding: 10px; color:${color}; font-weight:bold; position: sticky; left: 0; z-index: 1;">➔ Werte in SSV Rechner laden</td></tr>`;
        
        sectionHtml += `</tbody></table></div>`;
        return sectionHtml;
    }

    if (viewMode === 'combined' || viewMode === 'workpiece') {
        html += buildTableSection("📊 Werkstück", savedProfiles.workpiece, "#ffd600", "workpiece");
    }
    if (viewMode === 'combined' || viewMode === 'tool') {
        html += buildTableSection("⚙️ Werkzeug", savedProfiles.tool, "#4da6ff", "tool");
    }

    if (impactTablesContainer) impactTablesContainer.innerHTML = html;
    // Initial Rendern
    if (window.updateRpmChart) window.updateRpmChart();
}

// RPM Diagramm updaten: Lokal-Zoom auf Ziel-Drehzahl (+/- 25%)
window.updateRpmChart = function() {
    if (!rpmChartInstance) return;
    
    let activePeaks = [];
    let viewMode = 'combined';
    const filterRadios = document.querySelectorAll('input[name="impactViewFilter"]');
    if (filterRadios) {
        filterRadios.forEach(r => { if(r.checked) viewMode = r.value; });
    }
    
    if (typeof savedProfiles !== 'undefined' && savedProfiles) {
        if (viewMode === 'combined') {
            activePeaks = [...savedProfiles.workpiece.peaks, ...savedProfiles.tool.peaks];
        } else if (viewMode === 'workpiece') {
            activePeaks = [...savedProfiles.workpiece.peaks];
        } else if (viewMode === 'tool') {
            activePeaks = [...savedProfiles.tool.peaks];
        }
    }

    // Manueller Überschreib-Modus: Wenn User Frequenzen eintippt
    const freqWp = document.getElementById('ssvFreqWp');
    const freqTool = document.getElementById('ssvFreqTool');
    let userPeaks = [];
    let isManualOverride = false;
    
    if (freqWp && freqWp.value) {
        let f = parseFloat(freqWp.value);
        if (!isNaN(f) && f > 0) userPeaks.push({ freq: f, mag: 100, std: 0 });
    }
    if (freqTool && freqTool.value) {
        let f = parseFloat(freqTool.value);
        if (!isNaN(f) && f > 0) userPeaks.push({ freq: f, mag: 100, std: 0 });
    }
    
    // Check if the inputs exactly match our auto-filled best peaks
    if (userPeaks.length > 0) {
        let allMatch = true;
        for (let up of userPeaks) {
            let exists = activePeaks.some(ap => Math.abs(ap.freq - up.freq) < 0.2);
            if (!exists) allMatch = false;
        }
        if (!allMatch) {
            activePeaks = userPeaks;
        }
    }

    if (activePeaks.length === 0) return;

    let flutes = 1;
    let mode = 'fraesen';
    const modeRadios = document.querySelectorAll('input[name="impactMode"]');
    if (modeRadios) {
        modeRadios.forEach(r => { if(r.checked) mode = r.value; });
    }
    if (mode === 'drehen') {
        flutes = 1;
    } else {
        const fs = document.getElementById('impactFluteCount');
        const fc = document.getElementById('impactFluteCountCustom');
        if (fs && fc) {
            flutes = fs.value === 'custom' ? parseInt(fc.value, 10) : parseInt(fs.value, 10);
        }
        if (!flutes || flutes < 1) flutes = 4;
    }

    let N = 800; // Optimale Auflösung für Canvas Chart, verhindert UI Freezes
    let xRpm = new Float32Array(N);
    let yRisk = new Float32Array(N);
    let ySweet = new Float32Array(N);
    let maxY = 0;
    
    let targetMaxRpm = 10000;
    const rpmInput = document.getElementById('ssvRpmInput');
    if (rpmInput) {
        let val = parseInt(rpmInput.value, 10);
        if (!isNaN(val) && val > 0) targetMaxRpm = val;
    }
    
    let minRpm = targetMaxRpm * 0.75;
    let maxRpm = targetMaxRpm * 1.25;
    
    // --- 1. Vorberechnung aller Störfrequenzen (Gaussians) außerhalb der Renderschleife ---
    let gaussians = [];
    activePeaks.forEach(p => {
        let primaryBadRpm = (p.freq * 60) / flutes;
        let maxK = Math.ceil(primaryBadRpm / Math.max(10, minRpm)) + 2; 
        if (maxK > 50) maxK = 50;
        
        for(let k=1; k<=maxK; k++) {
            let badRpm = primaryBadRpm / k;
            if (badRpm > maxRpm * 1.5) continue;
            
            let sigma = badRpm * 0.005; 
            if (sigma < 2) sigma = 2;
            
            let amplitude = 100.0 / Math.sqrt(k);
            let denom = 2 * sigma * sigma;

            gaussians.push({ mean: badRpm, amp: amplitude, denom: denom });
        }
    });

    // --- 2. Hocheffiziente Render-Schleife (Verhindert 5-Sekunden Livechart Verzögerung) ---
    let rpmStep = (maxRpm - minRpm) / (N - 1);
    for(let i=0; i<N; i++) {
        let rpm = minRpm + i * rpmStep;
        xRpm[i] = rpm;
        
        let currentSystemRisk = 0;
        for (let g = 0; g < gaussians.length; g++) {
            let diff = rpm - gaussians[g].mean;
            // Diff*Diff viel schneller als Math.pow
            currentSystemRisk += gaussians[g].amp * Math.exp(-(diff * diff) / gaussians[g].denom);
        }
        
        yRisk[i] = currentSystemRisk;
        if (currentSystemRisk > maxY) maxY = currentSystemRisk;
    }
    
    if (maxY < 0.1) maxY = 1; 
    
    for(let i=0; i<N; i++) {
        ySweet[i] = maxY - yRisk[i];
    }
    
    rpmChartInstance.setData([xRpm, yRisk, ySweet]);
    rpmChartInstance.setScale('x', { min: minRpm, max: maxRpm });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initImpactTest();
        if (typeof attachSSVHooks === 'function') attachSSVHooks();
    });
} else {
    initImpactTest();
    if (typeof attachSSVHooks === 'function') attachSSVHooks();
}

window.toggleImpactChart = function(containerId) {
    const container = document.getElementById(containerId);
    const chevron = document.getElementById('chevron_' + containerId);
    const btnExt = document.getElementById('btnExt_' + containerId);
    if (!container) return;
    
    let isCollapsed = container.dataset.collapsed === "true";
    
    if (isCollapsed) {
        container.style.height = "250px";
        container.dataset.collapsed = "false";
        container.dataset.extended = "false";
        if (chevron) chevron.innerText = "▲"; // Points up to collapse
        if (btnExt) {
            btnExt.style.display = "inline-block";
            btnExt.innerText = "⛶ Extend";
        }
        triggerResize(containerId, 250);
    } else {
        container.style.height = "0px";
        container.dataset.collapsed = "true";
        if (chevron) chevron.innerText = "▼"; // Points down to expand
        if (btnExt) btnExt.style.display = "none";
    }
};

window.extendImpactChart = function(containerId) {
    const container = document.getElementById(containerId);
    const btnExt = document.getElementById('btnExt_' + containerId);
    if (!container) return;
    
    let isExtended = container.dataset.extended === "true";
    
    if (isExtended) {
        container.style.height = "250px";
        container.dataset.extended = "false";
        if (btnExt) btnExt.innerText = "⛶ Extend";
        triggerResize(containerId, 250);
    } else {
        container.style.height = "500px";
        container.dataset.extended = "true";
        if (btnExt) btnExt.innerText = "− Normal";
        triggerResize(containerId, 500);
    }
};

function triggerResize(containerId, height) {
    setTimeout(() => {
        const container = document.getElementById(containerId);
        if(!container) return;
        let cw = container.clientWidth;
        if (containerId === 'impactTimeChartContainer' && timeChartInstance) {
            timeChartInstance.setSize({width: cw, height: height});
        }
        else if (containerId === 'impactChartContainer' && chartInstance) {
            chartInstance.setSize({width: cw, height: height});
        }
        else if (containerId === 'rpmChartContainer' && rpmChartInstance) {
            rpmChartInstance.setSize({width: cw, height: height});
        }
    }, 310);
}

function rebuildTimeChart(srate = 1666) {
    const container = document.getElementById('impactTimeChartContainer');
    if (!container || container.clientWidth === 0) return;

    if (timeChartInstance) {
        timeChartInstance.destroy();
        timeChartInstance = null;
    }

    let seriesConfig = [ {} ]; // X-Achse
    let chartData = [];

    // Erzeuge eine X-Achse basierend auf der bufferSize
    let xTime = new Float32Array(bufferSize);
    for(let i=0; i<bufferSize; i++) xTime[i] = (i / srate) * 1000;
    chartData.push(xTime);

    let viewMode = 'combined';
    const filterRadios = document.querySelectorAll('input[name="impactViewFilter"]');
    if (filterRadios) filterRadios.forEach(r => { if(r.checked) viewMode = r.value; });

    let wpSamples = (viewMode === 'combined' || viewMode === 'workpiece') && savedProfiles.workpiece ? savedProfiles.workpiece.samples : [];
    let toolSamples = (viewMode === 'combined' || viewMode === 'tool') && savedProfiles.tool ? savedProfiles.tool.samples : [];

    // Helper für Achsen
    function addHitLines(samples, prefix, baseColorTotal) {
        const op = (i) => Math.max(0.2, 1.0 - (samples.length - 1 - i) * 0.15);
        const width = 1.0;

        for (let i = 0; i < samples.length; i++) {
            seriesConfig.push({ label: `${prefix} #${i+1} (X)`, stroke: `rgba(255, 74, 74, ${op(i)})`, width: width });
            chartData.push(samples[i].rawX || new Float32Array(bufferSize));
        }
        for (let i = 0; i < samples.length; i++) {
            seriesConfig.push({ label: `${prefix} #${i+1} (Y)`, stroke: `rgba(76, 175, 80, ${op(i)})`, width: width, dash: [5, 5] });
            chartData.push(samples[i].rawY || new Float32Array(bufferSize));
        }
        for (let i = 0; i < samples.length; i++) {
            seriesConfig.push({ label: `${prefix} #${i+1} (Z)`, stroke: `rgba(77, 166, 255, ${op(i)})`, width: width, dash: [10, 5] });
            chartData.push(samples[i].rawZ || new Float32Array(bufferSize));
        }
        for (let i = 0; i < samples.length; i++) {
            seriesConfig.push({ label: `${prefix} #${i+1} (Total)`, stroke: `rgba(${baseColorTotal}, ${op(i) * 0.3})`, width: width, dash: [2, 4] });
            
            // Berechne Total-Magnitude falls nicht vorhanden
            if (!samples[i].magsTotalTime && samples[i].rawX) {
                samples[i].magsTotalTime = new Float32Array(bufferSize);
                for(let j=0; j<bufferSize; j++) {
                    samples[i].magsTotalTime[j] = Math.sqrt(samples[i].rawX[j]**2 + samples[i].rawY[j]**2 + samples[i].rawZ[j]**2);
                }
            }
            chartData.push(samples[i].magsTotalTime || samples[i].rawTime || new Float32Array(bufferSize));
        }
    }

    if (wpSamples.length === 0 && toolSamples.length === 0) {
        seriesConfig.push({ label: "Impuls (g)", stroke: "#ff9800", width: 2 });
        chartData.push(new Float32Array(bufferSize));
    } else {
        addHitLines(wpSamples, "WP", "255, 214, 0");
        addHitLines(toolSamples, "Tool", "200, 200, 200");
    }

    const timeOpts = {
        width: container.clientWidth,
        height: container.clientHeight || 250,
        axes: [
            { label: "t (ms)", stroke: "#fff", grid: { stroke: "#333" } },
            { scale: "y", stroke: "#fff", grid: { stroke: "#333" } }
        ],
        series: seriesConfig,
        scales: { "x": { time: false }, "y": { auto: true } },
        cursor: { drag: { x: true, y: true, setScale: true } },
        plugins: [createCursorTooltipPlugin("ms"), wheelZoomPlugin()]
    };

    timeChartInstance = new uPlot(timeOpts, chartData, container);
}

// Duplicate function removed as it is now properly merged with window.rebuildFftChart

// --- SSV Rechner Logik ---
window.loadSSVParam = function(freqWpStr, freqToolStr, decayMs, disableScroll = false) {
    if (!disableScroll) {
        const topBlock = document.getElementById('processParamsBlock');
        if (topBlock) {
            setTimeout(() => {
                topBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }
    
    if (freqWpStr !== undefined && freqWpStr !== '') document.getElementById('ssvFreqWp').value = freqWpStr;
    if (freqToolStr !== undefined && freqToolStr !== '') document.getElementById('ssvFreqTool').value = freqToolStr;
    document.getElementById('ssvSelectedDecay').textContent = decayMs ? decayMs.toFixed(0) + " ms" : "-- ms";
    
    // Daten sichern für Re-calc
    window.currentSsvDecay = decayMs || 0;
    
    updateSSV();
};

function updateSSV() {
    const freqWp = document.getElementById('ssvFreqWp');
    const freqTool = document.getElementById('ssvFreqTool');
    
    let targetFreqs = [];
    if (freqWp && freqWp.value) {
        let f = parseFloat(freqWp.value);
        if(!isNaN(f) && f > 0) targetFreqs.push(f);
    }
    if (freqTool && freqTool.value) {
        let f = parseFloat(freqTool.value);
        if(!isNaN(f) && f > 0) targetFreqs.push(f);
    }
    if (targetFreqs.length === 0) {
        const rAmpPercent = document.getElementById('ssvResultAmpPercent');
        const rAmp = document.getElementById('ssvResultAmp');
        const rFreq = document.getElementById('ssvResultFreq');
        const rPer = document.getElementById('ssvResultPeriod');
        if (rAmpPercent) rAmpPercent.textContent = "-- %";
        if (rAmp) rAmp.textContent = "-- U/min";
        if (rFreq) rFreq.textContent = "-- Hz";
        if (rPer) rPer.textContent = "-- s";
        return;
    }
    
    const rpmInput = document.getElementById('ssvRpmInput');
    const N0 = rpmInput ? parseInt(rpmInput.value, 10) : 5000;
    if (isNaN(N0) || N0 <= 0) return;
    
    const ampInput = document.getElementById('ssvAmpPercent');
    const ampPercent = ampInput ? parseFloat(ampInput.value) : 10.0;
    
    const accelInput = document.getElementById('ssvAccelInput');
    const aMax = accelInput ? parseFloat(accelInput.value) : 6000.0;
    
    const limitInput = document.getElementById('ssvMaxFreqLimit');
    const absoluteLimit = limitInput ? parseFloat(limitInput.value) : 2.0;
    
    // 1. Amplitude berechnen (aus Prozentwert)
    let amplitude = Math.round(N0 * (ampPercent / 100.0));
    if (amplitude < 1) amplitude = 1;
    
    // 2. Kinetisches Limit (fm,max) berechnen basierend auf a_max
    let fm_max_accel = aMax / (2 * Math.PI * amplitude);
    let fm_max = Math.min(fm_max_accel, absoluteLimit);
    if (fm_max <= 0) fm_max = 0.1;
    
    // 3. Multi-Kriterielle Phasen-Optimierung 
    // Wir wollen f_m finden, sodass R = f_c / f_m für ALLE targets auf ~0.5 endet
    let best_fm = fm_max;
    
    if (targetFreqs.length === 1) {
        let r_max = targetFreqs[0] / fm_max;
        let r_base = Math.floor(r_max);
        let r_ideal = (r_max <= r_base + 0.5) ? (r_base + 0.5) : (r_base + 1.5);
        best_fm = targetFreqs[0] / r_ideal;
    } else {
        // Multi-System Sweep-Algorithmus (Fehler-Minimierung)
        let minError = Infinity;
        // Sweep von fm_max bis 0.1 Hz mit extrem feinen Schritten
        for(let fm_test = fm_max; fm_test >= 0.1; fm_test -= 0.005) {
            let error = 0;
            for(let fc of targetFreqs) {
                let r = fc / fm_test;
                let fractional = r - Math.floor(r);
                let dist = Math.abs(fractional - 0.5);
                error += dist * dist; // Squared Error penalisiert massive Ausreißer stärker
            }
            if (error < minError) {
                minError = error;
                best_fm = fm_test;
            }
        }
    }
    
    let fm = best_fm;
    let period = 1.0 / fm;
    
    const rAmpPercent = document.getElementById('ssvResultAmpPercent');
    const rAmp = document.getElementById('ssvResultAmp');
    const rFreq = document.getElementById('ssvResultFreq');
    const rPer = document.getElementById('ssvResultPeriod');
    
    if (rAmpPercent) rAmpPercent.textContent = ampPercent.toFixed(1) + " %";
    if (rAmp) rAmp.textContent = "±" + amplitude + " U/min";
    if (rFreq) rFreq.innerHTML = fm.toFixed(3) + " Hz";
    if (rPer) rPer.innerHTML = period.toFixed(4) + " s";
    
    // Live-Update des Graphen auf das neue Drehzahl-Fenster
    if (window.updateRpmChart) window.updateRpmChart();
}

// Hooks verankern (Da wir nicht in module mode sind, geht das auch nach DOM-Load oder per mutation)
function attachSSVHooks() {
    ['ssvRpmInput', 'ssvFreqWp', 'ssvFreqTool', 'ssvAmpPercent', 'ssvAccelInput', 'ssvMaxFreqLimit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateSSV);
    });

    // --- Bidirektionaler Schnittdatenrechner (vc / D <-> N0) ---
    const ssvVcInput = document.getElementById('ssvVcInput');
    const ssvDiameterInput = document.getElementById('ssvDiameterInput');
    const ssvRpmInput = document.getElementById('ssvRpmInput');

    function updateRpmFromVc() {
        if (!ssvVcInput || !ssvDiameterInput || !ssvRpmInput) return;
        const vc = parseFloat(ssvVcInput.value);
        const d = parseFloat(ssvDiameterInput.value);
        if (!isNaN(vc) && !isNaN(d) && d > 0) {
            let n0 = Math.round((vc * 1000) / (Math.PI * d));
            ssvRpmInput.value = n0;
            updateSSV();
        }
    }

    function updateVcFromRpm() {
        if (!ssvVcInput || !ssvDiameterInput || !ssvRpmInput) return;
        const n0 = parseFloat(ssvRpmInput.value);
        const d = parseFloat(ssvDiameterInput.value);
        if (!isNaN(n0) && !isNaN(d) && d > 0) {
            let vc = Math.round((n0 * Math.PI * d) / 1000);
            ssvVcInput.value = vc;
            // updateSSV() ist via ssvRpmInput 'input' event schon abgedeckt
        }
    }

    if (ssvVcInput) ssvVcInput.addEventListener('input', updateRpmFromVc);
    if (ssvDiameterInput) ssvDiameterInput.addEventListener('input', updateRpmFromVc);
    if (ssvRpmInput) ssvRpmInput.addEventListener('input', updateVcFromRpm);

    // --- Modus Toggle (Fräsen vs. Drehen) ---
    const unifiedFrasenConfig = document.getElementById('unifiedFrasenConfig');
    const impactModeRadiosParams = document.querySelectorAll('input[name="impactMode"]');
    impactModeRadiosParams.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'drehen') {
                if (unifiedFrasenConfig) unifiedFrasenConfig.style.display = 'none';
            } else {
                if (unifiedFrasenConfig) unifiedFrasenConfig.style.display = 'flex';
            }
        });
    });

    // --- Session Save & Load Logic ---
    window.showCustomToast = function(msg, isError = false) {
        let t = document.createElement('div');
        t.style.position = 'fixed';
        t.style.bottom = '20px';
        t.style.right = '20px';
        t.style.backgroundColor = isError ? 'rgba(255, 74, 74, 0.9)' : 'rgba(76, 175, 80, 0.9)';
        t.style.color = '#fff';
        t.style.padding = '12px 24px';
        t.style.borderRadius = '6px';
        t.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        t.style.zIndex = '9999';
        t.style.fontWeight = 'bold';
        t.style.opacity = '0';
        t.style.transform = 'translateY(20px)';
        t.style.transition = 'all 0.3s ease';
        t.textContent = msg;
        document.body.appendChild(t);

        setTimeout(() => {
            t.style.opacity = '1';
            t.style.transform = 'translateY(0)';
        }, 10);

        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transform = 'translateY(20px)';
            setTimeout(() => t.remove(), 300);
        }, 3000);
    };
    const btnSaveSession = document.getElementById('btnSaveSession');
    const btnLoadSession = document.getElementById('btnLoadSession');
    const impactFileInput = document.getElementById('impactFileInput');

    if (btnSaveSession) {
        btnSaveSession.addEventListener('click', () => {
            if (savedProfiles.workpiece.samples.length === 0 && savedProfiles.tool.samples.length === 0) return window.showCustomToast("Keine aktiven Messungen zum Speichern vorhanden.", true);
            
            // Helper um Float32Arrays für JSON tauglich zu machen
            const serializeState = (obj) => {
                if (obj instanceof Float32Array) return Array.from(obj);
                if (Array.isArray(obj)) return obj.map(serializeState);
                if (obj !== null && typeof obj === 'object') {
                    let result = {};
                    for (let key in obj) {
                        result[key] = serializeState(obj[key]);
                    }
                    return result;
                }
                return obj;
            };

            let uiState = {};
            ['ssvRpmInput', 'ssvFreqWp', 'ssvFreqTool', 'ssvAmpPercent', 'ssvAccelInput', 'ssvMaxFreqLimit', 'impactFluteCount', 'impactFluteCountCustom', 'ssvVcInput', 'ssvDiameterInput'].forEach(id => {
                const el = document.getElementById(id);
                if(el) uiState[id] = el.value;
            });

            let mode = 'fraesen';
            const modeRadios = document.querySelectorAll('input[name="impactMode"]');
            if (modeRadios) modeRadios.forEach(r => { if(r.checked) mode = r.value; });
            uiState['impactMode'] = mode;

            const sessionData = {
                timestamp: new Date().toISOString(),
                version: "1.0",
                uiState: uiState,
                profiles: serializeState(savedProfiles)
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionData));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href",     dataStr);
            downloadAnchorNode.setAttribute("download", "senzimu_session_" + new Date().getTime() + ".json");
            document.body.appendChild(downloadAnchorNode); 
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        });
    }

    if (btnLoadSession && impactFileInput) {
        btnLoadSession.addEventListener('click', () => {
            impactFileInput.click();
        });

        impactFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const sessionData = JSON.parse(event.target.result);
                    
                    // Helper um normale Arrays zurück in Float32Arrays zu gießen für die Performanz und Canvas-Engines
                    const deserializeState = (obj) => {
                        if (Array.isArray(obj)) {
                            // Wenn das erste Element eine Zahl ist, gehen wir davon aus, dass es ein Float32 Datenarray war
                            if (obj.length > 0 && typeof obj[0] === 'number') return new Float32Array(obj);
                            return obj.map(deserializeState); // Array von Objekten (z.B. samples)
                        }
                        if (obj !== null && typeof obj === 'object') {
                            let result = {};
                            for (let key in obj) {
                                result[key] = deserializeState(obj[key]);
                            }
                            return result;
                        }
                        return obj;
                    };

                    savedProfiles = deserializeState(sessionData.profiles);
                    
                    if (sessionData.uiState) {
                        for(let id in sessionData.uiState) {
                            if (id === 'impactMode') {
                                const modeRadios = document.querySelectorAll('input[name="impactMode"]');
                                modeRadios.forEach(r => { 
                                    if(r.value === sessionData.uiState[id]) {
                                        r.checked = true;
                                        r.dispatchEvent(new Event('change'));
                                    }
                                });
                            } else {
                                const el = document.getElementById(id);
                                if (el) el.value = sessionData.uiState[id];
                            }
                        }
                    }

                    // Alle Grafiken und Views neuladen aus gecachten Arrays
                    if (typeof rebuildTimeChart === 'function') rebuildTimeChart();
                    if (typeof rebuildFftChart === 'function') rebuildFftChart();
                    displayResults();
                    if(typeof loadSSVParam === 'function' || window.loadSSVParam) {
                        // SSV fields are implicitly updated inside displayResults, but to be sure we can trigger SSV redraw
                        if(window.updateSSV) window.updateSSV();
                    }
                    window.showCustomToast("Session erfolgreich geladen!", false);
                    
                } catch (err) {
                    window.showCustomToast("Fehler beim Laden der Datei", true);
                    console.error("Session Load Error: ", err);
                }
                
                // Clear input so same file can be loaded again if needed
                impactFileInput.value = "";
            };
            reader.readAsText(file);
        });
    }

}
