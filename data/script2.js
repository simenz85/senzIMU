import { calibrateWithZPlusXYFixed, calibrateWithZPlusXYSuperSimple, simpleZCalibration, calibrateWithZPlusXYSimple, calibrateWithIdleDataOnly, calibrateWithZPlusXY, calibrateWithZPlusXY2, calibrateTwoAxesFlexible, applyCalibrationToAccel, calibrateWithZPlusXYStrict } from './imuCalibration.js';
import { MultiRingBuffer2, UniDropdown } from './helperclasses.js';
import { AccVectorViewport } from './ui/acc-vector-viewport.js';
import { MotionViewport } from './ui/motion-viewport.js';
import { formatMicrosecondsToHMS, toRegularArray } from './utils/format-utils.js';

const FiliLib = globalThis.Fili;
const liveIirCalculator = FiliLib ? new FiliLib.CalcCascades() : null;
const liveDesignMapBilinear = {
    butterworth: 'butterworth',
    bessel: 'bessel',
};
const liveDesignMapMatchedZ = {
    bessel: 'bessel',
    butterworth: 'butterworth',
    allpass: 'allpass',
    tschebyscheff05: 'tschebyscheff05',
    tschebyscheff1: 'tschebyscheff1',
    tschebyscheff2: 'tschebyscheff2',
    tschebyscheff3: 'tschebyscheff3',
};


let tempgravity = 0;
let quater = null;
let calibrating1 = false;
let calibrating2 = false;
let calibrationMemory = [null, null];
let calibrationFlow = 'worldSimple';
const CALIBRATION_CAPTURE_STEP_MS = 30;
const CALIBRATION_CAPTURE_STEPS = 100;
const REFERENCE_CAPTURE_MIN_SAMPLES = 8;
const CALIBRATION_COOKIE_NAME = 'imuCalibrationState';
const CALIBRATION_COOKIE_VERSION = 1;
const CALIBRATION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CALIBRATION_STORAGE_KEY = 'imuCalibrationState.local';
const APP_SETTINGS_COOKIE_NAME = 'imuAppSettings';
const APP_SETTINGS_COOKIE_VERSION = 1;
const APP_SETTINGS_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const APP_SETTINGS_STORAGE_KEY = 'imuAppSettings.local';
const LEGACY_WS_HOST_STORAGE_KEY = 'wsHost';
let referenceCaptureActive = false;
let worldSimpleGyroCaptureActive = false;
let currentOrientationMode = 0;
let currentOrientationLabel = null;
let gravityCutEnabled = false;
let persistedCustomWsHost = null;
let currentReferenceState = null;
let currentWorldSimpleGyroState = null;
let currentAccelCalibrationScale = 1;
let appSettingsBindingsInitialized = false;
let chart = null;
let gyroChart = null;

let ausrichtung = [0,0,0,0];

// RINGPUFFER INITIALISIEREN

const ACC_BUFFER_SIZE = 300000;
const GYRO_BUFFER_SIZE = 300000;
const RMS_BUFFER_SIZE = 20000;
const TEMP_BUFFER_SIZE = 20000;
const FILTERED_ACC_BUFFER_SIZE = 120000;
const CALIB_BUFFER_SIZE = 100000;

const accBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array, Float32Array],
    ACC_BUFFER_SIZE,
    ['time', 'x', 'y', 'z', 'total']
);

const accRawBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array, Float32Array],
    ACC_BUFFER_SIZE,
    ['time', 'x', 'y', 'z', 'total']
);

const gyroRawBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array],
    GYRO_BUFFER_SIZE,
    ['time', 'x', 'y', 'z']
);

const accBufferCALIB = new MultiRingBuffer2(
    [Float32Array, Float32Array, Float32Array],
    CALIB_BUFFER_SIZE,
    ['x', 'y', 'z']
);

const gyroBufferCALIB = new MultiRingBuffer2(
    [Float32Array, Float32Array, Float32Array],
    CALIB_BUFFER_SIZE,
    ['x', 'y', 'z']
);

const rmsBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array, Float32Array],
    RMS_BUFFER_SIZE,
    ['time', 'x', 'y', 'z', 'total']
);

const gyroRmsBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array, Float32Array],
    RMS_BUFFER_SIZE,
    ['time', 'x', 'y', 'z', 'total']
);

const accBufferFiltered = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array, Float32Array],
    FILTERED_ACC_BUFFER_SIZE,
    ['time', 'x', 'y', 'z', 'total']
);

const gyroBufferFiltered = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array],
    FILTERED_ACC_BUFFER_SIZE,
    ['time', 'x', 'y', 'z']
);

const gyroBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array, Float32Array, Float32Array],
    GYRO_BUFFER_SIZE,
    ['time', 'x', 'y', 'z']
);

const tempBuffer = new MultiRingBuffer2(
    [Float64Array, Float32Array],
    TEMP_BUFFER_SIZE,
    ['time', 'temperature']
);



let dark = true;
let currentSampleRate = 0;

window.resetDashboardBuffers = function() {
    accBuffer.clear();
    accRawBuffer.clear();
    gyroRawBuffer.clear();
    accBufferCALIB.clear();
    gyroBufferCALIB.clear();
    rmsBuffer.clear();
    gyroRmsBuffer.clear();
    accBufferFiltered.clear();
    gyroBufferFiltered.clear();
    gyroBuffer.clear();

    if (window.chartData) {
        for(let i=0; i<4; i++) {
            if (window.chartData[i]) window.chartData[i].length = 0;
            if (window.gyroChartData && window.gyroChartData[i]) window.gyroChartData[i].length = 0;
        }
    }

    if (window.waterfallRenderer) window.waterfallRenderer.clear();
    if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.clear();

    window.samplecount = 0;
};

let initialisiert = false;
let displayDurationSeconds = 5;


let filePartIndex = 0;
const MAX_RECORDED_ROWS = 500000;
const ACC_CSV_HEADERS = [
    "time_local_hms",
    "timestamp_us",
    "acc_x_mg",
    "acc_y_mg",
    "acc_z_mg",
];
const GYRO_CSV_HEADERS = [
    "time_local_hms",
    "timestamp_us",
    "gyro_x_m°/s",
    "gyro_y_m°/s",
    "gyro_z_m°/s",
];

let fftDBoutput = false;
let filterSyncEnabled = false;
let filterPanelSyncInProgress = false;
let accFilterUi = null;
let gyroFilterUi = null;
let accFilterEnabled = false;
let gyroFilterEnabled = false;
let accFilterRequestInFlight = false;
let gyroFilterRequestInFlight = false;
let accLastFilterDispatchAt = 0;
let gyroLastFilterDispatchAt = 0;
let lastFilterSampleRateUpdateAt = 0;
let accChartVisible = true;
let gyroChartVisible = true;
let gyroChartPaused = false;
const FILTER_REQUEST_INTERVAL_MS = 120;
const FILTER_SAMPLE_RATE_UPDATE_INTERVAL_MS = 1500;
const FILTER_SAMPLE_RATE_MIN_ABSOLUTE_DELTA = 5;
const FILTER_SAMPLE_RATE_MIN_RELATIVE_DELTA = 0.03;
const FILTER_SAMPLE_RATE_ESTIMATE_SAMPLES = 12;
const FILTER_SAMPLE_RATE_EMA_ALPHA = 0.2;
const FILTER_WARMUP_MIN_SECONDS = 2.0;
const FILTER_WARMUP_MAX_SECONDS = 30;
const FILTER_WARMUP_BASE_CYCLES = 24;
const FILTER_WARMUP_MIN_SAMPLES = 512;
const FILTER_WARMUP_ORDER_SECONDS = 0.18;
const FILTER_ZERO_PHASE_PAD_MIN_SAMPLES = 96;
const FILTER_ZERO_PHASE_PAD_MAX_SAMPLES = 1024;
const lastAppliedFilterSettings = { acc: null, gyro: null };
const ENABLE_MOTION_VIEW = true;
const ENABLE_FUSION_PIPELINE = false;

function createNoopWorker() {
    return {
        onmessage: null,
        postMessage() {},
        terminate() {},
    };
}

function createNoopMotionViewport() {
    return {
        options: {},
        setDisplayScale() {},
        setState() {},
        setStatus() {},
        setVisible() {},
        getDisplaySettings() {
            return null;
        },
        applyDisplaySettings() {},
    };
}

const accVectorViewport = new AccVectorViewport();
const motionViewport = ENABLE_MOTION_VIEW ? new MotionViewport() : createNoopMotionViewport();
const motionWorker = ENABLE_MOTION_VIEW ? new Worker('motion-worker.js') : createNoopWorker();
const motionModeMotionBtn = document.getElementById('motionModeMotionBtn');
const motionModeVibrationBtn = document.getElementById('motionModeVibrationBtn');
const motionResetBtn = document.getElementById('motionResetBtn');
const motionTrailSecondsSlider = document.getElementById('motionTrailSeconds');
const motionTrailSecondsInput = document.getElementById('motionTrailSecondsInput');
const motionTrailSecondsValue = document.getElementById('motionTrailSecondsValue');
const motionDisplayScaleSlider = document.getElementById('motionDisplayScale');
const motionDisplayScaleInput = document.getElementById('motionDisplayScaleInput');
const motionDisplayScaleValue = document.getElementById('motionDisplayScaleValue');
const motionDeadbandSlider = document.getElementById('motionDeadband');
const motionDeadbandInput = document.getElementById('motionDeadbandInput');
const motionDeadbandValue = document.getElementById('motionDeadbandValue');
const motionStationarySlider = document.getElementById('motionStationary');
const motionStationaryInput = document.getElementById('motionStationaryInput');
const motionStationaryValue = document.getElementById('motionStationaryValue');
const motionVibrationLeakSlider = document.getElementById('motionVibrationLeak');
const motionVibrationLeakInput = document.getElementById('motionVibrationLeakInput');
const motionVibrationLeakValue = document.getElementById('motionVibrationLeakValue');
const motionModeReadout = document.getElementById('motionModeReadout');
const motionOrientationReadout = document.getElementById('motionOrientationReadout');
const motionTrailCountReadout = document.getElementById('motionTrailCountReadout');
const motionTrailWindowReadout = document.getElementById('motionTrailWindowReadout');
const motionAccX = document.getElementById('motionAccX');
const motionAccY = document.getElementById('motionAccY');
const motionAccZ = document.getElementById('motionAccZ');
const motionAccMagnitude = document.getElementById('motionAccMagnitude');
const motionVelocityX = document.getElementById('motionVelocityX');
const motionVelocityY = document.getElementById('motionVelocityY');
const motionVelocityZ = document.getElementById('motionVelocityZ');
const motionVelocityMagnitude = document.getElementById('motionVelocityMagnitude');
const motionPositionX = document.getElementById('motionPositionX');
const motionPositionY = document.getElementById('motionPositionY');
const motionPositionZ = document.getElementById('motionPositionZ');
const motionPositionMagnitude = document.getElementById('motionPositionMagnitude');
const motionUiState = {
    mode: 'vibration',
    trailSeconds: 5,
    displayScale: 3,
    deadbandMg: 10,
    stationaryAccelThresholdMs2: 0.12,
    stationaryGyroThresholdMdps: 8000,
    motionVelocityLeak: 0.99998,
    vibrationVelocityLeak: 0.94,
    vibrationPositionLeak: 0.985,
    vibrationHighPassAlpha: 0.92,
};

function setMotionSliderState(slider, input, label, value, suffix = '') {
    const normalized = Number(value);
    if (slider) {
        slider.value = String(normalized);
    }
    if (input) {
        input.value = String(normalized);
    }
    if (label) {
        label.textContent = `${normalized}${suffix}`;
    }
}

function updateMotionControlLabels() {
    setMotionSliderState(motionTrailSecondsSlider, motionTrailSecondsInput, motionTrailSecondsValue, motionUiState.trailSeconds, ' s');
    setMotionSliderState(motionDisplayScaleSlider, motionDisplayScaleInput, motionDisplayScaleValue, motionUiState.displayScale, 'x');
    setMotionSliderState(motionDeadbandSlider, motionDeadbandInput, motionDeadbandValue, motionUiState.deadbandMg, ' mg');

    const stationaryBasisPoints = Math.round(motionUiState.stationaryAccelThresholdMs2 * 100);
    if (motionStationarySlider) {
        motionStationarySlider.value = String(stationaryBasisPoints);
    }
    if (motionStationaryInput) {
        motionStationaryInput.value = String(stationaryBasisPoints);
    }
    if (motionStationaryValue) {
        motionStationaryValue.textContent = motionUiState.stationaryAccelThresholdMs2.toFixed(2);
    }

    const leakPercent = Math.round(motionUiState.vibrationVelocityLeak * 100);
    if (motionVibrationLeakSlider) {
        motionVibrationLeakSlider.value = String(leakPercent);
    }
    if (motionVibrationLeakInput) {
        motionVibrationLeakInput.value = String(leakPercent);
    }
    if (motionVibrationLeakValue) {
        motionVibrationLeakValue.textContent = `${leakPercent}%`;
    }

    if (motionTrailWindowReadout) {
        motionTrailWindowReadout.textContent = `${motionUiState.trailSeconds.toFixed(1)} s`;
    }
}

function updateMotionModeButtons() {
    motionModeMotionBtn?.classList.toggle('active', motionUiState.mode === 'motion');
    motionModeVibrationBtn?.classList.toggle('active', motionUiState.mode === 'vibration');
    if (motionModeReadout) {
        motionModeReadout.textContent = motionUiState.mode === 'vibration' ? 'Vibration' : 'Bewegung';
    }
}

function updateMotionReadouts(payload = {}) {
    const acc = payload.linearAcc || {};
    const velocity = payload.velocity || {};
    const position = payload.position || {};
    const accNorm = Math.hypot(Number(acc.x || 0), Number(acc.y || 0), Number(acc.z || 0));
    const velocityNorm = Math.hypot(Number(velocity.x || 0), Number(velocity.y || 0), Number(velocity.z || 0));
    const positionNorm = Math.hypot(Number(position.x || 0), Number(position.y || 0), Number(position.z || 0));
    if (motionAccX) motionAccX.textContent = Number(acc.x || 0).toFixed(3);
    if (motionAccY) motionAccY.textContent = Number(acc.y || 0).toFixed(3);
    if (motionAccZ) motionAccZ.textContent = Number(acc.z || 0).toFixed(3);
    if (motionAccMagnitude) motionAccMagnitude.textContent = accNorm.toFixed(3);
    if (motionVelocityX) motionVelocityX.textContent = Number(velocity.x || 0).toFixed(3);
    if (motionVelocityY) motionVelocityY.textContent = Number(velocity.y || 0).toFixed(3);
    if (motionVelocityZ) motionVelocityZ.textContent = Number(velocity.z || 0).toFixed(3);
    if (motionVelocityMagnitude) motionVelocityMagnitude.textContent = velocityNorm.toFixed(3);
    if (motionPositionX) motionPositionX.textContent = Number(position.x || 0).toFixed(3);
    if (motionPositionY) motionPositionY.textContent = Number(position.y || 0).toFixed(3);
    if (motionPositionZ) motionPositionZ.textContent = Number(position.z || 0).toFixed(3);
    if (motionPositionMagnitude) motionPositionMagnitude.textContent = positionNorm.toFixed(3);
    if (motionOrientationReadout) motionOrientationReadout.textContent = payload.orientationActive ? 'aktiv' : 'inaktiv';
    if (motionTrailCountReadout) {
        const trailCount = Number.isFinite(Number(payload.trailCount))
            ? Number(payload.trailCount)
            : (Array.isArray(payload.trail) ? payload.trail.length : 0);
        motionTrailCountReadout.textContent = String(trailCount);
    }
}

function syncMotionWorkerConfig({ reset = false } = {}) {
    motionWorker.postMessage({
        type: 'config',
        payload: {
            ...motionUiState,
            reset,
        },
    });
    motionViewport.setDisplayScale(motionUiState.displayScale);
    updateMotionControlLabels();
    updateMotionModeButtons();
}

accVectorViewport.options.onDisplaySettingsChange = () => {
    persistCalibrationCookie();
};
motionViewport.options.onDisplaySettingsChange = () => {
    persistCalibrationCookie();
};
accVectorViewport.options.onQuaternionChange = (payload) => {
    syncViewportPostTransformQuaternion({
        persistState: true,
        resetLiveBuffers: Boolean(payload?.commit),
    });
    syncMotionWorkerTransform({ reset: Boolean(payload?.commit) });
};
const alignLoadQuatBtn = document.getElementById('alignLoadQuatBtn');
const alignApplyQuatBtn = document.getElementById('alignApplyQuatBtn');

motionWorker.onmessage = (event) => {
    if (event.data?.type !== 'state') {
        return;
    }

    motionViewport.setState(event.data);
    updateMotionReadouts(event.data);
    motionViewport.setStatus(
        event.data.orientationActive
            ? (motionUiState.mode === 'vibration' ? 'Vibrationsspur aktiv' : 'Bewegungsspur aktiv')
            : 'Orientation erforderlich für Weltintegration'
    );
};

window.addEventListener('dashboardTabChanged', (event) => {
    console.log('[ACC-3D] dashboardTabChanged', event.detail);
    accVectorViewport.setVisible(event.detail?.sectionId === 'vectorAlignArea');
    motionViewport.setVisible(event.detail?.sectionId === 'motionViewportArea');
});

console.log('[ACC-3D] initial visibility', {
    vectorAlignAreaDisplay: document.getElementById('vectorAlignArea')?.style.display,
    motionViewportAreaDisplay: document.getElementById('motionViewportArea')?.style.display,
});
accVectorViewport.setVisible(document.getElementById('vectorAlignArea')?.style.display !== 'none');
motionViewport.setVisible(document.getElementById('motionViewportArea')?.style.display !== 'none');
updateMotionControlLabels();
updateMotionModeButtons();
motionViewport.setDisplayScale(motionUiState.displayScale);

motionModeMotionBtn?.addEventListener('click', () => {
    motionUiState.mode = 'motion';
    syncMotionWorkerConfig({ reset: true });
});

motionModeVibrationBtn?.addEventListener('click', () => {
    motionUiState.mode = 'vibration';
    syncMotionWorkerConfig({ reset: true });
});

motionResetBtn?.addEventListener('click', () => {
    motionWorker.postMessage({ type: 'reset' });
    motionViewport.setStatus('Spur zurückgesetzt');
});

const bindMotionNumericControl = (slider, input, onCommit) => {
    slider?.addEventListener('input', () => onCommit(slider.value, false));
    slider?.addEventListener('change', () => onCommit(slider.value, true));
    input?.addEventListener('input', () => onCommit(input.value, false));
    input?.addEventListener('change', () => onCommit(input.value, true));
    input?.addEventListener('blur', () => onCommit(input.value, true));
};

bindMotionNumericControl(motionTrailSecondsSlider, motionTrailSecondsInput, (value, commit) => {
    const nextValue = Math.max(1, Math.min(20, Math.round(Number(value) || motionUiState.trailSeconds)));
    motionUiState.trailSeconds = nextValue;
    updateMotionControlLabels();
    if (commit) {
        syncMotionWorkerConfig({ reset: false });
    }
});

bindMotionNumericControl(motionDisplayScaleSlider, motionDisplayScaleInput, (value) => {
    const nextValue = Math.max(1, Math.min(40, Math.round(Number(value) || motionUiState.displayScale)));
    motionUiState.displayScale = nextValue;
    updateMotionControlLabels();
    motionViewport.setDisplayScale(nextValue);
});

bindMotionNumericControl(motionDeadbandSlider, motionDeadbandInput, (value, commit) => {
    const nextValue = Math.max(0, Math.min(120, Math.round(Number(value) || motionUiState.deadbandMg)));
    motionUiState.deadbandMg = nextValue;
    updateMotionControlLabels();
    if (commit) {
        syncMotionWorkerConfig({ reset: true });
    }
});

bindMotionNumericControl(motionStationarySlider, motionStationaryInput, (value, commit) => {
    const nextValue = Math.max(5, Math.min(150, Math.round(Number(value) || 22)));
    motionUiState.stationaryAccelThresholdMs2 = nextValue / 100;
    updateMotionControlLabels();
    if (commit) {
        syncMotionWorkerConfig({ reset: false });
    }
});

bindMotionNumericControl(motionVibrationLeakSlider, motionVibrationLeakInput, (value, commit) => {
    const nextValue = Math.max(70, Math.min(99, Math.round(Number(value) || 94)));
    motionUiState.vibrationVelocityLeak = nextValue / 100;
    updateMotionControlLabels();
    if (commit) {
        syncMotionWorkerConfig({ reset: true });
    }
});

if (ENABLE_MOTION_VIEW) {
    syncMotionWorkerConfig({ reset: true });
}

// Regelmäßiges Update, Standard: 20 fps
let FFT_UPDATE_INTERVAL = 1000 / 20;
let RMS_UPDATE_INTERVAL = 50;
let FFT_WINDOW_SIZE = 2048; // Größte Zweierpotenz, ggf. auch 2048
let fftUpdateTimerId = null;
let rmsUpdateTimerId = null;
const fftMaxBuffer = [];

// FFT AVERAGE PUFFER
let N_AVG = 10;            // Anfangswert kann beliebig gewählt sein
let avgFFTBuffer = [];
let fftWorker = null;
let rmsWorker = null;
let RMS_WINDOW_SIZE = 100;

let GYRO_FFT_UPDATE_INTERVAL = 1000 / 20;
let GYRO_FFT_WINDOW_SIZE = 2048;
let gyroFftUpdateTimerId = null;
let gyroRmsUpdateTimerId = null;
const gyroFftMaxBuffer = [];
let gyroN_AVG = 10;
let gyroAvgFFTBuffer = [];
let gyroFftWorker = null;
let gyroRmsWorker = null;
const GYRO_FFT_RING_SIZE = 2 * 1000 / GYRO_FFT_UPDATE_INTERVAL;
let GYRO_FFT_WINDOW_TYPE = "BLACKMAN";
let GYRO_DC_CUTOFF = true;
let GYRO_FFT_AXIS_MODE = "COMBI";
let gyroFftHighPass = 0;
let gyroDisplayDurationSecondsRMS = 20;
let gyroRmsPaused = false;

const FFT_RING_SIZE = 2 * 1000 / FFT_UPDATE_INTERVAL; // z.B. 50
const dropdown1 = new UniDropdown(document.getElementById('dropdown1'), {
    type: 'select',
    label: 'Size',
    items: [
        { value: 256, label: 256 },
        { value: 512, label: 512 },
        { value: 1024, label: 1024 },
        { value: 2048, label: 2048 },
        { value: 4096, label: 4096 }
    ],
    defaultValue: FFT_WINDOW_SIZE,
    onChange: (value, label) => {
        FFT_WINDOW_SIZE = value;
        console.log('Ausgewählt:', value, label);
    }
});
dropdown1.button.title = "Wähle die Fenstergröße für FFT";

const dropdown2 = new UniDropdown(document.getElementById('dropdown2'), {
    type: 'select',
    label: 'Rate',
    items: [
        { value: 1000 / 60, label: "60 fps" },
        { value: 1000 / 30, label: "30 fps" },
        { value: 1000 / 20, label: "20 fps" },
        { value: 1000 / 10, label: "10fps" },
        { value: 1000 / 5, label: "5 fps" },
        { value: 1000 / 1, label: "1 fps" }
    ],
    defaultValue: FFT_UPDATE_INTERVAL,
    onChange: (value, label) => {
        FFT_UPDATE_INTERVAL = value;
        // Starte das Update mit dem neuen Intervall neu
        startFFTUpdates();

        console.log('Ausgewählt:', value, label);
    }
});
dropdown2.button.title = "Wähle die Samplerate für FFT";

const dropdown3 = new UniDropdown(document.getElementById('dropdown3'), {
    type: 'select',
    label: 'Avg',
    items: [
        { value: 5, label: "5" },
        { value: 10, label: "10" },
        { value: 15, label: "15" },
        { value: 20, label: "20" },
        { value: 25, label: "25" },
        { value: 50, label: "50" },
        { value: 100, label: "100" },
        { value: 150, label: "150" },
        { value: 300, label: "300" }
    ],
    defaultValue: N_AVG,
    onChange: (value, label) => {
        N_AVG = value;
        setAverageCount(value);
        // Starte das Update mit dem neuen Intervall neu
        //startFFTUpdates();

        console.log('Ausgewählt:', value, label);
    }
});
dropdown3.button.title = "Wähle die Anzahl der Samples für den FFT Mittelwert";


let FFT_WINDOW_TYPE = "BLACKMAN";
const dropdown4 = new UniDropdown(document.getElementById('dropdown4'), {
    type: 'select',
    label: 'Window',
    items: [
        { value: "BLACKMAN", label: "BLACKMAN" },
        { value: "HANNING", label: "HANNING" },
        { value: "HAMMING", label: "HAMMING" },
        { value: "RECTANGULAR", label: "RECTANGULAR" },
    ],
    defaultValue: FFT_WINDOW_TYPE,
    onChange: (value, label) => {
        FFT_WINDOW_TYPE = value;
        console.log('Ausgewählt:', value, label);
    }
});
dropdown4.button.title = "Wähle den Fenstertyp für FFT";

let DC_CUTOFF = true;
const dropdown5 = new UniDropdown(document.getElementById('dropdown5'), {
    type: 'select',
    label: 'DC',
    items: [
        { value: true, label: "YES" },
        { value: false, label: "NO" },

    ],
    defaultValue: true,
    onChange: (value, label) => {
        DC_CUTOFF = (value === "true");
        console.log('Ausgewählt:', DC_CUTOFF, label);
    }
});
dropdown5.button.title = "Wähle den DC Cutoff für FFT";


let FFT_AXIS_MODE = "COMBI";
const dropdown6 = new UniDropdown(document.getElementById('dropdown6'), {
    type: 'select',
    label: 'Axis',
    items: [
        { value: "COMBI", label: "KOMBINIERT" },
        { value: "ONLYX", label: "X" },
        { value: "ONLYY", label: "Y" },
        { value: "ONLYZ", label: "Z" },
    ],
    defaultValue: FFT_AXIS_MODE,
    onChange: (value, label) => {
        FFT_AXIS_MODE = value;
        console.log('Ausgewählt:', value, label);
    }
});
dropdown6.button.title = "Wähle die Achse für FFT";

let fftHighPass = 0;

const gyroDropdown1 = new UniDropdown(document.getElementById('gyroDropdown1'), {
    type: 'select',
    label: 'Size',
    items: [
        { value: 256, label: 256 },
        { value: 512, label: 512 },
        { value: 1024, label: 1024 },
        { value: 2048, label: 2048 },
        { value: 4096, label: 4096 }
    ],
    defaultValue: GYRO_FFT_WINDOW_SIZE,
    onChange: (value, label) => {
        GYRO_FFT_WINDOW_SIZE = value;
        console.log('Gyro FFT Blocksize:', value, label);
    }
});
gyroDropdown1.button.title = 'Wähle die Fenstergröße für Gyro FFT';

const gyroDropdown2 = new UniDropdown(document.getElementById('gyroDropdown2'), {
    type: 'select',
    label: 'Rate',
    items: [
        { value: 1000 / 60, label: '60 fps' },
        { value: 1000 / 30, label: '30 fps' },
        { value: 1000 / 20, label: '20 fps' },
        { value: 1000 / 10, label: '10 fps' },
        { value: 1000 / 5, label: '5 fps' },
        { value: 1000 / 1, label: '1 fps' }
    ],
    defaultValue: GYRO_FFT_UPDATE_INTERVAL,
    onChange: (value, label) => {
        GYRO_FFT_UPDATE_INTERVAL = value;
        startGyroFFTUpdates();
        console.log('Gyro FFT Samplerate:', value, label);
    }
});
gyroDropdown2.button.title = 'Wähle die Aktualisierungsrate für Gyro FFT';

const gyroDropdown3 = new UniDropdown(document.getElementById('gyroDropdown3'), {
    type: 'select',
    label: 'Avg',
    items: [
        { value: 5, label: '5' },
        { value: 10, label: '10' },
        { value: 15, label: '15' },
        { value: 20, label: '20' },
        { value: 25, label: '25' },
        { value: 50, label: '50' },
        { value: 100, label: '100' },
        { value: 150, label: '150' },
        { value: 300, label: '300' }
    ],
    defaultValue: gyroN_AVG,
    onChange: (value, label) => {
        gyroN_AVG = value;
        setAverageCount(value, gyroAvgFFTBuffer);
        console.log('Gyro FFT Mittelung:', value, label);
    }
});
gyroDropdown3.button.title = 'Wähle die Anzahl der Samples für den Gyro FFT Mittelwert';

const gyroDropdown4 = new UniDropdown(document.getElementById('gyroDropdown4'), {
    type: 'select',
    label: 'Window',
    items: [
        { value: 'BLACKMAN', label: 'BLACKMAN' },
        { value: 'HANNING', label: 'HANNING' },
        { value: 'HAMMING', label: 'HAMMING' },
        { value: 'RECTANGULAR', label: 'RECTANGULAR' },
    ],
    defaultValue: GYRO_FFT_WINDOW_TYPE,
    onChange: (value, label) => {
        GYRO_FFT_WINDOW_TYPE = value;
        console.log('Gyro FFT Fenstertyp:', value, label);
    }
});
gyroDropdown4.button.title = 'Wähle den Fenstertyp für Gyro FFT';

const gyroDropdown5 = new UniDropdown(document.getElementById('gyroDropdown5'), {
    type: 'select',
    label: 'DC',
    items: [
        { value: true, label: 'YES' },
        { value: false, label: 'NO' },
    ],
    defaultValue: true,
    onChange: (value, label) => {
        GYRO_DC_CUTOFF = (value === 'true');
        console.log('Gyro FFT DC Cutoff:', GYRO_DC_CUTOFF, label);
    }
});
gyroDropdown5.button.title = 'Wähle den DC Cutoff für Gyro FFT';

const gyroDropdown6 = new UniDropdown(document.getElementById('gyroDropdown6'), {
    type: 'select',
    label: 'Axis',
    items: [
        { value: 'COMBI', label: 'KOMBINIERT' },
        { value: 'ONLYX', label: 'X' },
        { value: 'ONLYY', label: 'Y' },
        { value: 'ONLYZ', label: 'Z' },
    ],
    defaultValue: GYRO_FFT_AXIS_MODE,
    onChange: (value, label) => {
        GYRO_FFT_AXIS_MODE = value;
        console.log('Gyro FFT Achse:', value, label);
    }
});
gyroDropdown6.button.title = 'Wähle die Achse für Gyro FFT';


// Welche Filtertypen gibt es mit welchen Designs & Transforms?
const filterTypeMap = {
    lowpass: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear', 'matchedz'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear', 'matchedz'] },
        { value: 'allpass', label: 'Allpass', transforms: ['matchedz'] },
        { value: 'tschebyscheff05', label: 'Chebyshev 0.5dB', transforms: ['matchedz'] },
        { value: 'tschebyscheff1', label: 'Chebyshev 1dB', transforms: ['matchedz'] },
        { value: 'tschebyscheff2', label: 'Chebyshev 2dB', transforms: ['matchedz'] },
        { value: 'tschebyscheff3', label: 'Chebyshev 3dB', transforms: ['matchedz'] }
    ],
    highpass: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear'] }
    ],
    bandpass: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear'] }
    ],
    bandstop: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear'] }
    ],
    peak: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear'] }
    ],
    lowshelf: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear'] }
    ],
    highshelf: [
        { value: 'butterworth', label: 'Butterworth', transforms: ['bilinear'] },
        { value: 'bessel', label: 'Bessel', transforms: ['bilinear'] }
    ]
    // usw. ggf. nach Fili.js-API ergänzen
};
const filterParamVisibility = {
    // Syntax: filterType: { designValue: [paramNames...] }
    peak: {
        butterworth: ['gain'],
        bessel: ['gain']
    },
    lowshelf: {
        butterworth: ['gain'],
        bessel: ['gain']
    },
    highshelf: {
        butterworth: ['gain'],
        bessel: ['gain']
    },
    bandpass: {
        butterworth: ['bandwidth'],
        bessel: ['bandwidth']
    },
    bandstop: {
        butterworth: ['bandwidth'],
        bessel: ['bandwidth']
    },
    lowpass: {
        tschebyscheff1: ['ripple'],
        tschebyscheff2: ['ripple'],
        tschebyscheff05: ['ripple'],
        tschebyscheff3: ['ripple'],
        elliptic: ['ripple', 'attenuation']
    }
    // ggf. weitere Filter/Design-Kombis
};





