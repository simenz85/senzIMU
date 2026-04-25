export function buildImpactTableSection(title, targetArea, color, targetKey, mode, flutes, hitOutliers) {
    if (!targetArea.peaks || targetArea.peaks.length === 0) return '';
    
    let avgPeak = targetArea.peaks[0];
    let avgDecay = targetArea.meanDecayMs || 0;
    let visibleSamples = targetArea.samples;
    
    let sectionHtml = `<div style="flex: 1; min-width: 300px; max-width: 100%; overflow-x: auto; background: #1a1a1a; padding: 10px; border-radius: 8px; border: 1px solid #333;">
        <table class="impact-result-table" style="width: 100%; text-align:center; white-space: nowrap;">
            <thead>
                <tr><th colspan="${visibleSamples.length + 2}" style="background:#222; color:${color}; font-size:1.1em; padding-top:15px; border-top:1px solid #444; border-bottom: 2px solid ${color};">${title} (Dominante Frequenz)</th></tr>
                <tr>
                    <th style="background:#333; text-align:left; position: sticky; left: 0; z-index: 2;">Parameter</th>`;
    
    for (let i = 0; i < visibleSamples.length; i++) {
        let bg = hitOutliers[i].isOutlier ? '#4a2a2a' : '#2a2a2a';
        let reasonStr = hitOutliers[i].outlierReason ? hitOutliers[i].outlierReason : 'Ausreißer-Warnung!';
        let warnIcon = hitOutliers[i].isOutlier ? ` <span title="${reasonStr}" style="cursor:help;">⚠️</span>` : '';
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
    const harmonische = [1.0, 0.5, 0.3333, 0.25];
    const kNames = ["1. Ordnung", "2. Ordnung", "3. Ordnung", "4. Ordnung"];
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
