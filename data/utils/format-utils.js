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
    const us = Number(v);
    if (!Number.isFinite(us)) return '';

    if (!isReplayFixedTime && (bootTimeOffsetMs === null || (lastUs !== -1 && us < lastUs - 5000000))) {
        bootTimeOffsetMs = Date.now() - (us / 1000);
        localTimezoneOffsetMs = new Date().getTimezoneOffset() * 60000;
    }
    lastUs = us;

    const localTimeMs = (us / 1000) + bootTimeOffsetMs;
    let timeOfDayMs = (localTimeMs - localTimezoneOffsetMs) % 86400000;
    if (timeOfDayMs < 0) timeOfDayMs += 86400000;

    const totalSeconds = timeOfDayMs / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function formatMicrosecondsToHMS(us, decimalPlaces = 0) {
    if (typeof us !== 'number' || isNaN(us)) {
        return '';
    }

    if (!isReplayFixedTime && (bootTimeOffsetMs === null || (lastUs !== -1 && us < lastUs - 5000000))) {
        bootTimeOffsetMs = Date.now() - (us / 1000);
        localTimezoneOffsetMs = new Date().getTimezoneOffset() * 60000;
    }
    lastUs = us;

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