//const filterController = setupFilterWorker();
function setupFilterWorker() {
    const chartVisibilityCheckboxes = {
        acc: document.getElementById('showAccChartToggle'),
        gyro: document.getElementById('showGyroChartToggle')
    };
    const syncToggle = document.getElementById('syncFilterToggle');

    function setChartVisibility(key, visible) {
        if (key === 'acc') {
            accChartVisible = visible;
            document.getElementById('livechart2').style.display = visible ? '' : 'none';
        } else {
            gyroChartVisible = visible;
            document.getElementById('gyrochart').style.display = visible ? '' : 'none';
        }

        requestAnimationFrame(() => {
            updateLiveChartPanelHeights();
            chart?.setSize(getSize());
            gyroChart?.setSize(getGyroChartSize());
        });
    }

    function applyFilterPanelEnabledState(panel, enabled) {
        panel.root.style.opacity = enabled ? '1' : '0.55';
        panel.root.style.pointerEvents = enabled ? '' : 'none';
    }

    function buildTransformOptions(transforms) {
        return transforms.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
    }

    function createFilterPanel(key, prefix, worker) {
        const panel = {
            key,
            root: document.getElementById(`${prefix}FilterPanel`),
            worker,
            oneDbCheckboxContainer: document.getElementById(`${prefix}OneDbCheckboxContainer`),
            preGainCheckbox: document.getElementById(`${prefix}PreGainCheckbox`),
            oneDbCheckbox: document.getElementById(`${prefix}OneDbCheckbox`),
        };

        const onPanelChanged = () => {
            panel.sendSettings(false);
            if (filterSyncEnabled && !filterPanelSyncInProgress) {
                syncFilterPanel(key === 'acc' ? 'gyro' : 'acc', panel);
            }
        };

        panel.typeDropdown = new UniDropdown(document.getElementById(`${prefix}TypeDropdown`), {
            type: 'select',
            label: 'Filter',
            items: [
                { value: 'none', label: 'Kein Filter' },
                { value: 'lowpass', label: 'Lowpass' },
                { value: 'highpass', label: 'Highpass' },
                { value: 'bandpass', label: 'Bandpass' },
                { value: 'bandstop', label: 'Bandstop' },
                { value: 'peak', label: 'Peak' },
                { value: 'lowshelf', label: 'Lowshelf' },
                { value: 'highshelf', label: 'Highshelf' }
            ],
            defaultValue: 'none',
            onChange: value => panel.onTypeChange(value)
        });

        panel.designDropdown = new UniDropdown(document.getElementById(`${prefix}DesignDropdown`), {
            type: 'select',
            label: 'DS',
            items: [{ value: 'butterworth', label: 'Butterworth' }],
            defaultValue: 'butterworth',
            onChange: value => panel.onDesignChange(panel.typeDropdown.getValue()?.value || 'none', value)
        });

        panel.transformDropdown = new UniDropdown(document.getElementById(`${prefix}TransformDropdown`), {
            type: 'select',
            label: 'Transform',
            items: buildTransformOptions(['bilinear', 'matchedz']),
            defaultValue: 'bilinear',
            onChange: () => {
                panel.updateDesignOptions(panel.transformDropdown.getValue()?.value || 'bilinear');
                onPanelChanged();
            }
        });

        panel.orderDropdown = new UniDropdown(document.getElementById(`${prefix}OrderDropdown`), {
            type: 'slider',
            label: 'N',
            min: 1,
            max: 5,
            step: 1,
            defaultValue: 2,
            onChange: onPanelChanged,
        });

        panel.cutoffDropdown = new UniDropdown(document.getElementById(`${prefix}CutoffDropdown`), {
            type: 'logslider',
            label: 'Cutoff (Hz)',
            minValue: 0.001,
            maxValue: 1,
            step: 0.01,
            defaultValue: 0.1,
            onChange: onPanelChanged,
        });

        panel.gainDropdown = new UniDropdown(document.getElementById(`${prefix}GainDropdown`), {
            type: 'slider',
            label: 'Gain (dB)',
            min: -30,
            max: 30,
            step: 0.1,
            defaultValue: 0,
            onChange: onPanelChanged,
        });

        panel.rippleDropdown = new UniDropdown(document.getElementById(`${prefix}RippleDropdown`), {
            type: 'slider',
            label: 'Ripple (dB)',
            min: 0,
            max: 5,
            step: 0.1,
            defaultValue: 0,
            onChange: onPanelChanged,
        });

        panel.attenuationDropdown = new UniDropdown(document.getElementById(`${prefix}AttenuationDropdown`), {
            type: 'slider',
            label: 'Attenuation (dB)',
            min: 10,
            max: 80,
            step: 1,
            defaultValue: 40,
            onChange: onPanelChanged,
        });

        panel.bandwidthDropdown = new UniDropdown(document.getElementById(`${prefix}BandwidthDropdown`), {
            type: 'logslider',
            label: 'Bandwidth',
            minValue: 0.001,
            maxValue: 1,
            step: 0.01,
            defaultValue: 0.1,
            onChange: onPanelChanged,
        });

        panel.preGainCheckbox.addEventListener('change', onPanelChanged);
        panel.oneDbCheckbox.addEventListener('change', onPanelChanged);

        panel.updateDesignOptions = transformVal => {
            const designOptions = {
                bilinear: [
                    { value: 'butterworth', label: 'Butterworth' },
                    { value: 'bessel', label: 'Bessel' }
                ],
                matchedz: [
                    { value: 'butterworth', label: 'Butterworth' },
                    { value: 'bessel', label: 'Bessel' },
                    { value: 'allpass', label: 'Allpass' },
                    { value: 'tschebyscheff05', label: 'Chebyshev 0.5dB' },
                    { value: 'tschebyscheff1', label: 'Chebyshev 1dB' },
                    { value: 'tschebyscheff2', label: 'Chebyshev 2dB' },
                    { value: 'tschebyscheff3', label: 'Chebyshev 3dB' }
                ]
            };

            const options = designOptions[transformVal] || designOptions.bilinear;
            panel.designDropdown.options.items = options;
            panel.designDropdown.dropdownContent.innerHTML = '';
            options.forEach(item => {
                const a = document.createElement('a');
                a.href = '#';
                a.dataset.value = item.value;
                a.textContent = item.label;
                panel.designDropdown.dropdownContent.appendChild(a);
                a.addEventListener('click', e => {
                    e.preventDefault();
                    panel.designDropdown.setActiveOption(a);
                    panel.designDropdown.close();
                    panel.onDesignChange(panel.typeDropdown.getValue()?.value || 'none', item.value);
                });
            });

            if (options.length > 0) {
                panel.designDropdown.setValueSelect(options[0].value, true);
            }
        };

        panel.sendSettings = (bypass = false) => {
            const selectedType = panel.typeDropdown.getValue()?.value || 'none';
            const sampleRate = Number(currentSampleRate);
            const shouldBypass = bypass || selectedType === 'none' || !Number.isFinite(sampleRate) || sampleRate <= 0;
            const liveFilterActive = !buildLiveFilterSettings(panel.key).bypass;
            const workerSettings = {
                bypass: shouldBypass,
                order: Number(panel.orderDropdown.getValue()),
                cutoff: Number(panel.cutoffDropdown.getValue()),
                fs: shouldBypass ? 1 : sampleRate,
                type: selectedType,
                design: panel.designDropdown.getValue()?.value || 'butterworth',
                gain: Number(panel.gainDropdown.getValue()),
                ripple: Number(panel.rippleDropdown.getValue()),
                attenuation: Number(panel.attenuationDropdown.getValue()),
                bandwidth: Number(panel.bandwidthDropdown.getValue()),
                preGain: !!panel.preGainCheckbox.checked,
                oneDb: !!panel.oneDbCheckbox.checked,
                transform: panel.transformDropdown.getValue()?.value || 'bilinear'
            };

            setLocalFilterEnabled(panel.key, liveFilterActive);
            if (!liveFilterActive) {
                clearFilteredBuffer(panel.key);
            }

            if (areFilterSettingsEquivalent(lastAppliedFilterSettings[panel.key], workerSettings)) {
                return;
            }

            lastAppliedFilterSettings[panel.key] = { ...workerSettings };

            panel.worker.postMessage({
                type: 'initFilter',
                data: workerSettings
            });
        };

        panel.onTypeChange = selectedType => {
            panel.designDropdown.container.style.display = 'none';
            panel.gainDropdown.container.style.display = 'none';
            panel.rippleDropdown.container.style.display = 'none';
            panel.attenuationDropdown.container.style.display = 'none';
            panel.bandwidthDropdown.container.style.display = 'none';
            panel.oneDbCheckboxContainer.style.display = 'none';
            panel.transformDropdown.container.style.display = 'none';

            if (selectedType === 'none') {
                panel.cutoffDropdown.container.style.display = 'none';
                panel.orderDropdown.container.style.display = 'none';
                panel.sendSettings(true);
                return;
            }

            panel.cutoffDropdown.container.style.display = 'block';
            panel.orderDropdown.container.style.display = 'block';

            const designsForType = filterTypeMap[selectedType] || [];
            if (designsForType.length === 0) {
                panel.sendSettings(true);
                return;
            }

            panel.designDropdown.options.items = designsForType;
            panel.designDropdown.dropdownContent.innerHTML = '';
            designsForType.forEach(item => {
                const a = document.createElement('a');
                a.href = '#';
                a.dataset.value = item.value;
                a.textContent = item.label;
                panel.designDropdown.dropdownContent.appendChild(a);
                a.addEventListener('click', e => {
                    e.preventDefault();
                    panel.designDropdown.setActiveOption(a);
                    panel.designDropdown.close();
                    panel.onDesignChange(selectedType, item.value);
                });
            });

            panel.designDropdown.container.style.display = 'block';
            panel.designDropdown.setValueSelect(designsForType[0].value, true);
            panel.onDesignChange(selectedType, designsForType[0].value);
        };

        panel.onDesignChange = (selectedType, selectedDesign) => {
            panel.cutoffDropdown.container.style.display = 'block';
            panel.orderDropdown.container.style.display = 'block';
            panel.designDropdown.container.style.display = 'block';
            panel.gainDropdown.container.style.display = 'none';
            panel.rippleDropdown.container.style.display = 'none';
            panel.attenuationDropdown.container.style.display = 'none';
            panel.bandwidthDropdown.container.style.display = 'none';
            panel.oneDbCheckboxContainer.style.display = 'none';
            panel.transformDropdown.container.style.display = 'none';

            const paramList = (filterParamVisibility[selectedType] && filterParamVisibility[selectedType][selectedDesign]) || [];
            paramList.forEach(param => {
                if (param === 'gain') panel.gainDropdown.container.style.display = 'block';
                if (param === 'ripple') panel.rippleDropdown.container.style.display = 'block';
                if (param === 'attenuation') panel.attenuationDropdown.container.style.display = 'block';
                if (param === 'bandwidth') panel.bandwidthDropdown.container.style.display = 'block';
                if (param === 'oneDb') panel.oneDbCheckboxContainer.style.display = 'block';
            });

            const designsForType = filterTypeMap[selectedType] || [];
            const selectedDesignObj = designsForType.find(d => d.value === selectedDesign);
            if (selectedDesignObj) {
                if (selectedDesignObj.transforms.length > 1) {
                    panel.transformDropdown.options.items = buildTransformOptions(selectedDesignObj.transforms);
                    panel.transformDropdown.dropdownContent.innerHTML = '';
                    selectedDesignObj.transforms.forEach(transform => {
                        const a = document.createElement('a');
                        a.href = '#';
                        a.dataset.value = transform;
                        a.textContent = transform.charAt(0).toUpperCase() + transform.slice(1);
                        panel.transformDropdown.dropdownContent.appendChild(a);
                        a.addEventListener('click', e => {
                            e.preventDefault();
                            panel.transformDropdown.setActiveOption(a);
                            panel.transformDropdown.close();
                            panel.updateDesignOptions(transform);
                            onPanelChanged();
                        });
                    });
                    panel.transformDropdown.setValue(selectedDesignObj.transforms[0], true);
                    panel.transformDropdown.container.style.display = 'block';
                } else {
                    panel.transformDropdown.setValue(selectedDesignObj.transforms[0], true);
                }
            }

            onPanelChanged();
        };

        panel.copyFrom = sourcePanel => {
            panel.typeDropdown.setValue(sourcePanel.typeDropdown.getValue()?.value || 'none', true);
            panel.onTypeChange(sourcePanel.typeDropdown.getValue()?.value || 'none');
            panel.designDropdown.setValue(sourcePanel.designDropdown.getValue()?.value || 'butterworth', true);
            panel.onDesignChange(sourcePanel.typeDropdown.getValue()?.value || 'none', sourcePanel.designDropdown.getValue()?.value || 'butterworth');
            panel.transformDropdown.setValue(sourcePanel.transformDropdown.getValue()?.value || 'bilinear', true);
            panel.orderDropdown.setValue(sourcePanel.orderDropdown.getValue(), true);
            panel.cutoffDropdown.setValue(sourcePanel.cutoffDropdown.getValue(), true);
            panel.gainDropdown.setValue(sourcePanel.gainDropdown.getValue(), true);
            panel.rippleDropdown.setValue(sourcePanel.rippleDropdown.getValue(), true);
            panel.attenuationDropdown.setValue(sourcePanel.attenuationDropdown.getValue(), true);
            panel.bandwidthDropdown.setValue(sourcePanel.bandwidthDropdown.getValue(), true);
            panel.preGainCheckbox.checked = sourcePanel.preGainCheckbox.checked;
            panel.oneDbCheckbox.checked = sourcePanel.oneDbCheckbox.checked;
            panel.sendSettings(false);
        };

        panel.updateDesignOptions('bilinear');
        panel.onTypeChange('none');
        return panel;
    }

    function syncFilterPanel(targetKey, sourcePanel) {
        const targetPanel = targetKey === 'acc' ? accFilterUi : gyroFilterUi;
        if (!targetPanel) return;
        filterPanelSyncInProgress = true;
        try {
            targetPanel.copyFrom(sourcePanel);
        } finally {
            filterPanelSyncInProgress = false;
        }
    }

    accFilterUi = createFilterPanel('acc', 'acc', accFilterWorker);
    gyroFilterUi = createFilterPanel('gyro', 'gyro', gyroFilterWorker);

    chartVisibilityCheckboxes.acc.addEventListener('change', () => setChartVisibility('acc', chartVisibilityCheckboxes.acc.checked));
    chartVisibilityCheckboxes.gyro.addEventListener('change', () => setChartVisibility('gyro', chartVisibilityCheckboxes.gyro.checked));
    syncToggle.addEventListener('change', () => {
        filterSyncEnabled = syncToggle.checked;
        if (filterSyncEnabled) {
            syncFilterPanel('gyro', accFilterUi);
        }
        applyFilterPanelEnabledState(gyroFilterUi, !filterSyncEnabled);
    });

    accFilterWorker.onmessage = e => handleFilterWorkerMessage('acc', e.data);
    gyroFilterWorker.onmessage = e => handleFilterWorkerMessage('gyro', e.data);

    setChartVisibility('acc', true);
    setChartVisibility('gyro', true);
    applyFilterPanelEnabledState(gyroFilterUi, true);
}

function handleFilterWorkerMessage(sensorKey, payload) {
    if (payload.type === 'initDone') {
        clearFilteredBuffer(sensorKey);
        if (sensorKey === 'acc') {
            accFilterRequestInFlight = false;
        } else {
            gyroFilterRequestInFlight = false;
        }
        if (!buildLiveFilterSettings(sensorKey).bypass) {
            seedFilterBuffer(sensorKey);
        }
        return;
    }

    if (payload.type === 'error') {
        if (sensorKey === 'acc') {
            accFilterRequestInFlight = false;
        } else {
            gyroFilterRequestInFlight = false;
        }
        console.error('Worker Fehler:', payload.message);
        return;
    }

    if (payload.type === 'filteredSamples') {
        appendFilteredSamples(sensorKey, payload.data);
        return;
    }

    if (payload.type !== 'filteredBlock') {
        return;
    }

    const isAcc = sensorKey === 'acc';
    const chartRef = isAcc ? chart : gyroChart;
    const chartPaused = isAcc ? paused : gyroChartPaused;
    const chartVisible = isAcc ? accChartVisible : gyroChartVisible;

    if (isAcc) {
        accFilterRequestInFlight = false;
    } else {
        gyroFilterRequestInFlight = false;
    }

    if (!chartRef || chartPaused || !chartVisible) {
        return;
    }

    const { times, rangeMinTime, rangeMaxTime, x, y, z, total } = payload.data;
    if (!times || times.length === 0) {
        return;
    }

    const yMinBefore = chartRef.scales.y.min;
    const yMaxBefore = chartRef.scales.y.max;

    if (isAcc) {
        chartRef.setData([times, x, y, z, total]);
    } else {
        chartRef.setData([times, x, y, z]);
    }

    if (!isAcc && !accChartVisible) {
        window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: rangeMaxTime } }));
    }
    if (yMinBefore !== undefined && yMaxBefore !== undefined) {
        chartRef.setScale('y', { min: yMinBefore, max: yMaxBefore });
    }
}

function clearFilteredBuffer(sensorKey) {
    if (sensorKey === 'acc') {
        accBufferFiltered.clear(false);
    } else {
        gyroBufferFiltered.clear(false);
    }
}

function appendFilteredSamples(sensorKey, payload) {
    const { times, x, y, z, total } = payload;
    if (!times || times.length === 0) {
        return;
    }

    if (sensorKey === 'acc') {
        for (let index = 0; index < times.length; index++) {
            accBufferFiltered.push([times[index], x[index], y[index], z[index], total ? total[index] : Math.hypot(x[index], y[index], z[index])]);
        }
        return;
    }

    for (let index = 0; index < times.length; index++) {
        gyroBufferFiltered.push([times[index], x[index], y[index], z[index]]);
    }
}

function dispatchStreamingFilterBatch(sensorKey, batchWindowData) {
    const worker = sensorKey === 'acc' ? accFilterWorker : gyroFilterWorker;
    if (!batchWindowData?.times || batchWindowData.times.length === 0) {
        return;
    }

    const rawDataBlock = {
        times: batchWindowData.times,
        x: batchWindowData.xs,
        y: batchWindowData.ys,
        z: batchWindowData.zs,
    };
    const transferables = [rawDataBlock.times.buffer, rawDataBlock.x.buffer, rawDataBlock.y.buffer, rawDataBlock.z.buffer];

    if (sensorKey === 'acc' && batchWindowData.totals) {
        rawDataBlock.total = batchWindowData.totals;
        transferables.push(batchWindowData.totals.buffer);
    }

    worker.postMessage({
        type: 'filterSamples',
        data: { rawDataBlock }
    }, transferables);
}

function areFilterSettingsEquivalent(previousSettings, nextSettings) {
    if (!previousSettings || !nextSettings) {
        return false;
    }

    const numericKeys = ['order', 'cutoff', 'fs', 'gain', 'ripple', 'attenuation', 'bandwidth'];
    for (const key of ['bypass', 'type', 'design', 'preGain', 'oneDb', 'transform']) {
        if (previousSettings[key] !== nextSettings[key]) {
            return false;
        }
    }

    for (const key of numericKeys) {
        const previousValue = Number(previousSettings[key]);
        const nextValue = Number(nextSettings[key]);
        const tolerance = key === 'fs'
            ? Math.max(FILTER_SAMPLE_RATE_MIN_ABSOLUTE_DELTA, nextValue * FILTER_SAMPLE_RATE_MIN_RELATIVE_DELTA)
            : 1e-6;
        if (Math.abs(previousValue - nextValue) > tolerance) {
            return false;
        }
    }

    return true;
}

function estimateRecentSampleRateHz(buffer, sampleCount = FILTER_SAMPLE_RATE_ESTIMATE_SAMPLES) {
    if (!buffer || buffer.length < 2) {
        return 0;
    }

    const recentTimes = buffer.getFieldTypedArray('time', Math.min(sampleCount, buffer.length));
    if (!recentTimes || recentTimes.length < 2) {
        return 0;
    }

    const diffs = [];
    for (let index = 1; index < recentTimes.length; index++) {
        const diff = recentTimes[index] - recentTimes[index - 1];
        if (Number.isFinite(diff) && diff > 0) {
            diffs.push(diff);
        }
    }

    if (diffs.length === 0) {
        return 0;
    }

    diffs.sort((left, right) => left - right);
    const middleIndex = Math.floor(diffs.length / 2);
    const medianDiff = diffs.length % 2 === 0
        ? (diffs[middleIndex - 1] + diffs[middleIndex]) / 2
        : diffs[middleIndex];

    if (!Number.isFinite(medianDiff) || medianDiff <= 0) {
        return 0;
    }

    return 1000000 / medianDiff;
}

function getSmoothedFilterSampleRate(nextSampleRate) {
    if (!Number.isFinite(nextSampleRate) || nextSampleRate <= 0) {
        return 0;
    }

    if (!Number.isFinite(currentSampleRate) || currentSampleRate <= 0) {
        return nextSampleRate;
    }

    return currentSampleRate + ((nextSampleRate - currentSampleRate) * FILTER_SAMPLE_RATE_EMA_ALPHA);
}

function seedFilterBuffer(sensorKey) {
    const seedDurationUs = Math.max(displayDurationSeconds * 1000000, getFilterWarmupDurationUs(sensorKey) * 2);
    const sourceBuffer = sensorKey === 'acc' ? accBuffer : gyroBuffer;
    const lastSample = sourceBuffer.getLast();
    if (!lastSample?.time) {
        return;
    }

    const minTime = lastSample.time - seedDurationUs;
    const seedWindow = sensorKey === 'acc'
        ? getAccWindowData(displayDurationSeconds, minTime)
        : getGyroWindowData(displayDurationSeconds, minTime);

    dispatchStreamingFilterBatch(sensorKey, seedWindow);
}

function sendFilterRequestFor(sensorKey, sharedMinTime, sharedMaxTime, precomputedWindowData = null) {
    const isAcc = sensorKey === 'acc';
    const enabled = isAcc ? accFilterEnabled : gyroFilterEnabled;
    const inFlight = isAcc ? accFilterRequestInFlight : gyroFilterRequestInFlight;
    const visible = isAcc ? accChartVisible : gyroChartVisible;
    const worker = isAcc ? accFilterWorker : gyroFilterWorker;
    const now = performance.now();
    const lastDispatchAt = isAcc ? accLastFilterDispatchAt : gyroLastFilterDispatchAt;

    if (!enabled || inFlight || !visible || !Number.isFinite(currentSampleRate) || currentSampleRate <= 0) {
        return;
    }

    if ((now - lastDispatchAt) < FILTER_REQUEST_INTERVAL_MS) {
        return;
    }

    const filterSourceMinTime = sharedMinTime - getFilterWarmupDurationUs(sensorKey);
    const windowData = precomputedWindowData || (isAcc
        ? getAccWindowData(displayDurationSeconds, filterSourceMinTime)
        : getGyroWindowData(displayDurationSeconds, filterSourceMinTime));

    if (!windowData || !windowData.times || windowData.times.length === 0) {
        return;
    }

    const maxPoints = getFilterTargetPointCount(sensorKey);

    const timesSlice = windowData.times;
    const xs = windowData.xs;
    const ys = windowData.ys;
    const zs = windowData.zs;
    const transferables = [xs.buffer, ys.buffer, zs.buffer, timesSlice.buffer];
    const rawDataBlock = {
        x: xs,
        y: ys,
        z: zs,
        times: timesSlice,
        rangeMinTime: sharedMinTime,
        rangeMaxTime: sharedMaxTime,
        maxPoints,
    };

    if (isAcc && windowData.totals) {
        rawDataBlock.total = windowData.totals;
        transferables.push(windowData.totals.buffer);
    }

    if (isAcc) {
        accFilterRequestInFlight = true;
        accLastFilterDispatchAt = now;
    } else {
        gyroFilterRequestInFlight = true;
        gyroLastFilterDispatchAt = now;
    }

    worker.postMessage({
        type: 'filterRequest',
        data: {
            rawDataBlock
        }
    }, transferables);
}

function shouldRefreshFilterSampleRate(nextSampleRate) {
    if (!Number.isFinite(nextSampleRate) || nextSampleRate <= 0) {
        return false;
    }

    if (!Number.isFinite(currentSampleRate) || currentSampleRate <= 0) {
        return true;
    }

    const delta = Math.abs(nextSampleRate - currentSampleRate);
    const minimumRelevantDelta = Math.max(
        FILTER_SAMPLE_RATE_MIN_ABSOLUTE_DELTA,
        currentSampleRate * FILTER_SAMPLE_RATE_MIN_RELATIVE_DELTA
    );

    if (delta < minimumRelevantDelta) {
        return false;
    }

    return (performance.now() - lastFilterSampleRateUpdateAt) >= FILTER_SAMPLE_RATE_UPDATE_INTERVAL_MS;
}

function getFilterTargetPointCount(sensorKey) {
    const chartRef = sensorKey === 'acc' ? chart : gyroChart;
    const chartWidth = Math.max(
        0,
        Math.round(
            chartRef?.bbox?.width ||
            chartRef?.root?.clientWidth ||
            0
        )
    );

    if (chartWidth <= 0) {
        return sensorKey === 'acc' ? 1800 : 2400;
    }

    return sensorKey === 'acc'
        ? Math.max(1200, chartWidth * 2)
        : Math.max(1600, chartWidth * 3);
}

function getFilterWarmupDurationUs(sensorKey) {
    const panel = sensorKey === 'acc' ? accFilterUi : gyroFilterUi;
    const sampleRate = Number(currentSampleRate);
    const filterType = panel?.typeDropdown?.getValue()?.value || 'none';
    const cutoffNormalized = Number(panel?.cutoffDropdown?.getValue());
    const filterOrder = Number(panel?.orderDropdown?.getValue()) || 2;

    if (!panel || filterType === 'none' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        return 0;
    }

    const normalizedCutoff = Number.isFinite(cutoffNormalized) ? cutoffNormalized : 0;
    const cutoffHz = Math.max(0.001, normalizedCutoff * (sampleRate / 2));
    const typeCycleMultiplier = (() => {
        switch (filterType) {
            case 'highpass':
            case 'bandpass':
            case 'bandstop':
                return 1.5;
            case 'peak':
            case 'lowshelf':
            case 'highshelf':
                return 1.25;
            default:
                return 1;
        }
    })();

    const settleByCyclesSeconds = (FILTER_WARMUP_BASE_CYCLES * typeCycleMultiplier) / cutoffHz;
    const settleBySamplesSeconds = Math.max(FILTER_WARMUP_MIN_SAMPLES / sampleRate, filterOrder * FILTER_WARMUP_ORDER_SECONDS);
    const warmupSeconds = Math.min(
        FILTER_WARMUP_MAX_SECONDS,
        Math.max(FILTER_WARMUP_MIN_SECONDS, settleByCyclesSeconds, settleBySamplesSeconds)
    );

    return warmupSeconds * 1000000;
}

function getFilterPanel(sensorKey) {
    return sensorKey === 'acc' ? accFilterUi : gyroFilterUi;
}

function setLocalFilterEnabled(sensorKey, enabled) {
    if (sensorKey === 'acc') {
        accFilterEnabled = enabled;
        return;
    }

    gyroFilterEnabled = enabled;
}

function buildLiveFilterSettings(sensorKey) {
    const panel = getFilterPanel(sensorKey);
    const sampleRate = Number(currentSampleRate);
    const selectedType = panel?.typeDropdown?.getValue()?.value || 'none';
    const shouldBypass = !panel || selectedType === 'none' || !Number.isFinite(sampleRate) || sampleRate <= 0 || !liveIirCalculator;

    return {
        bypass: shouldBypass,
        order: Number(panel?.orderDropdown?.getValue()) || 2,
        cutoff: Number(panel?.cutoffDropdown?.getValue()) || 0,
        fs: shouldBypass ? 1 : sampleRate,
        type: selectedType,
        design: panel?.designDropdown?.getValue()?.value || 'butterworth',
        gain: Number(panel?.gainDropdown?.getValue()) || 0,
        ripple: Number(panel?.rippleDropdown?.getValue()) || 0,
        attenuation: Number(panel?.attenuationDropdown?.getValue()) || 0,
        bandwidth: Number(panel?.bandwidthDropdown?.getValue()) || 0,
        preGain: !!panel?.preGainCheckbox?.checked,
        oneDb: !!panel?.oneDbCheckbox?.checked,
        transform: panel?.transformDropdown?.getValue()?.value || 'bilinear'
    };
}

function createLiveFilterCoefficients(settings) {
    if (!liveIirCalculator || settings.bypass || settings.type === 'none') {
        return null;
    }

    const nyquist = settings.fs / 2;
    const cutoffHz = settings.cutoff * nyquist;
    if (!Number.isFinite(cutoffHz) || cutoffHz <= 0 || cutoffHz >= nyquist) {
        return null;
    }

    const transform = (settings.transform || 'bilinear').toLowerCase();
    const characteristic = transform === 'matchedz'
        ? liveDesignMapMatchedZ[(settings.design || '').toLowerCase()]
        : liveDesignMapBilinear[(settings.design || '').toLowerCase()];

    if (!characteristic) {
        return null;
    }

    const params = {
        order: settings.order || 2,
        characteristic,
        Fs: settings.fs,
        Fc: cutoffHz,
        preGain: settings.preGain || false,
        transform,
    };

    if (transform === 'bilinear') {
        params.gain = settings.gain || 0;
    }

    if (['bandpass', 'bandstop'].includes(settings.type.toLowerCase()) && settings.bandwidth !== undefined) {
        params.BW = settings.bandwidth;
    }

    switch (settings.type.toLowerCase()) {
        case 'lowpass':
            return liveIirCalculator.lowpass(params);
        case 'highpass':
            return liveIirCalculator.highpass(params);
        case 'bandpass':
            return liveIirCalculator.bandpass(params);
        case 'bandstop':
            return liveIirCalculator.bandstop(params);
        case 'peak':
            return liveIirCalculator.peak(params);
        case 'lowshelf':
            return liveIirCalculator.lowshelf(params);
        case 'highshelf':
            return liveIirCalculator.highshelf(params);
        case 'aweighting':
            return liveIirCalculator.aweighting(params);
        default:
            return null;
    }
}

function hasSufficientFilterHistory(sensorKey, sharedMinTime) {
    const sourceBuffer = sensorKey === 'acc' ? accBuffer : gyroBuffer;
    const lastSample = sourceBuffer.getLast();
    if (!lastSample?.time || sourceBuffer.length < 2) {
        return false;
    }

    const earliestTime = sourceBuffer.getFieldValueAt('time', 0);
    const requiredHistoryStart = sharedMinTime - getFilterWarmupDurationUs(sensorKey);
    return earliestTime <= requiredHistoryStart;
}

function findEndIndexByTime(times, maxTime) {
    let low = 0;
    let high = times.length;

    while (low < high) {
        const mid = low + ((high - low) >> 1);
        if (times[mid] <= maxTime) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

function reverseTypedArray(values) {
    const reversed = new values.constructor(values.length);
    for (let index = 0; index < values.length; index++) {
        reversed[index] = values[values.length - 1 - index];
    }
    return reversed;
}

function reflectPadSignal(values, padLength) {
    if (!values || values.length === 0 || padLength <= 0) {
        return values;
    }

    const clampedPadLength = Math.min(padLength, Math.max(0, values.length - 1));
    if (clampedPadLength <= 0) {
        return values;
    }

    const padded = new values.constructor(values.length + (clampedPadLength * 2));
    for (let index = 0; index < clampedPadLength; index++) {
        const leftSourceIndex = Math.min(values.length - 1, clampedPadLength - index);
        padded[index] = values[leftSourceIndex];
    }

    padded.set(values, clampedPadLength);

    for (let index = 0; index < clampedPadLength; index++) {
        const rightSourceIndex = Math.max(0, values.length - 2 - index);
        padded[clampedPadLength + values.length + index] = values[rightSourceIndex];
    }

    return padded;
}

function applyZeroPhaseIir(coeffs, values, filterOrder) {
    if (!FiliLib || !coeffs || !values || values.length === 0) {
        return values;
    }

    const padLength = Math.min(
        FILTER_ZERO_PHASE_PAD_MAX_SAMPLES,
        Math.max(
            FILTER_ZERO_PHASE_PAD_MIN_SAMPLES,
            Math.ceil((filterOrder || 2) * 24),
            Math.ceil(values.length * 0.1)
        )
    );

    const padded = reflectPadSignal(values, padLength);
    const forwardFilter = new FiliLib.IirFilter(coeffs);
    const forward = forwardFilter.multiStep(padded);
    const reversedForward = reverseTypedArray(forward);
    const backwardFilter = new FiliLib.IirFilter(coeffs);
    const backward = backwardFilter.multiStep(reversedForward);
    const restored = reverseTypedArray(backward);

    return restored.slice(padLength, padLength + values.length);
}

function computeFilteredWindowForDisplay(sensorKey, sharedMinTime, sharedMaxTime) {
    const settings = buildLiveFilterSettings(sensorKey);
    const rawVisibleWindow = sensorKey === 'acc'
        ? getAccWindowData(displayDurationSeconds, sharedMinTime)
        : getGyroWindowData(displayDurationSeconds, sharedMinTime);

    if (!hasSufficientFilterHistory(sensorKey, sharedMinTime)) {
        return rawVisibleWindow;
    }

    const rawWindow = sensorKey === 'acc'
        ? getAccWindowData(displayDurationSeconds, sharedMinTime - getFilterWarmupDurationUs(sensorKey))
        : getGyroWindowData(displayDurationSeconds, sharedMinTime - getFilterWarmupDurationUs(sensorKey));

    if (settings.bypass || !rawWindow?.times || rawWindow.times.length === 0) {
        return rawVisibleWindow;
    }

    const coeffs = createLiveFilterCoefficients(settings);
    if (!coeffs || !FiliLib) {
        return rawVisibleWindow;
    }

    const filteredX = applyZeroPhaseIir(coeffs, rawWindow.xs, settings.order);
    const filteredY = applyZeroPhaseIir(coeffs, rawWindow.ys, settings.order);
    const filteredZ = applyZeroPhaseIir(coeffs, rawWindow.zs, settings.order);

    const startIndex = findStartIndexByTime(rawWindow.times, sharedMinTime);
    const endIndex = findEndIndexByTime(rawWindow.times, sharedMaxTime);
    const visibleTimes = rawWindow.times.slice(startIndex, endIndex);
    const visibleX = filteredX.slice(startIndex, endIndex);
    const visibleY = filteredY.slice(startIndex, endIndex);
    const visibleZ = filteredZ.slice(startIndex, endIndex);
    const visibleTotal = sensorKey === 'acc' ? new Float32Array(visibleX.length) : null;

    if (visibleTotal) {
        for (let index = 0; index < visibleX.length; index++) {
            visibleTotal[index] = Math.hypot(visibleX[index], visibleY[index], visibleZ[index]);
        }
    }

    return downsampleWindowData({
        times: visibleTimes,
        xs: visibleX,
        ys: visibleY,
        zs: visibleZ,
        totals: visibleTotal,
    }, getFilterTargetPointCount(sensorKey));
}

function downsampleWindowData(windowData, maxPoints) {
    if (!windowData?.times || windowData.times.length <= maxPoints) {
        return windowData;
    }

    const step = Math.max(1, Math.ceil(windowData.times.length / maxPoints));
    const resultLength = Math.ceil(windowData.times.length / step);
    const sampled = {
        times: new Float64Array(resultLength),
        xs: new Float32Array(resultLength),
        ys: new Float32Array(resultLength),
        zs: new Float32Array(resultLength),
    };

    if (windowData.totals) {
        sampled.totals = new Float32Array(resultLength);
    }

    let targetIndex = 0;
    for (let sourceIndex = 0; sourceIndex < windowData.times.length; sourceIndex += step) {
        sampled.times[targetIndex] = windowData.times[sourceIndex];
        sampled.xs[targetIndex] = windowData.xs[sourceIndex];
        sampled.ys[targetIndex] = windowData.ys[sourceIndex];
        sampled.zs[targetIndex] = windowData.zs[sourceIndex];
        if (sampled.totals) {
            sampled.totals[targetIndex] = windowData.totals[sourceIndex];
        }
        targetIndex++;
    }

    return sampled;
}

function findStartIndexByTime(times, minTime) {
    let low = 0;
    let high = times.length;

    while (low < high) {
        const mid = low + ((high - low) >> 1);
        if (times[mid] < minTime) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

function getAccWindowData(durationSeconds, minTimeOverride = null) {
    const lastSample = accBuffer.getLast();
    if (!lastSample) {
        return {
            times: new Float64Array(0),
            xs: new Float32Array(0),
            ys: new Float32Array(0),
            zs: new Float32Array(0),
            totals: new Float32Array(0)
        };
    }

    const latestTime = lastSample.time;
    const minTime = minTimeOverride ?? (latestTime - durationSeconds * 1000000);
    const window = accBuffer.getWindowByTime('time', minTime, ['time', 'x', 'y', 'z', 'total']);

    return {
        times: window.time,
        xs: window.x,
        ys: window.y,
        zs: window.z,
        totals: window.total
    };
}

function getGyroWindowData(durationSeconds, minTimeOverride = null) {
    const lastSample = gyroBuffer.getLast();
    if (!lastSample) {
        return {
            times: new Float64Array(0),
            xs: new Float32Array(0),
            ys: new Float32Array(0),
            zs: new Float32Array(0)
        };
    }

    const latestTime = lastSample.time;
    const minTime = minTimeOverride ?? (latestTime - durationSeconds * 1000000);
    const window = gyroBuffer.getWindowByTime('time', minTime, ['time', 'x', 'y', 'z']);

    return {
        times: window.time,
        xs: window.x,
        ys: window.y,
        zs: window.z
    };
}

function getAccFilteredWindowData(durationSeconds, minTimeOverride = null) {
    const lastSample = accBufferFiltered.getLast();
    if (!lastSample) {
        return getAccWindowData(durationSeconds, minTimeOverride);
    }

    const latestTime = lastSample.time;
    const minTime = minTimeOverride ?? (latestTime - durationSeconds * 1000000);
    const window = accBufferFiltered.getWindowByTime('time', minTime, ['time', 'x', 'y', 'z', 'total']);

    return {
        times: window.time,
        xs: window.x,
        ys: window.y,
        zs: window.z,
        totals: window.total
    };
}

function getGyroFilteredWindowData(durationSeconds, minTimeOverride = null) {
    const lastSample = gyroBufferFiltered.getLast();
    if (!lastSample) {
        return getGyroWindowData(durationSeconds, minTimeOverride);
    }

    const latestTime = lastSample.time;
    const minTime = minTimeOverride ?? (latestTime - durationSeconds * 1000000);
    const window = gyroBufferFiltered.getWindowByTime('time', minTime, ['time', 'x', 'y', 'z']);

    return {
        times: window.time,
        xs: window.x,
        ys: window.y,
        zs: window.z
    };
}














const logSliderDropdown = new UniDropdown(document.getElementById('sliderDropdown'), {
    type: 'logslider',
    label: 'HIGHPASS',
    minValue: 0.001,
    maxValue: 100,
    defaultValue: 0,
    alpha: 0.3,  // alpha <1 = "weniger intensive" Skalierung; 1 = normale Log-Skala

    onChange: (value, label) => {
        fftHighPass = value;
        console.log('Ausgewählt:', value, label);
    }
});

const gyroLogSliderDropdown = new UniDropdown(document.getElementById('gyroSliderDropdown'), {
    type: 'logslider',
    label: 'HIGHPASS',
    minValue: 0.001,
    maxValue: 100,
    defaultValue: 0,
    alpha: 0.3,

    onChange: (value, label) => {
        gyroFftHighPass = value;
        console.log('Gyro FFT Highpass:', value, label);
    }
});

// IMU SETTINGS

const accelRangeDD = new UniDropdown(document.getElementById('accelRangeDD'), {
    type: 'select',
    label: 'Acc Range',
    items: [
        { value: 2, label: "±2g" },
        { value: 4, label: "±4g" },
        { value: 8, label: "±8g" },
        { value: 16, label: "±16g" },
    ],
    onChange: (value, label) => {
        //FFT_AXIS_MODE = value;
        console.log('Ausgewählt:', value, label);
    }
});
const accelSampleRateDD = new UniDropdown(document.getElementById('accelSampleRateDD'), {
    type: 'select',
    label: 'Sample Rate',
    items: [
        { value: 0, label: "OFF" },
        { value: 125, label: "12.5 Hz" },
        { value: 26, label: "26 Hz" },
        { value: 52, label: "52 Hz" },
        { value: 104, label: "104 Hz" },
        { value: 208, label: "208 Hz" },
        { value: 416, label: "416 Hz" },
        { value: 833, label: "833 Hz" },
        { value: 1660, label: "1660 Hz" },
        { value: 3330, label: "3330 Hz" },
        { value: 6660, label: "6660 Hz" }
    ],
    onChange: (value, label) => {
        //FFT_AXIS_MODE = value;
        console.log('Ausgewählt:', value, label);
    }
});
const acelFFilterDD = new UniDropdown(document.getElementById('accelFilterDD'), {
    type: 'select',
    label: 'Accel Filter',
    items: [
        { value: "OFF", label: "OFF" },
        { value: "LOWPASS", label: "LOWPASS" },
        { value: "HIGHPASS1", label: "HIGHPASS 1" },
        { value: "HIGHPASS2", label: "HIGHPASS 2" },

    ],
    onChange: (value, label) => {
        //FFT_AXIS_MODE = value;
        console.log('Ausgewählt:', value, label);
    }
});


const gyroSampleRateDD = new UniDropdown(document.getElementById('gyroSampleRateDD'), {
    type: 'select',
    label: 'Gyro Sample Rate',
    items: [
        { value: 0, label: "OFF" },
        { value: 125, label: "12.5 Hz" },
        { value: 26, label: "26 Hz" },
        { value: 52, label: "52 Hz" },
        { value: 104, label: "104 Hz" },
        { value: 208, label: "208 Hz" },
        { value: 416, label: "416 Hz" },
        { value: 833, label: "833 Hz" },
        { value: 1660, label: "1660 Hz" },
        { value: 3330, label: "3330 Hz" },
        { value: 6660, label: "6660 Hz" }
    ],
    onChange: (value, label) => {
        //FFT_AXIS_MODE = value;
        console.log('Ausgewählt:', value, label);
    }
});
const gyroFilterDD = new UniDropdown(document.getElementById('gyroFilterDD'), {
    type: 'select',
    label: 'Gyro Filter',
    items: [
        { value: "OFF", label: "OFF" },
        { value: "LOWPASS", label: "LOWPASS" },
        { value: "HIGHPASS1", label: "HIGHPASS 1" },
        { value: "HIGHPASS2", label: "HIGHPASS 2" },

    ],
    onChange: (value, label) => {
        //FFT_AXIS_MODE = value;
        console.log('Ausgewählt:', value, label);
    }
});

// SIDEPANEL SETTINGS

const CSDD2 = new UniDropdown(document.getElementById('CSDD2'), {
    type: 'select',
    label: 'Orientation',
    items: [
        { value: 0, label: " - " },
    ],
    onChange: (value, label) => {
        applyOrientationMode(value);
        console.log('Ausgewählt:', value, label);
    }
});

function ensureOrientationOption(label, value, preferredIndex = 2) {
    const exists = CSDD2.items && CSDD2.items.some(item => Number(item.value) === Number(value));
    if (!exists) {
        CSDD2.addSelectItem({ label, value: String(value) }, preferredIndex);
    }
}

function resetOrientationLiveBuffers() {
    accBuffer.clear();
    gyroBuffer.clear();
    accBufferFiltered.clear();
    gyroBufferFiltered.clear();
    rmsBuffer.clear();
    gyroRmsBuffer.clear();
    if (typeof window.setPanOffset === 'function') {
        window.setPanOffset(0);
    }
    lastTimestamp = 0;

    if (typeof chart !== 'undefined' && chart) {
        chart.setData([[], [], [], [], []]);
        chart.setScale('y', { min: -1100, max: 1100 });
        chart.setScale('x', { auto: true });
    }

    if (typeof gyroChart !== 'undefined' && gyroChart) {
        gyroChart.setData([[], [], [], []]);
        gyroChart.setScale('y', { auto: true });
        gyroChart.setScale('x', { auto: true });
    }
}

function setCookieValue(name, value, maxAgeSeconds) {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
}

function setLocalStorageValue(name, value) {
    try {
        globalThis.localStorage?.setItem(name, value);
    } catch (error) {
        console.warn('Lokaler Persistenzspeicher konnte nicht geschrieben werden:', error);
    }
}

function getCookieValue(name) {
    const prefix = `${name}=`;
    const cookies = document.cookie ? document.cookie.split('; ') : [];

    for (const cookie of cookies) {
        if (cookie.startsWith(prefix)) {
            return decodeURIComponent(cookie.slice(prefix.length));
        }
    }

    return null;
}

function getLocalStorageValue(name) {
    try {
        return globalThis.localStorage?.getItem(name) ?? null;
    } catch (error) {
        console.warn('Lokaler Persistenzspeicher konnte nicht gelesen werden:', error);
        return null;
    }
}

function clearCookieValue(name) {
    document.cookie = `${name}=; max-age=0; path=/; samesite=lax`;
}

function clearLocalStorageValue(name) {
    try {
        globalThis.localStorage?.removeItem(name);
    } catch (error) {
        console.warn('Lokaler Persistenzspeicher konnte nicht gelöscht werden:', error);
    }
}

function sanitizeAppSettingsBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value === 'string') {
        const normalizedValue = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
            return true;
        }
        if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
            return false;
        }
    }

    return fallback;
}

