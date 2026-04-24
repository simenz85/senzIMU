// c:\SENZIMU_github_sicherung\data\ui\replay-manager.js
import { setFixedBootTimeOffset, resetFixedBootTimeOffset } from '../utils/format-utils.js';


window.replayData = {
    acc: [[], [], [], []],
    gyro: [[], [], [], []]
};
let replayData = window.replayData;

let isReplaying = false;
let replayTime = 0; // current playback time in us relative to start
let lastAnimationTime = 0;
let playbackSpeed = 1.0;
let replayStartTimeUs = 0;
let replayEndTimeUs = 0;
let replayDurationUs = 0;
let replayLoopId = null;

let currentAccIndex = 0;
let currentGyroIndex = 0;

export function initReplayManager() {
    window.initOfflineReplay = () => {
        // Offline-Flag und Disconnect passieren erst in loadCsvFiles!

        // Hide the boot overlay if we are coming from the boot screen
        const overlay = document.getElementById('bootOverlay');
        if (overlay) overlay.style.display = 'none';
        
        if (window.startChartUpdates) {
            window.startChartUpdates();
        }
        
        // The UI control bar will remain hidden until a CSV is actually loaded.
        const controlBar = document.getElementById('replayControlBar');
        if (controlBar) controlBar.style.display = 'none';

        // Fake a click to force the dashboard UI to show if coming from Boot Screen
        const liveChartBtn = document.getElementById('navLivechart');
        if (liveChartBtn) liveChartBtn.click();
    };

    const fileInput = document.getElementById('replayCsvInput');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                await loadCsvFiles(e.target.files);
            }
        });
    }

    const playBtn = document.getElementById('replayPlayBtn');
    if (playBtn) playBtn.addEventListener('click', togglePlayState);

    const slider = document.getElementById('replayTimeSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            onSliderSeek(parseFloat(e.target.value));
        });
    }

    const speedSelect = document.getElementById('replaySpeedSelect');
    if (speedSelect) speedSelect.addEventListener('change', (e) => {
        playbackSpeed = parseFloat(e.target.value) || 1.0;
    });
}

function resetReplayState() {
    replayData = { acc: [[], [], [], []], gyro: [[], [], [], []] };
    replayTime = 0;
    isReplaying = false;
    replayStartTimeUs = 0;
    replayEndTimeUs = 0;
    replayDurationUs = 0;
    currentAccIndex = [0, 0, 0, 0];
    currentGyroIndex = [0, 0, 0, 0];
    
    // window.isOfflineReplayMode = false; <-- Entfällt, sonst killen wir die Anzeige!
    window.replayRecordingDate = "";
    
    // UI Cleanup
    const tsDateEl = document.getElementById('timestampDate');
    if (tsDateEl) tsDateEl.style.display = 'none';
    
    cancelAnimationFrame(replayLoopId);
    resetFixedBootTimeOffset(); // Freigeben falls Live-Stream später wieder aktiviert wird
    
    const playBtn = document.getElementById('replayPlayBtn');
    if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="1.2em" height="1.2em"><path d="M8 5v14l11-7z"/></svg> PLAY';
    
    if (window.resetDashboardBuffers) window.resetDashboardBuffers();
}

