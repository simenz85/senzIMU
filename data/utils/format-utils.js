let bootTimeOffsetMs = null;
let lastUs = -1;
let localTimezoneOffsetMs = new Date().getTimezoneOffset() * 60000;
let isReplayFixedTime = false;

export function setFixedBootTimeOffset(offsetMs, timezoneOffsetMs = null) {
    bootTimeOffsetMs = offsetMs;
    localTimezoneOffsetMs = timezoneOffsetMs !== null ? timezoneOffsetMs : (new Date().getTimezoneOffset() * 60000);
    isReplayFixedTime = true;
}

export function resetFixedBootTimeOffset() {
    isReplayFixedTime = false;
    bootTimeOffsetMs = null; 
    lastUs = -1;
}

export function toRegularArray(arr) {
    return Array.from(arr);
}

export function formatMicroseconds(v) {
    return formatMicrosecondsToHMS(Number(v), 3);
}

export function formatRuntimeMicroseconds(us, decimalPlaces = 0) {
    if (typeof us !== 'number' || isNaN(us)) return '';
    const totalSeconds = us / 1000000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const hh = hours.toString().padStart(2, '0');
    const mm = minutes.toString().padStart(2, '0');
    
    let ss;
    if (decimalPlaces > 0) {
        ss = seconds.toFixed(decimalPlaces).padStart(3 + decimalPlaces, '0');
    } else {
        ss = Math.floor(seconds).toString().padStart(2, '0');
    }
    return `${hh}:${mm}:${ss}`;
}

export function formatMicrosecondsToHMS(us, decimalPlaces = 0) {
    if (typeof us !== 'number' || isNaN(us)) {
        return '';
    }

    if (!isReplayFixedTime) {
        // Detect ESP32 reboot: time jumped backwards by at least 5s AND is close to 0 (less than 60 seconds).
        if (bootTimeOffsetMs === null || (lastUs !== -1 && us < lastUs - 5000000 && us < 60000000)) {
            bootTimeOffsetMs = Date.now() - (us / 1000);
            localTimezoneOffsetMs = new Date().getTimezoneOffset() * 60000;
            lastUs = us;
        } else if (us > lastUs) {
            // Only update lastUs if time progresses forward (ignores tooltip hover on old chart data)
            lastUs = us;
        }
    }

    const localTimeMs = (us / 1000) + bootTimeOffsetMs;
    // subtract timezoneOffsetMs to get local time relative to midnight
    let timeOfDayMs = (localTimeMs - localTimezoneOffsetMs) % 86400000;
    if (timeOfDayMs < 0) timeOfDayMs += 86400000; // ensure positive

    const totalSeconds = timeOfDayMs / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const hh = hours.toString().padStart(2, '0');
    const mm = minutes.toString().padStart(2, '0');

    let ss;
    if (decimalPlaces > 0) {
        ss = seconds.toFixed(decimalPlaces).padStart(3 + decimalPlaces, '0');
    } else {
        ss = Math.floor(seconds).toString().padStart(2, '0');
    }

    return `${hh}:${mm}:${ss}`;
}

export function formatRecordedValue(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : '';
}

export function createRecordingRow(sample, channelIndex = 0) {
    return [
        channelIndex,
        formatMicrosecondsToHMS(sample.time, 6),
        sample.time,
        formatRecordedValue(sample.x),
        formatRecordedValue(sample.y),
        formatRecordedValue(sample.z),
    ];
}

export function downloadRecordedCsv({
    isIntermediate = false,
    recordedAccRows,
    recordedGyroRows,
    filePartIndex,
    accCsvHeaders,
    gyroCsvHeaders,
    activeQuaternion,
    recordingDateStr,
}) {
    if (!recordedAccRows.length && !recordedGyroRows.length) {
        return { downloaded: false, nextFilePartIndex: filePartIndex };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
    const suffix = isIntermediate ? `_part${String(filePartIndex).padStart(3, '0')}` : '';
    const resolvedQuaternion = Array.isArray(activeQuaternion) && activeQuaternion.length === 4
        ? activeQuaternion
        : [0, 0, 0, 1];
    const quatString = resolvedQuaternion.map(v => Number(v).toFixed(4)).join(', ');
    
    let filesToDownload = [];

    if (recordedAccRows.length > 0) {
        const groupedAcc = [[], [], [], []];
        for (const row of recordedAccRows) {
            const ch = parseInt(row[0], 10) || 0;
            if (ch >= 0 && ch < 4) groupedAcc[ch].push(row.slice(1));
        }
        
        const headerInfoAcc = `"# Gesamtquaternion: [${quatString}]"\n"# Recording Date: [${recordingDateStr}]"\n`;
        const headerAcc = accCsvHeaders.join(',');
        
        for (let ch = 0; ch < 4; ch++) {
            if (groupedAcc[ch].length > 0) {
                const csvAcc = `${headerInfoAcc}${headerAcc}\n${groupedAcc[ch].map((row) => row.join(',')).join('\n')}`;
                filesToDownload.push({ name: `recording_${timestamp}${suffix}_CH${ch + 1}_acc.csv`, content: csvAcc });
            }
        }
    }

    if (recordedGyroRows.length > 0) {
        const groupedGyro = [[], [], [], []];
        for (const row of recordedGyroRows) {
            const ch = parseInt(row[0], 10) || 0;
            if (ch >= 0 && ch < 4) groupedGyro[ch].push(row.slice(1));
        }
        
        const headerInfoGyro = `"# Gesamtquaternion: [${quatString}]"\n"# Recording Date: [${recordingDateStr}]"\n`;
        const headerGyro = gyroCsvHeaders.join(',');
        
        for (let ch = 0; ch < 4; ch++) {
            if (groupedGyro[ch].length > 0) {
                const csvGyro = `${headerInfoGyro}${headerGyro}\n${groupedGyro[ch].map((row) => row.join(',')).join('\n')}`;
                filesToDownload.push({ name: `recording_${timestamp}${suffix}_CH${ch + 1}_gyro.csv`, content: csvGyro });
            }
        }
    }

    if (filesToDownload.length > 0) {
        if (window.JSZip) {
            const zip = new JSZip();
            filesToDownload.forEach(f => zip.file(f.name, f.content));
            zip.generateAsync({ type: "blob" }).then(function(content) {
                const url = URL.createObjectURL(content);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `recording_${timestamp}${suffix}_multichannel.zip`;
                anchor.click();
                URL.revokeObjectURL(url);
            });
        } else {
            filesToDownload.forEach(f => {
                const blob = new Blob([f.content], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = f.name;
                anchor.click();
                URL.revokeObjectURL(url);
            });
        }
    }

    return {
        downloaded: true,
        nextFilePartIndex: isIntermediate ? filePartIndex + 1 : filePartIndex,
    };
}