function sanitizeCustomWsHost(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedHost = value
        .trim()
        .replace(/^wss?:\/\//i, '')
        .replace(/\/ws\/?$/i, '')
        .replace(/\/+$/g, '');

    if (!normalizedHost || /\s/.test(normalizedHost) || normalizedHost.includes('/')) {
        return null;
    }

    return normalizedHost;
}

function getCurrentAppSettingsState() {
    return {
        version: APP_SETTINGS_COOKIE_VERSION,
        savedAt: Date.now(),
        telemetryPanelHidden: telemetryElements.panel?.classList.contains('is-hidden') ?? true,
        gravityCutEnabled: Boolean(gravityCutEnabled),
        customWsHost: sanitizeCustomWsHost(persistedCustomWsHost),
    };
}

function parseAppSettingsPersistedState(rawState) {
    const parsed = JSON.parse(rawState);
    const version = Number(parsed?.version);

    if (version !== APP_SETTINGS_COOKIE_VERSION) {
        return null;
    }

    return {
        version,
        telemetryPanelHidden: sanitizeAppSettingsBoolean(parsed?.telemetryPanelHidden, true),
        gravityCutEnabled: sanitizeAppSettingsBoolean(parsed?.gravityCutEnabled, false),
        customWsHost: sanitizeCustomWsHost(parsed?.customWsHost),
    };
}

function buildLegacyAppSettingsState() {
    const legacyTelemetryHidden = getLocalStorageValue(TELEMETRY_PANEL_HIDDEN_KEY);
    const legacyWsHost = getLocalStorageValue(LEGACY_WS_HOST_STORAGE_KEY);

    if (legacyTelemetryHidden === null && !legacyWsHost) {
        return null;
    }

    return {
        version: APP_SETTINGS_COOKIE_VERSION,
        telemetryPanelHidden: sanitizeAppSettingsBoolean(legacyTelemetryHidden, true),
        gravityCutEnabled: false,
        customWsHost: sanitizeCustomWsHost(legacyWsHost),
    };
}

function clearLegacyAppSettingsStorage() {
    clearLocalStorageValue(APP_SETTINGS_STORAGE_KEY);
    clearLocalStorageValue(TELEMETRY_PANEL_HIDDEN_KEY);
    clearLocalStorageValue(LEGACY_WS_HOST_STORAGE_KEY);
}

function persistAppSettingsCookie() {
    const serializedState = JSON.stringify(getCurrentAppSettingsState());
    setCookieValue(APP_SETTINGS_COOKIE_NAME, serializedState, APP_SETTINGS_COOKIE_MAX_AGE_SECONDS);
}

function readAppSettingsCookieState() {
    const rawCookie = getCookieValue(APP_SETTINGS_COOKIE_NAME);
    if (rawCookie) {
        try {
            const state = parseAppSettingsPersistedState(rawCookie);
            if (!state) {
                clearCookieValue(APP_SETTINGS_COOKIE_NAME);
                return null;
            }

            return { state, source: 'cookie' };
        } catch (error) {
            console.warn('App-Settings-Cookie konnte nicht gelesen werden:', error);
            clearCookieValue(APP_SETTINGS_COOKIE_NAME);
        }
    }

    const rawStorage = getLocalStorageValue(APP_SETTINGS_STORAGE_KEY);
    if (rawStorage) {
        try {
            const state = parseAppSettingsPersistedState(rawStorage);
            if (!state) {
                clearLocalStorageValue(APP_SETTINGS_STORAGE_KEY);
            } else {
                return { state, source: 'localStorage' };
            }
        } catch (error) {
            console.warn('App-Settings-Backup konnte nicht gelesen werden:', error);
            clearLocalStorageValue(APP_SETTINGS_STORAGE_KEY);
        }
    }

    const legacyState = buildLegacyAppSettingsState();
    if (legacyState) {
        return { state: legacyState, source: 'legacy' };
    }

    return null;
}

function restoreAppSettingsFromCookie() {
    const persisted = readAppSettingsCookieState();
    const state = persisted?.state || {
        telemetryPanelHidden: true,
        gravityCutEnabled: false,
        customWsHost: null,
    };

    persistedCustomWsHost = sanitizeCustomWsHost(state.customWsHost);
    applyTelemetryPanelHidden(state.telemetryPanelHidden, { persistState: false });
    setGravityCutEnabled(state.gravityCutEnabled, { persistState: false, notifyWorker: true });

    if (persisted && persisted.source !== 'cookie') {
        persistAppSettingsCookie();
        clearLegacyAppSettingsStorage();
    }
}

function sanitizeReferenceState(referenceState) {
    if (!referenceState || typeof referenceState !== 'object') {
        return null;
    }

    const sanitized = {
        x: Number(referenceState.x),
        y: Number(referenceState.y),
        z: Number(referenceState.z),
        gx: Number(referenceState.gx ?? 0),
        gy: Number(referenceState.gy ?? 0),
        gz: Number(referenceState.gz ?? 0),
    };

    if (![sanitized.x, sanitized.y, sanitized.z, sanitized.gx, sanitized.gy, sanitized.gz].every(Number.isFinite)) {
        return null;
    }

    return sanitized;
}

function sanitizeGyroZeroState(gyroState) {
    if (!gyroState || typeof gyroState !== 'object') {
        return null;
    }

    const sanitized = {
        x: Number(gyroState.x),
        y: Number(gyroState.y),
        z: Number(gyroState.z),
    };

    if (![sanitized.x, sanitized.y, sanitized.z].every(Number.isFinite)) {
        return null;
    }

    return sanitized;
}

function sanitizeAccelCalibrationScale(scale) {
    const normalizedScale = Number(scale);
    if (!Number.isFinite(normalizedScale) || normalizedScale <= 0) {
        return 1;
    }

    return normalizedScale;
}

function sanitizeViewportDisplaySettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return null;
    }

    const rawArrowOpacity = settings.arrowOpacity;
    const rawAxisColors = settings.axisColors;

    const arrowOpacity = {
        raw: sanitizeArrowOpacity(rawArrowOpacity?.raw, 0.82),
        result: sanitizeArrowOpacity(rawArrowOpacity?.result, 0.88),
        world: sanitizeArrowOpacity(rawArrowOpacity?.world, 0.42),
        frame: sanitizeArrowOpacity(rawArrowOpacity?.frame, 0.58),
    };

    const axisColors = {
        x: sanitizeAxisColor(rawAxisColors?.x, '#ff0000'),
        y: sanitizeAxisColor(rawAxisColors?.y, '#00ff00'),
        z: sanitizeAxisColor(rawAxisColors?.z, '#0000ff'),
    };

    const rawVectorColors = settings.vectorColors;
    const vectorColors = {
        raw: sanitizeAxisColor(rawVectorColors?.raw, '#ffa000'),
        result: sanitizeAxisColor(rawVectorColors?.result, '#00e5ff'),
    };

    const allowedBackgroundPresets = new Set(['steel', 'steel-soft', 'steel-light', 'aurora', 'dusk', 'ember', 'polar', 'mint', 'sunrise', 'noir', 'lab']);
    const backgroundPreset = typeof settings.backgroundPreset === 'string'
        && allowedBackgroundPresets.has(settings.backgroundPreset.trim().toLowerCase())
        ? settings.backgroundPreset.trim().toLowerCase()
        : 'steel';

    return { arrowOpacity, axisColors, vectorColors, backgroundPreset };
}

function sanitizeMotionViewportDisplaySettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return null;
    }

    const rawArrowOpacity = settings.arrowOpacity;
    const rawAxisColors = settings.axisColors;

    const arrowOpacity = {
        world: sanitizeArrowOpacity(rawArrowOpacity?.world, 0.42),
        trail: sanitizeArrowOpacity(rawArrowOpacity?.trail, 0.9),
        velocity: sanitizeArrowOpacity(rawArrowOpacity?.velocity, 0.86),
        acceleration: sanitizeArrowOpacity(rawArrowOpacity?.acceleration, 0.82),
    };

    const axisColors = {
        x: sanitizeAxisColor(rawAxisColors?.x, '#ff0000'),
        y: sanitizeAxisColor(rawAxisColors?.y, '#00ff00'),
        z: sanitizeAxisColor(rawAxisColors?.z, '#0000ff'),
    };

    const rawVectorColors = settings.vectorColors;
    const vectorColors = {
        trail: sanitizeAxisColor(rawVectorColors?.trail, '#00e5ff'),
        velocity: sanitizeAxisColor(rawVectorColors?.velocity, '#ffa000'),
        acceleration: sanitizeAxisColor(rawVectorColors?.acceleration, '#ffd400'),
    };

    const allowedBackgroundPresets = new Set(['steel', 'steel-soft', 'steel-light', 'aurora', 'dusk', 'ember', 'polar', 'mint', 'sunrise', 'noir', 'lab']);
    const backgroundPreset = typeof settings.backgroundPreset === 'string'
        && allowedBackgroundPresets.has(settings.backgroundPreset.trim().toLowerCase())
        ? settings.backgroundPreset.trim().toLowerCase()
        : 'steel';

    return { arrowOpacity, axisColors, vectorColors, backgroundPreset };
}

function sanitizeArrowOpacity(value, fallback) {
    const normalizedValue = Number(value);
    if (!Number.isFinite(normalizedValue)) {
        return fallback;
    }

    return Math.min(1, Math.max(0.15, normalizedValue));
}

function sanitizeAxisColor(value, fallback) {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmedValue = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(trimmedValue)) {
        return trimmedValue;
    }

    return fallback;
}

function getOrientationLabelForMode(mode) {
    const normalizedMode = Number(mode);
    const existingItem = CSDD2.items?.find((item) => Number(item.value) === normalizedMode);
    if (existingItem?.label) {
        return existingItem.label;
    }

    if (normalizedMode === 2) {
        return currentOrientationLabel || 'World Simple';
    }

    if (normalizedMode === 3) {
        return 'Reference';
    }

    return null;
}

function getCurrentCalibrationCookieState() {
    const state = {
        version: CALIBRATION_COOKIE_VERSION,
        mode: Number.isFinite(currentOrientationMode) ? Number(currentOrientationMode) : 0,
        savedAt: Date.now(),
    };

    const normalizedQuaternion = normalizeQuaternionXYZW(calibrationMemory[1]);
    if (normalizedQuaternion) {
        state.worldSimpleQuaternion = normalizedQuaternion;
    }

    const viewportAdjustmentQuaternion = getViewportAdjustmentQuaternionXYZW();
    if (viewportAdjustmentQuaternion && !isIdentityQuaternionXYZW(viewportAdjustmentQuaternion)) {
        state.viewportAdjustmentQuaternion = viewportAdjustmentQuaternion;
    }

    const referenceState = sanitizeReferenceState(currentReferenceState);
    if (referenceState) {
        state.referenceState = referenceState;
    }

    const worldSimpleGyroState = sanitizeGyroZeroState(currentWorldSimpleGyroState);
    if (worldSimpleGyroState) {
        state.worldSimpleGyroState = worldSimpleGyroState;
    }

    const accelCalibrationScale = sanitizeAccelCalibrationScale(currentAccelCalibrationScale);
    if (Math.abs(accelCalibrationScale - 1) > 1e-6) {
        state.accelCalibrationScale = accelCalibrationScale;
    }

    if (Number.isFinite(tempgravity) && tempgravity > 0) {
        state.gravityMagnitude = Number(tempgravity);
    }

    const viewportDisplaySettings = sanitizeViewportDisplaySettings(accVectorViewport.getDisplaySettings?.());
    if (viewportDisplaySettings) {
        state.viewportDisplaySettings = viewportDisplaySettings;
    }

    const motionViewportDisplaySettings = sanitizeMotionViewportDisplaySettings(motionViewport.getDisplaySettings?.());
    if (motionViewportDisplaySettings) {
        state.motionViewportDisplaySettings = motionViewportDisplaySettings;
    }

    const orientationLabel = getOrientationLabelForMode(state.mode);
    if (orientationLabel) {
        state.orientationLabel = orientationLabel;
    }

    return state;
}

function persistCalibrationCookie() {
    const state = getCurrentCalibrationCookieState();
    const hasCalibrationPayload = Boolean(
        state.worldSimpleQuaternion
        || state.referenceState
        || state.worldSimpleGyroState
        || (Number.isFinite(state.accelCalibrationScale) && Math.abs(state.accelCalibrationScale - 1) > 1e-6)
        || state.gravityMagnitude
        || state.viewportAdjustmentQuaternion
        || state.viewportDisplaySettings
        || state.motionViewportDisplaySettings
    );

    if (!hasCalibrationPayload && state.mode === 0) {
        clearCookieValue(CALIBRATION_COOKIE_NAME);
        clearLocalStorageValue(CALIBRATION_STORAGE_KEY);
        return;
    }

    const serializedState = JSON.stringify(state);
    setCookieValue(CALIBRATION_COOKIE_NAME, serializedState, CALIBRATION_COOKIE_MAX_AGE_SECONDS);
    setLocalStorageValue(CALIBRATION_STORAGE_KEY, serializedState);
}

function parseCalibrationPersistedState(rawState) {
    const parsed = JSON.parse(rawState);
    const state = {
        version: Number(parsed?.version),
        mode: Number.isFinite(Number(parsed?.mode)) ? Number(parsed.mode) : 0,
        orientationLabel: typeof parsed?.orientationLabel === 'string' ? parsed.orientationLabel : null,
        worldSimpleQuaternion: normalizeQuaternionXYZW(parsed?.worldSimpleQuaternion),
        viewportAdjustmentQuaternion: normalizeQuaternionXYZW(parsed?.viewportAdjustmentQuaternion),
        referenceState: sanitizeReferenceState(parsed?.referenceState),
        worldSimpleGyroState: sanitizeGyroZeroState(parsed?.worldSimpleGyroState),
        accelCalibrationScale: sanitizeAccelCalibrationScale(parsed?.accelCalibrationScale),
        gravityMagnitude: Number(parsed?.gravityMagnitude),
        viewportDisplaySettings: sanitizeViewportDisplaySettings(parsed?.viewportDisplaySettings),
        motionViewportDisplaySettings: sanitizeMotionViewportDisplaySettings(parsed?.motionViewportDisplaySettings),
    };

    if (state.version !== CALIBRATION_COOKIE_VERSION) {
        return null;
    }

    if (!Number.isFinite(state.gravityMagnitude) || state.gravityMagnitude <= 0) {
        state.gravityMagnitude = null;
    }

    return state;
}

function readCalibrationCookieState() {
    const rawCookie = getCookieValue(CALIBRATION_COOKIE_NAME);
    if (rawCookie) {
        try {
            const state = parseCalibrationPersistedState(rawCookie);
            if (!state) {
                clearCookieValue(CALIBRATION_COOKIE_NAME);
                return null;
            }

            return { state, source: 'cookie' };
        } catch (error) {
            console.warn('Kalibrierungs-Cookie konnte nicht gelesen werden:', error);
            clearCookieValue(CALIBRATION_COOKIE_NAME);
        }
    }

    const rawStorage = getLocalStorageValue(CALIBRATION_STORAGE_KEY);
    if (!rawStorage) {
        return null;
    }

    try {
        const state = parseCalibrationPersistedState(rawStorage);
        if (!state) {
            clearLocalStorageValue(CALIBRATION_STORAGE_KEY);
            return null;
        }

        return { state, source: 'localStorage' };
    } catch (error) {
        console.warn('Kalibrierungs-Backup konnte nicht gelesen werden:', error);
        clearLocalStorageValue(CALIBRATION_STORAGE_KEY);
        return null;
    }
}

function restoreCalibrationFromCookie() {
    const persisted = readCalibrationCookieState();
    if (!persisted?.state) {
        return;
    }

    const { state, source } = persisted;

    if (state.worldSimpleQuaternion) {
        setOrientationCalibrationQuaternion(state.worldSimpleQuaternion, { persistState: false });
    }

    if (state.referenceState) {
        currentReferenceState = state.referenceState;
        decodeWorker.postMessage({
            type: 'referenceState',
            payload: state.referenceState,
        });
    }

    if (state.worldSimpleGyroState) {
        setWorldSimpleGyroState(state.worldSimpleGyroState, { persistState: false });
    }

    setAccelCalibrationScale(state.accelCalibrationScale, { persistState: false });

    if (state.gravityMagnitude) {
        tempgravity = state.gravityMagnitude;
        decodeWorker.postMessage({
            type: 'gravity',
            payload: {
                gravity: state.gravityMagnitude,
            }
        });
    }

    applyOrientationMode(state.mode, {
        syncDropdown: true,
        optionLabel: state.orientationLabel,
        persistState: false,
    });

    accVectorViewport.setAdjustmentQuaternion(state.viewportAdjustmentQuaternion || getIdentityQuaternionXYZW(), {
        silent: true,
        commit: false,
    });
    syncViewportPostTransformQuaternion({ persistState: false, resetLiveBuffers: false });

    if (state.viewportDisplaySettings) {
        accVectorViewport.applyDisplaySettings(state.viewportDisplaySettings, { silent: true });
    }

    if (state.motionViewportDisplaySettings) {
        motionViewport.applyDisplaySettings(state.motionViewportDisplaySettings, { silent: true });
    }

    if (source === 'localStorage') {
        const serializedState = JSON.stringify(getCurrentCalibrationCookieState());
        setCookieValue(CALIBRATION_COOKIE_NAME, serializedState, CALIBRATION_COOKIE_MAX_AGE_SECONDS);
    }

    persistCalibrationCookie();

    console.log('Kalibrierung aus Cookie wiederhergestellt:', state);
}

function setWorldSimpleGyroState(gyroState, { persistState = true } = {}) {
    currentWorldSimpleGyroState = sanitizeGyroZeroState(gyroState);

    decodeWorker.postMessage({
        type: 'worldSimpleGyroState',
        payload: currentWorldSimpleGyroState,
    });

    if (persistState) {
        persistCalibrationCookie();
    }
}

function setAccelCalibrationScale(scale, { persistState = true } = {}) {
    currentAccelCalibrationScale = sanitizeAccelCalibrationScale(scale);

    decodeWorker.postMessage({
        type: 'accelCalibrationScale',
        payload: {
            scale: currentAccelCalibrationScale,
        },
    });

    if (persistState) {
        persistCalibrationCookie();
    }
}

function applyOrientationMode(mode, { syncDropdown = false, optionLabel = null, persistState = true } = {}) {
    let normalizedMode = Number(mode);
    if (!Number.isFinite(normalizedMode)) {
        return;
    }

    if (!ENABLE_FUSION_PIPELINE && normalizedMode === 1) {
        normalizedMode = 0;
    }

    currentOrientationMode = normalizedMode;

    const resolvedLabel = optionLabel || getOrientationLabelForMode(normalizedMode);
    if (resolvedLabel) {
        currentOrientationLabel = resolvedLabel;
        ensureOrientationOption(resolvedLabel, normalizedMode, 2);
    }

    decodeWorker.postMessage({
        type: 'calibmode',
        payload: {
            mode: normalizedMode,
        }
    });

    syncViewportBaseQuaternion({ silent: true });
    syncMotionWorkerTransform({ reset: true });

    resetOrientationLiveBuffers();

    if (syncDropdown) {
        CSDD2.setValue(normalizedMode, true);
    }

    if (persistState) {
        persistCalibrationCookie();
    }
}

function normalizeQuaternionXYZW(quaternion) {
    const source = Array.isArray(quaternion)
        ? quaternion
        : (ArrayBuffer.isView(quaternion) || (typeof quaternion?.length === 'number' && quaternion.length >= 4))
            ? Array.from(quaternion).slice(0, 4)
            : [quaternion?.x, quaternion?.y, quaternion?.z, quaternion?.w];

    if (!source || source.length < 4) {
        return null;
    }

    const values = source.slice(0, 4).map((value) => Number(value));
    if (values.some((value) => !Number.isFinite(value))) {
        return null;
    }

    const length = Math.hypot(values[0], values[1], values[2], values[3]);
    if (length < 1e-12) {
        return null;
    }

    return values.map((value) => value / length);
}

function getIdentityQuaternionXYZW() {
    return [0, 0, 0, 1];
}

function isIdentityQuaternionXYZW(quaternion) {
    const normalizedQuaternion = normalizeQuaternionXYZW(quaternion);
    if (!normalizedQuaternion) {
        return false;
    }

    return Math.abs(normalizedQuaternion[0]) <= 1e-6
        && Math.abs(normalizedQuaternion[1]) <= 1e-6
        && Math.abs(normalizedQuaternion[2]) <= 1e-6
        && Math.abs(normalizedQuaternion[3] - 1) <= 1e-6;
}

function convertQuaternionWXYZtoXYZW(quaternion) {
    if (!Array.isArray(quaternion) || quaternion.length < 4) {
        return null;
    }

    return normalizeQuaternionXYZW([quaternion[1], quaternion[2], quaternion[3], quaternion[0]]);
}

function applyQuaternionXYZWToSample(sample, quaternion) {
    const normalizedQuaternion = normalizeQuaternionXYZW(quaternion);
    if (!sample || !normalizedQuaternion) {
        return null;
    }

    const [qx, qy, qz, qw] = normalizedQuaternion;
    const qConjX = -qx;
    const qConjY = -qy;
    const qConjZ = -qz;
    const qConjW = qw;
    const vx = Number(sample.x || 0);
    const vy = Number(sample.y || 0);
    const vz = Number(sample.z || 0);
    const tx = qw * vx + qy * vz - qz * vy;
    const ty = qw * vy + qz * vx - qx * vz;
    const tz = qw * vz + qx * vy - qy * vx;
    const tw = -qx * vx - qy * vy - qz * vz;
    const rx = tw * qConjX + tx * qConjW + ty * qConjZ - tz * qConjY;
    const ry = tw * qConjY + ty * qConjW + tz * qConjX - tx * qConjZ;
    const rz = tw * qConjZ + tz * qConjW + tx * qConjY - ty * qConjX;

    return {
        time: Number(sample.time || 0),
        x: rx,
        y: ry,
        z: rz,
        total: Math.hypot(rx, ry, rz),
    };
}

function multiplyQuaternionsXYZW(leftQuaternion, rightQuaternion) {
    const left = normalizeQuaternionXYZW(leftQuaternion);
    const right = normalizeQuaternionXYZW(rightQuaternion);
    if (!left && !right) {
        return null;
    }
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }

    const [lx, ly, lz, lw] = left;
    const [rx, ry, rz, rw] = right;

    return normalizeQuaternionXYZW([
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
        lw * rw - lx * rx - ly * ry - lz * rz,
    ]);
}

function applyQuaternionWXYZToSample(sample, quaternion) {
    if (!sample || !Array.isArray(quaternion) || quaternion.length < 4) {
        return null;
    }

    const w = Number(quaternion[0]);
    const x = Number(quaternion[1]);
    const y = Number(quaternion[2]);
    const z = Number(quaternion[3]);
    if (![w, x, y, z].every(Number.isFinite)) {
        return null;
    }

    const magnitude = Math.hypot(w, x, y, z);
    if (magnitude < 1e-12) {
        return null;
    }

    const nw = w / magnitude;
    const nx = x / magnitude;
    const ny = y / magnitude;
    const nz = z / magnitude;
    const vx = Number(sample.x || 0);
    const vy = Number(sample.y || 0);
    const vz = Number(sample.z || 0);
    const tx = 2 * (ny * vz - nz * vy);
    const ty = 2 * (nz * vx - nx * vz);
    const tz = 2 * (nx * vy - ny * vx);
    const rx = vx + nw * tx + (ny * tz - nz * ty);
    const ry = vy + nw * ty + (nz * tx - nx * tz);
    const rz = vz + nw * tz + (nx * ty - ny * tx);

    return {
        time: Number(sample.time || 0),
        x: rx,
        y: ry,
        z: rz,
        total: Math.hypot(rx, ry, rz),
    };
}

    function getGravityCutVectorSample(gravityMagnitude) {
        const normalizedGravity = Number.isFinite(gravityMagnitude) && gravityMagnitude > 0 ? gravityMagnitude : 1000;

        if (currentOrientationMode === 3) {
            return {
                time: 0,
                x: 0,
                y: 0,
                z: 0,
                total: 0,
            };
        }

        const gravityVector = {
            time: 0,
            x: 0,
            y: 0,
            z: -normalizedGravity,
            total: normalizedGravity,
        };

        if (currentOrientationMode === 0) {
            return gravityVector;
        }

        const adjustmentQuaternion = getViewportAdjustmentQuaternionXYZW();
        if (!adjustmentQuaternion || isIdentityQuaternionXYZW(adjustmentQuaternion)) {
            return gravityVector;
        }

        return applyQuaternionXYZWToSample(gravityVector, adjustmentQuaternion) || gravityVector;
    }

    function applyGravityCutToSample(sample, gravityMagnitude, gravityVector = null) {
    if (!sample) {
        return null;
    }

    const normalizedGravity = Number.isFinite(gravityMagnitude) && gravityMagnitude > 0 ? gravityMagnitude : 1000;
        const resolvedGravityVector = gravityVector || getGravityCutVectorSample(normalizedGravity);
        const gravityX = Number(resolvedGravityVector?.x || 0);
        const gravityY = Number(resolvedGravityVector?.y || 0);
        const gravityZ = Number(resolvedGravityVector?.z ?? -normalizedGravity);
        const x = Number(sample.x || 0) - gravityX;
        const y = Number(sample.y || 0) - gravityY;
        const z = Number(sample.z || 0) - gravityZ;

    return {
        time: Number(sample.time || 0),
        x,
        y,
        z,
        total: Math.hypot(x, y, z),
    };
}

function applyAccelCalibrationScale(sample, scale = currentAccelCalibrationScale) {
    if (!sample) {
        return null;
    }

    const normalizedScale = sanitizeAccelCalibrationScale(scale);
    if (Math.abs(normalizedScale - 1) <= 1e-6) {
        return sample;
    }

    const x = Number(sample.x || 0) * normalizedScale;
    const y = Number(sample.y || 0) * normalizedScale;
    const z = Number(sample.z || 0) * normalizedScale;

    return {
        time: Number(sample.time || 0),
        x,
        y,
        z,
        total: Math.hypot(x, y, z),
    };
}

function applyReferenceToSample(sample, referenceState) {
    if (!sample || !referenceState) {
        return null;
    }

    const x = Number(sample.x || 0) - Number(referenceState.x || 0);
    const y = Number(sample.y || 0) - Number(referenceState.y || 0);
    const z = Number(sample.z || 0) - Number(referenceState.z || 0);

    return {
        time: Number(sample.time || 0),
        x,
        y,
        z,
        total: Math.hypot(x, y, z),
    };
}

function getViewportGravityMagnitude() {
    if (Number.isFinite(tempgravity) && tempgravity > 0) {
        return tempgravity;
    }

    return 1000;
}

function getViewportBaseQuaternionXYZW() {
    if (currentOrientationMode === 2) {
        return normalizeQuaternionXYZW(calibrationMemory[1]) || convertQuaternionWXYZtoXYZW(ausrichtung);
    }

    if (currentOrientationMode === 1) {
        return convertQuaternionWXYZtoXYZW(ausrichtung) || normalizeQuaternionXYZW(calibrationMemory[1]);
    }

    return normalizeQuaternionXYZW(calibrationMemory[1]) || convertQuaternionWXYZtoXYZW(ausrichtung);
}

function getViewportAdjustmentQuaternionXYZW() {
    return normalizeQuaternionXYZW(accVectorViewport.getAdjustmentQuaternion?.()) || getIdentityQuaternionXYZW();
}

function getViewportEffectiveQuaternionXYZW() {
    if (currentOrientationMode === 0) {
        return null;
    }

    return multiplyQuaternionsXYZW(
        getViewportAdjustmentQuaternionXYZW(),
        getViewportBaseQuaternionXYZW(),
    ) || getViewportAdjustmentQuaternionXYZW();
}

function syncMotionWorkerTransform({ reset = false } = {}) {
    if (!ENABLE_MOTION_VIEW) {
        return;
    }

    motionWorker.postMessage({
        type: 'transform',
        payload: {
            quaternion: getViewportEffectiveQuaternionXYZW(),
            active: currentOrientationMode !== 0,
            gravityMagnitudeMg: getViewportGravityMagnitude(),
            reset,
        },
    });
}

function syncViewportBaseQuaternion({ silent = true } = {}) {
    const baseQuaternion = getViewportBaseQuaternionXYZW() || getIdentityQuaternionXYZW();
    accVectorViewport.setBaseQuaternion(baseQuaternion, { silent, commit: false });
}

function syncViewportPostTransformQuaternion({ persistState = false, resetLiveBuffers = false } = {}) {
    decodeWorker.postMessage({
        type: 'postTransformQuaternion',
        payload: {
            quaternion: getIdentityQuaternionXYZW(),
        }
    });

    if (resetLiveBuffers) {
        resetOrientationLiveBuffers();
    }

    if (persistState) {
        persistCalibrationCookie();
    }
}

function buildLiveAccelerationSample(rawSample, processedSample) {
    const raw = rawSample || processedSample || null;
    if (!raw) {
        return null;
    }

    if (currentOrientationMode === 0) {
        return processedSample || raw;
    }

    const calibratedSample = buildViewportBaseAccelerationSample(raw) || processedSample || raw;
    if (gravityCutEnabled) {
        const gravityMagnitude = getViewportGravityMagnitude();
        const gravityVector = getGravityCutVectorSample(gravityMagnitude);
        return applyGravityCutToSample(calibratedSample, gravityMagnitude, gravityVector) || calibratedSample;
    }

    return calibratedSample;
}

function buildMotionAccelerationSample(rawSample, processedSample) {
    const raw = rawSample || processedSample || null;
    if (!raw) {
        return null;
    }

    const gravityMagnitude = getViewportGravityMagnitude();
    const gravityVector = getGravityCutVectorSample(gravityMagnitude);
    const calibratedSample = buildViewportBaseAccelerationSample(raw) || processedSample || raw;
    return applyGravityCutToSample(calibratedSample, gravityMagnitude, gravityVector) || calibratedSample;
}

function buildLiveGyroSample(rawSample, processedSample) {
    const raw = rawSample || processedSample || null;
    if (!raw) {
        return null;
    }

    if (currentOrientationMode === 0) {
        return processedSample || raw;
    }

    const samples = buildViewportGyroSamples(raw, processedSample);
    return samples.calibrated || processedSample || raw;
}

function setOrientationCalibrationQuaternion(quaternion, { persistState = true } = {}) {
    const normalizedQuaternion = normalizeQuaternionXYZW(quaternion);
    calibrationMemory[1] = normalizedQuaternion ? normalizedQuaternion.slice() : null;
    decodeWorker.postMessage({
        type: 'calibdata',
        payload: {
            type: 2,
            quaternion: normalizedQuaternion,
        }
    });
    syncViewportBaseQuaternion({ silent: true });
    syncMotionWorkerTransform({ reset: true });

    if (persistState) {
        persistCalibrationCookie();
    }
}

function buildViewportBaseAccelerationSample(rawSample) {
    if (!rawSample) {
        return null;
    }

    if (currentOrientationMode === 3 && currentReferenceState) {
        const referenceSample = applyReferenceToSample(rawSample, currentReferenceState);
        const effectiveQuaternion = getViewportAdjustmentQuaternionXYZW();
        if (!referenceSample || isIdentityQuaternionXYZW(effectiveQuaternion)) {
            return referenceSample;
        }

        return applyQuaternionXYZWToSample(referenceSample, effectiveQuaternion) || referenceSample;
    }

    if (currentOrientationMode !== 0) {
        const effectiveQuaternion = getViewportEffectiveQuaternionXYZW();
        if (currentOrientationMode === 1) {
            if (effectiveQuaternion) {
                return applyQuaternionXYZWToSample(rawSample, effectiveQuaternion) || rawSample;
            }

            return applyQuaternionWXYZToSample(rawSample, ausrichtung) || rawSample;
        }

        if (effectiveQuaternion) {
            return applyAccelCalibrationScale(applyQuaternionXYZWToSample(rawSample, effectiveQuaternion)) || rawSample;
        }
    }

    return rawSample;
}

function buildViewportAccelerationSamples(rawSample, processedSample) {
    const raw = rawSample || processedSample || null;
    let calibrated = processedSample || raw;
    let calibratedCut = null;
    const gravityMagnitude = getViewportGravityMagnitude();
    const gravityVector = getGravityCutVectorSample(gravityMagnitude);

    if (raw) {
        calibrated = buildViewportBaseAccelerationSample(raw) || calibrated;
        calibratedCut = applyGravityCutToSample(calibrated, gravityMagnitude, gravityVector) || calibrated;
    }

    if (!calibratedCut) {
        calibratedCut = applyGravityCutToSample(processedSample || calibrated || raw, gravityMagnitude, gravityVector) || calibrated || raw;
    }

    return {
        raw,
        calibrated,
        calibratedCut,
    };
}

function buildViewportGyroSamples(rawSample, processedSample) {
    const raw = rawSample || processedSample || null;
    let calibrated = processedSample || raw;
    let calibratedCut = processedSample || raw;

    if (raw) {
        if (currentOrientationMode === 3 && currentReferenceState) {
            const referenceGyro = {
                time: Number(raw.time || 0),
                x: Number(raw.x || 0) - Number(currentReferenceState.gx || 0),
                y: Number(raw.y || 0) - Number(currentReferenceState.gy || 0),
                z: Number(raw.z || 0) - Number(currentReferenceState.gz || 0),
            };
            const adjustmentQuaternion = getViewportAdjustmentQuaternionXYZW();
            calibrated = isIdentityQuaternionXYZW(adjustmentQuaternion)
                ? referenceGyro
                : (applyQuaternionXYZWToSample(referenceGyro, adjustmentQuaternion) || referenceGyro);
            calibrated.total = Math.hypot(calibrated.x, calibrated.y, calibrated.z);
            calibratedCut = calibrated;
        } else if (currentOrientationMode === 1) {
            const effectiveQuaternion = getViewportEffectiveQuaternionXYZW();
            calibrated = effectiveQuaternion
                ? (applyQuaternionXYZWToSample(raw, effectiveQuaternion) || calibrated)
                : (applyQuaternionWXYZToSample(raw, ausrichtung) || calibrated);
            calibratedCut = calibrated;
        } else {
            const calibrationQuaternion = getViewportEffectiveQuaternionXYZW();
            if (calibrationQuaternion) {
                const worldSimpleGyroRaw = currentOrientationMode === 2 && currentWorldSimpleGyroState
                    ? {
                        time: Number(raw.time || 0),
                        x: Number(raw.x || 0) - Number(currentWorldSimpleGyroState.x || 0),
                        y: Number(raw.y || 0) - Number(currentWorldSimpleGyroState.y || 0),
                        z: Number(raw.z || 0) - Number(currentWorldSimpleGyroState.z || 0),
                    }
                    : raw;
                calibrated = applyQuaternionXYZWToSample(worldSimpleGyroRaw, calibrationQuaternion) || calibrated;
                calibratedCut = calibrated;
            }
        }
    }

    return {
        raw,
        calibrated,
        calibratedCut,
    };
}

if (alignLoadQuatBtn) {
    alignLoadQuatBtn.addEventListener('click', () => {
        syncViewportBaseQuaternion({ silent: true });
        accVectorViewport.setStatus('Basisrotation im Viewport synchronisiert');
    });
}

if (alignApplyQuatBtn) {
    alignApplyQuatBtn.addEventListener('click', () => {
        syncViewportBaseQuaternion({ silent: true });
        syncViewportPostTransformQuaternion({ persistState: true, resetLiveBuffers: true });
        accVectorViewport.setStatus('Live-Pipeline mit Zusatzrotation synchronisiert');
    });
}

function calculateStats(values) {
    if (!values || values.length === 0) {
        return { mean: 0, stdDev: 0, delta: 0 };
    }

    let sum = 0;
    let min = values[0];
    let max = values[0];

    for (let index = 0; index < values.length; index++) {
        const value = values[index];
        sum += value;
        if (value < min) min = value;
        if (value > max) max = value;
    }

    const mean = sum / values.length;
    let squaredDiffSum = 0;

    for (let index = 0; index < values.length; index++) {
        const diff = values[index] - mean;
        squaredDiffSum += diff * diff;
    }

    return {
        mean,
        stdDev: Math.sqrt(squaredDiffSum / values.length),
        delta: max - min,
    };
}