async function loadCsvFiles(files) {
    const overlay = document.getElementById('replayLoadingOverlay');
    const fnameEl = document.getElementById('replayLoadingFilename');
    if (overlay) overlay.classList.add('is-visible');

    // Force browser to paint the overlay with a robust delay before executing synchronous tasks
    await new Promise(r => setTimeout(r, 150));

    try {
        // Now we truly enter offline mode and halt the stream
        window.isOfflineReplayMode = true;
        if (window.wsWorker) {
            window.wsWorker.postMessage({ type: 'disconnect' });
        }
        if (window.activeSensors && window.activeSensors.length > 0) {
            window.activeSensors.forEach(node => {
                if (node.wsWorker) {
                    node.wsWorker.postMessage({ type: 'disconnect' });
                }
            });
        }
        
        resetReplayState();
        
        let minTime = Number.MAX_SAFE_INTEGER;
        let maxTime = 0;
    
        let flatFiles = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.name.toLowerCase().endsWith('.zip') && window.JSZip) {
                console.log(`Unpacking ${file.name}...`);
                if (fnameEl) fnameEl.textContent = `Entpacke ${file.name}...`;
                await new Promise(r => setTimeout(r, 50));
                
                const zip = await JSZip.loadAsync(file);
            for (const relativePath in zip.files) {
                const zipEntry = zip.files[relativePath];
                if (!zipEntry.dir && (relativePath.includes('acc') || relativePath.includes('gyro'))) {
                    const blob = await zipEntry.async("blob");
                    blob.name = relativePath;
                    flatFiles.push(blob);
                }
            }
        } else {
            flatFiles.push(file);
        }
    }
    
    for (let i = 0; i < flatFiles.length; i++) {
        const file = flatFiles[i];
        const isAcc = file.name.toLowerCase().includes('acc');
        const isGyro = file.name.toLowerCase().includes('gyro');
        
            if (isAcc || isGyro) {
                console.log(`Loading ${file.name}...`);
                if (fnameEl) fnameEl.textContent = `Analysiere ${file.name}...`;
                await new Promise(r => setTimeout(r, 50));
                
                const data = await parseCsv(file);
                console.log(`Parsed ${data.length > 0 ? data[0]?.length || 0 : 0} rows from ${file.name}.`);
            
            // Extract _CH1_, _CH2_, _CH3_, _CH4_ from filename to map to indices 0, 1, 2, 3
            const chMatch = file.name.toUpperCase().match(/_CH(\d)_/);
            const explicitCh = chMatch ? parseInt(chMatch[1], 10) - 1 : 0;
            const hasChannelColumnInFile = data.length > 1; // If parseCsv found multiple channels internally
            
            for (let ch = 0; ch < data.length; ch++) {
                if (!data[ch] || data[ch].length === 0) continue;
                
                // If it's a dedicated single-channel file mapped via filename, override target index
                let targetCh = ch;
                if (!hasChannelColumnInFile && ch === 0 && chMatch) {
                    targetCh = explicitCh;
                }
                
                // Ensure array exists
                if (isAcc) {
                    if (!replayData.acc[targetCh]) replayData.acc[targetCh] = [];
                    replayData.acc[targetCh] = data[ch];
                }
                if (isGyro) {
                    if (!replayData.gyro[targetCh]) replayData.gyro[targetCh] = [];
                    replayData.gyro[targetCh] = data[ch];
                }
                
                if (minTime === Number.MAX_SAFE_INTEGER) {
                    const firstRow = data[ch][0];
                    if (firstRow && firstRow.hms) {
                        const chunks = firstRow.hms.split(':');
                        if (chunks.length === 3) {
                            const h = parseInt(chunks[0], 10);
                            const m = parseInt(chunks[1], 10);
                            const sParts = chunks[2].split('.');
                            const s = parseInt(sParts[0], 10);
                            const frac = sParts.length > 1 ? parseFloat('0.' + sParts[1]) : 0;
                            const timeOfDayMs = ((h * 3600) + (m * 60) + s + frac) * 1000;
                            const timezoneOffsetMs = new Date().getTimezoneOffset() * 60000;
                            const offsetMs = timeOfDayMs + timezoneOffsetMs - (firstRow.time / 1000);
                            setFixedBootTimeOffset(offsetMs, timezoneOffsetMs);
                        }
                    }
                }
                
                const firstUs = data[ch][0].time;
                const lastUs = data[ch][data[ch].length - 1].time;
                if (firstUs < minTime) minTime = firstUs;
                if (lastUs > maxTime) maxTime = lastUs;
            }
        }
    }
    
    replayStartTimeUs = minTime === Number.MAX_SAFE_INTEGER ? 0 : minTime;
    replayEndTimeUs = maxTime;
    replayDurationUs = replayEndTimeUs - replayStartTimeUs;
    
    // Live-Simulator Mode applies data over time instead of static injection.
    if (window.resetDashboardBuffers) {
        window.resetDashboardBuffers();
    }
    
    // Evaluate how many channels we need based on the imported replay arrays
    let maxChannels = 0;
    for (let i = 0; i < 4; i++) {
        if (replayData.acc[i] && replayData.acc[i].length > 0) maxChannels = Math.max(maxChannels, i + 1);
        if (replayData.gyro[i] && replayData.gyro[i].length > 0) maxChannels = Math.max(maxChannels, i + 1);
    }
    
    // If the dashboard was not mapped (e.g. offline boot without ESP32 connection),
    // force initialization of the Live Pipeline for the required number of channels.
    if (maxChannels > 0 && typeof window.initializeDashboardNodes === "function") {
        if (!window.activeSensors || window.activeSensors.length < maxChannels) {
            console.log(`[Replay Manager] Bootstrapping Offline Dashboard for ${maxChannels} channels...`);
            const mockNodes = [];
            for (let i = 0; i < maxChannels; i++) {
                mockNodes.push({
                    ip: `Offline-CH${i+1}`,
                    mac: `Offline-MAC-${i+1}`,
                    isMaster: i === 0
                });
            }
            window.initializeDashboardNodes(mockNodes);
        }
    }
    
    const slider = document.getElementById('replayTimeSlider');
    if (slider) {
        slider.max = replayDurationUs;
        slider.value = 0;
    }
    
    const durationDisplay = document.getElementById('replayDurationDisplay');
    if (durationDisplay) {
        durationDisplay.textContent = formatUsToTime(replayDurationUs);
    }
    
    console.log(`Replay Ready: Duration ${replayDurationUs/1000000}s`); // init frame
    
    // Switch to offline replay mode inherently, even when paused!
    window.isOfflineReplayMode = true;
    const controlBar = document.getElementById('replayControlBar');
    if (controlBar) controlBar.style.display = 'flex';
    
    onSliderSeek(0);
    } finally {
        if (overlay) overlay.classList.remove('is-visible');
    }
}

