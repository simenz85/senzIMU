// c:\SENZIMU_github_sicherung\data\ui\replay-manager.js
import { setFixedBootTimeOffset, resetFixedBootTimeOffset } from '../utils/format-utils.js';


window.replayData = {
    acc: [],
    gyro: []
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
        window.isOfflineReplayMode = true;
        // Stop boot overlay
        const overlay = document.getElementById('bootOverlay');
        if (overlay) overlay.style.display = 'none';

        // Disconnect WebSocket if running
        if (window.wsWorker) {
            window.wsWorker.postMessage({ type: 'disconnect' });
        }
        
        // Boot up the animation render loop since WebSocket won't do it!
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
    replayData = { acc: [], gyro: [] };
    replayTime = 0;
    isReplaying = false;
    replayStartTimeUs = 0;
    replayEndTimeUs = 0;
    replayDurationUs = 0;
    currentAccIndex = 0;
    currentGyroIndex = 0;
    
    window.isOfflineReplayMode = false;
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
    resetReplayState();
    
    let minTime = Number.MAX_SAFE_INTEGER;
    let maxTime = 0;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isAcc = file.name.toLowerCase().includes('acc');
        const isGyro = file.name.toLowerCase().includes('gyro');
        
        if (isAcc || isGyro) {
            console.log(`Loading ${file.name}...`);
            const data = await parseCsv(file);
            console.log(`Parsed ${data.length} rows.`);
            
            if (isAcc) window.replayData.acc = replayData.acc = data;
            if (isGyro) window.replayData.gyro = replayData.gyro = data;
            
            if (data.length > 0) {
                if (minTime === Number.MAX_SAFE_INTEGER) {
                    const firstRow = data[0];
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
                
                const firstUs = data[0].time;
                const lastUs = data[data.length - 1].time;
                if (firstUs < minTime) minTime = firstUs;
                if (lastUs > maxTime) maxTime = lastUs;
            }
        }
    }
    
    replayStartTimeUs = minTime === Number.MAX_SAFE_INTEGER ? 0 : minTime;
    replayEndTimeUs = maxTime;
    replayDurationUs = replayEndTimeUs - replayStartTimeUs;
    
    // Inject full recorded session into UI Charts statically
    if (window.applyStaticReplayData) {
        let accExtracted = null;
        let accTotals = null;
        if (replayData.acc.length > 0) {
            const len = replayData.acc.length;
            const t = new Float32Array(len), x = new Float32Array(len), y = new Float32Array(len), z = new Float32Array(len), to = new Float32Array(len);
            for(let i=0; i<len; i++) {
                const d = replayData.acc[i];
                t[i] = d.time; x[i] = d.x; y[i] = d.y; z[i] = d.z; to[i] = d.total;
            }
            accExtracted = [t, x, y, z, to];
            accTotals = to;
        }
        
        let gyroExtracted = null;
        let gyroTotals = null;
        if (replayData.gyro.length > 0) {
            const len = replayData.gyro.length;
            const t = new Float32Array(len), x = new Float32Array(len), y = new Float32Array(len), z = new Float32Array(len), to = new Float32Array(len);
            for(let i=0; i<len; i++) {
                const d = replayData.gyro[i];
                t[i] = d.time; x[i] = d.x; y[i] = d.y; z[i] = d.z; to[i] = d.total; 
            }
            gyroExtracted = [t, x, y, z];
            gyroTotals = to;
        }
        
        window.applyStaticReplayData(accExtracted, gyroExtracted, replayStartTimeUs, replayEndTimeUs);
        
        if (window.generateStaticWaterfalls) {
            // Estimate average sampleRate from timespan
            let sampleRate = 0;
            if (replayData.acc.length > 100) {
                sampleRate = Math.round(replayData.acc.length / (replayDurationUs / 1000000));
            } else if (replayData.gyro.length > 100) {
                sampleRate = Math.round(replayData.gyro.length / (replayDurationUs / 1000000));
            }
            const accTimes = accExtracted ? accExtracted[0] : null;
            const gyroTimes = gyroExtracted ? gyroExtracted[0] : null;
            window.generateStaticWaterfalls(accTotals, gyroTotals, sampleRate, accTimes, gyroTimes);
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
                    continue; // Skip the column headers row
                }
                
                const parts = lines[i].split(',');
                
                if (parts.length >= 5) { 
                    const timeUs = parseFloat(parts[1]);
                    if (!isNaN(timeUs)) {
                        if (firstTimeUs === -1) firstTimeUs = timeUs;
                        let hmsStr = parts[0].replace(/"/g, '');
                        
                        if (recordingBaseTimeMs > 0) {
                            const absDate = new Date(recordingBaseTimeMs + ((timeUs - firstTimeUs) / 1000));
                            const HH = absDate.getHours().toString().padStart(2, '0');
                            const MM = absDate.getMinutes().toString().padStart(2, '0');
                            const SS = absDate.getSeconds().toString().padStart(2, '0');
                            const MS = absDate.getMilliseconds().toString().padStart(3, '0');
                            hmsStr = `${HH}:${MM}:${SS}.${Math.floor(parseInt(MS, 10)/100)}`;
                        }
                        
                        const x = parseFloat(parts[2]);
                        const y = parseFloat(parts[3]);
                        const z = parseFloat(parts[4]);
                        data.push({
                            time: timeUs,
                            x: x,
                            y: y,
                            z: z,
                            total: Math.hypot(x, y, z),
                            hms: hmsStr
                        });
                    }
                } else if (parts.length === 4) {
                    const timeSpanStr = parts[0].replace(/"/g, ''); 
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
                            
                            const x = parseFloat(parts[1]);
                            const y = parseFloat(parts[2]);
                            const z = parseFloat(parts[3]);
                            data.push({
                                time: timeUs,
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
    
    // Find nearest index
    currentAccIndex = replayData.acc.findIndex(s => s.time >= absTime);
    if (currentAccIndex === -1) currentAccIndex = replayData.acc.length;
    
    currentGyroIndex = replayData.gyro.findIndex(s => s.time >= absTime);
    if (currentGyroIndex === -1) currentGyroIndex = replayData.gyro.length;
    
    const timeDisplay = document.getElementById('replayTimeDisplay');
    if (timeDisplay) timeDisplay.textContent = formatUsToTime(replayTime);
    
    // Update global scrubber UI and 3D Vector Viewport
    if (window.updateReplayDashboard) {
        const accSample = replayData.acc[currentAccIndex < replayData.acc.length ? currentAccIndex : replayData.acc.length - 1];
        const gyroSample = replayData.gyro[currentGyroIndex < replayData.gyro.length ? currentGyroIndex : replayData.gyro.length - 1];
        window.updateReplayDashboard(absTime, accSample, gyroSample);
    }
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
    
    // Just scrub to the exact time representation globally
    const currentAbsTime = replayStartTimeUs + replayTime;
    if (window.updateReplayDashboard) {
        // Advance indexes dynamically for playback speed
        while (currentAccIndex < replayData.acc.length && replayData.acc[currentAccIndex].time <= currentAbsTime) {
            currentAccIndex++;
        }
        while (currentGyroIndex < replayData.gyro.length && replayData.gyro[currentGyroIndex].time <= currentAbsTime) {
            currentGyroIndex++;
        }
        
        const accSample = replayData.acc[currentAccIndex < replayData.acc.length ? currentAccIndex : replayData.acc.length - 1];
        const gyroSample = replayData.gyro[currentGyroIndex < replayData.gyro.length ? currentGyroIndex : replayData.gyro.length - 1];
        
        window.updateReplayDashboard(currentAbsTime, accSample, gyroSample);
    }
    
    replayLoopId = requestAnimationFrame(playbackLoop);
}

// Auto-init on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReplayManager);
} else {
    initReplayManager();
}