function getBufferAxisStats(buffer, fieldName) {
    return calculateStats(buffer.getFieldTypedArray(fieldName, buffer.length));
}

function buildCalibrationStatsTableHtml(accSampleCount, gyroSampleCount, accStats, gyroStats) {
    const rows = [
        { sensor: 'ACC', axis: 'X', stats: accStats.x, unit: 'mg' },
        { sensor: 'ACC', axis: 'Y', stats: accStats.y, unit: 'mg' },
        { sensor: 'ACC', axis: 'Z', stats: accStats.z, unit: 'mg' },
        { sensor: 'Gyro', axis: 'X', stats: gyroStats.x, unit: 'mdps' },
        { sensor: 'Gyro', axis: 'Y', stats: gyroStats.y, unit: 'mdps' },
        { sensor: 'Gyro', axis: 'Z', stats: gyroStats.z, unit: 'mdps' },
    ];

    const bodyRows = rows.map(row => `
        <tr>
            <td>${row.sensor}</td>
            <td>${row.axis}</td>
            <td>${row.stats.mean.toFixed(2)} ${row.unit}</td>
            <td>${row.stats.stdDev.toFixed(2)} ${row.unit}</td>
            <td>${row.stats.delta.toFixed(2)} ${row.unit}</td>
        </tr>
    `).join('');

    return `
        <div class="calibration-summary">
            <div class="calibration-summary-meta">
                <span>ACC Samples: ${accSampleCount}</span>
                <span>Gyro Samples: ${gyroSampleCount}</span>
            </div>
            <table class="calibration-summary-table">
                <thead>
                    <tr>
                        <th>Sensor</th>
                        <th>Achse</th>
                        <th>Mittel</th>
                        <th>StdAbw</th>
                        <th>Delta</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
    `;
}

function buildSingleSensorStatsTableHtml(sensorLabel, sampleCount, stats, unit) {
    const rows = [
        { axis: 'X', stats: stats.x },
        { axis: 'Y', stats: stats.y },
        { axis: 'Z', stats: stats.z },
    ];

    const bodyRows = rows.map(row => `
        <tr>
            <td>${sensorLabel}</td>
            <td>${row.axis}</td>
            <td>${row.stats.mean.toFixed(2)} ${unit}</td>
            <td>${row.stats.stdDev.toFixed(2)} ${unit}</td>
            <td>${row.stats.delta.toFixed(2)} ${unit}</td>
        </tr>
    `).join('');

    return `
        <div class="calibration-summary">
            <div class="calibration-summary-meta">
                <span>${sensorLabel} Samples: ${sampleCount}</span>
            </div>
            <table class="calibration-summary-table">
                <thead>
                    <tr>
                        <th>Sensor</th>
                        <th>Achse</th>
                        <th>Mittel</th>
                        <th>StdAbw</th>
                        <th>Delta</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
    `;
}



const accelRangeDD2 = new UniDropdown(document.getElementById('accelRangeDD2'), {
    type: 'select',
    label: 'Acc Range',
    items: [
        { value: 2, label: "±2g" },
        { value: 4, label: "±4g" },
        { value: 8, label: "±8g" },
        { value: 16, label: "±16g" },
    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            ACCELRANGE: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});
const accelSampleRateDD2 = new UniDropdown(document.getElementById('accelSampleRateDD2'), {
    type: 'select',
    label: 'Sample Rate',
    items: [
        { value: 0, label: "OFF" },
        { value: 125, label: "12.5 Hz" },
        { value: 26, label: "26 Hz" },
        { value: 52, label: "52 Hz" },
        { value: 104, label: "104 Hz" },
        { value: 208, label: "208 Hz" },
        { value: 416, label: "416 Hz" },
        { value: 833, label: "833 Hz" },
        { value: 1660, label: "1660 Hz" },
        { value: 3330, label: "3330 Hz" },
        { value: 6660, label: "6660 Hz" }
    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            ACCELSAMPLERATE: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});
const accelFilterDD2 = new UniDropdown(document.getElementById('accelFilterDD2'), {
    type: 'select',
    label: 'Accel Filter',
    items: [
        { value: "OFF", label: "OFF" },
        { value: "LOWPASS", label: "LOWPASS" },
        { value: "HIGHPASS1", label: "HIGHPASS 1" },
        { value: "HIGHPASS2", label: "HIGHPASS 2" },

    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            ACCELFILTER: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});
const gyroRangeDD2 = new UniDropdown(document.getElementById('gyroRangeDD2'), {
    type: 'select',
    label: 'Gyro Range',
    items: [
        { value: 125, label: "±125°/s" },
        { value: 250, label: "±250°/s" },
        { value: 500, label: "±500°/s" },
        { value: 1000, label: "±1000°/s" },
        { value: 2000, label: "±2000°/s" },
    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            GYRORANGE: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});
const gyroSampleRateDD2 = new UniDropdown(document.getElementById('gyroSampleRateDD2'), {
    type: 'select',
    label: 'Gyro Sample Rate',
    items: [
        { value: 0, label: "OFF" },
        { value: 125, label: "12.5 Hz" },
        { value: 26, label: "26 Hz" },
        { value: 52, label: "52 Hz" },
        { value: 104, label: "104 Hz" },
        { value: 208, label: "208 Hz" },
        { value: 416, label: "416 Hz" },
        { value: 833, label: "833 Hz" },
        { value: 1660, label: "1660 Hz" },
        { value: 3330, label: "3330 Hz" },
        { value: 6660, label: "6660 Hz" }
    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            GYROSAMPLERATE: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});
const gyroFilterDD2 = new UniDropdown(document.getElementById('gyroFilterDD2'), {
    type: 'select',
    label: 'Gyro Filter',
    items: [
        { value: "OFF", label: "OFF" },
        { value: "LOWPASS", label: "LOWPASS" },
        { value: "HIGHPASS1", label: "HIGHPASS 1" },
        { value: "HIGHPASS2", label: "HIGHPASS 2" },

    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            GYROFILTER: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});
const tempSampleRateDD2 = new UniDropdown(document.getElementById('tempSampleRateDD2'), {
    type: 'select',
    label: 'Temp Samplerate',
    items: [
        { value: "0", label: "OFF" },
        { value: "1", label: "1.6 Hz" },
        { value: "2", label: "12.5 Hz" },
        { value: "3", label: "52 Hz" },

    ],
    onChange: (value, label) => {
        // Aktuelle Einstellungen in ein JSON-Objekt umwandeln
        const settingsJSON = JSON.stringify({
            TEMPSAMPLERATE: value
        });
        // Nachricht an den WebSocket-Worker senden
        wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
        console.log('Ausgewählt:', value, label);
    }
});


// LIVECHARTSETTINGS









// === Globale Variablen ===
let SAMPLE_RATE = 6600;
const MAX_SAMPLES = 10000;

/* // RINGPUFFER
const chartData = [
  new RingBuffer(MAX_SAMPLES, Float64Array),  // Zeitstempel
  new RingBuffer(MAX_SAMPLES, Float32Array),  // X
  new RingBuffer(MAX_SAMPLES, Float32Array),  // Y
  new RingBuffer(MAX_SAMPLES, Float32Array)   // Z
];

// PERFO UPDATES

const pendingChartData = [
  new RingBuffer(MAX_SAMPLES, Float64Array),  // Zeitstempel
  new RingBuffer(MAX_SAMPLES, Float32Array),  // X
  new RingBuffer(MAX_SAMPLES, Float32Array),  // Y
  new RingBuffer(MAX_SAMPLES, Float32Array)   // Z
];


const TempChartData  = [
  new RingBuffer(MAX_SAMPLES, Float64Array),  // Zeitstempel
  new RingBuffer(MAX_SAMPLES, Float32Array),  // X
  new RingBuffer(MAX_SAMPLES, Float32Array),  // Y
  new RingBuffer(MAX_SAMPLES, Float32Array)   // Z
]; */

const chartData = [[], [], [], []]; // time, x, y, z
//const ChartData = [[], []]; // time, temperature

//let updateIntervalMs = 30; // Startwert (etwa 33 FPS)
let chartUpdateTimer = null;

let lastTimestamp = 0;
let currentTemperature = 0;
let temp = 0;
let paused = false;
let autoScroll = true;
let pausedLastTimestamp = 0;
let panOffset = 0;
let currentTimeRange = 5;
let samplesReceived = 0;
let lastRateCheck = performance.now();
let isRecording = false;
let recordedAccRows = [];
let recordedGyroRows = [];

let SamplesPerSecond = 0;
let samplecount = 0;
let totaltimeforcount = 0;
let tts = 0.0;
let fts = 0.0;
let lts = 0.0;

function formatRecordedValue(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function createAccRecordingRow(sample) {
    return [
        formatMicrosecondsToHMS(sample.time, 6),
        sample.time,
        formatRecordedValue(sample.x),
        formatRecordedValue(sample.y),
        formatRecordedValue(sample.z),
    ];
}

function createGyroRecordingRow(sample) {
    return [
        formatMicrosecondsToHMS(sample.time, 6),
        sample.time,
        formatRecordedValue(sample.x),
        formatRecordedValue(sample.y),
        formatRecordedValue(sample.z),
    ];
}

function downloadRecordedCsv(isIntermediate = false) {
    if (!recordedAccRows.length && !recordedGyroRows.length) {
        return false;
    }

    const downloadBtn = document.getElementById("downloadBtn");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "_");
    const suffix = isIntermediate ? `_part${String(filePartIndex).padStart(3, '0')}` : "";

    function getActiveQuaternion() {
        if (typeof calibrationMemory !== 'undefined' && Array.isArray(calibrationMemory[1]) && calibrationMemory[1].length === 4) {
            return calibrationMemory[1];
        }
        if (typeof ausrichtung !== 'undefined' && ausrichtung && ausrichtung.some(v => v !== 0)) {
            return ausrichtung;
        }
        return [0, 0, 0, 1];
    }
    const activeQuat = getActiveQuaternion();
    const quatString = activeQuat.map(v => Number(v).toFixed(4)).join(", ");
    
    // Store full local date string captured at the START of the recording
    const recordingDateStr = window.currentRecordingDateStr || new Date().toLocaleString('de-DE');

    if (recordedAccRows.length > 0) {
        const headerInfoAcc = `"# Gesamtquaternion: [${quatString}]"\n"# Recording Date: [${recordingDateStr}]"\n`;
        const headerAcc = ACC_CSV_HEADERS.join(",");
        const csvAcc = `${headerInfoAcc}${headerAcc}\n${recordedAccRows.map((row) => row.join(",")).join("\n")}`;
        const blobAcc = new Blob([csvAcc], { type: "text/csv" });
        const urlAcc = URL.createObjectURL(blobAcc);
        const anchorAcc = document.createElement("a");
        anchorAcc.href = urlAcc;
        anchorAcc.download = `recording_${timestamp}${suffix}_acc.csv`;
        anchorAcc.click();
        URL.revokeObjectURL(urlAcc);
    }

    if (recordedGyroRows.length > 0) {
        const headerInfoGyro = `"# Gesamtquaternion: [${quatString}]"\n"# Recording Date: [${recordingDateStr}]"\n`;
        const headerGyro = GYRO_CSV_HEADERS.join(",");
        const csvGyro = `${headerInfoGyro}${headerGyro}\n${recordedGyroRows.map((row) => row.join(",")).join("\n")}`;
        const blobGyro = new Blob([csvGyro], { type: "text/csv" });
        const urlGyro = URL.createObjectURL(blobGyro);
        const anchorGyro = document.createElement("a");
        anchorGyro.href = urlGyro;
        anchorGyro.download = `recording_${timestamp}${suffix}_gyro.csv`;
        anchorGyro.click();
        URL.revokeObjectURL(urlGyro);
    }

    if (isIntermediate) {
        filePartIndex += 1;
        recordedAccRows = [];
        recordedGyroRows = [];
    } else if (downloadBtn) {
        downloadBtn.style.display = "none";
    }

    return true;
}

// Chart-Zoom-Einstellungen
let yRanges = [
    { zoom: 1, pan: 0 },
    { zoom: 1, pan: 0 },
    { zoom: 1, pan: 0 }
];

// IMUPLOT
let plot = null;


// Initiale (leere) Arrays mit gewünschter Länge
const plN = 20;
const pltimes = new Float32Array(plN); // oder []
const plxs = new Float32Array(plN);
const plys = new Float32Array(plN);
const plzs = new Float32Array(plN);

const traces = [
    {
        x: [2, 3, 4, 5],

        y: [16, 5, 11, 9],

        mode: 'lines',
        line: { color: 'red', width: 1.25 },
    },
    {
        x: Array.from(pltimes),
        y: Array.from(plys),
        mode: 'lines',
        name: 'Y',
        line: { color: 'green', width: 1 }
    },
    {
        x: Array.from(pltimes),
        y: Array.from(plzs),
        mode: 'lines',
        name: 'Z',
        line: { color: 'blue' }
    }
];

const layout = {
    title: 'XYZ-Daten vs. Zeit',
    xaxis: { title: 'Zeit' },
    yaxis: { title: 'Messwert' }
};

//Plotly.newPlot('tester', traces, layout);



// FFT PLOT

//let fftWorker = null;updat
let fftPlot = null;
let rmsPlot = null;
let gyroFftPlot = null;
let gyroRmsPlot = null;


// === Web Workers ===
const wsWorker = new Worker("ws-worker.js");
window.wsWorker = wsWorker; // Export globally for Replay Manager
const decodeWorker = new Worker("decode-worker2.js");
const accFilterWorker = new Worker('filter-worker.js');
const gyroFilterWorker = new Worker('filter-worker.js');
const downsamplingWorker = ENABLE_FUSION_PIPELINE ? new Worker('downsampling-worker.js') : createNoopWorker();
const fusionWorker = ENABLE_FUSION_PIPELINE ? new Worker('fusion-worker5.js') : createNoopWorker();
let bootOverlayReadyTimer = null;
const TELEMETRY_PANEL_HIDDEN_KEY = 'telemetryPanelHidden';
const TELEMETRY_TOOLTIPS = {
    telemetryWsState: 'Aktueller Zustand der WebSocket-Verbindung zwischen Browser und ESP. Alles ausser "verbunden" bedeutet, dass keine Live-Daten mehr ankommen.',
    telemetryActiveClients: 'Anzahl der aktuell am ESP registrierten WebSocket-Clients. Fuer dein Live-Setup ist 1 der Normalfall.',
    telemetrySensorPackets: 'Rohpakete pro Sekunde, die der ESP vom Sensorpfad liest. Faellt der Wert deutlich, ist die Erfassung oder Weitergabe am Limit.',
    telemetryFramesPerSecond: 'WebSocket-Nutzdatenframes pro Sekunde, die im Browser ankommen. Mehr Frames bedeuten geringere Latenz, aber auch mehr Protokoll-Overhead.',
    telemetryWsErrors: 'Asynchrone Sendefehler pro Sekunde auf ESP-Seite. Werte ueber 0 zeigen Backpressure, Speicherknappheit oder Socket-Probleme.',
    telemetryRawBytes: 'Rohdatenrate am Browser-Eingang. Hilft beim Abgleich, ob die effektive Transportlast zum Sensorstrom passt.',
    telemetryFrameLimit: 'Aktuelle adaptive Obergrenze fuer Pakete pro WebSocket-Frame. Sinkt der Wert, reduziert der ESP aktiv die Framegroesse unter Druck.',
    telemetryInflightWs: 'Noch nicht fertig abgearbeitete WebSocket-Sendejobs im ESP. Dauerhaft > 0 bedeutet, dass der Netzwerkpfad hinterherlaeuft.',
    telemetryCpuLoad: 'Grobe CPU-Auslastung des ESP ueber alle aktiven Tasks. Werte nahe 100% lassen kaum Reserve fuer Peaks und koennen Jitter verstaerken.',
    telemetryCpuTemp: 'Interne Chiptemperatur. Hoehere Last und WLAN-Verkehr treiben diesen Wert nach oben; dauerhaft hohe Temperaturen koennen Instabilitaet beguenstigen.',
    telemetryFreeHeap: 'Aktuell frei verfuegbarer interner 8-Bit-Heap. Dieser Speicher ist fuer viele zeitkritische Allokationen wichtiger als der gesamte nominelle Heap.',
    telemetryMinHeap: 'Niedrigster jemals beobachteter freier interner Heap seit Boot. Ein sehr kleiner Wert zeigt, wie knapp das System im Peak bereits war.',
    telemetryLargestHeap: 'Groesster zusammenhaengender freier interner Heap-Block. Ist dieser klein, leidet das System eher an Fragmentierung als an absolutem Speichermangel.',
    telemetryPsramTotal: 'Physisch erkanntes PSRAM. Das ist die Gesamtkapazitaet, nicht automatisch der als Heap verfuegbare Anteil.',
    telemetryFreePsram: 'Aktuell freier PSRAM-Heap. Wenn hier trotz erkanntem PSRAM 0 B steht, ist PSRAM meist nicht als Heap-Caps-Allocator eingebunden oder komplett belegt.',
    telemetryMinPsram: 'Niedrigster jemals beobachteter freier PSRAM-Heap seit Boot. Hilft zu sehen, ob externe Reserven in Lastspitzen verbraucht wurden.',
    telemetryLargestPsram: 'Groesster zusammenhaengender freier PSRAM-Block. Ein guter Indikator dafuer, ob groessere externe Puffer noch allokierbar sind.',
    telemetryDrops: 'Vom ESP bewusst verworfene Rohdaten pro Sekunde, um Rueckstau zu begrenzen. Werte > 0 bedeuten, dass Stabilitaet vor Vollstaendigkeit priorisiert wird.',
    telemetryBacklogPeak: 'Groesster beobachteter Rueckstau im Stream-Puffer. Hohe Peaks deuten auf kurzfristige Transport- oder Verarbeitungsengpaesse hin.',
};
const telemetryElements = {
    panel: document.getElementById('telemetryPanel'),
    toggle: document.getElementById('telemetryToggle'),
    wsState: document.getElementById('telemetryWsState'),
    activeClients: document.getElementById('telemetryActiveClients'),
    sensorPackets: document.getElementById('telemetrySensorPackets'),
    framesPerSecond: document.getElementById('telemetryFramesPerSecond'),
    wsErrors: document.getElementById('telemetryWsErrors'),
    rawBytes: document.getElementById('telemetryRawBytes'),
    frameLimit: document.getElementById('telemetryFrameLimit'),
    inflightWs: document.getElementById('telemetryInflightWs'),
    cpuLoad: document.getElementById('telemetryCpuLoad'),
    cpuTemp: document.getElementById('telemetryCpuTemp'),
    freeHeap: document.getElementById('telemetryFreeHeap'),
    minHeap: document.getElementById('telemetryMinHeap'),
    largestHeap: document.getElementById('telemetryLargestHeap'),
    psramTotal: document.getElementById('telemetryPsramTotal'),
    freePsram: document.getElementById('telemetryFreePsram'),
    minPsram: document.getElementById('telemetryMinPsram'),
    largestPsram: document.getElementById('telemetryLargestPsram'),
    drops: document.getElementById('telemetryDrops'),
    backlogPeak: document.getElementById('telemetryBacklogPeak'),
};
const telemetryState = {
    wsState: 'offline',
    activeClients: 0,
    sensorPackets: 0,
    framesPerSecond: 0,
    wsErrors: 0,
    rawBytes: 0,
    frameLimitPackets: 0,
    inflightWs: 0,
    cpuLoad: -1,
    cpuTemp: Number.NaN,
    freeHeap: 0,
    minHeap: 0,
    largestHeap: 0,
    psramAvailable: false,
    psramTotal: 0,
    freePsram: 0,
    minPsram: 0,
    largestPsram: 0,
    drops: 0,
    backlogPeak: 0,
    recentFrames: 0,
    recentBytes: 0,
};

function setBootOverlayState(state, message, hint) {
    window.__espBootOverlay?.setState?.(state, message, hint);
}

function formatTelemetryBytes(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
        return '0 B';
    }

    if (bytesPerSecond >= 1024 * 1024) {
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB`;
    }

    if (bytesPerSecond >= 1024) {
        return `${(bytesPerSecond / 1024).toFixed(1)} KB`;
    }

    return `${Math.round(bytesPerSecond)} B`;
}

function formatTelemetryMetricBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '-';
    }

    return formatTelemetryBytes(bytes);
}

function setTelemetrySeverity(element, severity) {
    if (!element) {
        return;
    }

    element.classList.remove('is-warn', 'is-danger');
    if (severity === 'warn') {
        element.classList.add('is-warn');
    }
    if (severity === 'danger') {
        element.classList.add('is-danger');
    }
}

function setTelemetryTooltip(element, text) {
    if (!element || !text) {
        return;
    }

    element.title = text;
    element.setAttribute('aria-label', text);
    const keyElement = element.previousElementSibling;
    if (keyElement?.classList?.contains('telemetry-key')) {
        keyElement.title = text;
        keyElement.setAttribute('aria-label', text);
    }
}

function applyTelemetryTooltips() {
    Object.entries(TELEMETRY_TOOLTIPS).forEach(([elementId, text]) => {
        setTelemetryTooltip(document.getElementById(elementId), text);
    });
}

function applyTelemetryPanelHidden(hidden, { persistState = true } = {}) {
    telemetryElements.panel?.classList.toggle('is-hidden', hidden);
    if (telemetryElements.toggle) {
        telemetryElements.toggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
        telemetryElements.toggle.setAttribute('title', hidden ? 'Telemetrie einblenden' : 'Telemetrie ausblenden');
        telemetryElements.toggle.setAttribute('aria-label', hidden ? 'Telemetrie einblenden' : 'Telemetrie ausblenden');
    }

    if (persistState) {
        persistAppSettingsCookie();
    }
}

function renderTelemetry() {
    if (telemetryElements.wsState) {
        telemetryElements.wsState.textContent = telemetryState.wsState;
    }
    if (telemetryElements.activeClients) {
        telemetryElements.activeClients.textContent = String(telemetryState.activeClients);
    }
    if (telemetryElements.sensorPackets) {
        telemetryElements.sensorPackets.textContent = String(telemetryState.sensorPackets);
    }
    if (telemetryElements.framesPerSecond) {
        telemetryElements.framesPerSecond.textContent = String(telemetryState.framesPerSecond);
    }
    if (telemetryElements.wsErrors) {
        telemetryElements.wsErrors.textContent = String(telemetryState.wsErrors);
    }
    if (telemetryElements.rawBytes) {
        telemetryElements.rawBytes.textContent = `${formatTelemetryBytes(telemetryState.rawBytes)}/s`;
    }
    if (telemetryElements.frameLimit) {
        telemetryElements.frameLimit.textContent = telemetryState.frameLimitPackets > 0 ? `${telemetryState.frameLimitPackets} pkt` : '-';
    }
    if (telemetryElements.inflightWs) {
        telemetryElements.inflightWs.textContent = String(telemetryState.inflightWs);
        setTelemetrySeverity(telemetryElements.inflightWs, telemetryState.inflightWs >= 3 ? 'warn' : null);
    }
    if (telemetryElements.cpuLoad) {
        telemetryElements.cpuLoad.textContent = telemetryState.cpuLoad >= 0 ? `${telemetryState.cpuLoad}%` : '-';
        setTelemetrySeverity(telemetryElements.cpuLoad, telemetryState.cpuLoad >= 90 ? 'danger' : telemetryState.cpuLoad >= 75 ? 'warn' : null);
    }
    if (telemetryElements.cpuTemp) {
        telemetryElements.cpuTemp.textContent = Number.isFinite(telemetryState.cpuTemp) ? `${telemetryState.cpuTemp.toFixed(1)} C` : '-';
        setTelemetrySeverity(telemetryElements.cpuTemp, telemetryState.cpuTemp >= 80 ? 'danger' : telemetryState.cpuTemp >= 70 ? 'warn' : null);
    }
    if (telemetryElements.freeHeap) {
        telemetryElements.freeHeap.textContent = formatTelemetryMetricBytes(telemetryState.freeHeap);
        setTelemetrySeverity(telemetryElements.freeHeap, telemetryState.freeHeap < 8 * 1024 ? 'danger' : telemetryState.freeHeap < 16 * 1024 ? 'warn' : null);
    }
    if (telemetryElements.minHeap) {
        telemetryElements.minHeap.textContent = formatTelemetryMetricBytes(telemetryState.minHeap);
        setTelemetrySeverity(telemetryElements.minHeap, telemetryState.minHeap < 2 * 1024 ? 'danger' : telemetryState.minHeap < 8 * 1024 ? 'warn' : null);
    }
    if (telemetryElements.largestHeap) {
        telemetryElements.largestHeap.textContent = formatTelemetryMetricBytes(telemetryState.largestHeap);
        setTelemetrySeverity(telemetryElements.largestHeap, telemetryState.largestHeap < 4 * 1024 ? 'danger' : telemetryState.largestHeap < 8 * 1024 ? 'warn' : null);
    }
    if (telemetryElements.psramTotal) {
        telemetryElements.psramTotal.textContent = telemetryState.psramAvailable ? formatTelemetryMetricBytes(telemetryState.psramTotal) : 'n/a';
    }
    if (telemetryElements.freePsram) {
        telemetryElements.freePsram.textContent = telemetryState.psramAvailable ? formatTelemetryMetricBytes(telemetryState.freePsram) : 'n/a';
        setTelemetrySeverity(telemetryElements.freePsram, telemetryState.psramAvailable && telemetryState.freePsram < 128 * 1024 ? 'warn' : null);
    }
    if (telemetryElements.minPsram) {
        telemetryElements.minPsram.textContent = telemetryState.psramAvailable ? formatTelemetryMetricBytes(telemetryState.minPsram) : 'n/a';
    }
    if (telemetryElements.largestPsram) {
        telemetryElements.largestPsram.textContent = telemetryState.psramAvailable ? formatTelemetryMetricBytes(telemetryState.largestPsram) : 'n/a';
    }
    if (telemetryElements.drops) {
        telemetryElements.drops.textContent = String(telemetryState.drops);
        setTelemetrySeverity(telemetryElements.drops, telemetryState.drops > 0 ? 'warn' : null);
    }
    if (telemetryElements.backlogPeak) {
        telemetryElements.backlogPeak.textContent = formatTelemetryMetricBytes(telemetryState.backlogPeak);
        setTelemetrySeverity(telemetryElements.backlogPeak, telemetryState.backlogPeak > 8 * 1024 ? 'warn' : null);
    }
}

function updateTelemetry(patch = {}) {
    Object.assign(telemetryState, patch);
    renderTelemetry();
}

window.setInterval(() => {
    updateTelemetry({
        framesPerSecond: telemetryState.recentFrames,
        rawBytes: telemetryState.recentBytes,
        recentFrames: 0,
        recentBytes: 0,
    });
}, 1000);

telemetryElements.toggle?.addEventListener('click', () => {
    const willHide = !telemetryElements.panel?.classList.contains('is-hidden');
    applyTelemetryPanelHidden(willHide);
});

applyTelemetryTooltips();
renderTelemetry();

const initialAppSettings = readAppSettingsCookieState()?.state || {
    telemetryPanelHidden: true,
    gravityCutEnabled: false,
    customWsHost: null,
};

persistedCustomWsHost = sanitizeCustomWsHost(initialAppSettings.customWsHost);
gravityCutEnabled = Boolean(initialAppSettings.gravityCutEnabled);
applyTelemetryPanelHidden(initialAppSettings.telemetryPanelHidden, { persistState: false });

function clearBootOverlayReadyTimer() {
    if (bootOverlayReadyTimer !== null) {
        window.clearTimeout(bootOverlayReadyTimer);
        bootOverlayReadyTimer = null;
    }
}

function scheduleBootOverlayReadyFallback() {
    clearBootOverlayReadyTimer();
    bootOverlayReadyTimer = window.setTimeout(() => {
        setBootOverlayState(
            'ready',
            'Dashboard bereit',
            'WebSocket verbunden.'
        );
        bootOverlayReadyTimer = null;
    }, 1200);
}



// === Init ===
document.addEventListener("DOMContentLoaded", () => {
    // Shutdown Overlay UI
    const sidebarShutdownBtn = document.getElementById("sidebarShutdownBtn");
    const shutdownOverlay = document.getElementById("shutdownConfirmOverlay");
    const shutdownYes = document.getElementById("shutdownConfirmYes");
    const shutdownNo = document.getElementById("shutdownConfirmNo");

    if (sidebarShutdownBtn && shutdownOverlay) {
        sidebarShutdownBtn.addEventListener("click", () => {
            shutdownOverlay.classList.add("is-visible");
        });
        shutdownNo.addEventListener("click", () => {
            shutdownOverlay.classList.remove("is-visible");
        });
        shutdownYes.addEventListener("click", () => {
            shutdownOverlay.classList.remove("is-visible");
            const payload = JSON.stringify({ COMMAND: "SHUTDOWN" });
            wsWorker.postMessage({ type: "send", msgContent: payload });
        });
    }

    setupFilterWorker();
    //initChart();
    //enableChartZoomAndPan();
    setupWSWorker();
    setupDecodeWorker();
    restoreAppSettingsFromCookie();
    restoreCalibrationFromCookie();
    setupUIListeners();
    connectWebSocket();
    startChartUpdates();
    initFFTChart();
    initRMSChart();
    initGyroFFTChart();
    initGyroRMSChart();
    setupRMSWorker()
    startRMSUpdates();
    setupGyroRMSWorker();
    startGyroRMSUpdates();
    setupFFTWorker();
    startFFTUpdates();
    setupGyroFFTWorker();
    startGyroFFTUpdates();

    if (typeof WaterfallRenderer !== 'undefined') {
        window.waterfallRenderer = new WaterfallRenderer('waterfallArea', 'waterfallCanvas', 'wf');
        window.gyroWaterfallRenderer = new WaterfallRenderer('gyroWaterfallArea', 'gyroWaterfallCanvas', 'gwf');
        
        // --- ACCELEROMETER WATERFALL SETUP ---
        const magFilter = document.getElementById('waterfallMagFilter');
        const magValue = document.getElementById('waterfallMagValue');
        const wfLblMagMax = document.getElementById('wfLblMagMax');
        if (magFilter && magValue) {
            magFilter.addEventListener('input', (e) => {
                magValue.textContent = e.target.value;
                if (wfLblMagMax) wfLblMagMax.textContent = e.target.value;
                if (window.waterfallRenderer) window.waterfallRenderer.setMaxMagnitude(parseInt(e.target.value, 10));
            });
            window.waterfallRenderer.setMaxMagnitude(parseInt(magFilter.value, 10));
        }

        const themeDrop = document.getElementById('waterfallTheme');
        if (themeDrop) {
            themeDrop.addEventListener('change', (e) => {
                if (window.waterfallRenderer) window.waterfallRenderer.setTheme(e.target.value);
            });
        }
        
        const speedFilter = document.getElementById('waterfallSpeed');
        const speedValue = document.getElementById('waterfallSpeedValue');
        if (speedFilter && speedValue) {
            speedFilter.addEventListener('input', (e) => {
                speedValue.textContent = e.target.value;
                if (window.waterfallRenderer) window.waterfallRenderer.setScrollSpeed(parseInt(e.target.value, 10));
            });
        }

        const maxHzFilter = document.getElementById('waterfallMaxHz');
        const maxHzValue = document.getElementById('waterfallMaxHzValue');
        if (maxHzFilter && maxHzValue) {
            maxHzFilter.addEventListener('input', (e) => maxHzValue.textContent = e.target.value);
        }

        // --- GYROSCOPE WATERFALL SETUP ---
        const gMagFilter = document.getElementById('gyroWaterfallMagFilter');
        const gMagValue = document.getElementById('gyroWaterfallMagValue');
        const gwfLblMagMax = document.getElementById('gwfLblMagMax');
        if (gMagFilter && gMagValue) {
            gMagFilter.addEventListener('input', (e) => {
                gMagValue.textContent = e.target.value;
                if (gwfLblMagMax) gwfLblMagMax.textContent = e.target.value;
                if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.setMaxMagnitude(parseInt(e.target.value, 10));
            });
            window.gyroWaterfallRenderer.setMaxMagnitude(parseInt(gMagFilter.value, 10));
        }

        const gThemeDrop = document.getElementById('gyroWaterfallTheme');
        if (gThemeDrop) {
            gThemeDrop.addEventListener('change', (e) => {
                if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.setTheme(e.target.value);
            });
        }
        
        const gSpeedFilter = document.getElementById('gyroWaterfallSpeed');
        const gSpeedValue = document.getElementById('gyroWaterfallSpeedValue');
        if (gSpeedFilter && gSpeedValue) {
            gSpeedFilter.addEventListener('input', (e) => {
                gSpeedValue.textContent = e.target.value;
                if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.setScrollSpeed(parseInt(e.target.value, 10));
            });
        }

        const gMaxHzFilter = document.getElementById('gyroWaterfallMaxHz');
        const gMaxHzValue = document.getElementById('gyroWaterfallMaxHzValue');
        if (gMaxHzFilter && gMaxHzValue) {
            gMaxHzFilter.addEventListener('input', (e) => gMaxHzValue.textContent = e.target.value);
        }
    }

    const filterDrawer = document.getElementById('filterDrawer');
    const filterDrawerToggle = document.getElementById('filterDrawerToggle');
    filterDrawerToggle?.addEventListener('click', () => {
        filterDrawer?.classList.toggle('open');
        const isOpen = filterDrawer?.classList.contains('open');
        filterDrawer?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });

    const livechartsGrid = document.getElementById('livechartsGrid');
    const chartLayoutToggle = document.getElementById('chartLayoutToggle');
    const fftRmsGrid = document.getElementById('fftRmsGrid');
    const fftRmsLayoutToggle = document.getElementById('fftRmsLayoutToggle');
    const gyroFftRmsGrid = document.getElementById('gyroFftRmsGrid');
    const gyroFftRmsLayoutToggle = document.getElementById('gyroFftRmsLayoutToggle');
    const updateChartLayoutToggle = () => {
        const isSideBySide = livechartsGrid?.classList.contains('is-side-by-side');
        if (chartLayoutToggle) {
            chartLayoutToggle.textContent = isSideBySide ? 'Untereinander' : 'Nebeneinander';
            chartLayoutToggle.setAttribute('aria-pressed', isSideBySide ? 'true' : 'false');
        }
    };
    const updateFftRmsLayoutToggle = () => {
        const isSideBySide = fftRmsGrid?.classList.contains('is-side-by-side');
        if (fftRmsLayoutToggle) {
            fftRmsLayoutToggle.textContent = isSideBySide ? 'Untereinander' : 'Nebeneinander';
            fftRmsLayoutToggle.setAttribute('aria-pressed', isSideBySide ? 'true' : 'false');
        }
    };
    const updateGyroFftRmsLayoutToggle = () => {
        const isSideBySide = gyroFftRmsGrid?.classList.contains('is-side-by-side');
        if (gyroFftRmsLayoutToggle) {
            gyroFftRmsLayoutToggle.textContent = isSideBySide ? 'Untereinander' : 'Nebeneinander';
            gyroFftRmsLayoutToggle.setAttribute('aria-pressed', isSideBySide ? 'true' : 'false');
        }
    };
    updateChartLayoutToggle();
    updateFftRmsLayoutToggle();
    updateGyroFftRmsLayoutToggle();
    chartLayoutToggle?.addEventListener('click', () => {
        livechartsGrid?.classList.toggle('is-side-by-side');
        updateChartLayoutToggle();
        updateLiveChartPanelHeights();
        requestAnimationFrame(() => {
            chart?.setSize(getSize());
            gyroChart?.setSize(getGyroChartSize());
        });
    });
    fftRmsLayoutToggle?.addEventListener('click', () => {
        fftRmsGrid?.classList.toggle('is-side-by-side');
        updateFftRmsLayoutToggle();
        updateFftRmsPanelHeights();
        requestAnimationFrame(() => {
            fftPlot?.setSize(getFftChartSize());
            rmsPlot?.setSize(getRmsChartSize());
        });
    });
    gyroFftRmsLayoutToggle?.addEventListener('click', () => {
        gyroFftRmsGrid?.classList.toggle('is-side-by-side');
        updateGyroFftRmsLayoutToggle();
        updateGyroFftRmsPanelHeights();
        requestAnimationFrame(() => {
            gyroFftPlot?.setSize(getGyroFftChartSize());
            gyroRmsPlot?.setSize(getGyroRmsChartSize());
        });
    });




    // 👉 Hier der Sidebar-Toggle-Code:
    document.getElementById('sidebarToggle').addEventListener('click', function () {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('expanded');
        updateLiveChartPanelHeights();
        updateFftRmsPanelHeights();
        updateGyroFftRmsPanelHeights();
    });

    updateLiveChartPanelHeights();
    updateFftRmsPanelHeights();
    updateGyroFftRmsPanelHeights();

    window.addEventListener('dashboardTabChanged', (event) => {
        if (event.detail?.sectionId === 'fftChartarea') {
            updateFftRmsPanelHeights();
            requestAnimationFrame(() => {
                fftPlot?.setSize(getFftChartSize());
                rmsPlot?.setSize(getRmsChartSize());
            });
            return;
        }

        if (event.detail?.sectionId === 'gyroFftChartarea') {
            updateGyroFftRmsPanelHeights();
            requestAnimationFrame(() => {
                gyroFftPlot?.setSize(getGyroFftChartSize());
                gyroRmsPlot?.setSize(getGyroRmsChartSize());
            });
        }
        
        if (window.waterfallRenderer) {
            if (event.detail?.sectionId === 'waterfallArea') {
                const canvas = document.getElementById('waterfallCanvas');
                if (canvas) {
                    const rect = canvas.parentElement.getBoundingClientRect();
                    window.waterfallRenderer.resize(rect.width, rect.height);
                }
            }
        }

        if (window.gyroWaterfallRenderer) {
            if (event.detail?.sectionId === 'gyroWaterfallArea') {
                const canvas = document.getElementById('gyroWaterfallCanvas');
                if (canvas) {
                    const rect = canvas.parentElement.getBoundingClientRect();
                    window.gyroWaterfallRenderer.resize(rect.width, rect.height);
                }
            }
        }
    });
    
    window.addEventListener('resize', () => {
        if (window.waterfallRenderer && window.waterfallRenderer.active) {
            const canvas = document.getElementById('waterfallCanvas');
            if (canvas) {
                const rect = canvas.parentElement.getBoundingClientRect();
                window.waterfallRenderer.resize(rect.width, rect.height);
            }
        }

        if (window.gyroWaterfallRenderer && window.gyroWaterfallRenderer.active) {
            const canvas = document.getElementById('gyroWaterfallCanvas');
            if (canvas) {
                const rect = canvas.parentElement.getBoundingClientRect();
                window.gyroWaterfallRenderer.resize(rect.width, rect.height);
            }
        }
    });

});

// SLIDER ACTION

const fpsSlider = document.getElementById('fpsSlider');
if (fpsSlider) {
    fpsSlider.addEventListener('input', function () {
        const fps = parseInt(this.value, 10);
        const fpsValueLabel = document.getElementById('fpsValue');
        if (fpsValueLabel) fpsValueLabel.textContent = fps;
        updateIntervalMs = Math.round(1000 / fps);
        startChartUpdates(); // setzt neuen Intervall
    });
}

// === WebSocket Worker einrichten ===
function setupWSWorker() {
    wsWorker.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === "data") {
            if (payload instanceof ArrayBuffer) {
                telemetryState.recentFrames += 1;
                telemetryState.recentBytes += payload.byteLength || 0;
                renderTelemetry();
                clearBootOverlayReadyTimer();
                setBootOverlayState(
                    'ready',
                    'Dashboard bereit',
                    'Sensordaten empfangen.'
                );
                // ArrayBuffer als Transferable weitergeben
                decodeWorker.postMessage(payload, [payload]);
            }
        } else if (type === "connected") {
            console.log("WebSocket verbunden.", payload?.url || '');
            updateTelemetry({ wsState: 'verbunden' });
            setBootOverlayState(
                'loading',
                'WebSocket verbunden',
                payload?.url ? `Sensordaten werden initialisiert. ${payload.url}` : 'Sensordaten werden initialisiert.'
            );
            scheduleBootOverlayReadyFallback();
        } else if (type === "espStats") {
            updateTelemetry({
                activeClients: payload?.activeClients ?? telemetryState.activeClients,
                sensorPackets: payload?.sensorPackets ?? telemetryState.sensorPackets,
                wsErrors: payload?.wsSendErrors ?? telemetryState.wsErrors,
                frameLimitPackets: payload?.frameLimitPackets ?? telemetryState.frameLimitPackets,
                inflightWs: payload?.inflightWs ?? telemetryState.inflightWs,
                cpuLoad: payload?.cpuLoadPct ?? telemetryState.cpuLoad,
                cpuTemp: payload?.cpuTempC ?? telemetryState.cpuTemp,
                freeHeap: payload?.freeHeap ?? telemetryState.freeHeap,
                minHeap: payload?.minFreeHeap ?? telemetryState.minHeap,
                largestHeap: payload?.largestHeapBlock ?? telemetryState.largestHeap,
                psramAvailable: Boolean(payload?.psramAvailable ?? telemetryState.psramAvailable),
                psramTotal: payload?.psramTotal ?? telemetryState.psramTotal,
                freePsram: payload?.freePsram ?? telemetryState.freePsram,
                minPsram: payload?.minFreePsram ?? telemetryState.minPsram,
                largestPsram: payload?.largestPsramBlock ?? telemetryState.largestPsram,
                drops: payload?.streamDroppedBytes ?? telemetryState.drops,
                backlogPeak: payload?.streamBacklogPeak ?? telemetryState.backlogPeak,
            });
        } else if (type === "workerStats") {
            if (typeof payload?.forwardedBinaryFrames === 'number') {
                updateTelemetry({ framesPerSecond: payload.forwardedBinaryFrames });
            }
        } else if (type === "closed") {
            clearBootOverlayReadyTimer();
            console.warn("WebSocket getrennt.", payload || '');
            updateTelemetry({ wsState: 'getrennt', activeClients: 0 });
            const closeHint = payload?.url
                ? `${payload.url} (code=${payload.code ?? 'n/a'}${payload?.reason ? `, reason=${payload.reason}` : ''})`
                : 'Verbindung zum ESP wird erneut aufgebaut.';
            setBootOverlayState(
                'loading',
                'WebSocket getrennt',
                closeHint
            );
        } else if (type === "error") {
            clearBootOverlayReadyTimer();
            console.error("WebSocket-Fehler:", payload);
            updateTelemetry({ wsState: 'fehler' });
            const errorHint = typeof payload === 'string'
                ? payload
                : [payload?.message, payload?.url, payload?.readyState != null ? `readyState=${payload.readyState}` : null]
                    .filter(Boolean)
                    .join(' | ');
            setBootOverlayState(
                'loading',
                'WebSocket-Fehler',
                errorHint || 'Verbindung zum ESP fehlgeschlagen.'
            );
        }
    };
}



let chartUpdateRunning = false;
let lastChartUpdate = 0;
let updateIntervalMs = 50; // 20 FPS

window.startChartUpdates = function() {
    function updateLoop(now) {
        if (!chartUpdateRunning) return;
        if (window.isOfflineReplayMode) {
            requestAnimationFrame(updateLoop);
            return;
        }

        if (now - lastChartUpdate >= updateIntervalMs) {
            updateDashboard();
            lastChartUpdate = now;
        }

        requestAnimationFrame(updateLoop);
    }

    chartUpdateRunning = true;
    lastChartUpdate = performance.now();
    requestAnimationFrame(updateLoop);
}





let latestFusionData = null;
downsamplingWorker.postMessage({ type: 'init' });
downsamplingWorker.onmessage = (e) => {
fusionWorker.postMessage(e.data);
   // console.log(e.data);
};

// FusionWorker → Main-Thread
fusionWorker.onmessage = (event) => {
const message = event.data;

if (!message || typeof message !== 'object') {
    return;
}

if (message.type === 'ack' || message.type === 'state') {
    return;
}

if (message.type === 'calibrated') {
    console.info('Fusion-Kalibrierung abgeschlossen.');
    return;
}

if (!message.tiltHeadingRoll || !message.accWorld) {
    return;
}

//console.log("FUSION UPDATE" + now);
//console.log(event.data);







setBootOverlayState(
    'ready',
    'Dashboard bereit',
    'Sensorstream aktiv.'
);

decodeWorker.postMessage({type: "calibdata", payload: {type: 1, quaternion: message.quaternion}});

ausrichtung = Array.isArray(message.quaternion) ? message.quaternion.slice() : Array.from(message.quaternion || []);
if (currentOrientationMode === 1) {
    syncViewportBaseQuaternion({ silent: true });
}

};




// === Decode Worker einrichten ===
window.processSensorBatch = function(data) {
    const { acc, gyro, temp, info, acccalib, accraw, gyroraw, gyrocalib } = data;

        if (ENABLE_MOTION_VIEW && ((accraw && accraw.length > 0) || (gyroraw && gyroraw.length > 0))) {
            const motionAccSamples = Array.isArray(accraw) && accraw.length > 0
                ? accraw.map((sample, index) => buildMotionAccelerationSample(sample, acc?.[index]) || acc?.[index] || sample)
                : (Array.isArray(acc) ? acc.map((sample) => buildMotionAccelerationSample(sample, sample) || sample) : []);
            motionWorker.postMessage({
                type: 'batch',
                payload: {
                    acc: motionAccSamples,
                    gyro: Array.isArray(gyroraw) ? gyroraw : [],
                },
            });
        }


        if (accraw && accraw.length > 0) {
            if (ENABLE_FUSION_PIPELINE) {
                downsamplingWorker.postMessage({
                    type: "batch",
                    sensor: "acc",
                    data: accraw.map(s => ({ x: s.x, y: s.y, z: s.z, time: s.time }))
                });
            }

            for (let sample of accraw) {
                accRawBuffer.push([sample.time, sample.x, sample.y, sample.z, Math.hypot(sample.x, sample.y, sample.z)]);
                
                if (window.sonificationEnabled) {
                    let totalVibration = Math.hypot(sample.x, sample.y, sample.z);
                    window.audioHighPass = 0.995 * (window.audioHighPass + totalVibration - window.audioPrevZ);
                    window.audioPrevZ = totalVibration;
                    let out = window.audioHighPass / 50.0;
                    if (out > 1.0) out = 1.0; else if (out < -1.0) out = -1.0;
                    window.audioRingBuffer[window.audioWriteIdx] = out;
                    window.audioWriteIdx = (window.audioWriteIdx + 1) % window.audioRingBuffer.length;
                }

                if (referenceCaptureActive) {
                    accBufferCALIB.push([sample.x, sample.y, sample.z]);
                }
            }
        }

        if (gyroraw && gyroraw.length > 0) {
            if (ENABLE_FUSION_PIPELINE) {
                downsamplingWorker.postMessage({
                    type: "batch",
                    sensor: "gyro",
                    data: gyroraw.map(s => ({ x: s.x, y: s.y, z: s.z, time: s.time }))
                });
            }

            for (let sample of gyroraw) {
                gyroRawBuffer.push([sample.time, sample.x, sample.y, sample.z]);
                if (referenceCaptureActive) {
                    gyroBufferCALIB.push([sample.x, sample.y, sample.z]);
                }
            }
        }

        if (gyrocalib && gyrocalib.length > 0 && worldSimpleGyroCaptureActive) {
            for (const sample of gyrocalib) {
                gyroBufferCALIB.push([sample.x, sample.y, sample.z]);
            }
        }

        if (acccalib && acccalib.length > 0) {

            // Rohdaten pushen einmal komplett
            for (let sample of acccalib) {

                //console.log("ACCCALIB BEKOMMEN: " + sample.x + " Samples");
                accBufferCALIB.push([sample.x, sample.y, sample.z]);
                

            }
        }
        if (acc && acc.length > 0) {
            const batchTimes = new Float64Array(acc.length);
            const batchXs = new Float32Array(acc.length);
            const batchYs = new Float32Array(acc.length);
            const batchZs = new Float32Array(acc.length);
            const batchTotals = new Float32Array(acc.length);
            
/*         downsamplingWorker.postMessage({
            type: "batch",
            sensor: "acc",
            data: acc.map(s => ({ x: s.x, y: s.y, z: s.z, time: s.time }))
            }); */
            
            // Rohdaten pushen einmal komplett
            for (let index = 0; index < acc.length; index++) {
                const sample = buildLiveAccelerationSample(accraw?.[index], acc[index]) || acc[index];

                accBuffer.push([sample.time, sample.x, sample.y, sample.z, sample.total]);
                batchTimes[index] = sample.time;
                batchXs[index] = sample.x;
                batchYs[index] = sample.y;
                batchZs[index] = sample.z;
                batchTotals[index] = sample.total;
                
                // --- RECORDING LOGIC ADDED HERE ---
                if (isRecording) {
                    recordedAccRows.push(createAccRecordingRow(sample));
                    
                    if (recordedAccRows.length >= MAX_RECORDED_ROWS) {
                        console.log("Max rows reached (ACC). Triggering intermediate download.");
                        downloadRecordedCsv(true);
                    }
                }
                
                //downsamplingWorker.postMessage({ type: 'acc', payload: { x: sample.x, y: sample.y, z: sample.z, time: sample.time } });
                //mwrmsworker.postMessage({ type: 'acc', payload: { x: acc.x, y: acc.y, z: acc.z } })

                const newSample = { x: sample.x, y: sample.y, z: sample.z, time: sample.time };
                


//mwrmsworker.postMessage({ type: 'acc', payload: [newSample] })
            }

            if (accFilterEnabled) {
                dispatchStreamingFilterBatch('acc', {
                    times: batchTimes,
                    xs: batchXs,
                    ys: batchYs,
                    zs: batchZs,
                    totals: batchTotals,
                });
            }
        }
        if (gyro && gyro.length > 0) {
            const batchTimes = new Float64Array(gyro.length);
            const batchXs = new Float32Array(gyro.length);
            const batchYs = new Float32Array(gyro.length);
            const batchZs = new Float32Array(gyro.length);

/*                 downsamplingWorker.postMessage({
                type: "batch",
                sensor: "gyro",
                data: gyro.map(s => ({ x: s.x, y: s.y, z: s.z, time: s.time }))
                }); */

            for (let index = 0; index < gyro.length; index++) {
                const sample = buildLiveGyroSample(gyroraw?.[index], gyro[index]) || gyro[index];
                // sample ist { time, x, y, z }
                // push als Array oder Objekt in deinen MultiRingBuffer
                gyroBuffer.push([sample.time, sample.x, sample.y, sample.z]);
                batchTimes[index] = sample.time;
                batchXs[index] = sample.x;
                batchYs[index] = sample.y;
                batchZs[index] = sample.z;

                if (isRecording) {
                    recordedGyroRows.push(createGyroRecordingRow(sample));

                    if (recordedGyroRows.length >= MAX_RECORDED_ROWS) {
                        console.log("Max rows reached (GYRO). Triggering intermediate download.");
                        downloadRecordedCsv(true);
                    }
                }

//                downsamplingWorker.postMessage({ type: 'gyro', payload: { x: sample.x, y: sample.y, z: sample.z, time: sample.time } });
                       const newSample = { x: sample.x, y: sample.y, z: sample.z, time: sample.time };
//mwrmsworker.postMessage({ type: 'gyro', payload: [newSample] })
            }

            if (gyroFilterEnabled) {
                dispatchStreamingFilterBatch('gyro', {
                    times: batchTimes,
                    xs: batchXs,
                    ys: batchYs,
                    zs: batchZs,
                });
            }
        }

        if (temp && temp.length > 0) {
            for (let sample of temp) {
                // sample ist { time, value }
                // push als Array oder Objekt in deinen MultiRingBuffer
                tempBuffer.push([sample.time, sample.value]);
            }
        }

        if (info && info.length > 0) {
            info.forEach(entry => {
                console.log("INFO BEKOMMEN: " + entry.type + "  " + entry.value);
                switch (entry.type) {
                    case "ACCELRATE":
                        accelSampleRateDD2.setValue(entry.value, true);
                        break;
                    case "ACCELRANGE":
                        accelRangeDD2.setValue(entry.value, true);
                        break;
                    case "ACCELFILTER":
                        accelFilterDD2.setValue(entry.value, true);
                        break;

                    case "GYROFILTER":
                        gyroFilterDD2.setValue(entry.value, true);
                        break;
                    case "GYROSAMPLERATE":
                        gyroSampleRateDD2.setValue(entry.value, true);
                        break;

                    case "GYRORANGE":
                        gyroRangeDD2.setValue(entry.value, true);
                        break;
                    case "TEMPSAMPLERATE":
                        tempSampleRateDD2.setValue(entry.value, true);
                        break;


                    default:
                        console.warn("Unbekannte Config-SubID");
                }
            });
        }
};

function setupDecodeWorker() {
    decodeWorker.onmessage = (event) => {
        window.processSensorBatch(event.data);
    };
}







// === WebSocket starten ===
function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams(window.location.search);
    const customWsHost = sanitizeCustomWsHost(params.get("ws")) || persistedCustomWsHost;
    const previewHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
    const defaultEspHost = '192.168.4.1';
    const hasExplicitDevPort = window.location.port !== '' && !['80', '443'].includes(window.location.port);
    const isLocalPreview = previewHosts.has(window.location.hostname)
        || (hasExplicitDevPort && window.location.hostname !== defaultEspHost);

    let url;
    if (customWsHost) {
        const normalizedHost = customWsHost.replace(/^wss?:\/\//, "").replace(/\/$/, "");
        url = `${protocol}//${normalizedHost}/ws`;
    } else if (isLocalPreview) {
        url = `ws://${defaultEspHost}/ws`;
    } else {
        url = `${protocol}//${location.host}/ws`;
    }

    console.log("[WS] Verbinde zu WebSocket:", url);
    wsWorker.postMessage({ type: "connect", wsServerUrl: url });
}

// === Sample verarbeiten ===
function handleDecodedSample(sample) {
    // const { id, timestamp, value1, value2, value3, timestamp_raw, value1_raw, value2_raw, value3_raw } = sample;

    const { id, timestamp, value1, value2, value3 } = sample;
    // console.log(`[SAMPLE] ID: ${id}, Timestamp: ${timestamp.toFixed(5)}s, Values: [${value1.toFixed(2)}, ${value2.toFixed(2)}, ${value3.toFixed(2)}]`);

    if (id === 1 || id === 2) {
        chartData[0].push(timestamp);
        chartData[1].push(value1);
        chartData[2].push(value2);
        chartData[3].push(value3);
        samplesReceived++;
    }

    if (id === 3) {
        temp = value1;
    }



    if (isRecording) {
        if (id === 1) {
            recordedAccRows.push(createAccRecordingRow({ time: timestamp, x: value1, y: value2, z: value3 }));
            if (recordedAccRows.length >= MAX_RECORDED_ROWS) downloadRecordedCsv(true);
        } else if (id === 2) {
            recordedGyroRows.push(createGyroRecordingRow({ time: timestamp, x: value1, y: value2, z: value3 }));
            if (recordedGyroRows.length >= MAX_RECORDED_ROWS) downloadRecordedCsv(true);
        }
    } // DEBUGGING: Removed console.log
    else {
        // console.log("handleDecodedSample: not recording. isRecording=", isRecording);
        if (Math.random() < 0.01) console.log("handleDecodedSample active. isRecording:", isRecording);
    }


    lastTimestamp = timestamp;

    // Puffergröße begrenzen
    if (chartData[0].length > MAX_SAMPLES) {
        for (let i = 0; i < chartData.length; i++) chartData[i].shift();
    }
}


// UPDATE UI

function updateDashboard() {



    //console.log("[DASHBOARD] Update started, accBuffer size:", accBuffer.size);
    let lastAccSample = accBuffer.getLast();
    let lastAccRawSample = accRawBuffer.getLast();
    let lastGyroSample = gyroBuffer.getLast();
    let Samplerate1 = 0.0;
    let totalSeconds1 = 0;

    //console.log("accBuffer", accBuffer.length);
    //console.log("gyroBuffer", gyroBuffer.length);
    //console.log("tempBuffer", tempBuffer.length);


    if (accBuffer.length > 0) {
        Samplerate1 = Math.round(estimateRecentSampleRateHz(accBuffer) * 100) / 100;

        if (tempBuffer.length > 0) {
            let lastTempSample = tempBuffer.getLast();
            currentTemperature = lastTempSample.temperature;
        }
        else {
            console.log("Temperaturpuffer leer");
            currentTemperature = 0;
        }

        if (accBuffer.length > 0) {

            totalSeconds1 = lastAccSample.time * 0.000001;
            const formattedTime = formatMicrosecondsToHMS(lastAccSample.time, 2);
            document.getElementById("timestamp").textContent = formattedTime;


        }

        const smoothedSampleRate = getSmoothedFilterSampleRate(Samplerate1);
        if (shouldRefreshFilterSampleRate(smoothedSampleRate)) {
            currentSampleRate = smoothedSampleRate;
            lastFilterSampleRateUpdateAt = performance.now();
            if (accFilterUi) {
                accFilterUi.cutoffDropdown.setDisplayMultiplier(currentSampleRate / 2);
                accFilterUi.bandwidthDropdown.setDisplayMultiplier(currentSampleRate / 2);
                accFilterUi.sendSettings(false);
            }
            if (gyroFilterUi) {
                gyroFilterUi.cutoffDropdown.setDisplayMultiplier(currentSampleRate / 2);
                gyroFilterUi.bandwidthDropdown.setDisplayMultiplier(currentSampleRate / 2);
                gyroFilterUi.sendSettings(false);
            }
            console.log("[DASHBOARD] Neue Samplerate:", currentSampleRate);
        }
        // Temperatur: aus globaler Variable (da tempBuffer noch nicht implementiert)
        document.getElementById("temperature").textContent = currentTemperature.toFixed(2);
        document.getElementById("samplerate").textContent = Samplerate1.toFixed(2);
        document.getElementById("accX").textContent = lastAccSample.x.toFixed(1);
        document.getElementById("accY").textContent = lastAccSample.y.toFixed(1);
        document.getElementById("accZ").textContent = lastAccSample.z.toFixed(1);
        accVectorViewport.setAccelerationSamples(buildViewportAccelerationSamples(lastAccRawSample, lastAccSample));
        accVectorViewport.setGyroSamples(buildViewportGyroSamples(gyroRawBuffer.getLast(), lastGyroSample));
        if (lastGyroSample) {
            document.getElementById("gyroX").textContent = lastGyroSample.x.toFixed(1);
            document.getElementById("gyroY").textContent = lastGyroSample.y.toFixed(1);
            document.getElementById("gyroZ").textContent = lastGyroSample.z.toFixed(1);
        }

        const accLatestTimestamp = lastAccSample.time;
        const gyroLatestTimestamp = lastGyroSample?.time || accLatestTimestamp;
        const desiredRangeUs = displayDurationSeconds * 1000000;
        let currentSharedWindow = getCurrentSharedXWindow();

        const shouldInitializeSharedWindow = !currentSharedWindow ||
            !Number.isFinite(currentSharedWindow.min) ||
            !Number.isFinite(currentSharedWindow.max) ||
            Math.abs(currentSharedWindow.max - accLatestTimestamp) > desiredRangeUs * 5 ||
            (currentSharedWindow.max - currentSharedWindow.min) < desiredRangeUs * 0.25;

        if (shouldInitializeSharedWindow && !paused) {
            setSharedXScale(
                accLatestTimestamp - desiredRangeUs,
                accLatestTimestamp,
                { preserveY: true, syncUi: false }
            );
            currentSharedWindow = getCurrentSharedXWindow();
        }

        const accMinTime = currentSharedWindow?.min ?? (accLatestTimestamp - desiredRangeUs);
        const gyroMinTime = currentSharedWindow?.min ?? (gyroLatestTimestamp - desiredRangeUs);
        const accMaxTime = currentSharedWindow?.max ?? accLatestTimestamp;
        const gyroMaxTime = currentSharedWindow?.max ?? gyroLatestTimestamp;






        // Plot aktualisieren
        if (chart && accChartVisible) {
            //console.log("[DASHBOARD] Updating plot...");
            // Für y-Achsen z.B. Felder extrahieren:

            lastTimestamp = lastAccSample.time;
            if (paused == true) { return };
            //autoScroll = true;

            currentTimeRange = displayDurationSeconds; // Sekunden

            if (accFilterEnabled) {
                const filteredWindow = computeFilteredWindowForDisplay('acc', accMinTime, accMaxTime);
                const yMinBefore = chart.scales.y.min;
                const yMaxBefore = chart.scales.y.max;
                chart.setData([filteredWindow.times, filteredWindow.xs, filteredWindow.ys, filteredWindow.zs, filteredWindow.totals]);
                window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: accLatestTimestamp } }));
                if (yMinBefore !== undefined && yMaxBefore !== undefined) {
                    chart.setScale("y", { min: yMinBefore, max: yMaxBefore });
                }
            } else {
                const { times, xs, ys, zs, totals } = getAccWindowData(displayDurationSeconds, accMinTime);
                const yMinBefore = chart.scales.y.min;
                const yMaxBefore = chart.scales.y.max;
                chart.setData([times, xs, ys, zs, totals]);

                window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: accLatestTimestamp } }));

                if (yMinBefore !== undefined && yMaxBefore !== undefined) {
                    chart.setScale("y", { min: yMinBefore, max: yMaxBefore });
                }
            }

        }

        if (gyroChart && gyroChartVisible && !gyroChartPaused && gyroBuffer.length > 0) {
            if (gyroFilterEnabled) {
                const gyroWindow = computeFilteredWindowForDisplay('gyro', gyroMinTime, gyroMaxTime);
                const gyroYMinBefore = gyroChart.scales.y.min;
                const gyroYMaxBefore = gyroChart.scales.y.max;
                gyroChart.setData([gyroWindow.times, gyroWindow.xs, gyroWindow.ys, gyroWindow.zs]);
                if (!accChartVisible && gyroWindow.times.length > 0) {
                    window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: gyroLatestTimestamp } }));
                }
                if (gyroYMinBefore !== undefined && gyroYMaxBefore !== undefined) {
                    gyroChart.setScale("y", { min: gyroYMinBefore, max: gyroYMaxBefore });
                }
            } else {
                const gyroWindow = getGyroWindowData(displayDurationSeconds, gyroMinTime);
                const gyroYMinBefore = gyroChart.scales.y.min;
                const gyroYMaxBefore = gyroChart.scales.y.max;
                gyroChart.setData([gyroWindow.times, gyroWindow.xs, gyroWindow.ys, gyroWindow.zs]);
                if (!accChartVisible && gyroWindow.times.length > 0) {
                    window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: gyroLatestTimestamp } }));
                }
                if (gyroYMinBefore !== undefined && gyroYMaxBefore !== undefined) {
                    gyroChart.setScale("y", { min: gyroYMinBefore, max: gyroYMaxBefore });
                }
            }
        }
    }





}