function parseCsv(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const lines = e.target.result.split('\n');
            const data = [];
            
            window.replayRecordingDate = ""; // Reset for new file
            let recordingBaseTimeMs = 0;
            let firstTimeUs = -1;
            
            let hasChannelColumn = false;
            
            for (let i = 0; i < lines.length; i++) {
                if (!lines[i]) continue;
                
                if (lines[i].includes('"# Recording Date:')) {
                    const match = lines[i].match(/\[(.*?)\]/);
                    if (match && match[1]) {
                        window.replayRecordingDate = match[1];
                        // Parse "31.3.2026, 17:34:00" mapping explicitly to de-DE locale standard
                        const dtParts = window.replayRecordingDate.split(', ');
                        if (dtParts.length === 2) {
                            const dParts = dtParts[0].split('.');
                            const tParts = dtParts[1].split(':');
                            if (dParts.length === 3 && tParts.length >= 3) {
                                const d = new Date(
                                    parseInt(dParts[2], 10), 
                                    parseInt(dParts[1], 10) - 1, 
                                    parseInt(dParts[0], 10),
                                    parseInt(tParts[0], 10), 
                                    parseInt(tParts[1], 10), 
                                    parseInt(tParts[2], 10)
                                );
                                recordingBaseTimeMs = d.getTime();
                            }
                        }
                    }
                    continue;
                }
                if (lines[i].startsWith('"#') || lines[i].startsWith('#')) {
                    continue;
                }
                if (lines[i].toLowerCase().includes('time_local_hms') || lines[i].toLowerCase().includes('timestamp_us')) {
                    if (lines[i].toLowerCase().includes('channel_index')) hasChannelColumn = true;
                    continue; // Skip the column headers row
                }
                
                const parts = lines[i].split(',');
                let channel = 0;
                let offset = 0;
                
                if (hasChannelColumn && parts.length >= 6) {
                    channel = parseInt(parts[0], 10) || 0;
                    offset = 1;
                }
                
                if (parts.length >= 5 + offset) { 
                    const timeUs = parseFloat(parts[1 + offset]);
                    if (!isNaN(timeUs)) {
                        if (firstTimeUs === -1) firstTimeUs = timeUs;
                        let hmsStr = parts[0 + offset].replace(/"/g, '');
                        
                        if (recordingBaseTimeMs > 0) {
                            const absDate = new Date(recordingBaseTimeMs + ((timeUs - firstTimeUs) / 1000));
                            const HH = absDate.getHours().toString().padStart(2, '0');
                            const MM = absDate.getMinutes().toString().padStart(2, '0');
                            const SS = absDate.getSeconds().toString().padStart(2, '0');
                            const MS = absDate.getMilliseconds().toString().padStart(3, '0');
                            hmsStr = `${HH}:${MM}:${SS}.${Math.floor(parseInt(MS, 10)/100)}`;
                        }
                        
                        const x = parseFloat(parts[2 + offset]);
                        const y = parseFloat(parts[3 + offset]);
                        const z = parseFloat(parts[4 + offset]);
                        
                        if (!data[channel]) data[channel] = [];
                        data[channel].push({
                            time: timeUs - firstTimeUs,
                            x: x,
                            y: y,
                            z: z,
                            total: Math.hypot(x, y, z),
                            hms: hmsStr
                        });
                    }
                } else if (parts.length === 4 + offset) {
                    const timeSpanStr = parts[0 + offset].replace(/"/g, ''); 
                    const chunks = timeSpanStr.split(':');
                    if (chunks.length === 3) {
                        const h = parseInt(chunks[0], 10);
                        const m = parseInt(chunks[1], 10);
                        const sParts = chunks[2].split('.');
                        const s = parseInt(sParts[0], 10);
                        const frac = sParts.length > 1 ? parseFloat('0.' + sParts[1]) : 0;
                        
                        const timeUs = ((h * 3600) + (m * 60) + s + frac) * 1000000;
                        if (!isNaN(timeUs)) {
                            if (firstTimeUs === -1) firstTimeUs = timeUs;
                            let hmsStr = timeSpanStr;
                            
                            if (recordingBaseTimeMs > 0) {
                                const absDate = new Date(recordingBaseTimeMs + ((timeUs - firstTimeUs) / 1000));
                                const HH = absDate.getHours().toString().padStart(2, '0');
                                const MM = absDate.getMinutes().toString().padStart(2, '0');
                                const SS = absDate.getSeconds().toString().padStart(2, '0');
                                const MS = absDate.getMilliseconds().toString().padStart(3, '0');
                                hmsStr = `${HH}:${MM}:${SS}.${Math.floor(parseInt(MS, 10)/100)}`;
                            }
                            
                            const x = parseFloat(parts[1 + offset]);
                            const y = parseFloat(parts[2 + offset]);
                            const z = parseFloat(parts[3 + offset]);
                            
                            if (!data[channel]) data[channel] = [];
                            data[channel].push({
                                time: timeUs - firstTimeUs,
                                x: x,
                                y: y,
                                z: z,
                                total: Math.hypot(x, y, z),
                                hms: hmsStr
                            });
                        }
                    }
                }
            }
            resolve(data);
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function formatUsToTime(us) {
    const totalMs = Math.floor(us / 1000);
    const ms = totalMs % 1000;
    const totalSecs = Math.floor(totalMs / 1000);
    const s = totalSecs % 60;
    const m = Math.floor(totalSecs / 60);
    
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${Math.floor(ms/100)}`;
}

function togglePlayState() {
    isReplaying = !isReplaying;
    const playBtn = document.getElementById('replayPlayBtn');
    
    if (isReplaying) {
        if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="1.2em" height="1.2em"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> PAUSE';
        lastAnimationTime = performance.now();
        replayLoopId = requestAnimationFrame(playbackLoop);
    } else {
        if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="1.2em" height="1.2em"><path d="M8 5v14l11-7z"/></svg> PLAY';
        cancelAnimationFrame(replayLoopId);
    }
}

function onSliderSeek(usValue) {
    replayTime = usValue;
    const absTime = replayStartTimeUs + replayTime;
    
    // Find nearest index for all channels
    for (let ch = 0; ch < 4; ch++) {
        if (replayData.acc[ch]) {
            currentAccIndex[ch] = replayData.acc[ch].findIndex(s => s.time >= absTime);
            if (currentAccIndex[ch] === -1) currentAccIndex[ch] = replayData.acc[ch].length;
        }
        if (replayData.gyro[ch]) {
            currentGyroIndex[ch] = replayData.gyro[ch].findIndex(s => s.time >= absTime);
            if (currentGyroIndex[ch] === -1) currentGyroIndex[ch] = replayData.gyro[ch].length;
        }
    }
    
    // Update local variables and UI
    const timeDisplay = document.getElementById('replayTimeDisplay');
    if (timeDisplay) timeDisplay.textContent = formatUsToTime(replayTime);
    
    // Clear live data buffers so that charts jump cleanly to the new slice
    if (window.resetDashboardBuffers) {
        window.resetDashboardBuffers();
    }
    
    // Next playback frames will push new batches of data smoothly.
}

function playbackLoop(now) {
    if (!isReplaying) return;
    
    const deltaMs = now - lastAnimationTime;
    lastAnimationTime = now;
    
    // Calculate how many us passed in real time, scaled by playbackSpeed
    const deltaUs = (deltaMs * 1000) * playbackSpeed;
    replayTime += deltaUs;
    
    if (replayTime > replayDurationUs) {
        replayTime = replayDurationUs;
        togglePlayState(); // Auto pause at end
        return;
    }
    
    // Update slider UI (throttled visually by rAF)
    const slider = document.getElementById('replayTimeSlider');
    if (slider) slider.value = replayTime;
    
    const timeDisplay = document.getElementById('replayTimeDisplay');
    if (timeDisplay) timeDisplay.textContent = formatUsToTime(replayTime);
    
    // Feed samples precisely as they would arrive from WebSockets
    const currentAbsTime = replayStartTimeUs + replayTime;
    
    for (let ch = 0; ch < 4; ch++) {
        const batchAcc = [];
        const batchGyro = [];
        
        if (replayData.acc[ch] && replayData.acc[ch].length > 0) {
            while (currentAccIndex[ch] < replayData.acc[ch].length) {
                const sample = replayData.acc[ch][currentAccIndex[ch]];
                if (sample.time <= currentAbsTime) {
                    batchAcc.push(sample);
                    currentAccIndex[ch]++;
                } else {
                    break;
                }
            }
        }
        
        if (replayData.gyro[ch] && replayData.gyro[ch].length > 0) {
            while (currentGyroIndex[ch] < replayData.gyro[ch].length) {
                const sample = replayData.gyro[ch][currentGyroIndex[ch]];
                if (sample.time <= currentAbsTime) {
                    batchGyro.push(sample);
                    currentGyroIndex[ch]++;
                } else {
                    break;
                }
            }
        }
        
        if ((batchAcc.length > 0 || batchGyro.length > 0) && window.processSensorBatch) {
            const nodeDef = window.activeSensors ? window.activeSensors[ch] : null;
            window.processSensorBatch({ 
                acc: batchAcc, 
                accraw: batchAcc, 
                gyro: batchGyro, 
                gyroraw: batchGyro 
            }, ch, nodeDef);
        }
    }
    
    replayLoopId = requestAnimationFrame(playbackLoop);
}

// Auto-init on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReplayManager);
} else {
    initReplayManager();
}
