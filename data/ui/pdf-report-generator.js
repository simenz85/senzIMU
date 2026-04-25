export function generateImpactPdfReport(dataContext) {
    const { 
        timeChartInstance, 
        chartInstance, 
        rpmChartInstance, 
        triggerThresholdRaw, 
        savedProfiles, 
        flutes, 
        operationMode 
    } = dataContext;

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
}