// ALTE VERSION
/* function updateDashboard() {
  if (chartData[0].length === 0) return;

  // Aktuellen Index berechnen (Ringpuffer-Logik)
    const lastIndex = (chartData[0].index + chartData[0].size - 1) % chartData[0].size;

    const totalSeconds = chartData[0].buffer[lastIndex] * 0.001;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formattedTime =
      (hours > 0 ? hours + ":" : "") +
      (hours > 0 ? String(minutes).padStart(2, '0') : minutes) + ":" +
      seconds.toFixed(2).padStart(5, '0');  // z.B. "05.23"

    // Ausgabe
    document.getElementById("timestamp").textContent = formattedTime;


  // Letzte Werte aus dem Ringpuffer holen
  //document.getElementById("timestamp").textContent = (chartData[0].buffer[lastIndex]*0.001).toFixed(1);
  document.getElementById("temperature").textContent = currentTemperature.toFixed(2);
  document.getElementById("accX").textContent = chartData[1].buffer[lastIndex].toFixed(1);
  document.getElementById("accY").textContent = chartData[2].buffer[lastIndex].toFixed(1);
  document.getElementById("accZ").textContent = chartData[3].buffer[lastIndex].toFixed(1);
  document.getElementById("samplerate").textContent = SamplesPerSecond.toFixed(2);

  // lastTimestamp aktualisieren
  lastTimestamp = chartData[0].buffer[lastIndex];

  // Datenvalidierung (nur gültigen Bereich prüfen!)
  for (let i = 0; i < chartData.length; i++) {
    let data = [];
    if (chartData[i].length < chartData[i].size) {
      data = Array.from(chartData[i].buffer.slice(0, chartData[i].length));
    } else {
      // vollen Ring in richtiger Reihenfolge zusammensetzen
      const part1 = chartData[i].buffer.slice(chartData[i].index);
      const part2 = chartData[i].buffer.slice(0, chartData[i].index);
      data = Array.from(part1).concat(Array.from(part2));
    }
    //if (!data.every(x => typeof x === "number" && !isNaN(x))) {
     // console.warn("Fehlerhafte Daten in chartData[" + i + "]: ", data);
    //}
  }

  // Samplerate nur einmal pro Sekunde updaten
  const now = performance.now();
  if (now - lastRateCheck >= 1000) {
    document.getElementById("samplerate").textContent = samplesReceived;
    samplesReceived = 0;
    lastRateCheck = now;
  }

  

  // Chart bekommt Snapshot per .toArray()
  if (plot) {
    plot.setData(chartData.map(buf => buf.toArray()));
    plot.redraw(false);
    if (!paused && autoScroll) {
      plot.setScale("x", [lastTimestamp - currentTimeRange*1000, lastTimestamp]);
    }
    plot.setScale("y", getYRange());
  }
} */



// === Chart-Initialisierung ===








// === Y-Achsenbereich berechnen ===
function getYRange() {
    return (u, seriesIdx) => {
        const baseRange = 2500;
        let { zoom, pan } = yRanges[0];  // für einfachen globalen Bereich für alle Serien
        let half = baseRange / zoom;
        return [pan - half, pan + half];
    };
}

// === UI Button-Events ===
function setupUIListeners() {
    const recordBtn = document.getElementById("recordBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const pauseBtn = document.getElementById("pauseBtn");
    const resetZoomBtn = document.getElementById("resetZoomBtn");
    const timeSlider = document.getElementById("timeSlider");
    const timeValue = document.getElementById("timeValue");

     // Initialize slider value
    if (timeSlider && timeValue) {
        timeSlider.value = displayDurationSeconds;
        timeValue.textContent = displayDurationSeconds;
        currentTimeRange = displayDurationSeconds;
    }


    const recBtn2 = document.getElementById("recBtn2");

    if (timeSlider) {
        timeSlider.addEventListener("input", () => {
        displayDurationSeconds = parseInt(timeSlider.value);
        if (timeValue) timeValue.textContent = displayDurationSeconds;
        currentTimeRange = displayDurationSeconds;

        const currentScale = getSharedXScale(chart);
        const anchorMax = currentScale && Number.isFinite(currentScale.max)
            ? currentScale.max
            : lastTimestamp;

        if (Number.isFinite(anchorMax) && anchorMax > 0) {
            setSharedXScale(
                anchorMax - displayDurationSeconds * 1000000,
                anchorMax,
                { preserveY: true, syncUi: true }
            );
        }
    });
    }

    function syncRecordingButtons() {
        const rmsRecordBtn = document.getElementById('rmsRecordBtn');
        const gyroRmsRecordBtn = document.getElementById('gyroRmsRecordBtn');

        if (recordBtn) {
            recordBtn.innerHTML = isRecording
                ? '<i class="fas fa-stop"></i> Stop'
                : '<i class="fas fa-circle"></i> Record';
            recordBtn.classList.toggle("active", isRecording);
        }

        if (!document.getElementById('recordingPulseStyle')) {
            const style = document.createElement('style');
            style.id = 'recordingPulseStyle';
            style.innerHTML = `
                @keyframes pulseRecordGradient {
                    0% { opacity: 0.85; }
                    50% { opacity: 0.15; }
                    100% { opacity: 0.85; }
                }
                .recording-overlay {
                    position: fixed;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    width: 120px;
                    background: linear-gradient(to right, transparent, rgba(255, 0, 0, 0.7));
                    pointer-events: none;
                    z-index: 9999;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    align-items: flex-end;
                    padding: 30px 15px;
                    box-sizing: border-box;
                    animation: pulseRecordGradient 1.5s infinite ease-in-out;
                }
                .recording-label-box {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: #ff3333;
                    font-family: 'Segoe UI', sans-serif;
                    font-weight: 900;
                    font-size: 20px;
                    text-shadow: 0 0 10px rgba(0,0,0,0.9);
                    letter-spacing: 2px;
                }
                .recording-circle {
                    width: 16px;
                    height: 16px;
                    background-color: red;
                    border-radius: 50%;
                    box-shadow: 0 0 8px red;
                }
            `;
            document.head.appendChild(style);
        }

        let recOverlay = document.getElementById('recordingOverlayDynamic');
        if (isRecording) {
            if (!recOverlay) {
                recOverlay = document.createElement('div');
                recOverlay.id = 'recordingOverlayDynamic';
                recOverlay.className = 'recording-overlay';
                recOverlay.innerHTML = `
                    <div class="recording-label-box"><div class="recording-circle"></div>REC</div>
                    <div class="recording-label-box"><div class="recording-circle"></div>REC</div>
                `;
                document.body.appendChild(recOverlay);
            }
        } else {
            if (recOverlay) {
                recOverlay.remove();
            }
        }
        document.body.classList.remove('recording-active-border'); // Cleanup legacy class

        if (recBtn2) {
            recBtn2.textContent = isRecording ? "⏹" : "🔴";
            recBtn2.classList.toggle("active", isRecording);
        }

        if (rmsRecordBtn) {
            rmsRecordBtn.innerHTML = isRecording ? '⏹' : '🔴';
            rmsRecordBtn.classList.toggle('active', isRecording);
        }

        if (gyroRmsRecordBtn) {
            gyroRmsRecordBtn.innerHTML = isRecording ? '⏹' : '🔴';
            gyroRmsRecordBtn.classList.toggle('active', isRecording);
        }
    }

    window.toggleRecording = function() {
        isRecording = !isRecording;

        if (isRecording) {
            console.log("toggleRecording: STARTING. recordedRows reset.");
            window.currentRecordingDateStr = new Date().toLocaleString('de-DE');
            recordedAccRows = [];
            recordedGyroRows = [];
            filePartIndex = 0;
            if (downloadBtn) {
                downloadBtn.style.display = "none";
            }
        } else if (recordedAccRows.length > 0 || recordedGyroRows.length > 0) {
            downloadRecordedCsv(false);
        }

        syncRecordingButtons();
    };

    if (recordBtn) {
        recordBtn.addEventListener("click", window.toggleRecording);
    }

    if (recBtn2) {
        recBtn2.addEventListener("click", window.toggleRecording);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
            downloadRecordedCsv(false);
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener("click", () => {
            paused = !paused;
            pauseBtn.classList.toggle("active", paused);
            pauseBtn.innerHTML = paused
                ? '<i class="fas fa-play"></i> Play'
                : '<i class="fas fa-pause"></i> Pause';

            if (paused) {
                pausedLastTimestamp = lastTimestamp;
            }
        });
    }

    if (resetZoomBtn) {
        resetZoomBtn.addEventListener("click", () => {
            yRanges.forEach((range) => {
                range.zoom = 1;
                range.pan = 0;
            });

            panOffset = 0;
            if (typeof window.setPanOffset === 'function') {
                window.setPanOffset(0);
            }

            currentTimeRange = displayDurationSeconds;

            if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
                setSharedXScale(
                    lastTimestamp - displayDurationSeconds * 1000000,
                    lastTimestamp,
                    { preserveY: false, syncUi: true }
                );
            }
        });
    }

    syncRecordingButtons();
}

function initFFTChart() {
    const fftHost = document.getElementById("fftChart");
    const fftLegendHost = document.getElementById("fftChartLegendHost");
    const fftSize = getFftChartSize();
    const fftWidth = Math.max(320, fftSize.width || Math.round(fftHost?.clientWidth || 800));
    const fftHeight = Math.max(250, fftSize.height || 500);

    const fftopts = {
        title: 'ACC FFT',
        width: fftWidth,
        height: fftHeight,
        scales: {
            x: {
                time: false,
                label: "Frequenz (Hz)",
            },
            y: {
                auto: true,
                label: "Magnitude"
            }
        },
        axes: [
            {
                stroke: () => dark ? "white" : "black"
            },
            {
                stroke: () => dark ? "white" : "black"
            },
        ],
        series: [
            { label: "Freq (Hz)" },
            {
                label: "Max Magnitude",
                stroke: null,
                width: 0,
                fill: "rgba(200,210,223,0.08)",
                points: { show: false }
            },
            {
                label: "Average Magnitude",
                stroke: "#FFD600",
                width: 2,
                fill: "rgba(255, 213, 0, 0.5)",
                points: { show: false }
            },
            {
                label: "Current Magnitude",
                stroke: "rgba(110,190,255,0.45)",
                width: 1,
                points: { show: false }
            },
        ],
        legend: {
            mount: (u, table) => {
                fftLegendHost?.replaceChildren(table);
            },
        },
    };

    fftPlot = new uPlot(fftopts, [[], [], [], []], fftHost);
    installManualLegendToggle(fftPlot, "fftChartLegendHost");
    updatePeakFrequencyBadge('fftPeakBadge', null, null);
}

function initRMSChart() {
    const rmsSize = getRmsChartSize();
    const rmsLegendHost = document.getElementById("rmsChartLegendHost");

    const rmsopts = {
        ...rmsSize,
        title: 'ACC RMS',
        width: Math.max(320, rmsSize.width || 800),
        height: Math.max(250, rmsSize.height || 500),
        scales: {
            x: {
                values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
            },
            y: { auto: true, range: (s, min, max) => [0, Math.max(250, (max == null ? 250 : max * 1.1))] }
        },
        axes: [
            {
                space: 100,
                scale: "x",
                label: "Zeit",
                grid: { show: true },
                values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
                stroke: "white"
            },
            {
                scale: "y",
                label: "Wert",
                grid: { show: true },
                ticks: {
                    format: v => v.toFixed(2)
                },
                stroke: "white",
            }
        ],
        series: [
            {label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 2) },
            { label: "Acc X (mg)", stroke: "#FFD600" },
            { label: "Acc Y (mg)", stroke: "#ec3030ff" },
            { label: "Acc Z (mg)", stroke: "#7a96e2ff" },
            { label: "Acc Total (mg)", stroke: "#14c53bff", fill: "rgba(20,197,59,0.2)" },
        ],
        cursor: {
            drag: { x: true, y: true, setScale: true }
        },
        legend: {
            mount: (u, table) => {
                rmsLegendHost?.replaceChildren(table);
            },
        },
    };

    rmsPlot = new uPlot(rmsopts, [[], [], [], [], []], document.getElementById("rmsChart"));
    installManualLegendToggle(rmsPlot, "rmsChartLegendHost");
    
    // Bind overlays immediately after chart is defined
    bindYAxisOverlay("rms-y-axis-overlay", rmsPlot, true);
    bindRmsXAxisOverlay("rms-x-axis-overlay", rmsPlot, false);




    /* 
    
    
    let rmsopts = {
        width: document.getElementById("fftChartarea").clientWidth,
        height: 250,
        scales: {
            x: {
                time: true,
                autoScroll: true,
                label: "Frequenz (Hz)",
                //range: (u, min, max) => [0, 3300],
            },
            y: {
                auto: true,
                range: (u, min, max) => [0, 1000],
                label: "Magnitude"
            }
        },
        axes: [
            {
                stroke: () => dark ? "white" : "black",
                //    grid: {
                //    	stroke: () => dark ? "white" : "black",
                //    }
            },
            {
                stroke: () => dark ? "white" : "black"
            },
        ],
        series: [


{ label: "Time (s)", },

            { // Average Magnitude – Hauptdarstellung: kräftig und gelb (Kontrast zu Blau)
                label: "RMS VALUE",
                stroke: "#FFD600",                // sattes, leuchtendes Gelb (deutlich auf dunklem Grund)
                width: 2.,
                fill: "rgba(255, 213, 0, 0.5)",      // gelbliche Fläche, leicht transparent
                points: { show: false }
            },

            { // Average Magnitude – Hauptdarstellung: kräftig und gelb (Kontrast zu Blau)
                label: "X",
                stroke: "#0051ffff",                // sattes, leuchtendes Gelb (deutlich auf dunklem Grund)
                width: 2.,      // gelbliche Fläche, leicht transparent
                points: { show: false }
            },

            { // Average Magnitude – Hauptdarstellung: kräftig und gelb (Kontrast zu Blau)
                label: "Y",
                stroke: "#1aca55ff",                // sattes, leuchtendes Gelb (deutlich auf dunklem Grund)
                width: 2.,      // gelbliche Fläche, leicht transparent
                points: { show: false }
            },

                        { // Average Magnitude – Hauptdarstellung: kräftig und gelb (Kontrast zu Blau)
                label: "Z",
                stroke: "#f16406ff",                // sattes, leuchtendes Gelb (deutlich auf dunklem Grund)
                width: 2.,      // gelbliche Fläche, leicht transparent
                points: { show: false }
            },


        ]
    }; */

}

