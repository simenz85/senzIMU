export function toRegularArray(arr) {
    return Array.from(arr);
}

export function formatMicroseconds(v) {
    const totalSeconds = v / 1e3;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = (totalSeconds % 60).toFixed(3);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.padStart(6, '0')}`;
}

export function formatMicrosecondsToHMS(us, decimalPlaces = 0) {
    if (typeof us !== 'number' || isNaN(us)) {
        return '';
    }

    const totalSeconds = us / 1_000_000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const hh = hours.toString();
    const mm = minutes.toString().padStart(2, '0');

    let ss;
    if (decimalPlaces > 0) {
        ss = seconds.toFixed(decimalPlaces).padStart(3 + decimalPlaces, '0');
    } else {
        ss = Math.round(seconds).toString().padStart(2, '0');
    }

    return `${hh}:${mm}:${ss}`;
}