function initGyroFFTChart() {
    const fftHost = document.getElementById('gyroFftChart');
    const gyroFftLegendHost = document.getElementById('gyroFftChartLegendHost');
    const fftSize = getGyroFftChartSize();
    const fftWidth = Math.max(320, fftSize.width || Math.round(fftHost?.clientWidth || 800));
    const fftHeight = Math.max(250, fftSize.height || 500);

    const fftopts = {
        title: 'Gyro FFT',
        width: fftWidth,
        height: fftHeight,
        scales: {
            x: {
                time: false,
                label: 'Frequenz (Hz)',
            },
            y: {
                auto: true,
                label: 'Magnitude'
            }
        },
        axes: [
            {
                stroke: () => dark ? 'white' : 'black'
            },
            {
                stroke: () => dark ? 'white' : 'black'
            },
        ],
        series: [
            { label: 'Freq (Hz)' },
            {
                label: 'Max Magnitude',
                stroke: null,
                width: 0,
                fill: 'rgba(200,210,223,0.08)',
                points: { show: false }
            },
            {
                label: 'Average Magnitude',
                stroke: '#4dd0e1',
                width: 2,
                fill: 'rgba(77,208,225,0.22)',
                points: { show: false }
            },
            {
                label: 'Current Magnitude',
                stroke: 'rgba(255,183,77,0.5)',
                width: 1,
                points: { show: false }
            },
        ],
        legend: {
            mount: (u, table) => {
                gyroFftLegendHost?.replaceChildren(table);
            },
        },
    };

    gyroFftPlot = new uPlot(fftopts, [[], [], [], []], fftHost);
    installManualLegendToggle(gyroFftPlot, 'gyroFftChartLegendHost');
    updatePeakFrequencyBadge('gyroFftPeakBadge', null, null);
}

function updatePeakFrequencyBadge(elementId, freqs, mags) {
    const badge = document.getElementById(elementId);
    if (!badge) {
        return;
    }

    if (!freqs || !mags || freqs.length === 0 || mags.length === 0) {
        badge.textContent = 'Peak -- Hz | Amp --';
        return;
    }

    let bestIndex = -1;
    let bestMagnitude = -Infinity;
    const startIndex = freqs.length > 1 ? 1 : 0;

    for (let index = startIndex; index < freqs.length && index < mags.length; index++) {
        const frequency = Number(freqs[index]);
        const magnitude = Number(mags[index]);
        if (!Number.isFinite(frequency) || !Number.isFinite(magnitude)) {
            continue;
        }

        if (magnitude > bestMagnitude) {
            bestMagnitude = magnitude;
            bestIndex = index;
        }
    }

    if (bestIndex < 0) {
        badge.textContent = 'Peak -- Hz | Amp --';
        return;
    }

    const peakFrequency = Number(freqs[bestIndex]);
    const peakMagnitude = Number(mags[bestIndex]);
    const formattedFrequency = peakFrequency >= 100
        ? peakFrequency.toFixed(0)
        : peakFrequency.toFixed(1);
    const formattedMagnitude = peakMagnitude >= 1000
        ? peakMagnitude.toFixed(0)
        : peakMagnitude.toFixed(1);
    badge.textContent = `Peak ${formattedFrequency} Hz | Amp ${formattedMagnitude}`;
}

function initGyroRMSChart() {
    const rmsSize = getGyroRmsChartSize();
    const gyroRmsLegendHost = document.getElementById('gyroRmsChartLegendHost');

    const rmsopts = {
        ...rmsSize,
        title: 'Gyro RMS',
        width: Math.max(320, rmsSize.width || 800),
        height: Math.max(250, rmsSize.height || 500),
        scales: {
            x: {
                values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
            },
            y: { auto: true, range: (s, min, max) => [0, Math.max(1.0, (max == null ? 1 : max * 1.1))] }
        },
        axes: [
            {
                space: 100,
                scale: 'x',
                label: 'Zeit',
                grid: { show: true },
                values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
                stroke: 'white'
            },
            {
                scale: 'y',
                label: 'Wert',
                grid: { show: true },
                ticks: {
                    format: v => v.toFixed(2)
                },
                stroke: 'white',
            }
        ],
        series: [
            { label: 'Zeit', value: (u, v) => formatMicrosecondsToHMS(v, 2) },
            { label: 'Gyro X (m°/s)', stroke: '#4dd0e1' },
            { label: 'Gyro Y (m°/s)', stroke: '#ffb74d' },
            { label: 'Gyro Z (m°/s)', stroke: '#81c784' },
            { label: 'Gyro Total (m°/s)', stroke: '#ce93d8', fill: 'rgba(206,147,216,0.18)' },
        ],
        cursor: {
            drag: { x: true, y: true, setScale: true }
        },
        legend: {
            mount: (u, table) => {
                gyroRmsLegendHost?.replaceChildren(table);
            },
        },
    };

    gyroRmsPlot = new uPlot(rmsopts, [[], [], [], [], []], document.getElementById('gyroRmsChart'));
    installManualLegendToggle(gyroRmsPlot, 'gyroRmsChartLegendHost');

    // Bind overlays immediately after chart is defined
    bindYAxisOverlay("gyro-rms-y-axis-overlay", gyroRmsPlot, true);
    bindRmsXAxisOverlay("gyro-rms-x-axis-overlay", gyroRmsPlot, true);
}

// FFT Worker initialisieren
function setupFFTWorker() {
    if (fftWorker) {
        fftWorker.terminate();
    }

    fftWorker = new Worker("fft-worker.js");
    console.log("[Main] FFT Worker:", fftWorker);
    console.log("FFT WORKER STARTED");

    fftWorker.onmessage = (e) => {
        const { freqs, mags, timestamp, timeString } = e.data;
        //console.log("[DEBUG] empfangene freqs:", freqs);
        // console.log("[DEBUG] empfangene mags:", mags);

        if (!freqs || !mags) {
            console.warn("[Worker] Ungültige Daten empfangen:", e.data);
            return;
        }

        //const skipBins = 0;
        // NEU: Bereich für x-Achse berechnen
        const minFreq = Math.min(...freqs);
        const maxFreq = Math.max(...freqs);

        if (window.waterfallRenderer && window.waterfallRenderer.active) {
            const hzFilter = document.getElementById('waterfallMaxHz');
            const userMax = hzFilter ? parseInt(hzFilter.value, 10) : maxFreq;
            const actualMax = Math.min(maxFreq, userMax);
            window.waterfallRenderer.setFrequencyBounds(maxFreq, actualMax);
            window.waterfallRenderer.pushData(mags, timestamp, timeString, e.data.clockTimeStr);
            
            // Labels aktualisieren (ohne ständiges reflow)
            if (window.waterfallLastMax !== actualMax) {
                window.waterfallLastMax = actualMax;
                const wfLblMax = document.getElementById('wfLblMax');
                const wfLblMid = document.getElementById('wfLblMid');
                if (wfLblMax) wfLblMax.textContent = actualMax + " Hz";
                if (wfLblMid) wfLblMid.textContent = Math.round(actualMax / 2) + " Hz";
            }
        }

        // MAX PUFFER
        bufferFFTResult(mags); // Magnitudenpuffer für die letzten 5 Sekunden
        const maxValues = computeMaxFFTValues();
        // MITTELWERT PUFFER
        bufferAverageFFT(mags); // In Mittelungspuffer stecken
        const meanValues = computeAverageFFT();

        // setData erwartet ein Array: [x, serie1, serie2]


        let maxAmp = Math.max(...meanValues);
        let maxAmpMax = Math.max(...maxValues);
        let maxAmpCurrent = Math.max(...mags);

        let totalmax = Math.max(maxAmp * 1.2, maxAmpMax * 1.2, maxAmpCurrent * 1.2);

        if (totalmax < 2000) {
            totalmax = 2000;
        }

        // X-Achse dynamisch setzen
        if (fftPlot && !window.isFftHistoryScrubbing) {


            fftPlot.setScale('y', {
                min: 0,
                max: totalmax
            })



            if (fftDBoutput) {
                // Logarithmische Skala für dB-Ausgabe
                fftPlot.setScale("y", [0.0, 100.0]);
            }


            //fftPlot.setData([plotFreqs, maxValues, plotMags]);
            fftPlot.setData([toRegularArray(freqs), maxValues, toRegularArray(meanValues), toRegularArray(mags)]);
            updatePeakFrequencyBadge('fftPeakBadge', freqs, mags);
            if (fftDBoutput) {
                // Logarithmische Skala für dB-Ausgabe
                fftPlot.setScale("y", [0.0, 100.0]);
            } //fftPlot.setData([plotFreqs, meanValues]);
            //fftPlot.redraw();
        }

    };
}

function setupGyroFFTWorker() {
    if (gyroFftWorker) {
        gyroFftWorker.terminate();
    }

    gyroFftWorker = new Worker('fft-worker.js');
    console.log('[Main] Gyro FFT Worker:', gyroFftWorker);

    gyroFftWorker.onmessage = (e) => {
        const { freqs, mags, timestamp, timeString } = e.data;

        if (!freqs || !mags) {
            console.warn('[Gyro FFT Worker] Ungültige Daten empfangen:', e.data);
            return;
        }

        const minFreq = Math.min(...freqs);
        const maxFreq = Math.max(...freqs);

        if (window.gyroWaterfallRenderer && window.gyroWaterfallRenderer.active) {
            const hzFilter = document.getElementById('gyroWaterfallMaxHz');
            const userMax = hzFilter ? parseInt(hzFilter.value, 10) : maxFreq;
            const actualMax = Math.min(maxFreq, userMax);
            window.gyroWaterfallRenderer.setFrequencyBounds(maxFreq, actualMax);
            window.gyroWaterfallRenderer.pushData(mags, timestamp, timeString, e.data.clockTimeStr);
            
            // Labels aktualisieren (ohne ständiges reflow)
            if (window.gyroWaterfallLastMax !== actualMax) {
                window.gyroWaterfallLastMax = actualMax;
                const wfLblMax = document.getElementById('gwfLblMax');
                const wfLblMid = document.getElementById('gwfLblMid');
                if (wfLblMax) wfLblMax.textContent = actualMax + " Hz";
                if (wfLblMid) wfLblMid.textContent = Math.round(actualMax / 2) + " Hz";
            }
        }

        bufferFFTResult(mags, gyroFftMaxBuffer, GYRO_FFT_RING_SIZE);
        const maxValues = computeMaxFFTValues(gyroFftMaxBuffer);
        bufferAverageFFT(mags, gyroAvgFFTBuffer, gyroN_AVG);
        const meanValues = computeAverageFFT(gyroAvgFFTBuffer);

        let maxAmp = Math.max(...meanValues);
        let maxAmpMax = Math.max(...maxValues);
        let maxAmpCurrent = Math.max(...mags);
        let totalmax = Math.max(maxAmp * 1.2, maxAmpMax * 1.2, maxAmpCurrent * 1.2);

        if (totalmax < 2000) {
            totalmax = 2000;
        }

        if (gyroFftPlot && !window.isGyroFftHistoryScrubbing) {
            gyroFftPlot.setScale('y', {
                min: 0,
                max: totalmax
            });

            if (fftDBoutput) {
                gyroFftPlot.setScale('y', [0.0, 100.0]);
            }

            gyroFftPlot.setData([toRegularArray(freqs), maxValues, toRegularArray(meanValues), toRegularArray(mags)]);
            updatePeakFrequencyBadge('gyroFftPeakBadge', freqs, mags);

            if (fftDBoutput) {
                gyroFftPlot.setScale('y', [0.0, 100.0]);
            }
        }
    };
}

function setupRMSWorker() {
    if (rmsWorker) {
        rmsWorker.terminate();
    }

    rmsWorker = new Worker("rms-worker.js");
    console.log("[Main] RMS Worker:", rmsWorker);
    // console.log("RMS     WORKER STARTED");

    rmsWorker.onmessage = (e) => {
        if(rmsPaused) return;

        const { rmsX, rmsY, rmsZ, rmsTotal, time } = e.data;

        rmsBuffer.push([time, rmsX, rmsY, rmsZ, rmsTotal]);

        const updatesPerSecond = 1000 / RMS_UPDATE_INTERVAL;
        const requiredDuration = displayDurationSecondsRMS + Math.max(0, Math.abs(rmsPanOffset / 1000000));
        let N = Math.ceil(updatesPerSecond * requiredDuration);
        if (N < 10) N = 10;

        const rmsx = rmsBuffer.getFieldTypedArray("x", N);
        const rmsy = rmsBuffer.getFieldTypedArray("y", N);
        const rmsz = rmsBuffer.getFieldTypedArray("z", N);
        const rmstotal = rmsBuffer.getFieldTypedArray("total", N);
        const rmst = rmsBuffer.getFieldTypedArray("time", N);

        const yMinBefore = rmsPlot?.scales?.y?.min;
        const yMaxBefore = rmsPlot?.scales?.y?.max;

        rmsPlot.setData([rmst, rmsx, rmsy, rmsz, rmstotal]);

        if (rmsPlot._yLocked && yMinBefore !== undefined && yMaxBefore !== undefined) {
            rmsPlot.setScale("y", { min: yMinBefore, max: yMaxBefore });
        }

        if (rmst.length > 0) {
            window.dispatchEvent(new CustomEvent("rmsDataUpdate", { detail: { latestTimestamp: rmst[rmst.length - 1] } }));
        }
    };
}

function setupGyroRMSWorker() {
    if (gyroRmsWorker) {
        gyroRmsWorker.terminate();
    }

    gyroRmsWorker = new Worker('rms-worker.js');
    console.log('[Main] Gyro RMS Worker:', gyroRmsWorker);

    gyroRmsWorker.onmessage = (e) => {
        if (gyroRmsPaused) return;

        const { rmsX, rmsY, rmsZ, rmsTotal, time } = e.data;

        gyroRmsBuffer.push([time, rmsX, rmsY, rmsZ, rmsTotal]);

        const updatesPerSecond = 1000 / RMS_UPDATE_INTERVAL;
        const requiredDuration = gyroDisplayDurationSecondsRMS + Math.max(0, Math.abs(gyroRmsPanOffset / 1000000));
        let N = Math.ceil(updatesPerSecond * requiredDuration);
        if (N < 10) N = 10;

        const rmsx = gyroRmsBuffer.getFieldTypedArray('x', N);
        const rmsy = gyroRmsBuffer.getFieldTypedArray('y', N);
        const rmsz = gyroRmsBuffer.getFieldTypedArray('z', N);
        const rmstotal = gyroRmsBuffer.getFieldTypedArray('total', N);
        const rmst = gyroRmsBuffer.getFieldTypedArray('time', N);

        const yMinBefore = gyroRmsPlot?.scales?.y?.min;
        const yMaxBefore = gyroRmsPlot?.scales?.y?.max;

        gyroRmsPlot?.setData([rmst, rmsx, rmsy, rmsz, rmstotal]);

        if (gyroRmsPlot?._yLocked && yMinBefore !== undefined && yMaxBefore !== undefined) {
             gyroRmsPlot?.setScale("y", { min: yMinBefore, max: yMaxBefore });
        }

        if (rmst.length > 0) {
            window.dispatchEvent(new CustomEvent("gyroRmsDataUpdate", { detail: { latestTimestamp: rmst[rmst.length - 1] } }));
        }
    };
}


let displayDurationSecondsRMS = 20;
let rmsPaused = false;

function bindRMSControls({ sliderId, valueId, pauseButtonId, recordButtonId, screenshotButtonId, chartId, getDuration, setDuration, getPaused, setPaused }) {
    const timeSlider = document.getElementById(sliderId);
    const timeValue = document.getElementById(valueId);
    const pauseBtn = document.getElementById(pauseButtonId);
    const recordBtn = document.getElementById(recordButtonId);
    const screenshotBtn = document.getElementById(screenshotButtonId);
    const chartContainer = document.getElementById(chartId);

    if (timeSlider && timeValue) {
        timeSlider.value = String(Math.round(getDuration()));
        timeValue.textContent = String(Math.round(getDuration()));

        timeSlider.addEventListener('input', () => {
            const nextDuration = parseInt(timeSlider.value, 10);
            setDuration(nextDuration);
            timeValue.textContent = String(nextDuration);
        });
    }

    if (pauseBtn) {
        pauseBtn.textContent = getPaused() ? '▶' : 'Pause';
        pauseBtn.addEventListener('click', () => {
            const nextPaused = !getPaused();
            setPaused(nextPaused);
            pauseBtn.textContent = nextPaused ? '▶' : 'Pause';
        });
    }

    if (recordBtn) {
        recordBtn.innerHTML = isRecording ? '⏹' : '🔴';
        recordBtn.addEventListener('click', () => {
            if (typeof window.toggleRecording === 'function') {
                window.toggleRecording();
            }
        });
    }

    if (screenshotBtn && chartContainer) {
        screenshotBtn.addEventListener('click', () => {
            html2canvas(chartContainer).then((canvas) => {
                const link = document.createElement('a');
                link.download = `${chartId}_${new Date().toISOString()}.png`;
                link.href = canvas.toDataURL();
                link.click();
            });
        });
    }

    if (chartContainer) {
        chartContainer.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const factor = event.deltaY < 0 ? 0.85 : 1.15;
            let nextDuration = getDuration() * factor;

            if (nextDuration < 1) nextDuration = 1;
            if (nextDuration > 300) nextDuration = 300;

            setDuration(nextDuration);

            if (timeSlider) timeSlider.value = String(Math.round(nextDuration));
            if (timeValue) timeValue.textContent = String(Math.round(nextDuration));
        }, { passive: false, capture: true });
    }
}

function setupRMSControls() {
    bindRMSControls({
        sliderId: 'rmsTimeSlider',
        valueId: 'rmsTimeValue',
        pauseButtonId: 'rmsPauseBtn',
        recordButtonId: 'rmsRecordBtn',
        screenshotButtonId: 'rmsSSBtn',
        chartId: 'rmsChart',
        getDuration: () => displayDurationSecondsRMS,
        setDuration: (value) => {
            displayDurationSecondsRMS = value;
        },
        getPaused: () => rmsPaused,
        setPaused: (value) => {
            rmsPaused = value;
        }
    });
}

function setupGyroRMSControls() {
    bindRMSControls({
        sliderId: 'gyroRmsTimeSlider',
        valueId: 'gyroRmsTimeValue',
        pauseButtonId: 'gyroRmsPauseBtn',
        recordButtonId: 'gyroRmsRecordBtn',
        screenshotButtonId: 'gyroRmsSSBtn',
        chartId: 'gyroRmsChart',
        getDuration: () => gyroDisplayDurationSecondsRMS,
        setDuration: (value) => {
            gyroDisplayDurationSecondsRMS = value;
        },
        getPaused: () => gyroRmsPaused,
        setPaused: (value) => {
            gyroRmsPaused = value;
        }
    });
}

// Ensure setupRMSControls is called
document.addEventListener("DOMContentLoaded", () => {
    // Other setups are likely called elsewhere or inline
    setupRMSControls();
    setupGyroRMSControls();
});





function startRMSUpdates() {
    // Falls das Intervall schon läuft, abbrechen
    if (rmsUpdateTimerId !== null) {
        clearInterval(rmsUpdateTimerId);
    }

    rmsUpdateTimerId = setInterval(() => {
        if (!rmsWorker || !rmsPlot) return;
        const lastAccSample = accBuffer.getLast();
        if (!lastAccSample) return;

        const arrx = accBuffer.getFieldTypedArray('x', RMS_WINDOW_SIZE);
        const arry = accBuffer.getFieldTypedArray('y', RMS_WINDOW_SIZE);
        const arrz = accBuffer.getFieldTypedArray('z', RMS_WINDOW_SIZE);
        const arrtotal = accBuffer.getFieldTypedArray('total', RMS_WINDOW_SIZE);

        const t = lastAccSample.time;


        const rmsXInput = new Float32Array(arrx);
        const rmsYInput = new Float32Array(arry);
        const rmsZInput = new Float32Array(arrz);
        const rmsTotalInput = new Float32Array(arrtotal);

        rmsWorker.postMessage({
            x: rmsXInput,
            y: rmsYInput,
            z: rmsZInput,
            total: rmsTotalInput,
            time: t
        }, [
            rmsXInput.buffer,
            rmsYInput.buffer,
            rmsZInput.buffer,
            rmsTotalInput.buffer,
        ]);



        //fftWorker.postMessage({ buffer: buf.buffer, sampleRate: frq }, [buf.buffer]);
    }, RMS_UPDATE_INTERVAL);
}

function startGyroRMSUpdates() {
    if (gyroRmsUpdateTimerId !== null) {
        clearInterval(gyroRmsUpdateTimerId);
    }

    gyroRmsUpdateTimerId = setInterval(() => {
        if (!gyroRmsWorker || !gyroRmsPlot) return;

        const lastGyroSample = gyroBuffer.getLast();
        if (!lastGyroSample) return;

        const arrx = gyroBuffer.getFieldTypedArray('x', RMS_WINDOW_SIZE);
        const arry = gyroBuffer.getFieldTypedArray('y', RMS_WINDOW_SIZE);
        const arrz = gyroBuffer.getFieldTypedArray('z', RMS_WINDOW_SIZE);

        const arrtotal = new Float32Array(arrx.length);
        for (let index = 0; index < arrx.length; index++) {
            arrtotal[index] = Math.hypot(arrx[index] || 0, arry[index] || 0, arrz[index] || 0);
        }

        const rmsXInput = new Float32Array(arrx);
        const rmsYInput = new Float32Array(arry);
        const rmsZInput = new Float32Array(arrz);
        const rmsTotalInput = new Float32Array(arrtotal);

        gyroRmsWorker.postMessage({
            x: rmsXInput,
            y: rmsYInput,
            z: rmsZInput,
            total: rmsTotalInput,
            time: lastGyroSample.time
        }, [
            rmsXInput.buffer,
            rmsYInput.buffer,
            rmsZInput.buffer,
            rmsTotalInput.buffer,
        ]);
    }, RMS_UPDATE_INTERVAL);
}

function bufferFFTResult(magArray, targetBuffer = fftMaxBuffer, ringSize = FFT_RING_SIZE) {
    if (targetBuffer.length >= ringSize)
        targetBuffer.shift();
    targetBuffer.push(magArray);
}


function computeMaxFFTValues(targetBuffer = fftMaxBuffer) {
    if (targetBuffer.length === 0) return [];
    const numBins = targetBuffer[0].length;
    let maxValues = Array(numBins).fill(-Infinity);

    for (let bin = 0; bin < numBins; bin++) {
        for (let i = 0; i < targetBuffer.length; i++) {
            maxValues[bin] = Math.max(maxValues[bin], targetBuffer[i][bin]);
        }
    }
    return maxValues;
}

window.generateStaticWaterfalls = function(accData, gyroData, sampleRate, accTimes, gyroTimes) {
    console.log(`[Offline FFT] Generiere statischen Waterfall mit ${sampleRate}Hz (Async-Batch)...`);
    
    // Set up global sampleRate so scrubbers can use it
    if (sampleRate > 0 && typeof currentSampleRate !== "undefined") {
        currentSampleRate = sampleRate;
    }
    
    if (accData && accData.length > 0 && fftWorker) {
        if (window.waterfallRenderer) window.waterfallRenderer.clear();
    }
    if (gyroData && gyroData.length > 0 && gyroFftWorker) {
        if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.clear();
    }
    
    const frq = sampleRate > 0 ? sampleRate : (typeof currentSampleRate !== 'undefined' ? currentSampleRate : 1000);
    let step = Math.floor(frq * (FFT_UPDATE_INTERVAL / 1000));
    if (step < 10) step = 10;
    
    let accI = 0;
    let gyroI = 0;
    const BATCH_SIZE = 50;
    
    function processBatch() {
        let itemsProcessed = 0;
        
        while (itemsProcessed < BATCH_SIZE && accData && accI <= accData.length - FFT_WINDOW_SIZE) {
            if (fftWorker) {
                const windowArr = accData.slice(accI, accI + FFT_WINDOW_SIZE);
                const buf = Float32Array.from(windowArr); 
                
                const timestampUs = accTimes ? accTimes[accI + FFT_WINDOW_SIZE - 1] : 0;
                const tString = typeof formatUsToTime === 'function' ? formatUsToTime(timestampUs) : (timestampUs/1000000).toFixed(2);
                let clockTimeStr = undefined;
                if (window.replayData && window.replayData.acc && window.replayData.acc[accI + FFT_WINDOW_SIZE - 1]) {
                    clockTimeStr = window.replayData.acc[accI + FFT_WINDOW_SIZE - 1].hms;
                }
                
                fftWorker.postMessage({
                    buffer: buf.buffer,
                    sampleRate: frq,
                    windowType: typeof FFT_WINDOW_TYPE !== 'undefined' ? FFT_WINDOW_TYPE : 'BLACKMAN',
                    highpassCutoff: typeof fftHighPass !== 'undefined' ? fftHighPass : 0,
                    dcCutoff: typeof DC_CUTOFF !== 'undefined' ? DC_CUTOFF : true,
                    fftDBoutput: typeof fftDBoutput !== 'undefined' ? fftDBoutput : false,
                    timestamp: timestampUs,
                    timeString: tString,
                    clockTimeStr: clockTimeStr
                }, [buf.buffer]);
            }
            accI += step;
            itemsProcessed++;
        }
        
        itemsProcessed = 0;
        while (itemsProcessed < BATCH_SIZE && gyroData && gyroI <= gyroData.length - FFT_WINDOW_SIZE) {
            if (gyroFftWorker) {
                const windowArr = gyroData.slice(gyroI, gyroI + FFT_WINDOW_SIZE);
                const buf = Float32Array.from(windowArr);
                
                const timestampUs = gyroTimes ? gyroTimes[gyroI + FFT_WINDOW_SIZE - 1] : 0;
                const tString = typeof formatUsToTime === 'function' ? formatUsToTime(timestampUs) : (timestampUs/1000000).toFixed(2);
                let clockTimeStr = undefined;
                if (window.replayData && window.replayData.gyro && window.replayData.gyro[gyroI + FFT_WINDOW_SIZE - 1]) {
                    clockTimeStr = window.replayData.gyro[gyroI + FFT_WINDOW_SIZE - 1].hms;
                }
                
                gyroFftWorker.postMessage({
                    buffer: buf.buffer,
                    sampleRate: frq,
                    windowType: typeof FFT_WINDOW_TYPE !== 'undefined' ? FFT_WINDOW_TYPE : 'BLACKMAN',
                    highpassCutoff: typeof fftHighPass !== 'undefined' ? fftHighPass : 0,
                    dcCutoff: typeof DC_CUTOFF !== 'undefined' ? DC_CUTOFF : true,
                    fftDBoutput: typeof fftDBoutput !== 'undefined' ? fftDBoutput : false,
                    timestamp: timestampUs,
                    timeString: tString,
                    clockTimeStr: clockTimeStr
                }, [buf.buffer]);
            }
            gyroI += step;
            itemsProcessed++;
        }
        
        let pending = false;
        if (accData && accI <= accData.length - FFT_WINDOW_SIZE) pending = true;
        if (gyroData && gyroI <= gyroData.length - FFT_WINDOW_SIZE) pending = true;
        
        if (pending) {
            setTimeout(processBatch, 0);
        }
    }
    
    processBatch();
};



function startFFTUpdates() {
    // Falls das Intervall schon läuft, abbrechen
    if (fftUpdateTimerId !== null) {
        clearInterval(fftUpdateTimerId);
    }

    fftUpdateTimerId = setInterval(() => {
        if (!fftWorker || !fftPlot) return;



        //const arr = accBuffer.getFieldTypedArray('x', FFT_WINDOW_SIZE);


        const arr = getSelectedData(FFT_AXIS_MODE, accBuffer, FFT_WINDOW_SIZE);

        // const arr = chartData[1].toArray();
        const tarr = accBuffer.getFieldTypedArray('time', FFT_WINDOW_SIZE);

        const arrLen = arr.length;

        if (arrLen < FFT_WINDOW_SIZE) return;

        const idx0 = arrLen - 1;
        const idx1 = arrLen - FFT_WINDOW_SIZE;
        const t0 = tarr[idx0];
        const t1 = tarr[idx1];
        const delta = t0 - t1;

        if (delta <= 0) {
            console.warn("FFT: Ungültiges Zeitintervall!!!");
            return;
        }

        const frq = currentSampleRate; //Math.round(FFT_WINDOW_SIZE * (1000000 / delta));
        const windowArr = arr.slice(idx1, idx0 + 1);
        const buf = windowArr instanceof Float32Array ? windowArr : Float32Array.from(windowArr);



        fftWorker.postMessage({
            buffer: buf.buffer,
            sampleRate: frq,
            windowType: FFT_WINDOW_TYPE,// oder 'HANNING', 'HAMMING', 'RECTANGULAR'
            highpassCutoff: fftHighPass,
            dcCutoff: DC_CUTOFF,
            fftDBoutput: fftDBoutput,
        }, [buf.buffer]);


        //fftWorker.postMessage({ buffer: buf.buffer, sampleRate: frq }, [buf.buffer]);
    }, FFT_UPDATE_INTERVAL);
}

function startGyroFFTUpdates() {
    if (gyroFftUpdateTimerId !== null) {
        clearInterval(gyroFftUpdateTimerId);
    }

    gyroFftUpdateTimerId = setInterval(() => {
        if (!gyroFftWorker || !gyroFftPlot) return;

        const arr = getSelectedData(GYRO_FFT_AXIS_MODE, gyroBuffer, GYRO_FFT_WINDOW_SIZE);
        const tarr = gyroBuffer.getFieldTypedArray('time', GYRO_FFT_WINDOW_SIZE);
        const arrLen = arr.length;

        if (arrLen < GYRO_FFT_WINDOW_SIZE) return;

        const idx0 = arrLen - 1;
        const idx1 = arrLen - GYRO_FFT_WINDOW_SIZE;
        const t0 = tarr[idx0];
        const t1 = tarr[idx1];
        const delta = t0 - t1;

        if (delta <= 0) {
            console.warn('Gyro FFT: Ungültiges Zeitintervall');
            return;
        }

        const estimatedSampleRate = Math.round((GYRO_FFT_WINDOW_SIZE - 1) * (1000000 / delta));
        if (!Number.isFinite(estimatedSampleRate) || estimatedSampleRate <= 0) {
            return;
        }

        const windowArr = arr.slice(idx1, idx0 + 1);
        const buf = windowArr instanceof Float32Array ? windowArr : Float32Array.from(windowArr);

        gyroFftWorker.postMessage({
            buffer: buf.buffer,
            sampleRate: estimatedSampleRate,
            windowType: GYRO_FFT_WINDOW_TYPE,
            highpassCutoff: gyroFftHighPass,
            dcCutoff: GYRO_DC_CUTOFF,
            fftDBoutput: fftDBoutput,
        }, [buf.buffer]);
    }, GYRO_FFT_UPDATE_INTERVAL);
}



/*   function getSelectedData(mode, chartData) {
  switch (mode) {
    case "COMBI": {
      // Alle Werte zu einer Reihenfolge kombinieren – zum Beispiel als "Betrag" (Vektor-Länge)
      const arrX = chartData[1].toArray();
      const arrY = chartData[2].toArray();
      const arrZ = chartData[3].toArray();
      // Kombiniere: sqrt(x^2 + y^2 + z^2) für jeden Zeitschritt
      return arrX.map((x, i) => {
        const y = arrY[i] ?? 0;
        const z = arrZ[i] ?? 0;
        return Math.sqrt(x * x + y * y + z * z);
      });
    }
    case "ONLYX":
      return chartData[1].toArray();
    case "ONLYY":
      return chartData[2].toArray();
    case "ONLYZ":
      return chartData[3].toArray();
    default:
      return chartData[1].toArray(); // Fallback
  }
} */

function getSelectedData(mode, accBuffer, N) {
    switch (mode) {
        case "COMBI": {
            // Hier werden tatsächlich alle Achsen benötigt!
            const xs = accBuffer.getFieldTypedArray('x', N);
            const ys = accBuffer.getFieldTypedArray('y', N);
            const zs = accBuffer.getFieldTypedArray('z', N);
            return xs.map((x, i) => {
                const y = ys[i] ?? 0;
                const z = zs[i] ?? 0;
                return Math.sqrt(x * x + y * y + z * z);
            });
        }
        case "ONLYX":
            return accBuffer.getFieldTypedArray('x', N);
        case "ONLYY":
            return accBuffer.getFieldTypedArray('y', N);
        case "ONLYZ":
            return accBuffer.getFieldTypedArray('z', N);
        default:
            return accBuffer.getFieldTypedArray('x', N); // Fallback
    }
}








// FFT MITTELUNG

function bufferAverageFFT(mags, targetBuffer = avgFFTBuffer, limit = N_AVG) {
    if (targetBuffer.length >= limit) {
        targetBuffer.shift();
    }
    targetBuffer.push(mags);
}

function computeAverageFFT(targetBuffer = avgFFTBuffer) {
    if (targetBuffer.length === 0) return [];
    const len = targetBuffer[0].length;
    let avg = new Array(len).fill(0);
    for (let i = 0; i < targetBuffer.length; i++) {
        if (targetBuffer[i].length !== len) {
            console.error(`[ERROR] Abweichende Länge in Buffer bei Index ${i}:`, targetBuffer[i].length, 'erwartet:', len);
        }
        for (let j = 0; j < len; j++) {
            avg[j] += targetBuffer[i][j];
        }
    }
    for (let j = 0; j < len; j++) {
        avg[j] /= targetBuffer.length;
    }
    return avg;
}

function setAverageCount(newVal, targetBuffer = avgFFTBuffer) {
    const nextLimit = Math.max(1, parseInt(newVal));
    while (targetBuffer.length > nextLimit) {
        targetBuffer.shift();
    }
}





/* setInterval(() => {
  
  if (!fftWorker || !fftPlot) {
    console.warn("FFT Worker oder Plot nicht initialisiert");
    return;
  }

  if (chartData[1].length < FFT_WINDOW_SIZE) {
    console.warn(`[FFT] Nicht genug Daten: chartData[1].length = ${chartData[1].length}`);
    return;
  }

  // Index-Grenzen für das FFT-Fenster
  const startIdx = chartData[1].length - FFT_WINDOW_SIZE;
  const endIdx = chartData[1].length - 1;

  // Signalwerte für das FFT-Window extrahieren (als Float32Array)
  const windowArr = new Float32Array(FFT_WINDOW_SIZE);
  for (let i = 0; i < FFT_WINDOW_SIZE; i++) {
    windowArr[i] = chartData[1][startIdx + i];
  }

  // Zeitstempel des Fensters am Anfang und Ende
  const t0 = chartData[0][startIdx];
  const t1 = chartData[0][endIdx];
  console.log("T0 INDEX", startIdx, "T1 INDEX", endIdx);
  console.log("T0", t0, "T1", t1);


  // Zeitdifferenz in Sekunden (Annahme: Zeitstempel in ms)
  const deltaT = (t1 - t0) / 1000;
  console.log("DELTA T " + String(deltaT));
  if (deltaT <= 0) {
    console.warn("[FFT] Ungültige Zeitdifferenz für Samplingrate:", deltaT);
    return;
  }

  // Effektive Abtastrate berechnen
 // const effectiveSampleRate = (FFT_WINDOW_SIZE - 1) / deltaT;
  //effectiveSampleRate = SAMPLE_RATE;
console.log("LEN chartData[0]:", chartData[0].length, "LEN chartData[1]:", chartData[1].length);
  console.log(`[FFT] Sende Fenster mit ${FFT_WINDOW_SIZE} Werten an Worker.`);
  //console.log(`[FFT] Effektive Samplerate: ${effectiveSampleRate.toFixed(1)} Hz`);
console.log(`[FFT] Effektive Samplerate: ${SAMPLE_RATE.toFixed(1)} Hz`);
  // Buffer an Worker schicken (Transferable Objekt)
  fftWorker.postMessage(
    { buffer: windowArr.buffer, sampleRate: SAMPLE_RATE },
    [windowArr.buffer]
  );

}, FFT_UPDATE_INTERVAL); */







function getSize() {
    const container = document.getElementById("accChartHost");
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    }
}

function getGyroChartSize() {
    const container = document.getElementById("gyroChartHost");
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    }
}

function getFftChartSize() {
    const container = document.getElementById("fftChart");
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    };
}

function getRmsChartSize() {
    const container = document.getElementById("rmsChart");
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    };
}

function getGyroFftChartSize() {
    const container = document.getElementById('gyroFftChart');
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    };
}

function getGyroRmsChartSize() {
    const container = document.getElementById('gyroRmsChart');
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    };
}

function getViewportMetrics() {
    const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
    return { viewportHeight, viewportWidth };
}

function updateLiveChartPanelHeights() {
    const grid = document.getElementById("livechartsGrid");
    const accPanel = document.getElementById("livechart2");
    const gyroPanel = document.getElementById("gyrochart");
    const controls = document.querySelector("#liveChartForm .chart-controls");
    if (!grid || !accPanel || !gyroPanel || !controls) {
        return;
    }

    const { viewportHeight, viewportWidth } = getViewportMetrics();
    document.documentElement.style.setProperty("--viewport-height", `${viewportHeight}px`);
    document.documentElement.style.setProperty("--viewport-width", `${viewportWidth}px`);

    const gridRect = grid.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).gap || "12") || 12;
    const bottomPadding = 16;
    const visiblePanels = [accPanel, gyroPanel].filter(panel => getComputedStyle(panel).display !== "none");

    grid.classList.toggle("single-visible", visiblePanels.length === 1);

    accPanel.style.height = "";
    gyroPanel.style.height = "";

    if (visiblePanels.length === 0) {
        return;
    }

    const topAnchor = Math.max(gridRect.top, controlsRect.bottom + 10);
    const availableHeight = Math.max(220, Math.floor(viewportHeight - topAnchor - bottomPadding));
    const hasSideBySideLayout = grid.classList.contains("is-side-by-side");
    const isSingleVisible = visiblePanels.length === 1;

    let panelHeight;
    if (hasSideBySideLayout && isSingleVisible) {
        const desiredSingleSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(420, Math.min(availableHeight, desiredSingleSideBySideHeight));
    } else if (hasSideBySideLayout) {
        const desiredSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(380, Math.min(availableHeight, desiredSideBySideHeight));
    } else if (isSingleVisible) {
        const desiredSingleStackedHeight = Math.floor(viewportHeight * 0.62);
        panelHeight = Math.max(360, Math.min(availableHeight, desiredSingleStackedHeight));
    } else {
        const availablePerPanel = Math.floor((availableHeight - gap * (visiblePanels.length - 1)) / visiblePanels.length);
        panelHeight = Math.max(220, availablePerPanel);
    }

    visiblePanels.forEach(panel => {
        panel.style.height = `${panelHeight}px`;
    });
}

function updateFftRmsPanelHeights() {
    const grid = document.getElementById("fftRmsGrid");
    const fftPanel = document.getElementById("fftPanel");
    const rmsPanel = document.getElementById("rmsPanel");
    const controls = document.getElementById("fftRmsChartControls");
    if (!grid || !fftPanel || !rmsPanel || !controls) {
        return;
    }

    const { viewportHeight, viewportWidth } = getViewportMetrics();
    document.documentElement.style.setProperty("--viewport-height", `${viewportHeight}px`);
    document.documentElement.style.setProperty("--viewport-width", `${viewportWidth}px`);

    const gridRect = grid.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).gap || "12") || 12;
    const bottomPadding = 16;
    const visiblePanels = [fftPanel, rmsPanel].filter(panel => getComputedStyle(panel).display !== "none");

    grid.classList.toggle("single-visible", visiblePanels.length === 1);

    fftPanel.style.height = "";
    rmsPanel.style.height = "";

    if (visiblePanels.length === 0) {
        return;
    }

    const topAnchor = Math.max(gridRect.top, controlsRect.bottom + 10);
    const availableHeight = Math.max(220, Math.floor(viewportHeight - topAnchor - bottomPadding));
    const hasSideBySideLayout = grid.classList.contains("is-side-by-side");
    const isSingleVisible = visiblePanels.length === 1;

    let panelHeight;
    if (hasSideBySideLayout && isSingleVisible) {
        const desiredSingleSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(420, Math.min(availableHeight, desiredSingleSideBySideHeight));
    } else if (hasSideBySideLayout) {
        const desiredSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(380, Math.min(availableHeight, desiredSideBySideHeight));
    } else if (isSingleVisible) {
        const desiredSingleStackedHeight = Math.floor(viewportHeight * 0.62);
        panelHeight = Math.max(360, Math.min(availableHeight, desiredSingleStackedHeight));
    } else {
        const availablePerPanel = Math.floor((availableHeight - gap * (visiblePanels.length - 1)) / visiblePanels.length);
        panelHeight = Math.max(220, availablePerPanel);
    }

    visiblePanels.forEach(panel => {
        panel.style.height = `${panelHeight}px`;
    });
}

function updateGyroFftRmsPanelHeights() {
    const grid = document.getElementById('gyroFftRmsGrid');
    const fftPanel = document.getElementById('gyroFftPanel');
    const rmsPanel = document.getElementById('gyroRmsPanel');
    const controls = document.getElementById('gyroFftRmsChartControls');
    if (!grid || !fftPanel || !rmsPanel || !controls) {
        return;
    }

    const { viewportHeight, viewportWidth } = getViewportMetrics();
    document.documentElement.style.setProperty('--viewport-height', `${viewportHeight}px`);
    document.documentElement.style.setProperty('--viewport-width', `${viewportWidth}px`);

    const gridRect = grid.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).gap || '12') || 12;
    const bottomPadding = 16;
    const visiblePanels = [fftPanel, rmsPanel].filter(panel => getComputedStyle(panel).display !== 'none');

    grid.classList.toggle('single-visible', visiblePanels.length === 1);

    fftPanel.style.height = '';
    rmsPanel.style.height = '';

    if (visiblePanels.length === 0) {
        return;
    }

    const topAnchor = Math.max(gridRect.top, controlsRect.bottom + 10);
    const availableHeight = Math.max(220, Math.floor(viewportHeight - topAnchor - bottomPadding));
    const hasSideBySideLayout = grid.classList.contains('is-side-by-side');
    const isSingleVisible = visiblePanels.length === 1;

    let panelHeight;
    if (hasSideBySideLayout && isSingleVisible) {
        const desiredSingleSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(420, Math.min(availableHeight, desiredSingleSideBySideHeight));
    } else if (hasSideBySideLayout) {
        const desiredSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(380, Math.min(availableHeight, desiredSideBySideHeight));
    } else if (isSingleVisible) {
        const desiredSingleStackedHeight = Math.floor(viewportHeight * 0.62);
        panelHeight = Math.max(360, Math.min(availableHeight, desiredSingleStackedHeight));
    } else {
        const availablePerPanel = Math.floor((availableHeight - gap * (visiblePanels.length - 1)) / visiblePanels.length);
        panelHeight = Math.max(220, availablePerPanel);
    }

    visiblePanels.forEach(panel => {
        panel.style.height = `${panelHeight}px`;
    });
}

window.addEventListener("resize", e => {
    updateLiveChartPanelHeights();
    updateFftRmsPanelHeights();
    updateGyroFftRmsPanelHeights();
    chart?.setSize(getSize());
    gyroChart?.setSize(getGyroChartSize());
    fftPlot?.setSize(getFftChartSize());
    rmsPlot?.setSize(getRmsChartSize());
    gyroFftPlot?.setSize(getGyroFftChartSize());
    gyroRmsPlot?.setSize(getGyroRmsChartSize());
});


let timestamps = [];
let values1 = [];
let values2 = [];
let values3 = [];
let values4 = [];
const maxPoints = 300000;
const nowUs = Date.now() * 1000;
for (let i = -99; i <= 0; i++) {
    const t = nowUs + (i * 1000000);
    timestamps.push(t);
    values1.push(Math.sin(i / 5) * 10 + 50);
    values2.push(Math.cos(i / 5) * 7 + 40);
    values3.push(Math.tan(i / 10) * 5 + 30);
    values4.push(Math.sqrt(values1[i + 99] ** 2 + values2[i + 99] ** 2 + values3[i + 99] ** 2));
}

function createCanvasCursorPointsPlugin() {
    let overlayCanvas = null;
    let overlayContext = null;

    function ensureOverlayCanvas(u) {
        const wrap = u.root?.querySelector?.('.u-wrap');
        if (!wrap || !u.bbox) {
            return null;
        }

        if (!overlayCanvas) {
            overlayCanvas = document.createElement('canvas');
            overlayCanvas.className = 'u-cursor-pts-canvas';
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.pointerEvents = 'none';
            overlayCanvas.style.zIndex = '101';
            wrap.appendChild(overlayCanvas);
            overlayContext = overlayCanvas.getContext('2d');
        }

        const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const width = Math.max(1, Math.round(wrap.clientWidth));
        const height = Math.max(1, Math.round(wrap.clientHeight));
        const targetWidth = Math.max(1, Math.round(width * pixelRatio));
        const targetHeight = Math.max(1, Math.round(height * pixelRatio));

        if (overlayCanvas.width !== targetWidth || overlayCanvas.height !== targetHeight) {
            overlayCanvas.width = targetWidth;
            overlayCanvas.height = targetHeight;
        }

        overlayCanvas.style.left = '0px';
        overlayCanvas.style.top = '0px';
        overlayCanvas.style.width = `${width}px`;
        overlayCanvas.style.height = `${height}px`;

        overlayContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        return overlayContext;
    }

    function resolveSeriesColor(u, seriesIndex) {
        const series = u.series?.[seriesIndex];
        if (!series) {
            return '#ffffff';
        }

        if (typeof series.stroke === 'function') {
            return series.stroke(u, seriesIndex) || '#ffffff';
        }

        return series.stroke || '#ffffff';
    }

    function drawCursorPoints(u) {
        const context = ensureOverlayCanvas(u);
        if (!context || !u.bbox) {
            return;
        }

        context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        const cursorIndex = u.cursor?.idx;
        if (cursorIndex == null || cursorIndex < 0) {
            return;
        }

        const xData = u.data?.[0];
        if (!xData || cursorIndex >= xData.length) {
            return;
        }

        const xValue = Number(xData[cursorIndex]);
        if (!Number.isFinite(xValue)) {
            return;
        }

        const xPos = u.valToPos(xValue, 'x', false) + u.bbox.left;
        if (!Number.isFinite(xPos)) {
            return;
        }

        for (let seriesIndex = 1; seriesIndex < u.series.length; seriesIndex++) {
            const series = u.series[seriesIndex];
            if (!series?.show) {
                continue;
            }

            const yData = u.data?.[seriesIndex];
            if (!yData || cursorIndex >= yData.length) {
                continue;
            }

            const yValue = Number(yData[cursorIndex]);
            if (!Number.isFinite(yValue)) {
                continue;
            }

            const yScaleKey = series.scale || 'y';
            const yPos = u.valToPos(yValue, yScaleKey, false) + u.bbox.top;
            if (!Number.isFinite(yPos)) {
                continue;
            }

            context.beginPath();
            context.arc(xPos, yPos, 4.5, 0, Math.PI * 2);
            context.fillStyle = resolveSeriesColor(u, seriesIndex);
            context.fill();
            context.lineWidth = 2;
            context.strokeStyle = 'rgba(17, 24, 39, 0.9)';
            context.stroke();
        }
    }

    return {
        hooks: {
            ready: [drawCursorPoints],
            setCursor: [drawCursorPoints],
            setData: [drawCursorPoints],
            setScale: [drawCursorPoints],
            draw: [drawCursorPoints],
        },
    };
}

function createCursorYPlugin(unit) {
    let tooltip;

    function init(u) {
        let over = u.root.querySelector(".u-over");
        tooltip = document.createElement("div");
        tooltip.className = "u-tooltip-y";
        tooltip.style.position = "absolute";
        tooltip.style.background = "rgba(24, 28, 36, 0.85)";
        tooltip.style.color = "#FFD600";
        tooltip.style.padding = "3px 6px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "12px";
        tooltip.style.fontFamily = "monospace";
        tooltip.style.border = "1px solid rgba(255, 214, 0, 0.3)";
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.zIndex = "100";
        tooltip.style.whiteSpace = "nowrap";
        over.appendChild(tooltip);
    }

    function setCursor(u) {
        const { left, top } = u.cursor;
        if (top < 0 || left < 0) {
            if (tooltip) tooltip.style.display = "none";
            return;
        }

        const valY = u.posToVal(top, "y");
        tooltip.textContent = valY.toFixed(2) + " " + unit;
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

    return {
        hooks: {
            init: [init],
            setCursor: [setCursor],
        }
    };
}

const container = document.getElementById("livechart2");
const accChartLegendHost = document.getElementById("accChartLegendHost");
const options = {
    ...getSize(),
    title: "ACC Live-Daten",
    width: container.clientWidth,
    height: container.clientHeight,
    padding: [6, 8, 2, 2],
    axes: [
        {
            time: false,
            scale: "x",
            space: 64,
            size: 44,
            label: "Zeit (s)",
            grid: { show: true },
            values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
            stroke: "white"
        },
        {
            scale: "y",
            size: 56,
            label: "Wert",
            grid: { show: true },
            ticks: { format: (u, v) => v.toFixed(2) + " mg" },
            stroke: "white"
        }
    ],
    scales: {
        x: {},
        y: { range: [-1100, 1100] }
    },

    series: [
        {label: "Zeit",value: (u, v) => formatMicrosecondsToHMS(v, 5) },
        { label: "Acc X (mg)", stroke: "#FFD600" },
        { label: "Acc Y (mg)", stroke: "#ec3030ff" },
        { label: "Acc Z (mg)", stroke: "#7a96e2ff" },
        { label: "Acc Total (mg)", stroke: "#14c53bff" },

    ],
    cursor: {
        points: {},
        drag: { x: true, y: true, setScale: true }
    },
    legend: {
        mount: (u, table) => {
            accChartLegendHost?.replaceChildren(table);
        },
    },
    plugins: [createCursorYPlugin("mg")],
};

chart = new uPlot(options, [timestamps.slice(), values1.slice(), values2.slice(), values3.slice(), values4.slice()], document.getElementById("accChartHost"));

const gyroContainer = document.getElementById("gyrochart");
const gyroChartLegendHost = document.getElementById("gyroChartLegendHost");
const gyroOptions = {
    ...getGyroChartSize(),
    title: "Gyro Live-Daten",
    width: gyroContainer.clientWidth,
    height: gyroContainer.clientHeight,
    padding: [6, 8, 2, 2],
    axes: [
        {
            time: false,
            scale: "x",
            space: 64,
            size: 44,
            label: "Zeit (s)",
            grid: { show: true },
            values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
            stroke: "white"
        },
        {
            scale: "y",
            size: 56,
            label: "Wert",
            grid: { show: true },
            ticks: { format: (u, v) => v.toFixed(2) + " m°/s" },
            stroke: "white"
        }
    ],
    scales: {
        x: {},
        y: { range: [-25000, 25000] }
    },
    series: [
        { label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 5) },
        { label: "Gyro X (m°/s)", stroke: "#4dd0e1" },
        { label: "Gyro Y (m°/s)", stroke: "#ffb74d" },
        { label: "Gyro Z (m°/s)", stroke: "#81c784" },
    ],
    cursor: {
        points: {},
        drag: { x: true, y: true, setScale: true }
    },
    legend: {
        mount: (u, table) => {
            gyroChartLegendHost?.replaceChildren(table);
        },
    },
    plugins: [createCursorYPlugin("m°/s")],
};

gyroChart = new uPlot(
    gyroOptions,
    [timestamps.slice(), values1.slice(), values2.slice(), values3.slice()],
    document.getElementById("gyroChartHost")
);

window.applyStaticReplayData = function(accData, gyroData, startTimeUs, endTimeUs) {
    if (accData && chart) {
        chart.setData(accData);
        chart.setScale("x", { min: startTimeUs, max: endTimeUs });
        
        if (rmsPlot) {
            const [t, x, y, z, to] = accData;
            const N = t.length;
            const windowSize = RMS_WINDOW_SIZE > 0 ? RMS_WINDOW_SIZE : 100;
            const step = Math.max(1, Math.floor(N / 3000));
            
            const rT = [], rX = [], rY = [], rZ = [], rTo = [];
            for (let i = 0; i <= N - windowSize; i += step) {
                let sx = 0, sy = 0, sz = 0, sto = 0;
                for (let j = 0; j < windowSize; j++) {
                    const idx = i + j;
                    sx += x[idx]*x[idx];
                    sy += y[idx]*y[idx];
                    sz += z[idx]*z[idx];
                    sto += to[idx]*to[idx];
                }
                rX.push(Math.sqrt(sx / windowSize));
                rY.push(Math.sqrt(sy / windowSize));
                rZ.push(Math.sqrt(sz / windowSize));
                rTo.push(Math.sqrt(sto / windowSize));
                rT.push(t[i + windowSize - 1]);
            }
            if (rT.length > 0) {
                rmsPlot.setData([
                    new Float64Array(rT),
                    new Float32Array(rX),
                    new Float32Array(rY),
                    new Float32Array(rZ),
                    new Float32Array(rTo)
                ]);
                rmsPlot.setScale("x", { min: startTimeUs, max: endTimeUs });
            }
        }
    }
    
    if (gyroData && gyroChart) {
        gyroChart.setData(gyroData);
        gyroChart.setScale("x", { min: startTimeUs, max: endTimeUs });
        
        if (gyroRmsPlot) {
            const [t, x, y, z] = gyroData;
            const N = t.length;
            const windowSize = RMS_WINDOW_SIZE > 0 ? RMS_WINDOW_SIZE : 100;
            const step = Math.max(1, Math.floor(N / 3000));
            
            const rT = [], rX = [], rY = [], rZ = [], rTo = [];
            for (let i = 0; i <= N - windowSize; i += step) {
                let sx = 0, sy = 0, sz = 0, sto = 0;
                for (let j = 0; j < windowSize; j++) {
                    const idx = i + j;
                    sx += x[idx]*x[idx];
                    sy += y[idx]*y[idx];
                    sz += z[idx]*z[idx];
                    
                    const toVal = Math.hypot(x[idx]||0, y[idx]||0, z[idx]||0);
                    sto += toVal * toVal;
                }
                rX.push(Math.sqrt(sx / windowSize));
                rY.push(Math.sqrt(sy / windowSize));
                rZ.push(Math.sqrt(sz / windowSize));
                rTo.push(Math.sqrt(sto / windowSize));
                rT.push(t[i + windowSize - 1]);
            }
            if (rT.length > 0) {
                gyroRmsPlot.setData([
                    new Float64Array(rT),
                    new Float32Array(rX),
                    new Float32Array(rY),
                    new Float32Array(rZ),
                    new Float32Array(rTo)
                ]);
                gyroRmsPlot.setScale("x", { min: startTimeUs, max: endTimeUs });
            }
        }
    }
    // syncTimeRangeUi(endTimeUs - startTimeUs);  // <-- REMOVED: Auto-expanding to 60s kills the renderer
};

window.updateReplayDashboard = function(absTimeUs, accSample, gyroSample) {
    const tsDateEl = document.getElementById('timestampDate');
    if (tsDateEl) {
        if (window.replayRecordingDate) {
            tsDateEl.style.display = 'block';
            tsDateEl.textContent = window.replayRecordingDate;
        } else {
            tsDateEl.style.display = 'none';
            tsDateEl.textContent = "";
        }
    }

    if (accSample) {
        document.getElementById("accX").textContent = accSample.x.toFixed(1);
        document.getElementById("accY").textContent = accSample.y.toFixed(1);
        document.getElementById("accZ").textContent = accSample.z.toFixed(1);
        if (accVectorViewport) {
            accVectorViewport.setAccelerationSamples(buildViewportAccelerationSamples(accSample, accSample));
        }
    }
    if (gyroSample) {
        document.getElementById("gyroX").textContent = gyroSample.x.toFixed(1);
        document.getElementById("gyroY").textContent = gyroSample.y.toFixed(1);
        document.getElementById("gyroZ").textContent = gyroSample.z.toFixed(1);
        if (accVectorViewport) {
            accVectorViewport.setGyroSamples(buildViewportGyroSamples(gyroSample, gyroSample));
        }
    }
    
    // Auto-scroll X-Axis limits (mimic Live Mode)
    const durationUs = (typeof displayDurationSeconds !== 'undefined' ? displayDurationSeconds : 5) * 1000 * 1000;
    let minX = absTimeUs - durationUs;
    let maxX = absTimeUs;
    if (minX < (window.replayStartTimeUs || 0)) {
        minX = window.replayStartTimeUs || 0;
        maxX = minX + durationUs;
    }

    // Sync UI Cursors & Horizons
    if (chart) {
        if (!chart.yLocked) {
            const yMinOriginal = chart.scales.y?.min;
            const yMaxOriginal = chart.scales.y?.max;
            chart.setScale("x", { min: minX, max: maxX });
            if (yMinOriginal !== undefined && yMaxOriginal !== undefined) {
                chart.setScale("y", { min: yMinOriginal, max: yMaxOriginal });
            }
        }
        const left = chart.valToPos(absTimeUs, "x");
        if (left > 0) chart.setCursor({ left, top: chart.cursor.top || 10 });
    }
    if (gyroChart) {
        if (!gyroChart.yLocked) {
            const gyMinOriginal = gyroChart.scales.y?.min;
            const gyMaxOriginal = gyroChart.scales.y?.max;
            gyroChart.setScale("x", { min: minX, max: maxX });
            if (gyMinOriginal !== undefined && gyMaxOriginal !== undefined) {
                gyroChart.setScale("y", { min: gyMinOriginal, max: gyMaxOriginal });
            }
        }
        const left = gyroChart.valToPos(absTimeUs, "x");
        if (left > 0) gyroChart.setCursor({ left, top: gyroChart.cursor.top || 10 });
    }
    if (typeof rmsPlot !== 'undefined' && rmsPlot) {
        const rYMinOriginal = rmsPlot.scales.y?.min;
        const rYMaxOriginal = rmsPlot.scales.y?.max;
        rmsPlot.setScale("x", { min: minX, max: maxX });
        if (rYMinOriginal !== undefined && rYMaxOriginal !== undefined) {
            rmsPlot.setScale("y", { min: rYMinOriginal, max: rYMaxOriginal });
        }
        const left = rmsPlot.valToPos(absTimeUs, "x");
        if (left > 0) rmsPlot.setCursor({ left, top: rmsPlot.cursor.top || 10 });
    }
    if (typeof gyroRmsPlot !== 'undefined' && gyroRmsPlot) {
        const grYMinOriginal = gyroRmsPlot.scales.y?.min;
        const grYMaxOriginal = gyroRmsPlot.scales.y?.max;
        gyroRmsPlot.setScale("x", { min: minX, max: maxX });
        if (grYMinOriginal !== undefined && grYMaxOriginal !== undefined) {
            gyroRmsPlot.setScale("y", { min: grYMinOriginal, max: grYMaxOriginal });
        }
        const left = gyroRmsPlot.valToPos(absTimeUs, "x");
        if (left > 0) gyroRmsPlot.setCursor({ left, top: gyroRmsPlot.cursor.top || 10 });
    }
    
    // Sync FFT histories
    if (window.waterfallRenderer && window.waterfallRenderer.timestamps.length > 0) {
        const ts = window.waterfallRenderer.timestamps;
        let bestIdx = ts.length - 1;
        let minDist = Infinity;
        for (let i = 0; i < ts.length; i++) {
            const dist = Math.abs(ts[i] - absTimeUs);
            if (dist <= minDist) {
                minDist = dist;
                bestIdx = i;
            }
        }
        const mags = window.waterfallRenderer.history[bestIdx];
        if (fftPlot && mags) {
            const freqs = new Array(mags.length);
            const sr = (typeof currentSampleRate !== 'undefined' && currentSampleRate > 0) ? currentSampleRate : 1000;
            for(let i=0; i<mags.length; i++) freqs[i] = i * sr / (mags.length * 2); 
            
            const numAvg = typeof N_AVG !== 'undefined' ? N_AVG : 10;
            const startIdx = Math.max(0, bestIdx - numAvg + 1);
            const avgArr = new Float32Array(mags.length);
            const maxArr = new Float32Array(mags.length);
            maxArr.fill(-Infinity);
            
            for(let j=0; j<=bestIdx; j++) {
                const h = window.waterfallRenderer.history[j];
                for(let i=0; i<mags.length; i++) {
                    if (h[i] > maxArr[i]) maxArr[i] = h[i];
                }
            }
            
            let count = 0;
            for(let j=startIdx; j<=bestIdx; j++) {
                const h = window.waterfallRenderer.history[j];
                for(let i=0; i<mags.length; i++) avgArr[i] += h[i];
                count++;
            }
            if(count > 0) {
                for(let i=0; i<mags.length; i++) avgArr[i] /= count;
            }
            
            fftPlot.setData([freqs, Array.from(avgArr), Array.from(maxArr), Array.from(mags)]);
            
            // Optionally update the main UI timestamp with absolute clock time if available
            const tsEl = document.getElementById('timestamp');
            if (tsEl && window.waterfallRenderer.clockStrings[bestIdx]) {
                tsEl.textContent = window.waterfallRenderer.clockStrings[bestIdx];
            }
        }
        
        if (window.isOfflineReplayMode) {
            const wR = window.waterfallRenderer;
            wR.scrollOffset = Math.max(0, wR.history.length - 1 - bestIdx);
            if (wR.active) {
                wR.renderHistory();
                wR.updateLabels();
                wR.syncScrollbar();
            }
        }
    }

    if (window.gyroWaterfallRenderer && window.gyroWaterfallRenderer.timestamps.length > 0) {
        const ts = window.gyroWaterfallRenderer.timestamps;
        let bestIdx = ts.length - 1;
        let minDist = Infinity;
        for (let i = 0; i < ts.length; i++) {
            const dist = Math.abs(ts[i] - absTimeUs);
            if (dist <= minDist) {
                minDist = dist;
                bestIdx = i;
            }
        }
        const mags = window.gyroWaterfallRenderer.history[bestIdx];
        if (gyroFftPlot && mags) {
            const freqs = new Array(mags.length);
            const sr = (typeof currentSampleRate !== 'undefined' && currentSampleRate > 0) ? currentSampleRate : 1000;
            for(let i=0; i<mags.length; i++) freqs[i] = i * sr / (mags.length * 2); 

            const numAvg = typeof N_AVG !== 'undefined' ? N_AVG : 10;
            const startIdx = Math.max(0, bestIdx - numAvg + 1);
            const avgArr = new Float32Array(mags.length);
            const maxArr = new Float32Array(mags.length);
            maxArr.fill(-Infinity);

            for(let j=0; j<=bestIdx; j++) {
                const h = window.gyroWaterfallRenderer.history[j];
                for(let i=0; i<mags.length; i++) {
                    if (h[i] > maxArr[i]) maxArr[i] = h[i];
                }
            }

            let count = 0;
            for(let j=startIdx; j<=bestIdx; j++) {
                const h = window.gyroWaterfallRenderer.history[j];
                for(let i=0; i<mags.length; i++) avgArr[i] += h[i];
                count++;
            }
            if(count > 0) {
                for(let i=0; i<mags.length; i++) avgArr[i] /= count;
            }

            gyroFftPlot.setData([freqs, Array.from(avgArr), Array.from(maxArr), Array.from(mags)]);
        }
        
        if (window.isOfflineReplayMode) {
            const gwR = window.gyroWaterfallRenderer;
            gwR.scrollOffset = Math.max(0, gwR.history.length - 1 - bestIdx);
            if (gwR.active) {
                gwR.renderHistory();
                gwR.updateLabels();
                gwR.syncScrollbar();
            }
        }
    }
};

function syncAxisOverlayPositions(chartInstance, panelId, yOverlayId, xOverlayId) {
    const panel = document.getElementById(panelId);
    const yOverlay = document.getElementById(yOverlayId);
    const xOverlay = document.getElementById(xOverlayId);
    const wrap = chartInstance?.root?.querySelector?.(".u-wrap");
    const bbox = chartInstance?.bbox;

    if (!panel || !yOverlay || !xOverlay || !wrap || !bbox) {
        return;
    }

    const panelRect = panel.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const wrapLeft = wrapRect.left - panelRect.left;
    const wrapTop = wrapRect.top - panelRect.top;

    yOverlay.style.left = `${Math.max(0, wrapLeft)}px`;
    yOverlay.style.top = `${Math.max(0, wrapTop + bbox.top)}px`;
    yOverlay.style.width = `${Math.max(0, bbox.left)}px`;
    yOverlay.style.height = `${Math.max(0, bbox.height)}px`;

    const xTop = wrapTop + bbox.top + bbox.height;
    const xHeight = Math.max(0, (wrapRect.bottom - panelRect.top) - xTop);
    const xOverlayHeight = Math.max(0, Math.min(xHeight, 18));
    xOverlay.style.left = `${Math.max(0, wrapLeft + bbox.left)}px`;
    xOverlay.style.top = `${Math.max(0, xTop)}px`;
    xOverlay.style.width = `${Math.max(0, bbox.width)}px`;
    xOverlay.style.height = `${xOverlayHeight}px`;
    xOverlay.style.bottom = "auto";
}

function preserveScalesOnSeriesToggle(chartInstance) {
    if (!chartInstance || typeof chartInstance.setSeries !== "function") {
        return;
    }

    const originalSetSeries = chartInstance.setSeries.bind(chartInstance);
    chartInstance.setSeries = (...args) => {
        const xScale = chartInstance.scales?.x;
        const yScale = chartInstance.scales?.y;
        const lockedX = xScale && Number.isFinite(xScale.min) && Number.isFinite(xScale.max)
            ? { min: xScale.min, max: xScale.max }
            : null;
        const lockedY = yScale && Number.isFinite(yScale.min) && Number.isFinite(yScale.max)
            ? { min: yScale.min, max: yScale.max }
            : null;

        const restoreScales = () => {
            if (lockedX) {
                chartInstance.setScale("x", lockedX);
            }
            if (lockedY) {
                chartInstance.setScale("y", lockedY);
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

function installManualLegendToggle(chartInstance, legendHostId = null) {
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

preserveScalesOnSeriesToggle(chart);
preserveScalesOnSeriesToggle(gyroChart);
installManualLegendToggle(chart, "accChartLegendHost");
installManualLegendToggle(gyroChart, "gyroChartLegendHost");

syncAxisOverlayPositions(chart, "livechart2", "y-axis-overlay", "x-axis-overlay");
syncAxisOverlayPositions(gyroChart, "gyrochart", "gyro-y-axis-overlay", "gyro-x-axis-overlay");

if (timestamps.length > 0) {
    const initialLatestTimestamp = timestamps[timestamps.length - 1];
    setSharedXScale(
        initialLatestTimestamp - (displayDurationSeconds * 1000000),
        initialLatestTimestamp,
        { preserveY: true, syncUi: true }
    );
}

let liveChartResizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
        const accSize = getSize();
        const gyroSize = getGyroChartSize();

        if (chart && accSize.width > 0 && accSize.height > 0) {
            chart.setSize(accSize);
        }

        if (gyroChart && gyroSize.width > 0 && gyroSize.height > 0) {
            gyroChart.setSize(gyroSize);
        }

        syncAxisOverlayPositions(chart, "livechart2", "y-axis-overlay", "x-axis-overlay");
        syncAxisOverlayPositions(gyroChart, "gyrochart", "gyro-y-axis-overlay", "gyro-x-axis-overlay");

        if (typeof rmsPlot !== "undefined" && rmsPlot) {
            syncAxisOverlayPositions(rmsPlot, "rmsPanel", "rms-y-axis-overlay", "rms-x-axis-overlay");
        }
        if (typeof gyroRmsPlot !== "undefined" && gyroRmsPlot) {
            syncAxisOverlayPositions(gyroRmsPlot, "gyroRmsPanel", "gyro-rms-y-axis-overlay", "gyro-rms-x-axis-overlay");
        }
    });
});

liveChartResizeObserver.observe(document.getElementById("livechart2"));
liveChartResizeObserver.observe(document.getElementById("gyrochart"));
if (document.getElementById("rmsPanel")) liveChartResizeObserver.observe(document.getElementById("rmsPanel"));
if (document.getElementById("gyroRmsPanel")) liveChartResizeObserver.observe(document.getElementById("gyroRmsPanel"));

let resourcesDisposed = false;

function disposeRuntimeResources() {
    if (resourcesDisposed) {
        return;
    }
    resourcesDisposed = true;

    chartUpdateRunning = false;

    if (fftUpdateTimerId !== null) {
        clearInterval(fftUpdateTimerId);
        fftUpdateTimerId = null;
    }

    if (rmsUpdateTimerId !== null) {
        clearInterval(rmsUpdateTimerId);
        rmsUpdateTimerId = null;
    }

    liveChartResizeObserver?.disconnect();
    liveChartResizeObserver = null;

    fftWorker?.terminate();
    fftWorker = null;

    rmsWorker?.terminate();
    rmsWorker = null;

    wsWorker.terminate();
    decodeWorker.terminate();
    accFilterWorker.terminate();
    gyroFilterWorker.terminate();
    downsamplingWorker.terminate();
    fusionWorker.terminate();
}

window.addEventListener("beforeunload", disposeRuntimeResources, { once: true });
window.addEventListener("pagehide", disposeRuntimeResources, { once: true });

const pauseBtn2 = document.getElementById("pauseBtn2");
let paused2 = false;
pauseBtn2.textContent = "⏸"; // Start mit Pause-Symbol
pauseBtn2.onclick = () => {
    paused = !paused;
    pauseBtn2.textContent = paused ? "▶" : "⏸";
};



let liveChartPanOffset = 0;
let rmsPanOffset = 0;
let gyroRmsPanOffset = 0;
let rmsDisplayDurationSeconds = 20;
let gyroRmsDisplayDurationSeconds = 20;

const rmsTimeSlider = document.getElementById("rmsTimeSlider");
const rmsTimeValue = document.getElementById("rmsTimeValue");
if (rmsTimeSlider && rmsTimeValue) {
    rmsTimeSlider.addEventListener("input", (e) => {
        rmsDisplayDurationSeconds = Number(e.target.value);
        rmsTimeValue.textContent = rmsDisplayDurationSeconds;
    });
}

const gyroRmsTimeSlider = document.getElementById("gyroRmsTimeSlider");
const gyroRmsTimeValue = document.getElementById("gyroRmsTimeValue");
if (gyroRmsTimeSlider && gyroRmsTimeValue) {
    gyroRmsTimeSlider.addEventListener("input", (e) => {
        gyroRmsDisplayDurationSeconds = Number(e.target.value);
        gyroRmsTimeValue.textContent = gyroRmsDisplayDurationSeconds;
    });
}

function syncTimeRangeUi(rangeUs) {
    let rangeSecs = rangeUs / 1000000;
    if (rangeSecs < 1) rangeSecs = 1;
    if (rangeSecs > 60) rangeSecs = 60;

    currentTimeRange = rangeSecs;
    displayDurationSeconds = rangeSecs;

    const timeSlider = document.getElementById("timeSlider");
    const timeValue = document.getElementById("timeValue");
    if (timeSlider) timeSlider.value = Math.round(displayDurationSeconds);
    if (timeValue) timeValue.textContent = Math.round(displayDurationSeconds);
}

function setSharedXScale(min, max, options = {}) {
    const { preserveY = true, syncUi = false } = options;
    const accYMin = preserveY ? chart?.scales?.y?.min : undefined;
    const accYMax = preserveY ? chart?.scales?.y?.max : undefined;
    const gyroYMin = preserveY ? gyroChart?.scales?.y?.min : undefined;
    const gyroYMax = preserveY ? gyroChart?.scales?.y?.max : undefined;

    chart.setScale("x", { min, max });
    if (gyroChart) {
        gyroChart.setScale("x", { min, max });
    }

    if (preserveY && accYMin !== undefined && accYMax !== undefined) {
        chart.setScale("y", { min: accYMin, max: accYMax });
    }
    if (preserveY && gyroChart && gyroYMin !== undefined && gyroYMax !== undefined) {
        gyroChart.setScale("y", { min: gyroYMin, max: gyroYMax });
    }
    if (syncUi) {
        syncTimeRangeUi(max - min);
    }
}

function getSharedXScale(sourceChart = chart) {
    const sourceScale = sourceChart?.scales?.x;
    if (sourceScale && Number.isFinite(sourceScale.min) && Number.isFinite(sourceScale.max)) {
        return sourceScale;
    }

    const fallbackScale = chart?.scales?.x;
    if (fallbackScale && Number.isFinite(fallbackScale.min) && Number.isFinite(fallbackScale.max)) {
        return fallbackScale;
    }

    return null;
}

function getCurrentSharedXWindow() {
    const scale = getSharedXScale(chart);
    if (scale && Number.isFinite(scale.min) && Number.isFinite(scale.max)) {
        return { min: scale.min, max: scale.max };
    }
    return null;
}

function zoomSharedXAxis(factor, pointerPos, sourceChart = chart) {
    const sc = getSharedXScale(sourceChart);
    if (!sc) return;
    const range = sc.max - sc.min;
    const newRange = range * factor;
    
    // Oszilloskop-Modus: Wir nageln die rechte Kante fest
    const newMax = sc.max;
    const newMin = newMax - newRange;
    if (newMax - newMin < 1e-9) return;

    setSharedXScale(newMin, newMax, { preserveY: true, syncUi: true });
}

function panSharedXAxis(deltaPx, axisPxLength, sourceChart = chart) {
    if (axisPxLength === 0) return;
    const sc = getSharedXScale(sourceChart);
    if (!sc) return;
    const range = sc.max - sc.min;
    const deltaUs = -(deltaPx / axisPxLength) * range;

    liveChartPanOffset += deltaUs;
    if (liveChartPanOffset > 0) liveChartPanOffset = 0;
    panOffset = liveChartPanOffset;

    setSharedXScale(sc.min + deltaUs, sc.max + deltaUs, { preserveY: true, syncUi: false });
}

function zoomPlotYAxis(targetChart, factor, pointerPos, nailZero = false) {
    targetChart._yLocked = true;
    const sc = targetChart.scales.y;
    const range = sc.max - sc.min;
    
    if (nailZero) {
        let newMax = sc.max * factor;
        if (newMax < 1e-9) newMax = 1e-9;
        targetChart.setScale("y", { min: 0, max: newMax });
    } else {
        const newRange = range * factor;
        const newMin = sc.min + range * pointerPos - newRange * pointerPos;
        const newMax = newMin + newRange;
        if (newMax - newMin < 1e-9) return;
        targetChart.setScale("y", { min: newMin, max: newMax });
    }
}

function panPlotYAxis(targetChart, deltaPx, axisPxLength, nailZero = false) {
    if (axisPxLength === 0) return;
    targetChart._yLocked = true;
    const sc = targetChart.scales.y;
    const range = sc.max - sc.min;
    const delta = -(deltaPx / axisPxLength) * range;
    
    if (nailZero) {
        // When nailed to 0, dragging acts purely as a scale multiplier
        let newMax = sc.max + delta * 2;
        if (newMax < 1e-9) return;
        targetChart.setScale("y", { min: 0, max: newMax });
    } else {
        targetChart.setScale("y", { min: sc.min + delta, max: sc.max + delta });
    }
}

function updateCursor(el, dragging, canDrag, axis) {
    if (dragging) {
        el.style.cursor = "grabbing";
    } else if (canDrag) {
        el.style.cursor = axis === "y" ? "ns-resize" : "ew-resize";
    } else {
        el.style.cursor = "default";
    }
}

function bindYAxisOverlay(overlayId, targetChart, nailZero = false) {
    const yOverlay = document.getElementById(overlayId);
    if (!yOverlay || !targetChart) return;

    let isPanning = false;
    let lastY = 0;

    yOverlay.addEventListener("wheel", e => {
        e.preventDefault();
        e.stopPropagation();
        const rect = yOverlay.getBoundingClientRect();
        const pointerPos = (e.clientY - rect.top) / rect.height;
        const factor = e.deltaY < 0 ? 0.85 : 1.15;
        zoomPlotYAxis(targetChart, factor, pointerPos, nailZero);
    }, { passive: false });

    yOverlay.addEventListener("dblclick", () => {
        targetChart._yLocked = false;
        // Durch erneutes Setzen der Daten triggern wir das Auto-Scaling
        if (targetChart.data) {
            targetChart.setData(targetChart.data);
        }
    });

    yOverlay.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        isPanning = true;
        lastY = e.clientY;
        updateCursor(yOverlay, true, true, "y");
    });

    window.addEventListener("mousemove", e => {
        if (!isPanning) return;
        e.preventDefault();
        const deltaY = lastY - e.clientY;
        lastY = e.clientY;
        panPlotYAxis(targetChart, deltaY, yOverlay.getBoundingClientRect().height, nailZero);
    });

    window.addEventListener("mouseup", () => {
        if (!isPanning) return;
        isPanning = false;
        updateCursor(yOverlay, false, true, "y");
    });

    yOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(yOverlay, false, true, "y"));
    yOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(yOverlay, false, false, "y"));
}

function bindSharedXAxisOverlay(overlayId, sourceChart) {
    const xOverlay = document.getElementById(overlayId);
    if (!xOverlay) return;

    let isPanning = false;
    let lastX = 0;

    xOverlay.addEventListener("wheel", e => {
        e.preventDefault();
        e.stopPropagation();
        const rect = xOverlay.getBoundingClientRect();
        const pointerPos = (e.clientX - rect.left) / rect.width;
        const factor = e.deltaY < 0 ? 0.85 : 1.15;
        zoomSharedXAxis(factor, pointerPos, sourceChart);
    }, { passive: false });

    xOverlay.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        isPanning = true;
        lastX = e.clientX;
        updateCursor(xOverlay, true, true, "x");
    });

    window.addEventListener("mousemove", e => {
        if (!isPanning) return;
        e.preventDefault();
        const deltaX = e.clientX - lastX;
        lastX = e.clientX;
        panSharedXAxis(deltaX, xOverlay.getBoundingClientRect().width, sourceChart);
    });

    window.addEventListener("mouseup", () => {
        if (!isPanning) return;
        isPanning = false;
        updateCursor(xOverlay, false, true, "x");
    });

    xOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(xOverlay, false, true, "x"));
    xOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(xOverlay, false, false, "x"));
}

bindYAxisOverlay("y-axis-overlay", chart);
bindYAxisOverlay("gyro-y-axis-overlay", gyroChart);
bindSharedXAxisOverlay("x-axis-overlay", chart);
bindSharedXAxisOverlay("gyro-x-axis-overlay", gyroChart);

function syncRmsTimeRangeUi(rangeUs, isGyro) {
    let rangeSecs = rangeUs / 1000000;
    if (rangeSecs < 1) rangeSecs = 1;

    if (isGyro) {
        gyroRmsDisplayDurationSeconds = rangeSecs;
        const timeSlider = document.getElementById("gyroRmsTimeSlider");
        const timeValue = document.getElementById("gyroRmsTimeValue");
        if (timeSlider) timeSlider.value = Math.min(300, Math.round(rangeSecs));
        if (timeValue) timeValue.textContent = Math.round(rangeSecs);
    } else {
        rmsDisplayDurationSeconds = rangeSecs;
        const timeSlider = document.getElementById("rmsTimeSlider");
        const timeValue = document.getElementById("rmsTimeValue");
        if (timeSlider) timeSlider.value = Math.min(300, Math.round(rangeSecs));
        if (timeValue) timeValue.textContent = Math.round(rangeSecs);
    }
}

function bindRmsXAxisOverlay(overlayId, targetChart, isGyro) {
    const xOverlay = document.getElementById(overlayId);
    if (!xOverlay || !targetChart) return;
    let isPanning = false;
    let lastX = 0;

    const getOffset = () => isGyro ? gyroRmsPanOffset : rmsPanOffset;
    const setOffset = (val) => { if (isGyro) gyroRmsPanOffset = val; else rmsPanOffset = val; };

    xOverlay.addEventListener("wheel", e => {
        e.preventDefault();
        e.stopPropagation();
        const rect = xOverlay.getBoundingClientRect();
        const pointerPos = (e.clientX - rect.left) / rect.width;
        const factor = e.deltaY < 0 ? 0.85 : 1.15;
        const sc = targetChart.scales.x;
        const range = sc.max - sc.min;
        const newRange = range * factor;
        
        // Oszilloskop-Modus: Rechte Kante bleibt fest
        const newMax = sc.max;
        const newMin = newMax - newRange;
        if (newMax - newMin < 1e-9) return;
        
        syncRmsTimeRangeUi(newRange, isGyro);
        
        targetChart.setScale("x", { min: newMin, max: newMax });
    }, { passive: false });

    xOverlay.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        isPanning = true;
        lastX = e.clientX;
        updateCursor(xOverlay, true, true, "x");
    });

    window.addEventListener("mousemove", e => {
        if (!isPanning) return;
        e.preventDefault();
        const deltaX = e.clientX - lastX;
        lastX = e.clientX;
        const axisPxLength = xOverlay.getBoundingClientRect().width;
        if (axisPxLength === 0) return;
        const sc = targetChart.scales.x;
        const range = sc.max - sc.min;
        const deltaUs = -(deltaX / axisPxLength) * range;

        let offset = getOffset();
        offset += deltaUs;
        if (offset > 0) offset = 0;
        setOffset(offset);

        targetChart.setScale("x", { min: sc.min + deltaUs, max: sc.max + deltaUs });
    });

    window.addEventListener("mouseup", () => {
        if (!isPanning) return;
        isPanning = false;
        updateCursor(xOverlay, false, true, "x");
    });

    xOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(xOverlay, false, true, "x"));
    xOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(xOverlay, false, false, "x"));
}


window.addEventListener("liveDataUpdate", (e) => {
    const latest = e.detail.latestTimestamp;
    const currentVisibleRange = chart.scales.x.max - chart.scales.x.min;
    const desiredVisibleRange = displayDurationSeconds * 1000000;
    const visibleRange = Number.isFinite(currentVisibleRange) && currentVisibleRange > 0
        ? currentVisibleRange
        : desiredVisibleRange;
    if (!Number.isFinite(visibleRange) || visibleRange <= 0) return;

    if (Number.isFinite(panOffset) && panOffset !== liveChartPanOffset) {
        liveChartPanOffset = panOffset;
    }

    if (liveChartPanOffset > -500000) {
        liveChartPanOffset = 0;
        panOffset = 0;
        setSharedXScale(latest - desiredVisibleRange, latest, { preserveY: true, syncUi: false });
    } else {
        setSharedXScale(latest - visibleRange + liveChartPanOffset, latest + liveChartPanOffset, { preserveY: true, syncUi: false });
    }
});

window.addEventListener("rmsDataUpdate", (e) => {
    const latest2 = e.detail.latestTimestamp;
    const currentVisibleRange = rmsPlot.scales.x.max - rmsPlot.scales.x.min;
    const desiredVisibleRange = rmsDisplayDurationSeconds * 1000000;
    const visibleRange = Number.isFinite(currentVisibleRange) && currentVisibleRange > 0
        ? currentVisibleRange
        : desiredVisibleRange;

    if (rmsPanOffset > -0.5) {
        rmsPanOffset = 0;
        rmsPlot.setScale("x", { min: latest2 - desiredVisibleRange, max: latest2 });
    } else {
        rmsPlot.setScale("x", {
            min: latest2 - visibleRange + rmsPanOffset,
            max: latest2 + rmsPanOffset
        });
    }
});

window.addEventListener("gyroRmsDataUpdate", (e) => {
    const latest2 = e.detail.latestTimestamp;
    if (!gyroRmsPlot) return;
    const currentVisibleRange = gyroRmsPlot.scales.x.max - gyroRmsPlot.scales.x.min;
    const desiredVisibleRange = gyroRmsDisplayDurationSeconds * 1000000;
    const visibleRange = Number.isFinite(currentVisibleRange) && currentVisibleRange > 0
        ? currentVisibleRange
        : desiredVisibleRange;

    if (gyroRmsPanOffset > -0.5) {
        gyroRmsPanOffset = 0;
        gyroRmsPlot.setScale("x", { min: latest2 - desiredVisibleRange, max: latest2 });
    } else {
        gyroRmsPlot.setScale("x", {
            min: latest2 - visibleRange + gyroRmsPanOffset,
            max: latest2 + gyroRmsPanOffset
        });
    }
});

window.getPanOffset = () => liveChartPanOffset;
window.setPanOffset = (offset) => {
    liveChartPanOffset = Number.isFinite(offset) ? offset : 0;
    panOffset = liveChartPanOffset;
};

// Doppelklick reset
chart.over.addEventListener("dblclick", () => {
    window.setPanOffset(0);
    if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
        setSharedXScale(lastTimestamp - (displayDurationSeconds * 1000000), lastTimestamp, { preserveY: false, syncUi: true });
    } else {
        chart.setScale("x", { auto: true });
    }
    chart.setScale("y", { min: -1100, max: 1100 });
    if (gyroChart) {
        gyroChart.setScale("y", { auto: true });
    }
});

gyroChart.over.addEventListener("dblclick", () => {
    window.setPanOffset(0);
    if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
        setSharedXScale(lastTimestamp - (displayDurationSeconds * 1000000), lastTimestamp, { preserveY: false, syncUi: true });
    } else {
        if (chart) {
            chart.setScale("x", { auto: true });
        }
        gyroChart.setScale("x", { auto: true });
    }
    if (chart) {
        chart.setScale("y", { min: -1100, max: 1100 });
    }
    gyroChart.setScale("y", { auto: true });
});

[rmsPlot, gyroRmsPlot].forEach((p, idx) => {
    if (!p || !p.over) return;
    p.over.addEventListener("dblclick", () => {
        const isGyro = idx === 1;
        if (isGyro) gyroRmsPanOffset = 0;
        else rmsPanOffset = 0;
        
        p.setScale("y", { auto: true });
        // X-axis will snap back on next data update due to panOffset = 0
    });
});





// Live-Daten Simulation & Updates mit persistierendem Pan-Offset
let lastTimestamp2 = timestamps[timestamps.length - 1];
function addLiveDataPoint() {
    if (paused) return;

    lastTimestamp2 += 1;
    timestamps.push(lastTimestamp2);
    values1.push(Math.sin(lastTimestamp2 / 5) * 10 + 50 + (Math.random() - 0.5));
    values2.push(Math.cos(lastTimestamp2 / 7) * 7 + 40 + (Math.random() - 0.5));
    values3.push(Math.sin(lastTimestamp2 / 10) * 5 + 30 + (Math.random() - 0.5));

    if (timestamps.length > maxPoints) {
        timestamps.shift();
        values1.shift();
        values2.shift();
        values3.shift();
    }

    const xMinBefore = chart.scales.x.min;
    const xMaxBefore = chart.scales.x.max;
    const yMinBefore = chart.scales.y.min;
    const yMaxBefore = chart.scales.y.max;

    chart.setData([timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]);

    // Wenn Nutzer den Pan-Bereich manuell gesetzt hat, übernehmen wir den Offset
    // Sonst automatisch weiter scollen (xPanOffset wird intern im Overlay verwaltet)
    // Wir triggern ein Event für die X-Achse, damit Overlay das neu repositioniert
    window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: lastTimestamp2 } }));

    // Y-Skala behalten
    if (yMinBefore !== undefined && yMaxBefore !== undefined) {
        chart.setScale("y", { min: yMinBefore, max: yMaxBefore });
    }
    if (xMinBefore !== undefined && xMaxBefore !== undefined) {
        chart.setScale("x", { min: xMinBefore, max: xMaxBefore });
    }
    //window.setPanOffset(0);

}
//setInterval(addLiveDataPoint, 1); // 33 FPS

const FILTER_INTERVAL_MS = 30;
const CHART_WINDOW_SECONDS = 5;
const sampleRate = 6666; // z.B. 100 Hz


function saveUplotAsPNG(uplotInstance, filename = 'chart.png') {
    // uPlot rendert auf dem Canvas im Container (erstes Canvas im Container)
    const canvas = uplotInstance.root.querySelector('canvas');

    if (!canvas) {
        console.error('Kein Canvas-Element gefunden');
        return;
    }

    // Canvas-Bild als Data-URL (PNG) holen
    const dataURL = canvas.toDataURL('image/png');

    // Erzeuge Link und simuliere Klick zum Herunterladen
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Button-Eventlistener setzen
const screenshotButton = document.getElementById('SSBtn2');
screenshotButton.addEventListener('click', () => {
    saveUplotAsPNG(chart, 'uplot-screenshot.png');
});

// POPUP

const popup = document.getElementById("popup");
const statusbar = document.getElementById("statusbar");
const okBtn = document.getElementById("okBtn");
const resetBtn = document.getElementById("resetBtn");
const cancelBtn = document.getElementById("cancelBtn");

const btn1 = document.getElementById("btn1");
const btn2 = document.getElementById("btn2");
const btn3 = document.getElementById("btn3");




//const progress = document.getElementById("progress");

const headline = document.getElementById("headline");
const buttonRow1 = document.getElementById("buttonRow1");
const buttonRow2 = document.getElementById("buttonRow2");
const buttonRow3 = document.getElementById("buttonRow3");
const command = document.getElementById("command");
const action1 = document.getElementById("action1");
const action2 = document.getElementById("action2");
const action3 = document.getElementById("action3");
const result1 = document.getElementById("result1");
const result2 = document.getElementById("result2");
const result3 = document.getElementById("result3");

document.getElementById("openBtn").addEventListener("click", openPopup);
document.getElementById("cancelBtn").addEventListener("click", closePopup);
document.getElementById("okBtn").addEventListener("click", closePopup);


function openPopup() {
    popup.style.display = "flex";
    action1.style.display = "none";
    action2.style.display = "none";
    action3.style.display = "none";
    okBtn.style.display = "none";
}

function closePopup() {
    popup.style.display = "none";

    resetAll();

    //resetStatusbar();
}


//++++++++++++++++++++++++++++++



function startCalibWorldSimple(button, progressBar, statusText) {
    console.log("Starte Kalibrierung der Welt (einfach)...  kkk");
    accBufferCALIB.clear(); // Buffer leeren für Kalibrierung
    gyroBufferCALIB.clear();
    worldSimpleGyroCaptureActive = true;
    // START-Kommando senden
    decodeWorker.postMessage({
        type: "calibcommand",
        payload: {
            calib1: true,
        }
    });

    let value = 0;
    button.disabled = true;

    const interval = setInterval(() => {
        value += 1;
        progressBar.style.width = value + "%";
        statusText.textContent = `Fortschritt: ${value}%`;
        result1.textContent = `${accBufferCALIB.length} Samples`
        if (value >= 100) {
            clearInterval(interval);
            worldSimpleGyroCaptureActive = false;
            statusText.textContent = "Fertig!";

            // NÄCHSTEN Button aktivieren
            if (button.id === "btn1") document.getElementById("btn2").disabled = false;
            if (button.id === "btn2") document.getElementById("btn3").disabled = false;

            // STOP-Kommando erst hier senden
            decodeWorker.postMessage({
                type: "calibcommand",
                payload: {
                    calib1: false,
                }
            });

            console.log("Kalibrierung der Welt (einfach) abgeschlossen.");
            console.log("ACCBUFFER:", accBufferCALIB.length);

            let N = accBufferCALIB.length;

            console.log("Streuung X [%]:", accBufferCALIB.getAbsoluteDelta("x").toFixed(2));
            console.log("Streuung Y [%]:", accBufferCALIB.getAbsoluteDelta("y").toFixed(2));
            console.log("Streuung Z [%]:", accBufferCALIB.getAbsoluteDelta("z").toFixed(2));


            // AKTUELLE BIAS-WERTE
            biasX = accBufferCALIB.getMean("x");
            biasY = accBufferCALIB.getMean("y");
            biasZ = accBufferCALIB.getMean("z");


            const measuredGravity = Math.sqrt(biasX * biasX + biasY * biasY + biasZ * biasZ);
            const accelCalibrationScale = measuredGravity > 0 ? (1000 / measuredGravity) : 1;
            tempgravity = 1000;

            let accelIdleData = [accBufferCALIB.getFieldTypedArray("x", N), accBufferCALIB.getFieldTypedArray("y", N), accBufferCALIB.getFieldTypedArray("z", N)];
            const accStats = {
                x: getBufferAxisStats(accBufferCALIB, 'x'),
                y: getBufferAxisStats(accBufferCALIB, 'y'),
                z: getBufferAxisStats(accBufferCALIB, 'z'),
            };
            const gyroZeroState = gyroBufferCALIB.length > 0
                ? {
                    x: gyroBufferCALIB.getMean('x'),
                    y: gyroBufferCALIB.getMean('y'),
                    z: gyroBufferCALIB.getMean('z'),
                }
                : null;

            command.textContent = "Kalibrierung abgeschlossen!";
            result1.innerHTML = buildSingleSensorStatsTableHtml('ACC', N, accStats, 'mg');
            okBtn.style.display = "flex"; // OK-Button anzeigen
            cancelBtn.style.display = "none"; // Reset-Button ausblenden
            // KALIBRIERUNG DURCHFÜHREN

            const quatsimple = simpleZCalibration(accelIdleData);

            setOrientationCalibrationQuaternion(quatsimple, { persistState: false });
            decodeWorker.postMessage({
                type: 'calibmode',
                payload: {
                    mode: 2,
                }
            });
            decodeWorker.postMessage({
                type: 'gravity',
                payload: {
                    gravity: tempgravity,
                }
            });
            setAccelCalibrationScale(accelCalibrationScale, { persistState: false });
            setWorldSimpleGyroState(gyroZeroState, { persistState: false });
            persistCalibrationCookie();



            console.log('Kalibrierungsquaternion Variante World + Axis:', quatsimple);

            document.getElementById("btn1").disabled = false; // Button wieder aktivieren

            document.getElementById("btn1").disabled = false; // Button wieder aktivieren
        // Prüfe, ob "World Simple" schon existiert
            applyOrientationMode(2, { syncDropdown: true, optionLabel: 'World Simple' });
            console.log("CALIBRATION DONE");
        }
    }, 30);
}

// WORLD + AXIS
document.getElementById("btn2").addEventListener("click", () => startCalibWorldAxis(
    document.getElementById("btn2"),
    document.getElementById("progress2"),
    document.getElementById("statusText2")
));
document.getElementById("btnWorldAxis").addEventListener("click", () => {
    buttonRow1.style.display = "none";
    console.log("BUTTON CLICK");
    headline.textContent = "World + Axis aktiviert";
    command.textContent = "Bitte halte das Gerät ruhig, während die Kalibrierung durchgeführt wird.";
    btn2.disabled = false;
    action1.style.display = "none";
    action2.style.display = "block";
    action3.style.display = "none";
});


let biasX = null;
let biasY = null;
let biasZ = null;
let accelIdleData = null;

function startCalibWorldAxis(button, progressBar, statusText) {
    console.log("Starte Kalibrierung der Welt (einfach)...");
    accBufferCALIB.clear(); // Buffer leeren für Kalibrierung
    // START-Kommando senden
    decodeWorker.postMessage({
        type: "calibcommand",
        payload: {
            calib1: true,
        }
    });


    // PHASE 1 - SIMPLE WORLD CALIBRATION
    let value = 0;
    button.disabled = true;

    const interval = setInterval(() => {
        value += 1;
        progressBar.style.width = value + "%";
        statusText.textContent = `Fortschritt: ${value}%`;
        result1.textContent = `${accBufferCALIB.length} Samples`
        if (value >= 100) {
            clearInterval(interval);
            statusText.textContent = "Fertig!";

            // NÄCHSTEN Button aktivieren
            if (button.id === "btn1") document.getElementById("btn2").disabled = false;
            if (button.id === "btn2") document.getElementById("btn3").disabled = false;

            // STOP-Kommando erst hier senden
            decodeWorker.postMessage({
                type: "calibcommand",
                payload: {
                    calib1: false,
                }
            });

            console.log("Kalibrierung der Welt (einfach) abgeschlossen.");
            console.log("ACCBUFFER:", accBufferCALIB.length);

            let N = accBufferCALIB.length;

            console.log("Streuung X [%]:", accBufferCALIB.getAbsoluteDelta("x").toFixed(2));
            console.log("Streuung Y [%]:", accBufferCALIB.getAbsoluteDelta("y").toFixed(2));
            console.log("Streuung Z [%]:", accBufferCALIB.getAbsoluteDelta("z").toFixed(2));
            accelIdleData = [accBufferCALIB.getFieldTypedArray("x", N), accBufferCALIB.getFieldTypedArray("y", N), accBufferCALIB.getFieldTypedArray("z", N)];
            const accStats = {
                x: getBufferAxisStats(accBufferCALIB, 'x'),
                y: getBufferAxisStats(accBufferCALIB, 'y'),
                z: getBufferAxisStats(accBufferCALIB, 'z'),
            };

            command.textContent = "Schritt 1 abgeschlossen!";
            result2.innerHTML = buildSingleSensorStatsTableHtml('ACC', N, accStats, 'mg');
            result2.style.display = "block";
            okBtn.style.display = "flex"; // OK-Button anzeigen
            cancelBtn.style.display = "none"; // Reset-Button ausblenden
            action3.style.display = "block";
            //action2.style.display = "none";
            //const quatsimple = simpleZCalibration(accelIdleData);
            //decodeWorker.postMessage({
            //   type: "calibdata",
            //   payload: {
            //       quaternion: quatsimple,
            //    }
            // });

            // AKTUELLE BIAS-WERTE
            biasX = accBufferCALIB.getMean("x");
            biasY = accBufferCALIB.getMean("y");
            biasZ = accBufferCALIB.getMean("z");


            tempgravity = Math.sqrt(biasX * biasX + biasY * biasY + biasZ * biasZ);

            console.log("Bias X [mg]:", biasX.toFixed(2));
            console.log("Bias Y [mg]:", biasY.toFixed(2));
            console.log("Bias Z [mg]:", biasZ.toFixed(2));
            btn2.disabled = false; // Button wieder aktivieren

            //calibrationMemory[1] = quatsimple;
            //CSDD2.addSelectItem({ label: "World + Axis", value: "2" }, 1)
            //CSDD2.setValue(1, true);
        }
    }, 30);
}

document.getElementById("btn3").addEventListener("click", () => startCalibWorldAxisSTEP2(
    document.getElementById("btn3"),
    document.getElementById("progress3"),
    document.getElementById("statusText3")
));






let accelmotiondata = null;
function startCalibWorldAxisSTEP2(button, progressBar, statusText) {
    console.log("Starte Kalibrierung der Welt (einfach)...");
    accBufferCALIB.clear(); // Buffer leeren für Kalibrierung
    // START-Kommando senden
    decodeWorker.postMessage({
        type: "calibcommand",
        payload: {
            calib1: true,
        }
    });


    // PHASE 1 - SIMPLE WORLD CALIBRATION
    let value = 0;
    button.disabled = true;

    const interval = setInterval(() => {
        value += 1;
        progressBar.style.width = value + "%";
        statusText.textContent = `Fortschritt: ${value}%`;
        result1.textContent = `${accBufferCALIB.length} Samples`
        if (value >= 100) {
            clearInterval(interval);
            statusText.textContent = "Fertig!";

            // NÄCHSTEN Button aktivieren
            if (button.id === "btn1") document.getElementById("btn2").disabled = false;
            if (button.id === "btn2") document.getElementById("btn3").disabled = false;

            // STOP-Kommando erst hier senden
            decodeWorker.postMessage({
                type: "calibcommand",
                payload: {
                    calib1: false,
                }
            });

            console.log("Kalibrierung der Welt (einfach) abgeschlossen.");
            console.log("ACCBUFFER:", accBufferCALIB.length);

            let N = accBufferCALIB.length;

            console.log("Streuung X [%]:", accBufferCALIB.getAbsoluteDelta("x").toFixed(2));
            console.log("Streuung Y [%]:", accBufferCALIB.getAbsoluteDelta("y").toFixed(2));
            console.log("Streuung Z [%]:", accBufferCALIB.getAbsoluteDelta("z").toFixed(2));
            accelmotiondata = [accBufferCALIB.getFieldTypedArray("x", N), accBufferCALIB.getFieldTypedArray("y", N), accBufferCALIB.getFieldTypedArray("z", N)];
            const accStats = {
                x: getBufferAxisStats(accBufferCALIB, 'x'),
                y: getBufferAxisStats(accBufferCALIB, 'y'),
                z: getBufferAxisStats(accBufferCALIB, 'z'),
            };

            command.textContent = "Schritt 1 abgeschlossen!";
            result2.innerHTML = buildSingleSensorStatsTableHtml('ACC', N, accStats, 'mg');
            result2.style.display = "block";
            okBtn.style.display = "flex"; // OK-Button anzeigen
            cancelBtn.style.display = "none"; // Reset-Button ausblenden
            action3.style.display = "block";


            // Subtrahiere den Bias von jedem Wert:
            let accCorrected = [
                accelmotiondata[0].map(val => val - biasX),
                accelmotiondata[1].map(val => val - biasY),
                accelmotiondata[2].map(val => val - biasZ)
            ];


            const quatsimple = calibrateWithZPlusXYFixed(accelIdleData, accCorrected, calibaxis1);

            setOrientationCalibrationQuaternion(quatsimple, { persistState: false });
            console.log('Kalibrierungsquaternion Variante World + Axis:', quatsimple);

            document.getElementById("btn1").disabled = false; // Button wieder aktivieren

            applyOrientationMode(2, { syncDropdown: true, optionLabel: 'World + Axis' });
            //action2.style.display = "none";
            //const quatsimple = simpleZCalibration(accelIdleData);
            //decodeWorker.postMessage({
            //   type: "calibdata",
            //   payload: {
            //       quaternion: quatsimple,
            //    }
            // });

            // AKTUELLE BIAS-WERTE
            //biasX = accBufferCALIB.getMean("x");
            //biasY = accBufferCALIB.getMean("y");
            //biasZ = accBufferCALIB.getMean("z");

            //console.log("Bias X [mg]:", biasX.toFixed(2));
            //console.log("Bias Y [mg]:", biasY.toFixed(2));
            //console.log("Bias Z [mg]:", biasZ.toFixed(2));
            btn2.disabled = false; // Button wieder aktivieren

            //calibrationMemory[1] = quatsimple;
            //CSDD2.addSelectItem({ label: "World + Axis", value: "2" }, 1)
            //CSDD2.setValue(1, true);
        }
    }, 30);
}





function captureCurrentReferenceState(button, progressBar, statusText) {
    if (referenceCaptureActive) {
        return;
    }

    if (accRawBuffer.length < REFERENCE_CAPTURE_MIN_SAMPLES) {
        statusText.textContent = "Zu wenig Rohdaten";
        result1.textContent = "Bitte kurz warten, bis genug ACC-Rohdaten vorhanden sind.";
        return;
    }

    accBufferCALIB.clear();
    gyroBufferCALIB.clear();
    referenceCaptureActive = true;
    button.disabled = true;
    progressBar.style.width = '0%';
    statusText.textContent = 'Erfasse Referenz...';
    result1.textContent = '0 ACC Samples\n0 Gyro Samples';

    let progress = 0;
    const interval = setInterval(() => {
        progress += 1;
        progressBar.style.width = `${progress}%`;
        statusText.textContent = `Fortschritt: ${progress}%`;
        result1.textContent = `${accBufferCALIB.length} ACC Samples\n${gyroBufferCALIB.length} Gyro Samples`;

        if (progress < CALIBRATION_CAPTURE_STEPS) {
            return;
        }

        clearInterval(interval);
        referenceCaptureActive = false;

        const accSampleCount = accBufferCALIB.length;
        const gyroSampleCount = gyroBufferCALIB.length;

        if (accSampleCount < REFERENCE_CAPTURE_MIN_SAMPLES) {
            statusText.textContent = 'Zu wenig Rohdaten';
            result1.textContent = 'Es wurden zu wenige ACC-Rohdaten während der Referenzaufnahme erfasst.';
            button.disabled = false;
            progressBar.style.width = '0%';
            return;
        }

        const accStats = {
            x: getBufferAxisStats(accBufferCALIB, 'x'),
            y: getBufferAxisStats(accBufferCALIB, 'y'),
            z: getBufferAxisStats(accBufferCALIB, 'z'),
        };
        const gyroStats = gyroSampleCount > 0 ? {
            x: getBufferAxisStats(gyroBufferCALIB, 'x'),
            y: getBufferAxisStats(gyroBufferCALIB, 'y'),
            z: getBufferAxisStats(gyroBufferCALIB, 'z'),
        } : {
            x: { mean: 0, stdDev: 0, delta: 0 },
            y: { mean: 0, stdDev: 0, delta: 0 },
            z: { mean: 0, stdDev: 0, delta: 0 },
        };

        console.log('Reference ACC Streuung X [mg]:', accStats.x.stdDev.toFixed(2));
        console.log('Reference ACC Streuung Y [mg]:', accStats.y.stdDev.toFixed(2));
        console.log('Reference ACC Streuung Z [mg]:', accStats.z.stdDev.toFixed(2));
        console.log('Reference GYRO Streuung X [m°/s]:', gyroStats.x.stdDev.toFixed(2));
        console.log('Reference GYRO Streuung Y [m°/s]:', gyroStats.y.stdDev.toFixed(2));
        console.log('Reference GYRO Streuung Z [m°/s]:', gyroStats.z.stdDev.toFixed(2));

        currentReferenceState = {
            x: accStats.x.mean,
            y: accStats.y.mean,
            z: accStats.z.mean,
            gx: gyroStats.x.mean,
            gy: gyroStats.y.mean,
            gz: gyroStats.z.mean,
        };

        decodeWorker.postMessage({
            type: 'referenceState',
            payload: currentReferenceState
        });

        applyOrientationMode(3, { syncDropdown: true, optionLabel: 'Reference' });

        statusText.textContent = 'Fertig!';
        command.textContent = 'Referenz gespeichert!';
        result1.innerHTML = buildCalibrationStatsTableHtml(accSampleCount, gyroSampleCount, accStats, gyroStats);
        okBtn.style.display = 'flex';
        cancelBtn.style.display = 'none';
        button.disabled = false;
    }, CALIBRATION_CAPTURE_STEP_MS);
}

// Button-Events
// CALIB WORLD SIMPLE / REFERENCE
document.getElementById("btn1").addEventListener("click", () => {
    const button = document.getElementById("btn1");
    const progressBar = document.getElementById("progress1");
    const statusText = document.getElementById("statusText1");

    if (calibrationFlow === 'reference') {
        captureCurrentReferenceState(button, progressBar, statusText);
        return;
    }

    startCalibWorldSimple(button, progressBar, statusText);
});







document.getElementById("btn3").addEventListener("click", () => startProgress(
    document.getElementById("btn3"),
    document.getElementById("progress3"),
    document.getElementById("statusText3")
));


function resetAll() {
    // Buttons zurücksetzen
    command.textContent = "";
    result1.textContent = "";
    okBtn.style.display = "none"; // OK-Button ausblenden
    cancelBtn.style.display = "flex"; // Reset-Button wieder anzeigen
    buttonRow1.style.display = "flex";
    document.getElementById("headline").textContent = "Koordinatensystem wählen";
    document.getElementById("btn1").textContent = "Starte Kalibrierung";
    calibrationFlow = 'worldSimple';


    action1.style.display = "none";
    action2.style.display = "none";
    action3.style.display = "none";
    okBtn.style.display = "none";



    document.getElementById("btn1").disabled = false;
    document.getElementById("btn2").disabled = true;
    document.getElementById("btn3").disabled = true;

    // Progressbars und Statustexte zurücksetzen
    for (let i = 1; i <= 3; i++) {
        document.getElementById(`progress${i}`).style.width = "0%";
        document.getElementById(`statusText${i}`).textContent = "Bereit";
    }
}

// Event für Reset-Button
document.getElementById("resetBtn").addEventListener("click", resetAll);

let calibaxis1 = 'x';
const axisselector2 = new UniDropdown(document.getElementById('axisselector2'), {
    type: 'select',
    label: 'Wähle Achse',
    items: [
        { value: 'x', label: "X" },
        { value: 'y', label: "Y" },
    ],
    onChange: (value, label) => {
        calibaxis1 = value;
        console.log('Ausgewählt:', "KALIBRIERACHSE", calibaxis1);
    }
});






// WORLD SIMPLE
document.getElementById("btnWorldSimple").addEventListener("click", () => {
    calibrationFlow = 'worldSimple';
    headline.textContent = "World Simple aktiviert";
    command.textContent = "Bitte halte das Gerät ruhig, während die Kalibrierung durchgeführt wird.";
    document.getElementById("btn1").textContent = "Starte Kalibrierung";

    buttonRow1.style.display = "none";

    action1.style.display = "block";
    action2.style.display = "none";
    action3.style.display = "none";
});



document.getElementById("btnTwoAxis").addEventListener("click", () => {
    headline.textContent = "Two Axis aktiviert";
    buttonRow1.style.display = "none";
});

document.getElementById("btnReferenceState").addEventListener("click", () => {
    calibrationFlow = 'reference';
    headline.textContent = "Reference aktiviert";
    command.textContent = "Bitte halte das Gerät ruhig. ACC und Gyro werden mehrere Sekunden gemittelt und anschliessend als Referenz verwendet.";
    document.getElementById("btn1").textContent = "Referenz erfassen";

    buttonRow1.style.display = "none";
    action1.style.display = "block";
    action2.style.display = "none";
    action3.style.display = "none";
});


// GRAVITY

const btn = document.getElementById('gravityBtn');
btn?.classList.toggle('toggle-on', gravityCutEnabled);

function setGravityCutEnabled(enabled, { persistState = true, notifyWorker = true } = {}) {
    const normalizedEnabled = Boolean(enabled);
    gravityCutEnabled = normalizedEnabled;
    btn?.classList.toggle('toggle-on', normalizedEnabled);

    if (notifyWorker) {
        decodeWorker.postMessage({
            type: "setgravity",
            payload: {
                gravity: normalizedEnabled,
            }
        });
    }

    if (persistState) {
        persistAppSettingsCookie();
    }
}

btn?.addEventListener('click', function () {
    setGravityCutEnabled(!gravityCutEnabled);
});


// ======= AUDIO SONIFICATION POC =======
window.audioCtx = null;
window.audioScriptNode = null;
window.audioRingBuffer = new Float32Array(65536);
window.audioWriteIdx = 0;
window.audioReadIdx = 0;
window.sonificationEnabled = false;
window.audioHighPass = 0;
window.audioPrevZ = 0;

window.audioFractionalReadIdx = 0;

window.toggleSonification = function() {
    const btn = document.getElementById("btnSonification");
    if (!window.sonificationEnabled) {
        if (!window.audioCtx) {
            try {
                window.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 8000 });
            } catch(e) {
                window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            window.audioScriptNode = window.audioCtx.createScriptProcessor(2048, 0, 1);
            
            window.audioScriptNode.onaudioprocess = function(e) {
                let out = e.outputBuffer.getChannelData(0);
                let srIn = 6600; // Expected sensor rate
                let srOut = window.audioCtx.sampleRate;
                let step = srIn / srOut;

                for (let i = 0; i < out.length; i++) {
                    let integerIdx = Math.floor(window.audioFractionalReadIdx);
                    let available = (window.audioWriteIdx - integerIdx + window.audioRingBuffer.length) % window.audioRingBuffer.length;
                    
                    if (available > 10000) {
                        // Resync if we fell way behind
                        window.audioFractionalReadIdx = (window.audioWriteIdx - 1000 + window.audioRingBuffer.length) % window.audioRingBuffer.length;
                        available = 1000;
                    }

                    if (available > 2) {
                        let idx1 = integerIdx;
                        let idx2 = (idx1 + 1) % window.audioRingBuffer.length;
                        let frac = window.audioFractionalReadIdx - idx1;
                        
                        out[i] = window.audioRingBuffer[idx1] + frac * (window.audioRingBuffer[idx2] - window.audioRingBuffer[idx1]);
                        
                        window.audioFractionalReadIdx += step;
                        if (window.audioFractionalReadIdx >= window.audioRingBuffer.length) {
                            window.audioFractionalReadIdx -= window.audioRingBuffer.length;
                        }
                    } else {
                        out[i] = 0; // buffer underrun/starvation
                    }
                }
            };
            window.audioScriptNode.connect(window.audioCtx.destination);
        }
        window.audioCtx.resume().then(() => {
            window.sonificationEnabled = true;
            if (btn) {
                btn.innerHTML = `<i class="fas fa-volume-up"></i> AUDIO: ON`;
                btn.style.background = "rgba(255, 0, 0, 0.3)";
                btn.style.color = "#FFD600";
                btn.style.border = "1px solid red";
            }
        });
    } else {
        if (window.audioCtx) {
            window.audioCtx.suspend().then(() => {
                window.sonificationEnabled = false;
                if (btn) {
                    btn.innerHTML = `<i class="fas fa-volume-up"></i> Audio: OFF`;
                    btn.style.background = "";
                    btn.style.border = "";
                }
            });
        }
    }
};















