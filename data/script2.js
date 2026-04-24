import { calibrateWithZPlusXYFixed, calibrateWithZPlusXYSuperSimple, simpleZCalibration, calibrateWithZPlusXYSimple, calibrateWithIdleDataOnly, calibrateWithZPlusXY, calibrateWithZPlusXY2, calibrateTwoAxesFlexible, applyCalibrationToAccel, calibrateWithZPlusXYStrict } from './imuCalibration.js?v=20';
import { MultiRingBuffer2, UniDropdown } from './helperclasses.js?v=20';
import { AccVectorViewport } from './ui/acc-vector-viewport.js?v=20';
import {
    createFftChartOptions,
    createLegendMount,
    createLiveChartOptions,
    createRmsChartOptions,
    installManualLegendToggle,
    preserveScalesOnSeriesToggle,
} from './ui/chart-factories.js?v=21';
import { createChartInteractionRuntime } from './ui/chart-interactions.js?v=20';
import { syncWaterfallRenderer, updateSharedFftPlot, updateSharedMultiFftData, updateSingleFftPlot } from './ui/fft-runtime.js?v=23';
import { getFftChartSize, getGyroChartSize, getGyroFftChartSize, getGyroRmsChartSize, getRmsChartSize, getSize, getViewportMetrics, updateFftRmsPanelHeights, updateGyroFftRmsPanelHeights, updateLiveChartPanelHeights } from './ui/chart-layout.js?v=20';
import { applyPlotDataWithLockedY, startMultiSensorRmsUpdatesRuntime, startGyroRmsUpdatesRuntime, alignPlotDataToSeriesCount, bindRmsControlsRuntime, createRmsWorkerRuntime } from './ui/rms-runtime.js?v=27';
import { applyStaticReplayData as applyStaticReplayDataHelper, updateReplayDashboard as updateReplayDashboardHelper } from './ui/replay-sync.js?v=20';
import { buildSettingsColumnForNode, setupButtons } from './ui/ui-setup.js?v=21';
import { MotionViewport } from './ui/motion-viewport.js?v=21';
import { initRelativeAnalysisUI, updateRelativeAnalysisNodeSelector, initRelativeDiffRmsChart, initRelativeTranslationChart, startRelativeDiffRmsRuntime, initRelativeKinematicViewport, initRelativeLissajousChart } from './ui/relative-analysis.js';
import { createRecordingRow, downloadRecordedCsv as downloadRecordedCsvPure, formatMicrosecondsToHMS, formatRuntimeMicroseconds, toRegularArray } from './utils/format-utils.js';
import {
    buildCurrentAppSettingsState,
    buildCurrentCalibrationCookieState,
    clearLegacyAppSettingsStorage as clearLegacyAppSettingsStoragePure,
    getLocalStorageValue,
    persistAppSettingsCookie as persistAppSettingsCookiePure,
    persistCalibrationCookieState,
    readAppSettingsCookieState as readAppSettingsCookieStatePure,
    readCalibrationCookieState as readCalibrationCookieStatePure,
    restoreAppSettingsFromPersistence,
    restoreCalibrationFromPersistence,
    sanitizeCustomWsHost,
} from './app/orientation/calibration-store.js';
import {
    applyAccelCalibrationScale as applyAccelCalibrationScalePure,
    applyGravityCutToSample as applyGravityCutToSamplePure,
    buildCalibrationStatsTableHtml as buildCalibrationStatsTableHtmlPure,
    buildLiveAccelerationSample as buildLiveAccelerationSamplePure,
    buildLiveGyroSample as buildLiveGyroSamplePure,
    buildMotionAccelerationSample as buildMotionAccelerationSamplePure,
    buildSingleSensorStatsTableHtml as buildSingleSensorStatsTableHtmlPure,
    buildViewportAccelerationSamples as buildViewportAccelerationSamplesPure,
    buildViewportBaseAccelerationSample as buildViewportBaseAccelerationSamplePure,
    buildViewportGyroSamples as buildViewportGyroSamplesPure,
    calculateStats as calculateStatsPure,
    getBufferAxisStats as getBufferAxisStatsPure,
    getViewportAdjustmentQuaternionXYZW as getViewportAdjustmentQuaternionXYZWPure,
    getViewportBaseQuaternionXYZW as getViewportBaseQuaternionXYZWPure,
    getViewportEffectiveQuaternionXYZW as getViewportEffectiveQuaternionXYZWPure,
    getViewportGravityMagnitude as getViewportGravityMagnitudePure,
    resolveGravityCutVectorSample,
    resolveOrientationMode,
    setOrientationCalibrationQuaternion as setOrientationCalibrationQuaternionPure,
    syncMotionWorkerTransform as syncMotionWorkerTransformPure,
    syncViewportBaseQuaternion as syncViewportBaseQuaternionPure,
    syncViewportPostTransformQuaternion as syncViewportPostTransformQuaternionPure,
    updateAccelCalibrationScale,
    updateWorldSimpleGyroState,
} from './app/orientation/orientation-runtime.js';
import { getIdentityQuaternionXYZW } from './app/orientation/orientation-math.js';

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
let FFT_UPDATE_INTERVAL = 1000 / 20;
let RMS_UPDATE_INTERVAL = 50;
let FFT_WINDOW_SIZE = 2048;
let fftUpdateTimerId = null;
let rmsUpdateTimerId = null;
const fftMaxBuffer = [];
let N_AVG = 10;
let avgFFTBuffer = [];
let RMS_WINDOW_SIZE = 100;
let GYRO_FFT_UPDATE_INTERVAL = 1000 / 20;
let GYRO_FFT_WINDOW_SIZE = 2048;
let gyroFftUpdateTimerId = null;
let gyroRmsUpdateTimerId = null;
const gyroFftMaxBuffer = [];
let gyroN_AVG = 10;
let gyroAvgFFTBuffer = [];
const GYRO_FFT_RING_SIZE = 2 * 1000 / GYRO_FFT_UPDATE_INTERVAL;
let GYRO_FFT_WINDOW_TYPE = 'RECTANGULAR';
let GYRO_DC_CUTOFF = true;
let GYRO_FFT_AXIS_MODE = 'COMBI';
let gyroFftHighPass = 0;
const FFT_RING_SIZE = 2 * 1000 / FFT_UPDATE_INTERVAL;
let FFT_WINDOW_TYPE = 'RECTANGULAR';
let DC_CUTOFF = true;
let FFT_AXIS_MODE = 'COMBI';
let fftHighPass = 0;
let FFT_WINDOW_TIME_S = 2;
let GYRO_FFT_WINDOW_TIME_S = 2;
let fftWorkerBusy = false;
let gyroFftWorkerBusy = false;
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

let ausrichtung = [0, 0, 0, 0];

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
        for (let i = 0; i < 4; i++) {
            if (window.chartData[i]) window.chartData[i].length = 0;
            if (window.gyroChartData && typeof window.gyroChartData[i] !== "undefined") window.gyroChartData[i].length = 0;
        }
    }
    
    if (window.multiChartData) window.multiChartData.forEach(arr => arr.length = 0);
    if (window.multiGyroChartData) window.multiGyroChartData.forEach(arr => arr.length = 0);
    if (window.multiFftData) window.multiFftData.forEach(arr => arr.length = 0);
    if (window.multiGyroFftData) window.multiGyroFftData.forEach(arr => arr.length = 0);

    if (window.waterfallRenderer) window.waterfallRenderer.clear();
    if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.clear();
    if (typeof window.syncMotionWorkerTransform === 'function') window.syncMotionWorkerTransform({ reset: true });
    if (typeof window.resetRelativeAnalysisBuffers === 'function') window.resetRelativeAnalysisBuffers();

    if (typeof chart !== 'undefined' && chart) {
        chart.setScale("x", { auto: true });
    }
    if (typeof gyroChart !== 'undefined' && gyroChart) {
        gyroChart.setScale("x", { auto: true });
    }

    window.samplecount = 0;
};

let initialisiert = false;
let displayDurationSeconds = 5;

let filePartIndex = 0;
const MAX_RECORDED_ROWS = 500000;
const ACC_CSV_HEADERS = [
    'time_local_hms',
    'timestamp_us',
    'acc_x_mg',
    'acc_y_mg',
    'acc_z_mg',
];
const GYRO_CSV_HEADERS = [
    'time_local_hms',
    'timestamp_us',
    'gyro_x_mdeg/s',
    'gyro_y_mdeg/s',
    'gyro_z_mdeg/s',
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
const ENABLE_FUSION_PIPELINE = true;

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

window.globalMotionState = null;
if (ENABLE_MOTION_VIEW) {
    motionWorker.onmessage = (event) => {
        if (event.data && event.data.type === 'state') {
            window.globalMotionState = event.data;
        }
    };
}

function setupFilterWorker() {
    const chartVisibilityCheckboxes = {
        acc: document.getElementById('showAccChartToggle'),
        gyro: document.getElementById('showGyroChartToggle'),
    };
    const syncToggle = document.getElementById('syncFiltersToggle');

    function setChartVisibility(key, visible) {
        if (key === 'acc') {
            accChartVisible = visible;
            const liveChartPanel = document.getElementById('livechart2');
            if (liveChartPanel) {
                liveChartPanel.style.display = visible ? '' : 'none';
            }
            if (chart) {
                chart.root.style.display = visible ? '' : 'none';
            }
            return;
        }

        gyroChartVisible = visible;
        const gyroChartPanel = document.getElementById('gyrochart');
        if (gyroChartPanel) {
            gyroChartPanel.style.display = visible ? '' : 'none';
        }
        if (gyroChart) {
            gyroChart.root.style.display = visible ? '' : 'none';
        }
    }

    function applyFilterPanelEnabledState(panel, enabled) {
        panel.root.style.opacity = enabled ? '1' : '0.55';
        panel.root.style.pointerEvents = enabled ? '' : 'none';
    }

    function buildTransformOptions(transforms) {
        return transforms.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
    }

    function populateSelectDropdown(dropdown, items, onSelect) {
        dropdown.options.items = items;
        dropdown.dropdownContent.innerHTML = '';
        items.forEach(item => {
            const option = document.createElement('a');
            option.href = '#';
            option.dataset.value = item.value;
            option.textContent = item.label;
            dropdown.dropdownContent.appendChild(option);
            option.addEventListener('click', event => {
                event.preventDefault();
                dropdown.setActiveOption(option);
                dropdown.close();
                onSelect(item.value);
            });
        });
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

        const createPanelDropdown = (property, suffix, options) => {
            panel[property] = new UniDropdown(document.getElementById(`${prefix}${suffix}`), options);
        };

        createPanelDropdown('typeDropdown', 'TypeDropdown', {
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

        createPanelDropdown('designDropdown', 'DesignDropdown', {
            type: 'select',
            label: 'DS',
            items: [{ value: 'butterworth', label: 'Butterworth' }],
            defaultValue: 'butterworth',
            onChange: value => panel.onDesignChange(panel.typeDropdown.getValue()?.value || 'none', value)
        });

        createPanelDropdown('transformDropdown', 'TransformDropdown', {
            type: 'select',
            label: 'Transform',
            items: buildTransformOptions(['bilinear', 'matchedz']),
            defaultValue: 'bilinear',
            onChange: () => {
                panel.updateDesignOptions(panel.transformDropdown.getValue()?.value || 'bilinear');
                onPanelChanged();
            }
        });

        createPanelDropdown('orderDropdown', 'OrderDropdown', {
            type: 'slider',
            label: 'N',
            min: 1,
            max: 5,
            step: 1,
            defaultValue: 2,
            onChange: onPanelChanged,
        });

        createPanelDropdown('cutoffDropdown', 'CutoffDropdown', {
            type: 'logslider',
            label: 'Cutoff (Hz)',
            minValue: 0.001,
            maxValue: 1,
            step: 0.01,
            defaultValue: 0.1,
            onChange: onPanelChanged,
        });

        createPanelDropdown('gainDropdown', 'GainDropdown', {
            type: 'slider',
            label: 'Gain (dB)',
            min: -30,
            max: 30,
            step: 0.1,
            defaultValue: 0,
            onChange: onPanelChanged,
        });

        createPanelDropdown('rippleDropdown', 'RippleDropdown', {
            type: 'slider',
            label: 'Ripple (dB)',
            min: 0,
            max: 5,
            step: 0.1,
            defaultValue: 0,
            onChange: onPanelChanged,
        });

        createPanelDropdown('attenuationDropdown', 'AttenuationDropdown', {
            type: 'slider',
            label: 'Attenuation (dB)',
            min: 10,
            max: 80,
            step: 1,
            defaultValue: 40,
            onChange: onPanelChanged,
        });

        createPanelDropdown('bandwidthDropdown', 'BandwidthDropdown', {
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
            populateSelectDropdown(panel.designDropdown, options, value => {
                panel.onDesignChange(panel.typeDropdown.getValue()?.value || 'none', value);
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

            populateSelectDropdown(panel.designDropdown, designsForType, value => {
                panel.onDesignChange(selectedType, value);
            });

            panel.designDropdown.container.style.display = 'block';
            panel.designDropdown.setValueSelect(designsForType[0].value, true);
            panel.onDesignChange(selectedType, designsForType[0].value);
        };

        panel.onDesignChange = (selectedType, selectedDesign) => {
            const paramControlMap = {
                gain: panel.gainDropdown.container,
                ripple: panel.rippleDropdown.container,
                attenuation: panel.attenuationDropdown.container,
                bandwidth: panel.bandwidthDropdown.container,
                oneDb: panel.oneDbCheckboxContainer,
            };

            [
                panel.cutoffDropdown.container,
                panel.orderDropdown.container,
                panel.designDropdown.container
            ].forEach(container => {
                container.style.display = 'block';
            });

            [...Object.values(paramControlMap), panel.transformDropdown.container].forEach(container => {
                container.style.display = 'none';
            });

            const paramList = (filterParamVisibility[selectedType] && filterParamVisibility[selectedType][selectedDesign]) || [];
            paramList.forEach(param => {
                paramControlMap[param] && (paramControlMap[param].style.display = 'block');
            });

            const designsForType = filterTypeMap[selectedType] || [];
            const selectedDesignObj = designsForType.find(d => d.value === selectedDesign);
            if (selectedDesignObj) {
                const transformItems = buildTransformOptions(selectedDesignObj.transforms);
                populateSelectDropdown(panel.transformDropdown, transformItems, transform => {
                    panel.updateDesignOptions(transform);
                    onPanelChanged();
                });
                panel.transformDropdown.setValue(selectedDesignObj.transforms[0], true);
                panel.transformDropdown.container.style.display = selectedDesignObj.transforms.length > 1 ? 'block' : 'none';
            }

            onPanelChanged();
        };

        panel.copyFrom = sourcePanel => {
            panel.typeDropdown.setValue(sourcePanel.typeDropdown.getValue()?.value || 'none', true);
            panel.onTypeChange(sourcePanel.typeDropdown.getValue()?.value || 'none');
            panel.designDropdown.setValue(sourcePanel.designDropdown.getValue()?.value || 'butterworth', true);
            panel.onDesignChange(sourcePanel.typeDropdown.getValue()?.value || 'none', sourcePanel.designDropdown.getValue()?.value || 'butterworth');
            [
                'transformDropdown',
                'orderDropdown',
                'cutoffDropdown',
                'gainDropdown',
                'rippleDropdown',
                'attenuationDropdown',
                'bandwidthDropdown'
            ].forEach(property => {
                panel[property].setValue(sourcePanel[property].getValue(), true);
            });
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

    Object.entries(chartVisibilityCheckboxes).forEach(([key, checkbox]) => {
        checkbox?.addEventListener('change', () => setChartVisibility(key, checkbox.checked));
    });
    syncToggle?.addEventListener('change', () => {
        filterSyncEnabled = syncToggle.checked;
        if (filterSyncEnabled) {
            syncFilterPanel('gyro', accFilterUi);
        }
        applyFilterPanelEnabledState(gyroFilterUi, !filterSyncEnabled);
    });

    accFilterWorker.onmessage = e => handleFilterWorkerMessage('acc', e.data);
    gyroFilterWorker.onmessage = e => handleFilterWorkerMessage('gyro', e.data);

    filterSyncEnabled = syncToggle?.checked ?? false;

    setChartVisibility('acc', true);
    setChartVisibility('gyro', true);
    applyFilterPanelEnabledState(gyroFilterUi, !filterSyncEnabled);
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
        chartRef.setData(alignPlotDataToSeriesCount(chartRef, [times, x, y, z, total]));
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
            let tx = x[index], ty = y[index], tz = z[index];
            accBufferFiltered.push([times[index], tx, ty, tz, total ? total[index] : Math.sqrt(tx*tx + ty*ty + tz*tz)]);
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

const accelRangeItems = [
    { value: 2, label: "±2g" },
    { value: 4, label: "±4g" },
    { value: 8, label: "±8g" },
    { value: 16, label: "±16g" },
];
const sampleRateItems = [
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
    { value: 6660, label: "6660 Hz" },
];
const filterItems = [
    { value: 0, label: "OFF" },
    { value: 1, label: "LOWPASS" },
    { value: 2, label: "HIGHPASS 1" },
    { value: 3, label: "HIGHPASS 2" },
];
const gyroRangeItems = [
    { value: 125, label: "±125°/s" },
    { value: 250, label: "±250°/s" },
    { value: 500, label: "±500°/s" },
    { value: 1000, label: "±1000°/s" },
    { value: 2000, label: "±2000°/s" },
];
const tempSampleRateItems = [
    { value: 0, label: "OFF" },
    { value: 1, label: "1.6 Hz" },
    { value: 2, label: "12.5 Hz" },
    { value: 3, label: "52 Hz" },
];

function createLoggedDropdown(elementId, label, items) {
    return new UniDropdown(document.getElementById(elementId), {
        type: 'select',
        label,
        items,
        onChange: (value, selectedLabel) => {
            console.log('Ausgewählt:', value, selectedLabel);
        }
    });
}

function createOptionalUniDropdown(elementId, options) {
    const container = document.getElementById(elementId);
    if (container) {
        return new UniDropdown(container, options);
    }

    return {
        options,
        dropdownContent: { innerHTML: '' },
        setValue() {},
        getValue() { return null; },
        setActiveOption() {},
        setValueSelect() {},
        setDisplayMultiplier() {},
        close() {},
        open() {},
    };
}

function createWsBackedOptionalDropdown(elementId, label, items, settingKey) {
    return createOptionalUniDropdown(elementId, {
        type: 'select',
        label,
        items,
        onChange: (value, selectedLabel) => {
            const settingsJSON = JSON.stringify({ [settingKey]: value });
            wsWorker.postMessage({ type: 'send', msgContent: settingsJSON });
            console.log('Ausgewählt:', value, selectedLabel);
        }
    });
}

const accelRangeDD = createWsBackedOptionalDropdown('accelRangeDD', 'Acc Range', accelRangeItems, 'ACCELRANGE');
const accelSampleRateDD = createWsBackedOptionalDropdown('accelSampleRateDD', 'Sample Rate', sampleRateItems, 'ACCELSAMPLERATE');
const accelFilterDD = createWsBackedOptionalDropdown('accelFilterDD', 'Accel Filter', filterItems, 'ACCELFILTER');
const gyroRangeDD = createWsBackedOptionalDropdown('gyroRangeDD', 'Gyro Range', gyroRangeItems, 'GYRORANGE');
const gyroSampleRateDD = createWsBackedOptionalDropdown('gyroSampleRateDD', 'Gyro Sample Rate', sampleRateItems, 'GYROSAMPLERATE');
const gyroFilterDD = createWsBackedOptionalDropdown('gyroFilterDD', 'Gyro Filter', filterItems, 'GYROFILTER');
const accelRangeDD2 = createWsBackedOptionalDropdown('accelRangeDD2', 'Acc Range', accelRangeItems, 'ACCELRANGE');
const accelSampleRateDD2 = createWsBackedOptionalDropdown('accelSampleRateDD2', 'Sample Rate', sampleRateItems, 'ACCELSAMPLERATE');
const accelFilterDD2 = createWsBackedOptionalDropdown('accelFilterDD2', 'Accel Filter', filterItems, 'ACCELFILTER');
const gyroRangeDD2 = createWsBackedOptionalDropdown('gyroRangeDD2', 'Gyro Range', gyroRangeItems, 'GYRORANGE');
const gyroSampleRateDD2 = createWsBackedOptionalDropdown('gyroSampleRateDD2', 'Gyro Sample Rate', sampleRateItems, 'GYROSAMPLERATE');
const gyroFilterDD2 = createWsBackedOptionalDropdown('gyroFilterDD2', 'Gyro Filter', filterItems, 'GYROFILTER');
const tempSampleRateDD2 = createWsBackedOptionalDropdown('tempSampleRateDD2', 'Temp Samplerate', tempSampleRateItems, 'TEMPSAMPLERATE');

// SIDEPANEL SETTINGS

const CSDD2 = {
    items: [],
    addSelectItem: () => {},
    setValue: () => {}
};

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
        chart.setData(alignPlotDataToSeriesCount(chart, [[], [], [], [], []]));
        chart.setScale('y', { min: -1100, max: 1100 });
        chart.setScale('x', { auto: true });
    }

    if (typeof gyroChart !== 'undefined' && gyroChart) {
        gyroChart.setData([[], [], [], []]);
        gyroChart.setScale('y', { auto: true });
        gyroChart.setScale('x', { auto: true });
    }
}

function getCurrentAppSettingsState() {
    return buildCurrentAppSettingsState({
        appSettingsCookieVersion: APP_SETTINGS_COOKIE_VERSION,
        telemetryPanelHidden: telemetryElements.panel?.classList.contains('is-hidden') ?? true,
        gravityCutEnabled,
        customWsHost: persistedCustomWsHost,
    });
}

function persistAppSettingsCookie() {
    persistAppSettingsCookiePure({
        appSettingsCookieName: APP_SETTINGS_COOKIE_NAME,
        appSettingsStorageKey: APP_SETTINGS_STORAGE_KEY,
        appSettingsCookieMaxAgeSeconds: APP_SETTINGS_COOKIE_MAX_AGE_SECONDS,
        state: getCurrentAppSettingsState(),
    });
}

function readAppSettingsCookieState() {
    return readAppSettingsCookieStatePure({
        appSettingsCookieName: APP_SETTINGS_COOKIE_NAME,
        appSettingsStorageKey: APP_SETTINGS_STORAGE_KEY,
        appSettingsCookieVersion: APP_SETTINGS_COOKIE_VERSION,
        legacyTelemetryHidden: getLocalStorageValue(TELEMETRY_PANEL_HIDDEN_KEY),
        legacyWsHost: getLocalStorageValue(LEGACY_WS_HOST_STORAGE_KEY),
    });
}

function restoreAppSettingsFromCookie() {
    restoreAppSettingsFromPersistence({
        persisted: readAppSettingsCookieState(),
        fallbackState: {
            telemetryPanelHidden: true,
            gravityCutEnabled: false,
            customWsHost: null,
        },
        onCustomWsHost: (value) => {
            persistedCustomWsHost = value;
        },
        applyTelemetryPanelHidden,
        setGravityCutEnabled,
        onLegacyStateMigrated: () => {
            persistAppSettingsCookie();
            clearLegacyAppSettingsStoragePure({
                appSettingsStorageKey: APP_SETTINGS_STORAGE_KEY,
                telemetryPanelHiddenKey: TELEMETRY_PANEL_HIDDEN_KEY,
                legacyWsHostStorageKey: LEGACY_WS_HOST_STORAGE_KEY,
            });
        },
    });
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
    return buildCurrentCalibrationCookieState({
        calibrationCookieVersion: CALIBRATION_COOKIE_VERSION,
        mode: currentOrientationMode,
        worldSimpleQuaternion: calibrationMemory[1],
        viewportAdjustmentQuaternion: getViewportAdjustmentQuaternionXYZW(),
        referenceState: currentReferenceState,
        worldSimpleGyroState: currentWorldSimpleGyroState,
        accelCalibrationScale: currentAccelCalibrationScale,
        gravityMagnitude: tempgravity,
        viewportDisplaySettings: accVectorViewport.getDisplaySettings?.(),
        motionViewportDisplaySettings: motionViewport.getDisplaySettings?.(),
        orientationLabel: getOrientationLabelForMode(Number.isFinite(currentOrientationMode) ? Number(currentOrientationMode) : 0),
    });
}

function persistCalibrationCookie() {
    persistCalibrationCookieState({
        calibrationCookieName: CALIBRATION_COOKIE_NAME,
        calibrationStorageKey: CALIBRATION_STORAGE_KEY,
        calibrationCookieMaxAgeSeconds: CALIBRATION_COOKIE_MAX_AGE_SECONDS,
        state: getCurrentCalibrationCookieState(),
    });
}

function readCalibrationCookieState() {
    return readCalibrationCookieStatePure({
        calibrationCookieName: CALIBRATION_COOKIE_NAME,
        calibrationStorageKey: CALIBRATION_STORAGE_KEY,
        calibrationCookieVersion: CALIBRATION_COOKIE_VERSION,
    });
}

function restoreCalibrationFromCookie() {
    restoreCalibrationFromPersistence({
        persisted: readCalibrationCookieState(),
        setOrientationCalibrationQuaternion,
        applyReferenceState: (referenceState) => {
            currentReferenceState = referenceState;
            decodeWorker.postMessage({
                type: 'referenceState',
                payload: referenceState,
            });
        },
        setWorldSimpleGyroState,
        setAccelCalibrationScale,
        applyGravityMagnitude: (gravityMagnitude) => {
            tempgravity = gravityMagnitude;
            decodeWorker.postMessage({
                type: 'gravity',
                payload: {
                    gravity: gravityMagnitude,
                }
            });
        },
        applyOrientationMode,
        applyViewportAdjustmentQuaternion: (viewportAdjustmentQuaternion) => {
            accVectorViewport.setAdjustmentQuaternion(viewportAdjustmentQuaternion || getIdentityQuaternionXYZW(), {
                silent: true,
                commit: false,
            });
        },
        syncViewportPostTransformQuaternion,
        applyViewportDisplaySettings: (viewportDisplaySettings) => {
            accVectorViewport.applyDisplaySettings(viewportDisplaySettings, { silent: true });
        },
        applyMotionViewportDisplaySettings: (motionViewportDisplaySettings) => {
            motionViewport.applyDisplaySettings(motionViewportDisplaySettings, { silent: true });
        },
        onLocalStorageStateMigrated: () => {
            const serializedState = JSON.stringify(getCurrentCalibrationCookieState());
            setCookieValue(CALIBRATION_COOKIE_NAME, serializedState, CALIBRATION_COOKIE_MAX_AGE_SECONDS);
        },
        persistCalibrationCookie,
    });
}

function setWorldSimpleGyroState(gyroState, { persistState = true } = {}) {
    currentWorldSimpleGyroState = updateWorldSimpleGyroState(gyroState);

    decodeWorker.postMessage({
        type: 'worldSimpleGyroState',
        payload: currentWorldSimpleGyroState,
    });

    if (persistState) {
        persistCalibrationCookie();
    }
}

function setAccelCalibrationScale(scale, { persistState = true } = {}) {
    currentAccelCalibrationScale = updateAccelCalibrationScale(scale);

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
    const resolvedMode = resolveOrientationMode(
        mode,
        ENABLE_FUSION_PIPELINE,
        optionLabel,
        getOrientationLabelForMode,
    );
    if (!resolvedMode) {
        return;
    }

    const normalizedMode = resolvedMode.mode;
    const resolvedLabel = resolvedMode.label;

    currentOrientationMode = normalizedMode;

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

    function getGravityCutVectorSample(gravityMagnitude) {
        return resolveGravityCutVectorSample(
            gravityMagnitude,
            currentOrientationMode,
            getViewportAdjustmentQuaternionXYZW(),
        );
    }

    function applyGravityCutToSample(sample, gravityMagnitude, gravityVector = null) {
        return applyGravityCutToSamplePure(sample, gravityMagnitude, gravityVector || getGravityCutVectorSample(gravityMagnitude));
    }

function applyAccelCalibrationScale(sample, scale = currentAccelCalibrationScale) {
    return applyAccelCalibrationScalePure(sample, scale);
}

function getViewportGravityMagnitude() {
    return getViewportGravityMagnitudePure(tempgravity);
}

function getViewportBaseQuaternionXYZW() {
    if (accVectorViewport && accVectorViewport.activeNodeIp && accVectorViewport.activeNodeIp !== 'master') {
        const node = window.getNodeByIp(accVectorViewport.activeNodeIp);
        if (node && node.calibrationState && node.calibrationState.quat) {
             return Array.from(node.calibrationState.quat);
        }
        return getIdentityQuaternionXYZW();
    }
    return getViewportBaseQuaternionXYZWPure(
        currentOrientationMode,
        calibrationMemory[1],
        ausrichtung,
    );
}

function getViewportAdjustmentQuaternionXYZW() {
    return getViewportAdjustmentQuaternionXYZWPure(accVectorViewport.getAdjustmentQuaternion?.());
}

function getViewportEffectiveQuaternionXYZW() {
    return getViewportEffectiveQuaternionXYZWPure(
        currentOrientationMode,
        getViewportAdjustmentQuaternionXYZW(),
        getViewportBaseQuaternionXYZW(),
    );
}

function syncMotionWorkerTransform({ reset = false } = {}) {
    syncMotionWorkerTransformPure({
        enableMotionView: ENABLE_MOTION_VIEW,
        motionWorker,
        effectiveQuaternion: getViewportEffectiveQuaternionXYZW(),
        currentOrientationMode,
        gravityMagnitude: getViewportGravityMagnitude(),
        reset,
    });
}



function syncViewportBaseQuaternion({ silent = true } = {}) {
    syncViewportBaseQuaternionPure({
        accVectorViewport,
        baseQuaternion: getViewportBaseQuaternionXYZW(),
        silent,
    });
}

function syncViewportPostTransformQuaternion({ persistState = false, resetLiveBuffers = false } = {}) {
    let targetWorker = decodeWorker;
    let targetNode = null;
    
    if (accVectorViewport && accVectorViewport.activeNodeIp && accVectorViewport.activeNodeIp !== 'master') {
        const nodeInfo = window.getNodeByIp(accVectorViewport.activeNodeIp);
        if (nodeInfo && nodeInfo.decodeWorker) {
            targetWorker = nodeInfo.decodeWorker;
            targetNode = nodeInfo;
        }
    }

    syncViewportPostTransformQuaternionPure({
        decodeWorker: targetWorker,
        persistState,
        resetLiveBuffers,
        onResetLiveBuffers: resetOrientationLiveBuffers,
        onPersistState: () => {
             if (targetNode) {
                 window.persistNodeCalibration(targetNode);
             } else {
                 persistCalibrationCookie();
             }
        },
    });
}

window.onAccVectorNodeChanged = function(ip) {
    if (!accVectorViewport) return;
    
    if (typeof accVectorViewport.resetRotation === 'function') {
        accVectorViewport.resetRotation();
    }
    
    syncViewportBaseQuaternion({ silent: true });
    accVectorViewport.setStatus(`Kanal gewechselt auf ${ip === 'master' ? 'Master (CH1)' : ip}`);
};

function getOrientationRuntimeContext() {
    return {
        currentOrientationMode,
        currentReferenceState,
        currentWorldSimpleGyroState,
        currentAccelCalibrationScale,
        gravityCutEnabled,
        gravityMagnitude: tempgravity,
        adjustmentQuaternion: getViewportAdjustmentQuaternionXYZW(),
        effectiveQuaternion: getViewportEffectiveQuaternionXYZW(),
        ausrichtungQuaternion: ausrichtung,
    };
}

window.buildLiveAccelerationSample = function(rawSample, processedSample) {
    return buildLiveAccelerationSamplePure(rawSample, processedSample, getOrientationRuntimeContext());
}

function buildMotionAccelerationSample(rawSample, processedSample) {
    return buildMotionAccelerationSamplePure(rawSample, processedSample, getOrientationRuntimeContext());
}

window.buildLiveGyroSample = function(rawSample, processedSample) {
    return buildLiveGyroSamplePure(rawSample, processedSample, getOrientationRuntimeContext());
}

function setOrientationCalibrationQuaternion(quaternion, { persistState = true } = {}) {
    setOrientationCalibrationQuaternionPure({
        quaternion,
        decodeWorker,
        onQuaternionStored: (normalizedQuaternion) => {
            calibrationMemory[1] = normalizedQuaternion;
            if (window.activeSensors && window.activeSensors[0]) {
                window.activeSensors[0].calibrationState = window.activeSensors[0].calibrationState || {};
                window.activeSensors[0].calibrationState.quat = normalizedQuaternion;
            }
        },
        onSyncViewportBaseQuaternion: () => {
            syncViewportBaseQuaternion({ silent: true });
        },
        onSyncMotionWorkerTransform: () => {
            syncMotionWorkerTransform({ reset: true });
        },
        persistState,
        onPersistState: persistCalibrationCookie,
    });
}

function buildViewportBaseAccelerationSample(rawSample) {
    return buildViewportBaseAccelerationSamplePure(rawSample, getOrientationRuntimeContext());
}

function buildViewportAccelerationSamples(rawSample, processedSample) {
    return buildViewportAccelerationSamplesPure(rawSample, processedSample, getOrientationRuntimeContext());
}

function buildViewportGyroSamples(rawSample, processedSample) {
    return buildViewportGyroSamplesPure(rawSample, processedSample, getOrientationRuntimeContext());
}

if (alignLoadQuatBtn) {
    alignLoadQuatBtn.addEventListener('click', () => {
        syncViewportBaseQuaternion({ silent: true });
        accVectorViewport.setStatus('Basisrotation im Viewport synchronisiert');
    });
}

if (alignApplyQuatBtn) {
    alignApplyQuatBtn.addEventListener('click', () => {
        let qArray = null;
        if (typeof accVectorViewport.getAppliedQuaternionObject === 'function') {
            const obj = accVectorViewport.getAppliedQuaternionObject();
            if (obj) qArray = [obj.x, obj.y, obj.z, obj.w];
        }

        if (accVectorViewport && accVectorViewport.activeNodeIp && accVectorViewport.activeNodeIp !== 'master') {
             const node = window.getNodeByIp(accVectorViewport.activeNodeIp);
             if (node && qArray) {
                 node.calibrationState = node.calibrationState || {};
                 node.calibrationState.quat = qArray;
                 if (node.decodeWorker) {
                      node.decodeWorker.postMessage({ type: 'calibdata', payload: { type: 2, quaternion: qArray }});
                 }
                 window.persistNodeCalibration(node);
             }
        } else {
             if (qArray) setOrientationCalibrationQuaternion(qArray, { persistState: true });
        }
        
        syncViewportBaseQuaternion({ silent: true });
        syncViewportPostTransformQuaternion({ persistState: true, resetLiveBuffers: true });
        accVectorViewport.setStatus('Live-Pipeline mit Zusatzrotation synchronisiert');
    });
}

function calculateStats(values) {
    return calculateStatsPure(values);
}

function getBufferAxisStats(buffer, fieldName) {
    return getBufferAxisStatsPure(buffer, fieldName);
}

function buildCalibrationStatsTableHtml(accSampleCount, gyroSampleCount, accStats, gyroStats) {
    return buildCalibrationStatsTableHtmlPure(accSampleCount, gyroSampleCount, accStats, gyroStats);
}

function buildSingleSensorStatsTableHtml(sensorLabel, sampleCount, stats, unit) {
    return buildSingleSensorStatsTableHtmlPure(sensorLabel, sampleCount, stats, unit);
}






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
let liveChartPanOffset = 0;
let rmsPanOffset = 0;
let gyroRmsPanOffset = 0;
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

function createAccRecordingRow(sample, channelIndex = 0) {
    return createRecordingRow(sample, channelIndex);
}

function createGyroRecordingRow(sample, channelIndex = 0) {
    return createRecordingRow(sample, channelIndex);
}

function downloadRecordedCsv(isIntermediate = false) {
    const downloadBtn = document.getElementById("downloadBtn");
    const activeQuaternion = Array.isArray(calibrationMemory[1]) && calibrationMemory[1].length === 4
        ? calibrationMemory[1]
        : (ausrichtung && ausrichtung.some(v => v !== 0) ? ausrichtung : [0, 0, 0, 1]);
    const result = downloadRecordedCsvPure({
        isIntermediate,
        recordedAccRows,
        recordedGyroRows,
        filePartIndex,
        accCsvHeaders: ACC_CSV_HEADERS,
        gyroCsvHeaders: GYRO_CSV_HEADERS,
        activeQuaternion,
        recordingDateStr: window.currentRecordingDateStr || new Date().toLocaleString('de-DE'),
    });

    if (!result.downloaded) {
        return false;
    }

    if (isIntermediate) {
        filePartIndex = result.nextFilePartIndex;
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

let fftWorker = null;
let rmsWorker = null;
let gyroFftWorker = null;
let gyroRmsWorker = null;
let fftPlot = null;
let rmsPlot = null;
let gyroFftPlot = null;
let gyroRmsPlot = null;

const chartInteractionRuntime = createChartInteractionRuntime({
    getChart: () => chart,
    getGyroChart: () => gyroChart,
    getRmsPlot: () => rmsPlot,
    getGyroRmsPlot: () => gyroRmsPlot,
    getFftPlot: () => fftPlot,
    getGyroFftPlot: () => gyroFftPlot,
    getLiveChartSize: () => getSize(),
    getGyroChartSize: () => getGyroChartSize(),
    getFftChartSize: () => getFftChartSize(),
    getRmsChartSize: () => getRmsChartSize(),
    getGyroFftChartSize: () => getGyroFftChartSize(),
    getGyroRmsChartSize: () => getGyroRmsChartSize(),
    updateLiveChartPanelHeights,
    updateFftRmsPanelHeights,
    updateGyroFftRmsPanelHeights,
    setCurrentTimeRange: (value) => {
        currentTimeRange = value;
    },
    setDisplayDurationSeconds: (value) => {
        displayDurationSeconds = value;
    },
    getDisplayDurationSeconds: () => displayDurationSeconds,
    getLivePanOffset: () => liveChartPanOffset,
    setLivePanOffset: (value) => {
        liveChartPanOffset = Number.isFinite(value) ? value : 0;
        panOffset = liveChartPanOffset;
    },
    getPanOffset: () => panOffset,
    getRmsPanOffset: () => rmsPanOffset,
    setRmsPanOffset: (value) => {
        rmsPanOffset = Number.isFinite(value) ? value : 0;
    },
    getGyroRmsPanOffset: () => gyroRmsPanOffset,
    setGyroRmsPanOffset: (value) => {
        gyroRmsPanOffset = Number.isFinite(value) ? value : 0;
    },
    getRmsDurationSeconds: () => displayDurationSecondsRMS,
    setRmsDurationSeconds: (value) => {
        displayDurationSecondsRMS = value;
    },
    getGyroRmsDurationSeconds: () => gyroDisplayDurationSecondsRMS,
    setGyroRmsDurationSeconds: (value) => {
        gyroDisplayDurationSecondsRMS = value;
    },
    getLastTimestamp: () => lastTimestamp,
    getTimestamps: () => timestamps,
    preserveScalesOnSeriesToggle,
    installManualLegendToggle,
});

const {
    bindRmsXAxisOverlay,
    bindSharedXAxisOverlay,
    bindYAxisOverlay,
    createLiveChartResizeObserver,
    observeChartPanels,
    registerRuntimeAxisListeners,
    setupInitialOverlayInteractions,
    syncAxisOverlayPositions,
    setSharedXScale,
} = chartInteractionRuntime;


// === Web Workers ===
const wsWorker = new Worker("ws-worker.js?v=99");
window.wsWorker = wsWorker; // Export globally for Replay Manager
const decodeWorker = new Worker("decode-worker2.js?v=55");
const accFilterWorker = new Worker('filter-worker.js');
const gyroFilterWorker = new Worker('filter-worker.js');
const downsamplingWorker = ENABLE_FUSION_PIPELINE ? new Worker('downsampling-worker.js') : createNoopWorker();
const fusionWorker = ENABLE_FUSION_PIPELINE ? new Worker('fusion-worker6.js') : createNoopWorker();
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
    panel: document.getElementById('telemetryWrapper'),
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
    if (patch.wsState && window.updateTelemetryNodeWsState) {
        window.updateTelemetryNodeWsState(0, patch.wsState);
    }
}

window.setInterval(() => {
    updateTelemetry({
        framesPerSecond: telemetryState.recentFrames,
        rawBytes: telemetryState.recentBytes,
        recentFrames: 0,
        recentBytes: 0,
    });
}, 1000);

const telemetryElements2 = {
    wsState: document.getElementById('telemetryWsState2'),
    activeClients: document.getElementById('telemetryActiveClients2'),
    sensorPackets: document.getElementById('telemetrySensorPackets2'),
    framesPerSecond: document.getElementById('telemetryFramesPerSecond2'),
    wsErrors: document.getElementById('telemetryWsErrors2'),
    rawBytes: document.getElementById('telemetryRawBytes2'),
    frameLimit: document.getElementById('telemetryFrameLimit2'),
    inflightWs: document.getElementById('telemetryInflightWs2'),
    cpuLoad: document.getElementById('telemetryCpuLoad2'),
    cpuTemp: document.getElementById('telemetryCpuTemp2'),
    freeHeap: document.getElementById('telemetryFreeHeap2'),
    minHeap: document.getElementById('telemetryMinHeap2'),
    largestHeap: document.getElementById('telemetryLargestHeap2'),
    psramTotal: document.getElementById('telemetryPsramTotal2'),
    freePsram: document.getElementById('telemetryFreePsram2'),
    minPsram: document.getElementById('telemetryMinPsram2'),
    largestPsram: document.getElementById('telemetryLargestPsram2'),
    drops: document.getElementById('telemetryDrops2'),
    backlogPeak: document.getElementById('telemetryBacklogPeak2'),
};

const telemetryState2Tracker = {
    recentFrames: 0,
    recentBytes: 0,
};

window.setInterval(() => {
    if (telemetryElements2.framesPerSecond) telemetryElements2.framesPerSecond.textContent = String(telemetryState2Tracker.recentFrames);
    if (telemetryElements2.rawBytes) telemetryElements2.rawBytes.textContent = `${formatTelemetryBytes(telemetryState2Tracker.recentBytes)}/s`;
    telemetryState2Tracker.recentFrames = 0;
    telemetryState2Tracker.recentBytes = 0;
}, 1000);

window.incrementTelemetryNodeFrames = function(channelIndex, bytes) {
    if (channelIndex === 1) {
        telemetryState2Tracker.recentFrames++;
        telemetryState2Tracker.recentBytes += bytes;
    }
};

window.updateTelemetryNodeWsState = function(channelIndex, state) {
    if (channelIndex === 1 && telemetryElements2.wsState) {
        telemetryElements2.wsState.textContent = state;
    }
    const stateEl = document.getElementById(`nodeWsState_${channelIndex}`);
    if (stateEl) {
        if (state === 'verbunden' || state === 'Live') {
            stateEl.innerHTML = '(● Live)';
            stateEl.style.color = '#50c878';
            stateEl.style.opacity = '1';
        } else if (state === 'fehler' || state === 'getrennt' || state === 'Fehler') {
            stateEl.innerHTML = '(✖ ' + state + ')';
            stateEl.style.color = '#ff6b6b';
            stateEl.style.opacity = '1';
        } else {
            stateEl.innerHTML = '(● ' + state + ')';
            stateEl.style.color = '#f39c12';
            stateEl.style.opacity = '1';
        }
    }
};

window.updateTelemetryNode = function(channelIndex, payload) {
    if (channelIndex !== 1 || !payload) return; 

    if (telemetryElements2.activeClients) telemetryElements2.activeClients.textContent = String(payload.activeClients ?? 0);
    if (telemetryElements2.sensorPackets) telemetryElements2.sensorPackets.textContent = String(payload.sensorPackets ?? 0);
    if (telemetryElements2.wsErrors) telemetryElements2.wsErrors.textContent = String(payload.wsSendErrors ?? 0);
    if (telemetryElements2.frameLimit) telemetryElements2.frameLimit.textContent = payload.frameLimitPackets > 0 ? `${payload.frameLimitPackets} pkt` : '-';
    
    if (telemetryElements2.inflightWs) {
        telemetryElements2.inflightWs.textContent = String(payload.inflightWs ?? 0);
        setTelemetrySeverity(telemetryElements2.inflightWs, (payload.inflightWs ?? 0) >= 3 ? 'warn' : null);
    }
    if (telemetryElements2.cpuLoad) {
        telemetryElements2.cpuLoad.textContent = (payload.cpuLoadPct ?? -1) >= 0 ? `${payload.cpuLoadPct}%` : '-';
        setTelemetrySeverity(telemetryElements2.cpuLoad, (payload.cpuLoadPct ?? 0) >= 90 ? 'danger' : (payload.cpuLoadPct ?? 0) >= 75 ? 'warn' : null);
    }
    if (telemetryElements2.cpuTemp) {
        telemetryElements2.cpuTemp.textContent = Number.isFinite(payload.cpuTempC) ? `${payload.cpuTempC.toFixed(1)} C` : '-';
        setTelemetrySeverity(telemetryElements2.cpuTemp, payload.cpuTempC >= 80 ? 'danger' : payload.cpuTempC >= 70 ? 'warn' : null);
    }
    if (telemetryElements2.freeHeap) {
        telemetryElements2.freeHeap.textContent = formatTelemetryMetricBytes(payload.freeHeap);
        setTelemetrySeverity(telemetryElements2.freeHeap, payload.freeHeap < 8 * 1024 ? 'danger' : payload.freeHeap < 16 * 1024 ? 'warn' : null);
    }
    if (telemetryElements2.minHeap) {
        telemetryElements2.minHeap.textContent = formatTelemetryMetricBytes(payload.minFreeHeap);
        setTelemetrySeverity(telemetryElements2.minHeap, payload.minFreeHeap < 2 * 1024 ? 'danger' : payload.minFreeHeap < 8 * 1024 ? 'warn' : null);
    }
    if (telemetryElements2.largestHeap) {
        telemetryElements2.largestHeap.textContent = formatTelemetryMetricBytes(payload.largestHeapBlock);
        setTelemetrySeverity(telemetryElements2.largestHeap, payload.largestHeapBlock < 4 * 1024 ? 'danger' : payload.largestHeapBlock < 8 * 1024 ? 'warn' : null);
    }
    
    const psramAvail = Boolean(payload.psramAvailable);
    if (telemetryElements2.psramTotal) telemetryElements2.psramTotal.textContent = psramAvail ? formatTelemetryMetricBytes(payload.psramTotal) : 'n/a';
    if (telemetryElements2.freePsram) {
        telemetryElements2.freePsram.textContent = psramAvail ? formatTelemetryMetricBytes(payload.freePsram) : 'n/a';
        setTelemetrySeverity(telemetryElements2.freePsram, psramAvail && payload.freePsram < 128 * 1024 ? 'warn' : null);
    }
    if (telemetryElements2.minPsram) telemetryElements2.minPsram.textContent = psramAvail ? formatTelemetryMetricBytes(payload.minFreePsram) : 'n/a';
    if (telemetryElements2.largestPsram) telemetryElements2.largestPsram.textContent = psramAvail ? formatTelemetryMetricBytes(payload.largestPsramBlock) : 'n/a';
    
    if (telemetryElements2.drops) {
        telemetryElements2.drops.textContent = String(payload.streamDroppedBytes ?? 0);
        setTelemetrySeverity(telemetryElements2.drops, (payload.streamDroppedBytes ?? 0) > 0 ? 'warn' : null);
    }
    if (telemetryElements2.backlogPeak) {
        telemetryElements2.backlogPeak.textContent = formatTelemetryMetricBytes(payload.streamBacklogPeak);
        setTelemetrySeverity(telemetryElements2.backlogPeak, (payload.streamBacklogPeak ?? 0) > 8 * 1024 ? 'warn' : null);
    }
};

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
    // Discovery erst nach kompletter Modulevaluierung starten, damit die Charts bereits existieren.
    queueMicrotask(() => connectWebSocket());
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

    const syncLayoutToggleLabel = (toggleButton, grid) => {
        if (!toggleButton) {
            return;
        }

        const isSideBySide = grid?.classList.contains('is-side-by-side');
        toggleButton.textContent = isSideBySide ? 'Untereinander' : 'Nebeneinander';
        toggleButton.setAttribute('aria-pressed', isSideBySide ? 'true' : 'false');
    };

    const setupLayoutToggle = (toggleButton, grid, updatePanelHeights, resizeCharts) => {
        syncLayoutToggleLabel(toggleButton, grid);
        toggleButton?.addEventListener('click', () => {
            grid?.classList.toggle('is-side-by-side');
            syncLayoutToggleLabel(toggleButton, grid);
            updatePanelHeights();
            requestAnimationFrame(() => {
                resizeCharts();
            });
        });
    };

    setupLayoutToggle(chartLayoutToggle, livechartsGrid, updateLiveChartPanelHeights, resizeLiveCharts);
    setupLayoutToggle(fftRmsLayoutToggle, fftRmsGrid, updateFftRmsPanelHeights, resizeFftRmsCharts);
    setupLayoutToggle(gyroFftRmsLayoutToggle, gyroFftRmsGrid, updateGyroFftRmsPanelHeights, resizeGyroFftRmsCharts);




    // 👉 Hier der Sidebar-Toggle-Code:
    document.getElementById('sidebarToggle').addEventListener('click', function () {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('expanded');
        updateAllChartPanelHeights();
    });

    updateAllChartPanelHeights();

    window.addEventListener('dashboardTabChanged', (event) => {
        const sectionId = event.detail?.sectionId;

        if (typeof accVectorViewport?.setVisible === 'function') {
            accVectorViewport.setVisible(sectionId === 'vectorAlignArea');
        }
        if (typeof motionViewport?.setVisible === 'function') {
            motionViewport.setVisible(sectionId === 'motionViewportArea');
        }

        if (sectionId === 'fftChartarea') {
            updateFftRmsPanelHeights();
            requestAnimationFrame(() => {
                resizeFftRmsCharts();
            });
            return;
        }

        if (event.detail?.sectionId === 'gyroFftChartarea') {
            updateGyroFftRmsPanelHeights();
            requestAnimationFrame(() => {
                resizeGyroFftRmsCharts();
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
        if (window.activeSensors && window.activeSensors[0]) {
             window.activeSensors[0].lastDataMs = performance.now();
        }
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
        } else if (type === "firmwareVer") {
            const masterNodeIp = (window.activeSensors && window.activeSensors[0]) ? window.activeSensors[0].ip : "192.168.4.1";
            const safeIp = masterNodeIp.replace(/\./g, "_");
            const otaBtn = document.getElementById(`otaTriggerBtn_${safeIp}`);
            if (otaBtn) {
                otaBtn.innerText = payload;
                otaBtn.style.color = "rgba(255,255,255,0.6)";
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

if (message.type === 'ack') {
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
if (window.activeSensors) {
    const mNode = window.activeSensors.find(n => n.isMaster);
    if (mNode) {
        mNode.orientationState = { quaternionXYZW: ausrichtung };
    }
}
if (currentOrientationMode === 1) {
    syncViewportBaseQuaternion({ silent: true });
}

};




// === Decode Worker einrichten ===
window.processSensorBatch = function(data, channelIndex = 0, nodeDef = null) {
    const { acc, gyro, temp, info, acccalib, accraw, gyroraw, gyrocalib } = data;

        const targetIp = document.getElementById("settingsSensorTarget")?.value || "192.168.4.1";
        const isTarget = nodeDef ? (nodeDef.ip === targetIp) : true;
        
        if (isTarget && ENABLE_MOTION_VIEW && ((accraw && accraw.length > 0) || (gyroraw && gyroraw.length > 0))) {
            const motionAccSamples = accraw ? accraw.map((sample, index) => buildMotionAccelerationSample(sample, acc?.[index]) || acc?.[index] || sample) : [];
            
            motionWorker.postMessage({
                type: 'batch',
                payload: {
                    acc: motionAccSamples,
                    gyro: Array.isArray(gyroraw) ? gyroraw : [],
                },
            });
        }


        if (accraw && accraw.length > 0) {
            if (isTarget && ENABLE_FUSION_PIPELINE) {
                downsamplingWorker.postMessage({
                    type: "batch",
                    sensor: "acc",
                    data: accraw.map(s => ({ x: s.x, y: s.y, z: s.z, time: s.time }))
                });
            }

            for (let sample of accraw) {
                let totalAcc = Math.sqrt(sample.x*sample.x + sample.y*sample.y + sample.z*sample.z);
                accRawBuffer.push([sample.time, sample.x, sample.y, sample.z, totalAcc]);
                
                if (window.sonificationEnabled) {
                    let totalVibration = totalAcc;
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
// Master Node Data für Multi-Channel Rendering bucketieren (Master ist CH1 = Index 0)
            const calibratedAcc = [];
            
            // TargetBuffer ermitteln, ansonsten wird Node 1 von Node 2 überschrieben!
            // WICHTIG: Kein window.accBuffer, da globals (const/let) nicht auf window liegen!
            let targetBuffer = (nodeDef && nodeDef.accBuffer) ? nodeDef.accBuffer : accBuffer;
            // Rohdaten pushen einmal komplett
            for (let index = 0; index < acc.length; index++) {
                const sample = window.isOfflineReplayMode 
                    ? acc[index] 
                    : (buildLiveAccelerationSample(accraw?.[index], acc[index]) || acc[index]);
                calibratedAcc.push(sample);
                targetBuffer.push([sample.time, sample.x, sample.y, sample.z, sample.total]);
                batchTimes[index] = sample.time;
                batchXs[index] = sample.x;
                batchYs[index] = sample.y;
                batchZs[index] = sample.z;
                batchTotals[index] = sample.total;
                
                if (window.feedImpactTestData) {
                    window.feedImpactTestData(sample.x, sample.y, sample.z, sample.time);
                }
                
                // --- RECORDING LOGIC ADDED HERE ---
                if (isRecording) {
                    recordedAccRows.push(createAccRecordingRow(sample, channelIndex));
                    
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
            if (window.insertIntoMultiChart && window.activeSensors && window.activeSensors.length > 0) {
                window.insertIntoMultiChart(channelIndex, calibratedAcc);
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

            // Master Node Gyro Data bucketieren
            const calibratedGyro = [];

            for (let index = 0; index < gyro.length; index++) {
                const sample = window.isOfflineReplayMode
                    ? gyro[index]
                    : (buildLiveGyroSample(gyroraw?.[index], gyro[index]) || gyro[index]);
                calibratedGyro.push(sample);
                // sample ist { time, x, y, z }
                // push als Array oder Objekt in deinen MultiRingBuffer
                let targetGyroBuffer = (nodeDef && nodeDef.gyroBuffer) ? nodeDef.gyroBuffer : gyroBuffer;
                targetGyroBuffer.push([sample.time, sample.x, sample.y, sample.z]);
                batchTimes[index] = sample.time;
                batchXs[index] = sample.x;
                batchYs[index] = sample.y;
                batchZs[index] = sample.z;

                if (isRecording) {
                    recordedGyroRows.push(createGyroRecordingRow(sample, channelIndex));

                    if (recordedGyroRows.length >= MAX_RECORDED_ROWS) {
                        console.log("Max rows reached (GYRO). Triggering intermediate download.");
                        downloadRecordedCsv(true);
                    }
                }

//                downsamplingWorker.postMessage({ type: 'gyro', payload: { x: sample.x, y: sample.y, z: sample.z, time: sample.time } });
                       const newSample = { x: sample.x, y: sample.y, z: sample.z, time: sample.time };
//mwrmsworker.postMessage({ type: 'gyro', payload: [newSample] })
            }
            if (window.insertIntoMultiGyroChart && window.activeSensors && window.activeSensors.length > 0) {
                window.insertIntoMultiGyroChart(channelIndex, calibratedGyro);
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
        if (typeof tempBuffer !== 'undefined' && tempBuffer.push) {
            for (let i = 0; i < temp.length; i++) {
                let sample = temp[i];
                tempBuffer.push([sample.time, sample.value]);
            }
        }
    }

    if (info && info.length > 0) {
        window.updateSensorUIFromInfo("192.168.4.1", info);
    }
};

window.updateSensorUIFromInfo = function(nodeIp, infoArray) {
    if(!window.sensorConfigs) window.sensorConfigs = {};
    if(!window.sensorConfigs[nodeIp]) window.sensorConfigs[nodeIp] = {};
    
    let safeIp = (nodeIp || "192.168.4.1").replace(/\./g, "_");
    
    infoArray.forEach(entry => {
        let typeStr = entry.type;
        let value = entry.value;
        let idMapping = {
            "ACCELRATE": "accelSampleRate",
            "ACCELRANGE": "accelRange",
            "ACCELFILTER": "accelFilter",
            "GYROSAMPLERATE": "gyroSampleRate",
            "GYRORANGE": "gyroRange",
            "GYROFILTER": "gyroFilter",
            "TEMPSAMPLERATE": "tempSampleRate"
        };
        let cfgKey = idMapping[typeStr];
        let subIdMapping = { "ACCELRATE":100, "ACCELRANGE":101, "ACCELFILTER":102, "GYROSAMPLERATE":103, "GYRORANGE":104, "GYROFILTER":105, "TEMPSAMPLERATE":106 };
        let numKey = subIdMapping[typeStr];
        
        if (numKey) window.sensorConfigs[nodeIp][numKey] = value;
        
        if (cfgKey) {
            // Updated the dynamically built CustomDropdown in ui-setup.js
            if(window.nodeDropdowns && window.nodeDropdowns[nodeIp]) {
                let inst = window.nodeDropdowns[nodeIp][cfgKey];
                if(inst && typeof inst.setValueSelect === 'function') {
                    inst.setValueSelect(value, true);
                } else if(inst && typeof inst.setValue === 'function') {
                    inst.setValue(value, true);
                }
            }
        }
    });
};

function setupDecodeWorker() {
    decodeWorker.onmessage = (event) => {
        window.processSensorBatch(event.data);
    };
}







// === Node Discovery für Multi-Channel ===
window.activeSensors = [];
window.multiChartData = []; // [Zeit, CH1_X, CH1_Y, CH1_Z, CH2_X, ...]
window.multiFftData = [];   // Array für das synchrone FFT Plotting [Freqs, CH1_Max, CH1_Avg, CH1_Cur, CH2_Max...]
window.multiGyroFftData = [];

window.setGyroFftSensorCount = function(n) {
    if (!gyroFftPlot) return;
    
    const baseColors = [
        { max: "rgba(200,210,223,0.08)", avg: "#FFD600", cur: "rgba(122,187,255,0.45)" }, // CH1
        { max: "rgba(77,166,255,0.08)",  avg: "#4da6ff", cur: "rgba(77,166,255,0.45)" },  // CH2
        { max: "rgba(0,255,0,0.08)",     avg: "#50c878", cur: "rgba(80,200,120,0.45)" },  // CH3
        { max: "rgba(224,64,251,0.08)",  avg: "#e040fb", cur: "rgba(224,64,251,0.45)" }   // CH4
    ];
    
    let newSeries = [{ label: "Freq (Hz)" }];
    
    for (let i = 0; i < n; i++) {
        const c = baseColors[i % 4];
        const valFormatter = (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--');
        newSeries.push({ label: `CH${i+1} Max`, stroke: null, width: 0, fill: c.max, points: { show: false }, value: valFormatter });
        newSeries.push({ label: `CH${i+1} Avg`, stroke: c.avg, width: 2, fill: c.avg.replace(')', ', 0.3)').replace('rgb', 'rgba'), points: { show: false }, value: valFormatter });
        newSeries.push({ label: `CH${i+1} Live`, stroke: c.cur, width: 1, points: { show: false }, value: valFormatter });
    }
    
    let newOpts = {
        title: 'Gyro FFT Multi-Channel',
        width: gyroFftPlot.width,
        height: gyroFftPlot.height,
        scales: { 
            x: { 
                time: false,
                range: (u, min, max) => {
                    if (u._xLocked && u._xLockMin != null && u._xLockMax != null) return [u._xLockMin, u._xLockMax];
                    return [min, max];
                }
            }, 
            y: { 
                auto: true,
                range: (u, min, max) => [0, Math.max(500, (max == null ? 500 : max * 1.1))]
            } 
        },
        axes: [
            { scale: "x", label: "Hz", stroke: "white" },
            { scale: "y", label: "Mag", stroke: "white" }
        ],
        series: newSeries,
        legend: { mount: (u, table) => { document.getElementById("gyroFftChartLegendHost")?.replaceChildren(table); } },
        cursor: {
            sync: { key: 'fft_sync' },
            points: {},
            drag: { x: true, y: true, setScale: true }
        },
        hooks: {
            setSelect: [
                (u) => {
                    if (u.select.width > 0 || u.select.height > 0) {
                        u._xLocked = true;
                        u._xLockMin = u.posToVal(u.select.left, 'x');
                        u._xLockMax = u.posToVal(u.select.left + u.select.width, 'x');
                    }
                }
            ],
            ready: [
                (u) => {
                    u.root.addEventListener('dblclick', () => {
                        u._xLocked = false;
                        u._xLockMin = null;
                        u._xLockMax = null;
                        u.setScale('x', { auto: true });
                    });
                }
            ]
        }
    };
    
    const parent = gyroFftPlot.root.parentNode;
    gyroFftPlot.destroy();
    gyroFftPlot = new uPlot(newOpts, Array(n * 3 + 1).fill().map(() => []), parent);
};

window.setFftSensorCount = function(n) {
    if (!fftPlot) return;
    
    const baseColors = [
        { max: "rgba(200,210,223,0.08)", avg: "#FFD600", cur: "rgba(122,187,255,0.45)" }, // CH1
        { max: "rgba(77,166,255,0.08)",  avg: "#4da6ff", cur: "rgba(77,166,255,0.45)" },  // CH2
        { max: "rgba(0,255,0,0.08)",     avg: "#50c878", cur: "rgba(80,200,120,0.45)" },  // CH3
        { max: "rgba(224,64,251,0.08)",  avg: "#e040fb", cur: "rgba(224,64,251,0.45)" }   // CH4
    ];
    
    let newSeries = [{ label: "Freq (Hz)" }];
    
    for (let i = 0; i < n; i++) {
        const c = baseColors[i % 4];
        const valFormatter = (u, v) => (v != null ? Math.abs(v).toFixed(2) : '--');
        newSeries.push({ label: `CH${i+1} Max`, stroke: null, width: 0, fill: c.max, points: { show: false }, value: valFormatter });
        newSeries.push({ label: `CH${i+1} Avg`, stroke: c.avg, width: 2, fill: c.avg.replace(')', ', 0.3)').replace('rgb', 'rgba'), points: { show: false }, value: valFormatter });
        newSeries.push({ label: `CH${i+1} Live`, stroke: c.cur, width: 1, points: { show: false }, value: valFormatter });
    }
    
    let newOpts = {
        title: 'ACC FFT Multi-Channel',
        width: fftPlot.width,
        height: fftPlot.height,
        scales: { 
            x: { 
                time: false,
                range: (u, min, max) => {
                    if (u._xLocked && u._xLockMin != null && u._xLockMax != null) return [u._xLockMin, u._xLockMax];
                    return [min, max];
                }
            }, 
            y: { 
                range: (u, min, max) => [0, Math.max(500, (max == null ? 500 : max * 1.1))]
            } 
        },
        axes: [
            { scale: "x", label: "Hz", stroke: "white" },
            { scale: "y", label: "Mag", stroke: "white" }
        ],
        series: newSeries,
        legend: { mount: (u, table) => { document.getElementById("fftChartLegendHost")?.replaceChildren(table); } },
        cursor: {
            sync: { key: 'fft_sync' },
            points: {},
            drag: { x: true, y: true, setScale: true }
        },
        hooks: {
            setSelect: [
                (u) => {
                    if (u.select.width > 0 || u.select.height > 0) {
                        u._xLocked = true;
                        u._xLockMin = u.posToVal(u.select.left, 'x');
                        u._xLockMax = u.posToVal(u.select.left + u.select.width, 'x');
                    }
                }
            ],
            ready: [
                (u) => {
                    u.root.addEventListener('dblclick', () => {
                        u._xLocked = false;
                        u._xLockMin = null;
                        u._xLockMax = null;
                        u.setScale('x', { auto: true });
                    });
                }
            ]
        }
    };
    
    const parent = fftPlot.root.parentNode;
    fftPlot.destroy();
    // Verwende .map(() => []), damit uPlot nicht über geklonte Array-Referenzen stolpert!
    fftPlot = new uPlot(newOpts, Array(n * 3 + 1).fill().map(() => []), parent);
};


window.setRmsSensorCount = function(n) {
    if (!rmsPlot) return;
    
    const baseColors = [
        { x: "#FFD600", y: "#ec3030ff", z: "#7ABBFFff", max: "#14c53bff", maxFill: "rgba(20,197,59,0.2)" },   // CH1 (Z=hellblau)
        { x: "#997A00", y: "#8C1C1Cff", z: "#3D6FCCff", max: "#0B7523ff", maxFill: "rgba(11,117,35,0.2)" },   // CH2: CH1 ~60%
        { x: "#50c878", y: "#81c784ff", z: "#2e8b57ff", max: "#32cd32ff", maxFill: "rgba(50,205,50,0.2)" },   // CH3
        { x: "#e040fb", y: "#ea80fcff", z: "#aa00ffff", max: "#d500f9ff", maxFill: "rgba(213,0,249,0.2)" }    // CH4
    ];

    // Abs-Formatter: CH2+ Werte sind negiert (Spiegel), Legende zeigt trotzdem positive Werte
    const absVal = (u, v) => v != null ? Math.abs(v).toFixed(1) : '--';

    let newSeries = [{ label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 2) }];
    
    for (let i = 0; i < n; i++) {
        const c = baseColors[i % 4];
        newSeries.push({ label: `CH${i+1} X (mg)`,  stroke: c.x,   value: absVal });
        newSeries.push({ label: `CH${i+1} Y (mg)`,  stroke: c.y,   value: absVal });
        newSeries.push({ label: `CH${i+1} Z (mg)`,  stroke: c.z,   value: absVal });
        newSeries.push({ label: `CH${i+1} Total`,   stroke: c.max, fill: c.maxFill, value: absVal });
    }
    
    // Y-Achsen-Ticks als absolute Werte anzeigen (CH2 ist gespiegelt)
    const absAxis = (u, vals) => vals.map(v => Math.abs(v).toFixed(0));

    const symRange = (s, min, max) => {
        const activeCount = window.activeSensors ? window.activeSensors.filter(n => !n.isHiddenFromUI).length : 1;
        const absMax = Math.max(250, Math.abs(min ?? 0) * 1.1, Math.abs(max ?? 0) * 1.1);
        return activeCount > 1 ? [-absMax, absMax] : [0, absMax];
    };

    let newOpts = createRmsChartOptions({
        size: { width: rmsPlot.ctx.canvas.clientWidth / window.devicePixelRatio, height: rmsPlot.ctx.canvas.clientHeight / window.devicePixelRatio },
        title: 'ACC RMS Multi-Channel',
        yRange: symRange,
        series: newSeries,
        legendHostId: "rmsChartLegendHost",
        formatMicrosecondsToHMS,
    });

    // Überschreibe das Y-Achsen Label Formatting
    if (newOpts.axes && newOpts.axes[1]) {
        newOpts.axes[1].values = absAxis;
    }

    // Setze speziellen setScale Hook
    newOpts.hooks = newOpts.hooks || {};
    newOpts.hooks.setScale = [
        ...(newOpts.hooks.setScale || []),
        (() => {
            let _enforcing = false;
            return (u, key) => {
                if (key !== 'y' || _enforcing) return;
                const activeCount = window.activeSensors ? window.activeSensors.filter(n => !n.isHiddenFromUI).length : 1;
                if (activeCount <= 1) return; // Kein Symmetrie-Zwang bei nur einem aktiven/gültigen Sensor

                const { min, max } = u.scales.y;
                if (!Number.isFinite(min) || !Number.isFinite(max)) return;
                const absMax = Math.max(Math.abs(min), Math.abs(max));
                if (Math.abs(Math.abs(min) - absMax) > 0.5 || Math.abs(Math.abs(max) - absMax) > 0.5) {
                    _enforcing = true;
                    u.setScale('y', { min: -absMax, max: absMax });
                    _enforcing = false;
                }
            };
        })(),
    ];
    
    const parent = rmsPlot.root.parentNode;
    rmsPlot.destroy();
    rmsPlot = new uPlot(newOpts, Array(n * 4 + 1).fill().map(() => []), parent);
    installManualLegendToggle(rmsPlot, "rmsChartLegendHost");

    // Nach Chart-Rebuild: Y-Overlay neu binden (symmetrisch, kein nailZero)
    // Wichtig: alter Overlay hatte noch Zeiger auf zerstoerten Chart
    if (typeof bindYAxisOverlay === 'function') {
        bindYAxisOverlay('rms-y-axis-overlay', rmsPlot, false);
    }
};

window.setGyroRmsSensorCount = function(n) {
    if (!gyroRmsPlot) return;
    
    // Wir nutzen hier leicht andere Basis-Colors für Gyro zur besseren Unterscheidbarkeit
    const baseColors = [
        { x: "#4dd0e1", y: "#ffb74d", z: "#81c784", max: "#ce93d8", maxFill: "rgba(206,147,216,0.18)" }, // CH1
        { x: "#00acc1", y: "#f57c00", z: "#43a047", max: "#8e24aa", maxFill: "rgba(142,36,170,0.18)" }, // CH2
        { x: "#006064", y: "#e65100", z: "#1b5e20", max: "#4a148c", maxFill: "rgba(74,20,140,0.18)" },  // CH3
        { x: "#84ffff", y: "#ffe082", z: "#b9f6ca", max: "#f3e5f5", maxFill: "rgba(243,229,245,0.18)" } // CH4
    ];

    // Abs-Formatter für gespiegelte Achsen
    const absVal = (u, v) => v != null ? Math.abs(v).toFixed(1) : '--';
    const absAxis = (u, vals) => vals.map(v => Math.abs(v).toFixed(0));

    let newSeries = [{ label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 2) }];
    
    for (let i = 0; i < n; i++) {
        const c = baseColors[i % 4];
        newSeries.push({ label: `CH${i+1} Gyro X`, stroke: c.x, value: absVal });
        newSeries.push({ label: `CH${i+1} Gyro Y`, stroke: c.y, value: absVal });
        newSeries.push({ label: `CH${i+1} Gyro Z`, stroke: c.z, value: absVal });
        newSeries.push({ label: `CH${i+1} Gyro Tot`, stroke: c.max, fill: c.maxFill, value: absVal });
    }

    const symRange = (s, min, max) => {
        const activeCount = window.activeSensors ? window.activeSensors.filter(n => !n.isHiddenFromUI).length : 1;
        const absMax = Math.max(1.0, Math.abs(min ?? 0) * 1.1, Math.abs(max ?? 0) * 1.1);
        return activeCount > 1 ? [-absMax, absMax] : [0, absMax];
    };

    let newOpts = createRmsChartOptions({
        size: { width: gyroRmsPlot.ctx.canvas.clientWidth / window.devicePixelRatio, height: gyroRmsPlot.ctx.canvas.clientHeight / window.devicePixelRatio },
        title: 'Gyro RMS Multi-Channel',
        yRange: symRange,
        series: newSeries,
        legendHostId: "gyroRmsChartLegendHost",
        formatMicrosecondsToHMS,
    });

    if (newOpts.axes && newOpts.axes[1]) {
        newOpts.axes[1].values = absAxis;
    }

    newOpts.hooks = newOpts.hooks || {};
    newOpts.hooks.setScale = [
        ...(newOpts.hooks.setScale || []),
        (() => {
            let _enforcing = false;
            return (u, key) => {
                if (key !== 'y' || _enforcing) return;
                const activeCount = window.activeSensors ? window.activeSensors.filter(n => !n.isHiddenFromUI).length : 1;
                if (activeCount <= 1) return; // Kein Symmetrie-Zwang bei nur einem aktiven/gültigen Sensor

                const { min, max } = u.scales.y;
                if (!Number.isFinite(min) || !Number.isFinite(max)) return;
                const absMax = Math.max(Math.abs(min), Math.abs(max));
                if (Math.abs(Math.abs(min) - absMax) > 0.1 || Math.abs(Math.abs(max) - absMax) > 0.1) {
                    _enforcing = true;
                    u.setScale('y', { min: -absMax, max: absMax });
                    _enforcing = false;
                }
            };
        })(),
    ];
    
    const parent = gyroRmsPlot.root.parentNode;
    gyroRmsPlot.destroy();
    gyroRmsPlot = new uPlot(newOpts, Array(n * 4 + 1).fill().map(() => []), parent);
    installManualLegendToggle(gyroRmsPlot, "gyroRmsChartLegendHost");

    if (typeof bindYAxisOverlay === 'function') {
        bindYAxisOverlay('gyro-rms-y-axis-overlay', gyroRmsPlot, false);
    }
};



class SensorNode {
    constructor(nodeInfo, channelIndex) {
        const normalizedNode = typeof nodeInfo === "string" ? { ip: nodeInfo, mac: "", isMaster: false } : (nodeInfo || {});
        this.ip = normalizedNode.ip || "";
        this.mac = normalizedNode.mac || "";
        this.sensorId = this.mac || this.ip;
        this.isMaster = Boolean(normalizedNode.isMaster);
        this.channelIndex = channelIndex;
        this.lastDataMs = performance.now(); // Init watchdog baseline
        
        // --- Per-Sensor Logic State ---
        this.gravityCutEnabled = false;
        this.orientationMode = 0;
        this.calibrationState = null;
        this.referenceSampleData = []; // for capturing references

        // Puffer für FFT & Filter
        if (typeof MultiRingBuffer2 !== 'undefined') {
             this.accBuffer = new MultiRingBuffer2([Float64Array, Float32Array, Float32Array, Float32Array, Float32Array], 12000, ['time', 'x', 'y', 'z', 'total']);
             this.rmsBuffer = new MultiRingBuffer2([Float64Array, Float32Array, Float32Array, Float32Array, Float32Array], 20000, ['time', 'x', 'y', 'z', 'total']);
             this.gyroBuffer = new MultiRingBuffer2([Float64Array, Float32Array, Float32Array, Float32Array], 12000, ['time', 'x', 'y', 'z']);
             this.gyroRmsBuffer = new MultiRingBuffer2([Float64Array, Float32Array, Float32Array, Float32Array, Float32Array], 20000, ['time', 'x', 'y', 'z', 'total']);
        } else if (typeof MultiRingBuffer !== 'undefined') {
             this.accBuffer = new MultiRingBuffer(12000);
        }
        
        this.fftMaxBuffer = [];
        this.avgFftBuffer = [];
        this.gyroFftMaxBuffer = [];
        this.gyroAvgFftBuffer = [];
        
        // Eigene Worker Instanzen!
        this.decodeWorker = new Worker('decode-worker2.js?v=55');
        this.wsWorker = new Worker('ws-worker.js?v=99');
        this.fftWorker = new Worker('fft-worker.js');
        this.rmsWorker = new Worker('rms-worker.js?v=27');
        this.gyroFftWorker = new Worker('fft-worker.js');
        this.gyroRmsWorker = new Worker('rms-worker.js?v=27');
        
        // NEW: Downsampling und Fusion für diesen Node (für 3D Anzeige)
        this.downsamplingWorker = new Worker('downsampling-worker.js');
        this.fusionWorker = new Worker('fusion-worker6.js');
        
        this.downsamplingWorker.postMessage({ type: 'init' });
        this.downsamplingWorker.onmessage = (e) => {
            this.fusionWorker.postMessage(e.data);
        };
        this.fusionWorker.onmessage = (e) => {
            const msg = e.data;
            if (msg && msg.type === 'state' && msg.quaternion) {
                this.orientationState = { 
                    quaternionXYZW: msg.quaternion,
                    positionXYZ: msg.position || null 
                };
            }
        };
        
        console.log(`[SensorNode] CH${channelIndex+1} Pipeline (Decoding, Websocket, FFT, RMS, Fusion) initialisiert auf ${this.sensorId}`);

        // FFT Worker Event Listener für diese Instanz
        this.fftWorker.onmessage = (e) => {
            const { freqs, mags } = e.data;
            if (!freqs || !mags) return;
            
            // Berechne lokale Averages
            bufferFFTResult(mags, this.fftMaxBuffer, FFT_RING_SIZE);
            const maxValues = computeMaxFFTValues(this.fftMaxBuffer);
            bufferAverageFFT(mags, this.avgFftBuffer, N_AVG);
            const meanValues = computeAverageFFT(this.avgFftBuffer);
            
            // Fülle die globalen Multi-FFT Arrays für uPlot  [Freqs, Max_CH1, Mean_CH1, Mag_CH1, Max_CH2...]
            updateSharedMultiFftData({
                multiFftData: window.multiFftData,
                freqs,
                maxValues,
                meanValues,
                magnitudes: mags,
                channelIndex: this.channelIndex,
            });

            window.latestWaterfallMags = window.latestWaterfallMags || [];
            window.latestWaterfallMags[this.channelIndex] = mags;

            if (this.channelIndex === 0 && window.waterfallRenderer) {
                const visibleNodes = window.activeSensors.filter(n => !n.isHiddenFromUI);
                const combinedMags = visibleNodes.map(n => window.latestWaterfallMags[n.channelIndex] || new Float32Array(mags.length));
                syncWaterfallRenderer({
                    renderer: window.waterfallRenderer,
                    maxHzInputId: 'waterfallMaxHz',
                    maxFreq: Math.max(...freqs),
                    magnitudes: combinedMags,
                    timestamp: e.data.timestamp,
                    timeString: e.data.timeString,
                    clockTimeStr: e.data.clockTimeStr,
                    lastMaxWindowKey: 'waterfallLastMax',
                    labelMaxId: 'wfLblMax',
                    labelMidId: 'wfLblMid',
                });
            }
        };

        // RMS Worker Event Listener für diese Instanz
        this.rmsWorker.onmessage = (e) => {
            if(rmsPaused || !this.rmsBuffer) return;
            const { rmsX, rmsY, rmsZ, rmsTotal, time } = e.data;
            this.rmsBuffer.push([time, rmsX, rmsY, rmsZ, rmsTotal]);
        };

        // Gyro RMS Worker Event Listener für diese Instanz
        this.gyroRmsWorker.onmessage = (e) => {
            if(rmsPaused || !this.gyroRmsBuffer) return;
            const { rmsX, rmsY, rmsZ, rmsTotal, time } = e.data;
            this.gyroRmsBuffer.push([time, rmsX, rmsY, rmsZ, rmsTotal]);
        };

        // Gyro FFT Worker Event Listener für diese Instanz
        this.gyroFftWorker.onmessage = (e) => {
            const { freqs, mags } = e.data;
            if (!freqs || !mags) return;
            
            bufferFFTResult(mags, this.gyroFftMaxBuffer, GYRO_FFT_RING_SIZE);
            const maxValues = computeMaxFFTValues(this.gyroFftMaxBuffer);
            bufferAverageFFT(mags, this.gyroAvgFftBuffer, gyroN_AVG);
            const meanValues = computeAverageFFT(this.gyroAvgFftBuffer);
            
            updateSharedMultiFftData({
                multiFftData: window.multiGyroFftData,
                freqs,
                maxValues,
                meanValues,
                magnitudes: mags,
                channelIndex: this.channelIndex,
            });

            window.latestGyroWaterfallMags = window.latestGyroWaterfallMags || [];
            window.latestGyroWaterfallMags[this.channelIndex] = mags;

            if (this.channelIndex === 0 && window.gyroWaterfallRenderer) {
                const visibleNodes = window.activeSensors.filter(n => !n.isHiddenFromUI);
                const combinedGyroMags = visibleNodes.map(n => window.latestGyroWaterfallMags[n.channelIndex] || new Float32Array(mags.length));
                syncWaterfallRenderer({
                    renderer: window.gyroWaterfallRenderer,
                    maxHzInputId: 'gyroWaterfallMaxHz',
                    maxFreq: Math.max(...freqs),
                    magnitudes: combinedGyroMags,
                    timestamp: e.data.timestamp,
                    timeString: e.data.timeString,
                    clockTimeStr: e.data.clockTimeStr,
                    lastMaxWindowKey: 'gyroWaterfallLastMax',
                    labelMaxId: 'gwfLblMax',
                    labelMidId: 'gwfLblMid',
                });
            }
        };
    }

    connect() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${this.ip}/ws`;
        console.log(`[SensorNode CH${this.channelIndex+1}] Verbinde zu: ${url}`);
        
        // Eigener WS-Worker übernimmt die Verbindung für diesen Node
        this.wsWorker.postMessage({ type: "connect", wsServerUrl: url });
        
        this.wsWorker.onmessage = (event) => {
            this.lastDataMs = performance.now();
            const { type, payload, subId, value, msg } = event.data;
            if (type === "data" && payload instanceof ArrayBuffer) {
                if (window.incrementTelemetryNodeFrames) {
                    window.incrementTelemetryNodeFrames(this.channelIndex, payload.byteLength || 0);
                }
                this.decodeWorker.postMessage(payload, [payload]);
            } else if (type === "config") {
                if (!window.sensorConfigs) window.sensorConfigs = {};
                if (!window.sensorConfigs[this.sensorId]) window.sensorConfigs[this.sensorId] = {};
                window.sensorConfigs[this.sensorId][subId] = value;
                console.log(`[SensorNode CH${this.channelIndex+1}] Config empfangen (${this.sensorId}): ${subId}=${value}`);
            } else if (type === "espStats") {
                if (payload && payload.syncedEspTime !== undefined) {
                    // Cache für Sync-Offset (O(1), kein zusätzlicher Aufwand)
                    this.syncedEspTime = payload.syncedEspTime;
                    this.decodeWorker.postMessage({ type: 'time_sync', payload: payload.syncedEspTime });
                }
                if (window.updateTelemetryNode) {
                    window.updateTelemetryNode(this.channelIndex, payload);
                }
            } else if (type === "firmwareVer") {
                const safeIp = (this.ip || "").replace(/\./g, "_");
                const otaBtn = document.getElementById(`otaTriggerBtn_${safeIp}`);
                if (otaBtn) {
                    otaBtn.innerText = payload;
                    otaBtn.style.color = "rgba(255,255,255,0.6)";
                }
            } else if (type === "connected") {
                console.log(`[SensorNode CH${this.channelIndex+1}] Websocket verbunden an ${this.ip}`);
                if (window.updateTelemetryNodeWsState) {
                    window.updateTelemetryNodeWsState(this.channelIndex, 'verbunden');
                }
            } else if (type === "error" || type === "closed") {
                console.warn(`[SensorNode CH${this.channelIndex+1}] Websocket Error/Closed:`, event.data);
                if (window.updateTelemetryNodeWsState) {
                    window.updateTelemetryNodeWsState(this.channelIndex, type === "error" ? "fehler" : "getrennt");
                }
                
                // AUTO-RECONNECT NACH NVS-WLAN-ABSTURZ
                // Wenn der NVS geschrieben wird, friert das WLAN auf dem ESP32 temporär ein. LWIP schließt den TCP Socket.
                // Der Browser muss sich nach dem Freiwerden des Speichers stumpf wiederverbinden, damit Channel 2 überlebt!
                if (!this.reconnectTimeout) {
                    console.log(`[SensorNode CH${this.channelIndex+1}] Plane automatischen Reconnect in 2000ms...`);
                    this.reconnectTimeout = setTimeout(() => {
                        this.reconnectTimeout = null;
                        // Erneut verbinden
                        this.wsWorker.postMessage({ type: "connect", wsServerUrl: url });
                    }, 2000);
                }
            }
        };

        this.decodeWorker.onmessage = (event) => {
            const { acc, gyro, temp, info, acccalib, gyrocalib } = event.data;
            if (temp && temp.length > 0) {
                const latestTemp = temp[temp.length - 1].value;
                if (Number.isFinite(latestTemp)) {
                    this.currentTemperature = latestTemp;
                }
            }
            if (!acc || acc.length === 0) {
                 if(Math.random() < 0.05) console.warn(`[SensorNode CH${this.channelIndex+1}] Decoder lieferte leeres ACC Array`);
            }
            
            if (info && info.length > 0) {
                window.updateSensorUIFromInfo(this.ip, info);
            }
            
            // Wenn der Worker in den lokalen Kalibrierungsmodus geschaltet wurde,
            // pushe die extrahierten Idle-Samples in den globalen Puffer, auf den das Popup lauscht!
            if (acccalib && acccalib.length > 0) {
                for (let sample of acccalib) {
                    accBufferCALIB.push([sample.x, sample.y, sample.z]);
                }
            }
            if (gyrocalib && gyrocalib.length > 0 && typeof gyroBufferCALIB !== 'undefined') {
                for (let sample of gyrocalib) {
                    gyroBufferCALIB.push([sample.x, sample.y, sample.z]);
                }
            }
            
            if (acc && acc.length > 0) {
                 this.lastDataMs = performance.now();
                 const calibratedAcc = [];
                // Fülle lokalen Puffer für FFT & RMS
                if (this.accBuffer) {
                    for (let i = 0; i < acc.length; i++) {
                        let sample = acc[i];
                        
                        // NEW: Pipeline Node-Specific Calibration & Gravity Cut!
                        if (window.buildNodeAccelerationSample) {
                            sample = window.buildNodeAccelerationSample(sample, this) || sample;
                        }
                        
                        let total = sample.total || Math.sqrt(sample.x*sample.x + sample.y*sample.y + sample.z*sample.z);
                        this.accBuffer.push([sample.time, sample.x, sample.y, sample.z, total]);
                        calibratedAcc.push(sample);
                        
                        if (typeof isRecording !== 'undefined' && isRecording) {
                            recordedAccRows.push(createAccRecordingRow(sample, this.channelIndex));
                            
                            if (recordedAccRows.length >= MAX_RECORDED_ROWS) {
                                console.log(`Max rows reached (ACC CH${this.channelIndex+1}). Triggering intermediate download.`);
                                downloadRecordedCsv(true);
                            }
                        }
                    }
                }
                
                // Pipeline Downsampling & Fusion
                this.downsamplingWorker.postMessage({ type: 'batch', sensor: 'acc', data: acc });

                 // Sende kalibrierte Daten ins LiveChart
                 if (window.insertIntoMultiChart) {
                     window.insertIntoMultiChart(this.channelIndex, calibratedAcc.length > 0 ? calibratedAcc : acc);
                 }
            }
            
            if (gyro && gyro.length > 0) {
                const calibratedGyro = [];
                for (let i = 0; i < gyro.length; i++) {
                    let sample = gyro[i];
                    if (window.buildNodeGyroSample) {
                        sample = window.buildNodeGyroSample(sample, this) || sample;
                    }
                    if (this.gyroBuffer) {
                        this.gyroBuffer.push([sample.time, sample.x, sample.y, sample.z]);
                    }
                    calibratedGyro.push(sample);
                    
                    if (typeof isRecording !== 'undefined' && isRecording) {
                        recordedGyroRows.push(createGyroRecordingRow(sample, this.channelIndex));
                        
                        if (recordedGyroRows.length >= MAX_RECORDED_ROWS) {
                            console.log(`Max rows reached (GYRO CH${this.channelIndex+1}). Triggering intermediate download.`);
                            downloadRecordedCsv(true);
                        }
                    }
                }
                // Pipeline Downsampling & Fusion
                this.downsamplingWorker.postMessage({ type: 'batch', sensor: 'gyro', data: gyro });
                
                if (window.insertIntoMultiGyroChart) {
                    window.insertIntoMultiGyroChart(this.channelIndex, calibratedGyro.length > 0 ? calibratedGyro : gyro);
                }
            }
        };
    }
}

// --- Decentralized Node-Accessing API ---
window.getNodeByIp = function(ip) {
    return window.activeSensors ? window.activeSensors.find(n => n.ip === ip) : null;
};

window.persistNodeCalibration = function(node) {
    if (!node || (!node.ip && !node.mac)) return;
    try {
        let serializedQuat = null;
        if (node.calibrationState && node.calibrationState.quat) {
            serializedQuat = Array.from(node.calibrationState.quat);
        }
        const payload = {
            ip: node.ip,
            mac: node.mac,
            orientationMode: node.orientationMode,
            calibrationState: {
                scale: node.calibrationState?.scale || 1,
                quat: serializedQuat,
                accNoise: node.calibrationState?.accNoise,
                gyroZero: node.calibrationState?.gyroZero
            },
            gravityCutEnabled: node.gravityCutEnabled
        };
        const identifier = node.mac ? node.mac.replace(/:/g, '') : node.ip.replace(/\./g, '_');
        const key = `node_calib_${identifier}`;
        globalThis.localStorage.setItem(key, JSON.stringify(payload));
        console.log(`[CH-SEC] Saved calibration for ${identifier}`);
    } catch(e) { console.warn(e); }
};

window.restoreNodeCalibration = function(node) {
    if (!node || (!node.ip && !node.mac)) return;
    try {
        const identifier = node.mac ? node.mac.replace(/:/g, '') : node.ip.replace(/\./g, '_');
        const key = `node_calib_${identifier}`;
        const raw = globalThis.localStorage.getItem(key);
        if (raw) {
            const payload = JSON.parse(raw);
            node.orientationMode = payload.orientationMode || 0;
            node.calibrationState = payload.calibrationState || {};
            node.gravityCutEnabled = !!payload.gravityCutEnabled;
            
            // Master Override (Syncs into global scope replacing old IP-based cookies)
            if (node.isMaster) {
                if (typeof window.applyOrientationMode === 'function') {
                    window.applyOrientationMode(node.orientationMode, { syncDropdown: true, persistState: false });
                }
                
                if (node.calibrationState.scale) {
                     window.currentAccelCalibrationScale = node.calibrationState.scale;
                     if (window.decodeWorker) window.decodeWorker.postMessage({ type: 'accelCalibrationScale', payload: { scale: node.calibrationState.scale }});
                }
                
                if (node.calibrationState.gyroZero) {
                     window.currentWorldSimpleGyroState = node.calibrationState.gyroZero;
                     if (window.decodeWorker) window.decodeWorker.postMessage({ type: 'worldSimpleGyroState', payload: node.calibrationState.gyroZero });
                }
                
                if (node.calibrationState.quat) {
                      let q = node.calibrationState.quat;
                      if (!Array.isArray(q) && !(q instanceof Float32Array)) {
                          if (q[0] !== undefined && q[1] !== undefined) {
                              q = [q[0], q[1], q[2], q[3]];
                          } else {
                              q = null; 
                          }
                      }
                      if (q && window.calibrationMemory) {
                          window.calibrationMemory[1] = q;
                          if (typeof window.syncViewportPostTransformQuaternion === 'function') {
                               window.syncViewportPostTransformQuaternion({ persistState: true, resetLiveBuffers: false });
                          }
                      }
                }
                return;
            }
            
            if (node.decodeWorker) {
                 if (node.calibrationState.scale) node.decodeWorker.postMessage({ type: 'accelCalibrationScale', payload: { scale: node.calibrationState.scale }});
                 if (node.calibrationState.gyroZero) node.decodeWorker.postMessage({ type: 'worldSimpleGyroState', payload: node.calibrationState.gyroZero });
                 if (node.calibrationState.quat) {
                      let q = node.calibrationState.quat;
                      if (!Array.isArray(q) && !(q instanceof Float32Array)) {
                          if (q[0] !== undefined && q[1] !== undefined) {
                              q = [q[0], q[1], q[2], q[3]];
                          } else {
                              q = null; // Corrupted
                          }
                      }
                      if (q) node.decodeWorker.postMessage({ type: 'calibdata', payload: { type: 2, quaternion: q }});
                 }
                 node.decodeWorker.postMessage({ type: 'calibmode', payload: { mode: node.orientationMode }});
                 node.decodeWorker.postMessage({ type: 'setgravity', payload: { gravity: node.gravityCutEnabled }});
            }
            console.log(`[CH-SEC] Restored calibration for ${node.ip}`);
            return true;
        }
    } catch(e) { console.warn(e); }
    return false;
};

window.setNodeOrientationMode = function(ip, mode) {
    const node = window.getNodeByIp(ip);
    if (!node) return;
    node.orientationMode = mode;
    console.log(`[Node ${ip}] Orientation = ${mode}`);
    
    if (node.decodeWorker && !node.isMaster) {
        node.decodeWorker.postMessage({ type: 'calibmode', payload: { mode: mode } });
        window.persistNodeCalibration(node);
    }
    
    // Fallback: If this is Master (CH1), sync global mode to keep 3D Viewer identical
    if (node.isMaster && typeof window.setOrientationMode === 'function') {
        window.setOrientationMode(mode);
    }
};

window.toggleNodeGravityCut = function(ip) {
    const node = window.getNodeByIp(ip);
    if (!node) return false;
    node.gravityCutEnabled = !node.gravityCutEnabled;
    console.log(`[Node ${ip}] Gravity Cut = ${node.gravityCutEnabled}`);
    
    if (node.decodeWorker && !node.isMaster) {
        node.decodeWorker.postMessage({ type: 'setgravity', payload: { gravity: node.gravityCutEnabled } });
        window.persistNodeCalibration(node);
    }
    
    // Fallback: Sync Master to Global for 3D Viewer
    if (node.isMaster && typeof window.setGravityCutEnabled === 'function') {
        window.setGravityCutEnabled(node.gravityCutEnabled);
    }
    return node.gravityCutEnabled;
};

window.openNodeCalibrationPopup = function(ip) {
    const node = window.getNodeByIp(ip);
    if (!node) return;
    
    // Hack: Da das bestehende popup immer global arbeitet, überschreiben wir temporär
    // die Quelle, wenn es CH2 ist, oder wir geben eine Meldung aus, falls zu komplex.
    // Für jetzt öffnen wir das globale, aber merken uns intern den "pendingCalibrationNode"
    window.pendingCalibrationIp = ip;
    
    // openPopup() ist im selben ES Modul vorhanden und muss nicht über window. angesprochen werden!
    openPopup();
    
    const popupTitle = document.querySelector(".popup-header h2");
    if(popupTitle) popupTitle.innerText = `Sensorkalibrierung (${ip})`;
};

// window.buildNodeAccelerationSample starts around line 3652
window.buildNodeAccelerationSample = function(raw, node) {
    if (!raw) return null;
    if (node.isMaster && typeof window.buildLiveAccelerationSample === 'function') {
        return window.buildLiveAccelerationSample(null, raw) || raw;
    }
    // Pipeline is now natively solved in the decode-worker2.js for secondary nodes as well!
    return raw;
};

window.buildNodeGyroSample = function(raw, node) {
    if (!raw) return null;
    if (node.isMaster && typeof window.buildLiveGyroSample === 'function') {
        return window.buildLiveGyroSample(null, raw) || raw;
    }
    return raw;
};


// === MULTI-CHANNEL BUFFER MERGER (BUCKETING) ===
window.CHART_BUCKET_MS = 2.0; // 2 ms Eimer (500 Hz Chart-Resolution ist für den Browser flüssig)

window.getMultiChartDataWindow = function(timeMinSec) {
    if (!window.multiChartData || window.multiChartData.length === 0 || window.multiChartData[0].length === 0) 
        return window.multiChartData;
        
    let times = window.multiChartData[0];
    let startIdx = 0;
    while(startIdx < times.length && times[startIdx] < timeMinSec) startIdx++;
    return window.multiChartData.map(arr => arr.slice(startIdx));
};

window.getMultiGyroChartDataWindow = function(timeMinSec) {
    if (!window.multiGyroChartData || window.multiGyroChartData.length === 0 || window.multiGyroChartData[0].length === 0) 
        return window.multiGyroChartData;
        
    let times = window.multiGyroChartData[0];
    let startIdx = 0;
    while(startIdx < times.length && times[startIdx] < timeMinSec) startIdx++;
    return window.multiGyroChartData.map(arr => arr.slice(startIdx));
};

function preserveAllYScales(myChart, updateCallback) {
    if (!myChart || !myChart.scales) {
        updateCallback();
        return;
    }
    const scalesBefore = {};
    for (let key in myChart.scales) {
        if (key.startsWith('y')) {
            scalesBefore[key] = { min: myChart.scales[key].min, max: myChart.scales[key].max };
        }
    }
    
    updateCallback();
    
    for (let key in scalesBefore) {
        if (scalesBefore[key].min !== undefined && scalesBefore[key].max !== undefined) {
            myChart.setScale(key, scalesBefore[key]);
        }
    }
}

function rebuildAccChartForSensorCount(sensorCount) {
    if (!chart || typeof uPlot === "undefined") return;

    const channelCount = Math.max(1, Number(sensorCount) || 1);
    const accChartHost = document.getElementById("accChartHost");
    const accChartLegendHost = document.getElementById("accChartLegendHost");
    const prevX = chart.scales?.x ? { min: chart.scales.x.min, max: chart.scales.x.max } : null;
    const prevY = chart.scales?.y ? { min: chart.scales.y.min, max: chart.scales.y.max } : null;

    const baseColors = [
        ["#FFD600", "#ec3030ff", "#7ABBFFff"], // CH1 (Z=hellblau)
        ["#997A00", "#8C1C1Cff", "#3D6FCCff"], // CH2: CH1 ~60%
        ["#ff4a4a", "#cc0000",   "#800000"],   // CH3
        ["#50c878", "#228b22",   "#006400"],   // CH4
    ];

    const series = [
        { label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 5) }
    ];

    const scales = { x: {} };
    const axes = [
        {
            time: false,
            scale: "x",
            space: 64,
            size: 44,
            label: "Zeit (s)",
            grid: { show: true },
            values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
            stroke: "white"
        }
    ];

    for (let i = 0; i < channelCount; i++) {
        const colors = baseColors[i % baseColors.length];
        const scaleId = i === 0 ? "y" : "y" + (i + 1);
        
        series.push({ label: `CH${i + 1} X (mg)`, stroke: colors[0], spanGaps: true, scale: scaleId });
        series.push({ label: `CH${i + 1} Y (mg)`, stroke: colors[1], spanGaps: true, scale: scaleId });
        series.push({ label: `CH${i + 1} Z (mg)`, stroke: colors[2], spanGaps: true, scale: scaleId });
        
        scales[scaleId] = { range: [-1100, 1100] };
        
        axes.push({
            scale: scaleId,
            size: 56,
            side: i % 2 === 0 ? 3 : 1, // 3: links, 1: rechts
            label: channelCount > 1 ? `CH${i + 1}` : "Wert",
            grid: { show: i === 0 },
            ticks: { format: (u, v) => v.toFixed(2) + " mg" },
            stroke: "white"
        });
    }

    const nextData = Array.from({ length: series.length }, () => []);
    const nextOptions = {
        ...getSize(),
        title: channelCount > 1 ? "ACC Live-Daten Multi-Channel" : "ACC Live-Daten",
        width: accChartHost?.clientWidth || chart.width,
        height: accChartHost?.clientHeight || chart.height,
        padding: [6, 8, 2, 2],
        axes: axes,
        scales: scales,
        series,
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

    const parent = chart.root.parentNode;
    chart.destroy();
    chart = new uPlot(nextOptions, nextData, parent);

    if (prevY && prevY.min !== undefined && prevY.max !== undefined) {
        chart.setScale("y", { min: prevY.min, max: prevY.max });
    }
    if (prevX && prevX.min !== undefined && prevX.max !== undefined) {
        chart.setScale("x", { min: prevX.min, max: prevX.max });
    }

    rebindAccChartInteractions();
    installManualLegendToggle(chart, "accChartLegendHost");
}

function rebindOverlayElement(overlayId) {
    const oldOverlay = document.getElementById(overlayId);
    if (!oldOverlay || !oldOverlay.parentNode) {
        return null;
    }

    const newOverlay = oldOverlay.cloneNode(false);
    oldOverlay.parentNode.replaceChild(newOverlay, oldOverlay);
    return newOverlay;
}

function rebindAccChartInteractions() {
    if (!chart) return;

    preserveScalesOnSeriesToggle(chart);

    rebindOverlayElement("y-axis-overlay");
    rebindOverlayElement("y2-axis-overlay");
    rebindOverlayElement("x-axis-overlay");
    
    // We only bind y2 if it exists in the chart (e.g. scales.y2 is defined)
    if (chart.scales && chart.scales.y2) {
        bindYAxisOverlay("y2-axis-overlay", chart, false, "y2");
        const syncBtn = document.getElementById("syncYAxesBtn");
        if (syncBtn) syncBtn.style.display = ""; // Show when multiple nodes
    } else {
        const syncBtn = document.getElementById("syncYAxesBtn");
        if (syncBtn) syncBtn.style.display = "none";
    }
    bindYAxisOverlay("y-axis-overlay", chart, false, "y");
    bindSharedXAxisOverlay("x-axis-overlay", chart);
    window.chartInteractions && window.chartInteractions.syncAxisOverlayPositions(chart, "livechart2", "y-axis-overlay", "x-axis-overlay", "y2-axis-overlay");

    if (chart.over && !chart.over.dataset.accDblclickBound) {
        chart.over.addEventListener("dblclick", () => {
            window.setPanOffset(0);
            if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
                chart.setScale("x", { min: lastTimestamp - (displayDurationSeconds * 1000000), max: lastTimestamp });
                if (window.chartInteractions) window.chartInteractions.syncTimeRangeUi(displayDurationSeconds * 1000000);
            } else {
                chart.setScale("x", { auto: true });
            }
            
            for (let key in chart.scales) {
                if (key === "x") continue;
                chart.setScale(key, { min: -1100, max: 1100 });
            }
        });
        chart.over.dataset.accDblclickBound = "1";
    }
}

function rebindGyroChartInteractions() {
    if (!gyroChart) return;

    preserveScalesOnSeriesToggle(gyroChart);

    rebindOverlayElement("gyro-y-axis-overlay");
    rebindOverlayElement("gyro-y2-axis-overlay");
    rebindOverlayElement("gyro-x-axis-overlay");
    
    if (gyroChart.scales && gyroChart.scales.y2) {
        bindYAxisOverlay("gyro-y2-axis-overlay", gyroChart, false, "y2");
        const syncBtn = document.getElementById("syncGyroYAxesBtn");
        if (syncBtn) syncBtn.style.display = ""; // Show when multiple nodes
    } else {
        const syncBtn = document.getElementById("syncGyroYAxesBtn");
        if (syncBtn) syncBtn.style.display = "none";
    }
    bindYAxisOverlay("gyro-y-axis-overlay", gyroChart, false, "y");
    bindSharedXAxisOverlay("gyro-x-axis-overlay", gyroChart);
    window.chartInteractions && window.chartInteractions.syncAxisOverlayPositions(gyroChart, "gyrochart", "gyro-y-axis-overlay", "gyro-x-axis-overlay", "gyro-y2-axis-overlay");

    if (gyroChart.over && !gyroChart.over.dataset.gyroDblclickBound) {
        gyroChart.over.addEventListener("dblclick", () => {
            window.setPanOffset(0);
            if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
                gyroChart.setScale("x", { min: lastTimestamp - (displayDurationSeconds * 1000000), max: lastTimestamp });
                if (window.chartInteractions) window.chartInteractions.syncTimeRangeUi(displayDurationSeconds * 1000000);
            } else {
                gyroChart.setScale("x", { auto: true });
            }
            
            for (let key in gyroChart.scales) {
                if (key === "x") continue;
                gyroChart.setScale(key, { min: -20000, max: 20000 });
            }
        });
        gyroChart.over.dataset.gyroDblclickBound = "1";
    }
}

function rebuildGyroChartForSensorCount(sensorCount) {
    if (!gyroChart || typeof uPlot === "undefined") return;

    const channelCount = Math.max(1, Number(sensorCount) || 1);
    const gyroChartHost = document.getElementById("gyrochart");
    const gyroChartLegendHost = document.getElementById("gyroChartLegendHost");
    const prevX = gyroChart.scales?.x ? { min: gyroChart.scales.x.min, max: gyroChart.scales.x.max } : null;
    const prevY = gyroChart.scales?.y ? { min: gyroChart.scales.y.min, max: gyroChart.scales.y.max } : null;

    const baseColors = [
        ["#FFD600", "#ec3030ff", "#7ABBFFff"], // CH1 (Z=hellblau)
        ["#997A00", "#8C1C1Cff", "#3D6FCCff"], // CH2: CH1 ~60%
        ["#ff4a4a", "#cc0000",   "#800000"],   // CH3
        ["#50c878", "#228b22",   "#006400"],   // CH4
    ];

    const series = [
        { label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 5) }
    ];

    const scales = { x: {} };
    const axes = [
        {
            time: false,
            scale: "x",
            space: 64,
            size: 44,
            label: "Zeit (s)",
            grid: { show: true },
            values: (u, v) => v.map(t => formatMicrosecondsToHMS(t, 0)),
            stroke: "white"
        }
    ];

    for (let i = 0; i < channelCount; i++) {
        const colors = baseColors[i % baseColors.length];
        const scaleId = i === 0 ? "y" : "y" + (i + 1);
        
        series.push({ label: `CH${i + 1} X (mdp)`, stroke: colors[0], spanGaps: true, scale: scaleId });
        series.push({ label: `CH${i + 1} Y (mdp)`, stroke: colors[1], spanGaps: true, scale: scaleId });
        series.push({ label: `CH${i + 1} Z (mdp)`, stroke: colors[2], spanGaps: true, scale: scaleId });
        
        scales[scaleId] = { range: [-20000, 20000] };
        
        axes.push({
            scale: scaleId,
            size: 56,
            side: i % 2 === 0 ? 3 : 1, // 3: links, 1: rechts
            label: channelCount > 1 ? `CH${i + 1}` : "Wert",
            grid: { show: i === 0 },
            ticks: { format: (u, v) => v.toFixed(2) + " mdp" },
            stroke: "white"
        });
    }

    const nextData = Array.from({ length: series.length }, () => []);
    const nextOptions = {
        ...getGyroChartSize(),
        title: channelCount > 1 ? "GYRO Live-Daten Multi-Channel" : "GYRO Live-Daten",
        width: gyroChartHost?.clientWidth || gyroChart.width,
        height: gyroChartHost?.clientHeight || gyroChart.height,
        padding: [6, 8, 2, 2],
        axes: axes,
        scales: scales,
        series,
        cursor: {
            points: {},
            drag: { x: true, y: true, setScale: true }
        },
        legend: {
            mount: (u, table) => {
                gyroChartLegendHost?.replaceChildren(table);
            },
        },
        plugins: [createCursorYPlugin("mdp")],
    };

    const parent = gyroChart.root.parentNode;
    gyroChart.destroy();
    gyroChart = new uPlot(nextOptions, nextData, parent);

    if (prevY && prevY.min !== undefined && prevY.max !== undefined) {
        gyroChart.setScale("y", { min: prevY.min, max: prevY.max });
    }
    if (prevX && prevX.min !== undefined && prevX.max !== undefined) {
        gyroChart.setScale("x", { min: prevX.min, max: prevX.max });
    }

    rebindGyroChartInteractions();
    installManualLegendToggle(gyroChart, "gyroChartLegendHost");
}

function normalizeMultiChartDataForPlot(rawData) {
    if (!Array.isArray(rawData) || rawData.length === 0) {
        return rawData;
    }

    const times = Array.isArray(rawData[0]) ? rawData[0].slice() : [];
    const normalized = [times];

    for (let seriesIndex = 1; seriesIndex < rawData.length; seriesIndex++) {
        const sourceSeries = Array.isArray(rawData[seriesIndex]) ? rawData[seriesIndex] : [];
        const denseSeries = new Array(times.length);

        for (let i = 0; i < times.length; i++) {
            const value = sourceSeries[i];
            denseSeries[i] = Number.isFinite(value) ? value : null;
        }

        normalized.push(denseSeries);
    }

    return normalized;
}



window.insertIntoMultiChart = function(channelIndex, samples) {
    if (!window.multiChartData || window.multiChartData.length === 0) return;
    if (channelIndex >= window.activeSensors.length) return;
    
    const baseIdx = channelIndex * 4 + 1;
    if (baseIdx + 3 >= window.multiChartData.length) return;
    
    const node = window.activeSensors[channelIndex];
    // --- Offset-Tracking für Sekundär-Kanäle (O(1) EMA, kein Array/Sort) ---
    if (node) {
        if (channelIndex === 0) {
            // Master: kein Offset nötig
            node.timeOffset = 0;
        } else if (samples.length > 0) {
            // Primär: syncedEspTime aus espStats (aktuellste Firmware-Zeit, O(1))
            // Fallback: Ring-Buffer-Lookup falls espStats noch nicht empfangen
            const masterNode = window.activeSensors[0];
            let masterLatestTime = 0;
            if (masterNode?.syncedEspTime > 0 && node.syncedEspTime > 0) {
                // Direkte ESP-Zeitdifferenz – stabilster Weg, unabhängig von Datenpaketen
                masterLatestTime = masterNode.syncedEspTime;
                const secondaryEspTime = node.syncedEspTime;
                const currentDiff = masterLatestTime - secondaryEspTime;
                const prevOffset = node.timeOffset;
                if (!Number.isFinite(prevOffset) || prevOffset === 0) {
                    node.timeOffset = currentDiff;
                } else {
                    const delta = currentDiff - prevOffset;
                    // Sprung > 500ms → direkt setzen, sonst EMA α=0.05
                    node.timeOffset = Math.abs(delta) > 500000
                        ? currentDiff
                        : prevOffset + delta * 0.05;
                }
            } else {
                // Fallback: O(1) Ring-Buffer-Lookup
                masterLatestTime = Number(
                    (masterNode?.accBuffer ?? accBuffer)?.getLast?.()?.time ?? 0
                );
                const secondaryLatestTime = samples[samples.length - 1].time;
                if (masterLatestTime > 0 && secondaryLatestTime > 0) {
                    const currentDiff = masterLatestTime - secondaryLatestTime;
                    const prevOffset = node.timeOffset;
                    if (!Number.isFinite(prevOffset) || prevOffset === 0) {
                        node.timeOffset = currentDiff;
                    } else {
                        const delta = currentDiff - prevOffset;
                        node.timeOffset = Math.abs(delta) > 500000
                            ? currentDiff
                            : prevOffset + delta * 0.05;
                    }
                } else if (!Number.isFinite(node.timeOffset)) {
                    node.timeOffset = 0;
                }
            }
        } else if (!Number.isFinite(node.timeOffset)) {
            node.timeOffset = 0;
        }
    }

    const timeArr = window.multiChartData[0];
    const xArr = window.multiChartData[baseIdx];
    const yArr = window.multiChartData[baseIdx + 1];
    const zArr = window.multiChartData[baseIdx + 2];
    const totalArr = window.multiChartData[baseIdx + 3];
    
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const t = s.time + (Number.isFinite(node?.timeOffset) ? node.timeOffset : 0);
        
        let lastTime = timeArr.length > 0 ? timeArr[timeArr.length - 1] : -1;
        
        if (timeArr.length === 0 || t > lastTime) {
            timeArr.push(t);
            for (let c = 1; c < window.multiChartData.length; c++) {
                window.multiChartData[c].push(null);
            }
            xArr[timeArr.length - 1] = s.x;
            yArr[timeArr.length - 1] = s.y;
            zArr[timeArr.length - 1] = s.z;
            totalArr[timeArr.length - 1] = s.total || Math.hypot(s.x, s.y, s.z);
        } else {
             let k = timeArr.length - 1;
             while (k >= 0 && timeArr[k] > t + 5000) {
                 k--;
             }
             if (k >= 0 && Math.abs(timeArr[k] - t) <= 5000) {
                 xArr[k] = s.x;
                 yArr[k] = s.y;
                 zArr[k] = s.z;
                 totalArr[k] = s.total || Math.hypot(s.x, s.y, s.z);
             } else {
                 const insertPos = k + 1;
                 timeArr.splice(insertPos, 0, t);
                 for (let c = 1; c < window.multiChartData.length; c++) {
                     window.multiChartData[c].splice(insertPos, 0, null);
                 }
                 xArr[insertPos] = s.x;
                 yArr[insertPos] = s.y;
                 zArr[insertPos] = s.z;
                 totalArr[insertPos] = s.total || Math.hypot(s.x, s.y, s.z);
             }
        }
    }
    
    const MAX_BUCKETS = 60000;
    if (timeArr.length > MAX_BUCKETS) {
        const excess = timeArr.length - MAX_BUCKETS;
        for (let i = 0; i < window.multiChartData.length; i++) {
            window.multiChartData[i].splice(0, excess);
        }
    }
};

window.insertIntoMultiGyroChart = function(channelIndex, samples) {
    if (!window.multiGyroChartData || window.multiGyroChartData.length === 0) return;
    if (channelIndex >= window.activeSensors.length) return;
    
    const baseIdx = channelIndex * 3 + 1;
    if (baseIdx + 2 >= window.multiGyroChartData.length) return;
    
    const node = window.activeSensors[channelIndex];
    if (node) {
        if (channelIndex === 0) {
            node.timeOffset = 0;
        } else if (samples.length > 0) {
            let masterLatestTime = 0;
            const masterBuffer = window.activeSensors[0]?.gyroBuffer;

            if (masterBuffer?.length > 0) {
                masterLatestTime = Number(masterBuffer.getLast()?.time || 0);
            } else if (window.multiGyroChartData?.[0]?.length > 0) {
                const times = window.multiGyroChartData[0];
                masterLatestTime = Number(times[times.length - 1] || 0);
            } else if (Number.isFinite(lastTimestamp) && lastTimestamp > 0) {
                masterLatestTime = Number(lastTimestamp);
            }

            const secondaryLatestTime = Number(samples[samples.length - 1]?.time || 0);
            if (masterLatestTime > 0 && secondaryLatestTime > 0) {
                const diff = masterLatestTime - secondaryLatestTime;
                if (!Number.isFinite(node.timeOffset) || node.timeOffset === 0 || Math.abs(node.timeOffset - diff) > 1000000) {
                    node.timeOffset = diff;
                }
            } else if (!Number.isFinite(node.timeOffset)) {
                node.timeOffset = 0;
            }
        } else if (!Number.isFinite(node.timeOffset)) {
            node.timeOffset = 0;
        }
    }

    const timeArr = window.multiGyroChartData[0];
    const xArr = window.multiGyroChartData[baseIdx];
    const yArr = window.multiGyroChartData[baseIdx + 1];
    const zArr = window.multiGyroChartData[baseIdx + 2];
    
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const t = s.time + (Number.isFinite(node?.timeOffset) ? node.timeOffset : 0);
        
        let lastTime = timeArr.length > 0 ? timeArr[timeArr.length - 1] : -1;
        
        if (timeArr.length === 0 || t > lastTime) {
            timeArr.push(t);
            for (let c = 1; c < window.multiGyroChartData.length; c++) {
                window.multiGyroChartData[c].push(null);
            }
            xArr[timeArr.length - 1] = s.x;
            yArr[timeArr.length - 1] = s.y;
            zArr[timeArr.length - 1] = s.z;
        } else {
             let k = timeArr.length - 1;
             while (k >= 0 && timeArr[k] > t + 5000) {
                 k--;
             }
             if (k >= 0 && Math.abs(timeArr[k] - t) <= 5000) {
                 xArr[k] = s.x;
                 yArr[k] = s.y;
                 zArr[k] = s.z;
             } else {
                 const insertPos = k + 1;
                 timeArr.splice(insertPos, 0, t);
                 for (let c = 1; c < window.multiGyroChartData.length; c++) {
                     window.multiGyroChartData[c].splice(insertPos, 0, null);
                 }
                 xArr[insertPos] = s.x;
                 yArr[insertPos] = s.y;
                 zArr[insertPos] = s.z;
             }
        }
    }
    
    const MAX_BUCKETS_GYRO = 60000;
    if (timeArr.length > MAX_BUCKETS_GYRO) {
        const excess = timeArr.length - MAX_BUCKETS_GYRO;
        for (let i = 0; i < window.multiGyroChartData.length; i++) {
            window.multiGyroChartData[i].splice(0, excess);
        }
    }
};


window.initializeDashboardNodes = function(nodes) {
    const nodesList = document.getElementById('nodesList');
    if (nodesList) nodesList.innerHTML = '';
    
    // Zerstöre alte Background-Worker, falls der Refresh-Button gedrückt wurde
    if (window.activeSensors) {
        window.activeSensors.forEach(node => {
            if (node.isMaster) return; // Globale Master-Worker NICHT zerstören!
            
            if (node.wsWorker) {
                node.wsWorker.postMessage({ type: "disconnect" });
                node.wsWorker.terminate();
            }
            if (node.decodeWorker) node.decodeWorker.terminate();
            if (node.fftWorker) node.fftWorker.terminate();
            if (node.rmsWorker) node.rmsWorker.terminate();
            if (node.gyroFftWorker) node.gyroFftWorker.terminate();
            if (node.gyroRmsWorker) node.gyroRmsWorker.terminate();
        });
    }
    window.activeSensors = []; // Reset Nodes

    updateRelativeAnalysisNodeSelector(nodes); // Update Relativ-Tab Dropdown
    if (typeof accVectorViewport !== 'undefined' && accVectorViewport && typeof accVectorViewport.updateNodeSelector === 'function') {
        accVectorViewport.updateNodeSelector(nodes);
    }

    const settingsTargetSelect = document.getElementById("settingsSensorTarget");
    const sensorTabsContainer = document.getElementById("sensorTabsContainer");
    const multiNodeSettingsHost = document.getElementById("multiNodeSettingsHost");
    if (settingsTargetSelect) settingsTargetSelect.innerHTML = '';
    if (sensorTabsContainer) sensorTabsContainer.innerHTML = '';
    if (multiNodeSettingsHost) multiNodeSettingsHost.innerHTML = '';

    nodes.forEach((nodeInfo, idx) => {
        const nodeIp = nodeInfo.ip;
        const nodeMac = nodeInfo.mac || "";
        const isMasterNode = Boolean(nodeInfo.isMaster);
        const channelName = isMasterNode ? "CH1 (Master)" : `CH${idx+1}`;
        const tabColor = ['#FFD600', '#ec3030ff', '#50c878', '#4da6ff'][idx % 4];

        // SensorNode-Objekt erzeugen & verbinden (moved up)
        let node;
        if (isMasterNode) {
            node = {
                ip: nodeIp,
                mac: nodeMac,
                sensorId: nodeMac || nodeIp,
                isMaster: true,
                channelIndex: idx,
                orientationMode: typeof currentOrientationMode !== 'undefined' ? currentOrientationMode : 0,
                gravityCutEnabled: typeof gravityCutEnabled !== 'undefined' ? gravityCutEnabled : false,
                calibrationState: {
                    quat: typeof calibrationMemory !== 'undefined' && calibrationMemory ? calibrationMemory[1] : null,
                    scale: typeof currentAccelCalibrationScale !== 'undefined' ? currentAccelCalibrationScale : 1,
                    gyroZero: typeof currentWorldSimpleGyroState !== 'undefined' ? currentWorldSimpleGyroState : null,
                    accNoise: 15
                },
                accRawBuffer: window.accRawBuffer ?? (typeof accRawBuffer !== 'undefined' ? accRawBuffer : null),
                accBuffer: window.accBuffer ?? (typeof accBuffer !== 'undefined' ? accBuffer : null),
                rmsBuffer: window.rmsBuffer ?? (typeof rmsBuffer !== 'undefined' ? rmsBuffer : null),
                gyroRawBuffer: window.gyroRawBuffer ?? (typeof gyroRawBuffer !== 'undefined' ? gyroRawBuffer : null),
                gyroBuffer: window.gyroBuffer ?? (typeof gyroBuffer !== 'undefined' ? gyroBuffer : null),
                gyroRmsBuffer: window.gyroRmsBuffer ?? (typeof gyroRmsBuffer !== 'undefined' ? gyroRmsBuffer : null),
                fftWorker,
                rmsWorker,
                gyroFftWorker: typeof gyroFftWorker !== 'undefined' ? gyroFftWorker : null,
                gyroRmsWorker: typeof gyroRmsWorker !== 'undefined' ? gyroRmsWorker : null,
            };
            window.restoreNodeCalibration(node);
        } else {
            node = new SensorNode(nodeInfo, idx);
            window.restoreNodeCalibration(node);
        }
        window.activeSensors.push(node);

        // Generiere dedizierte Sensor-Einstellungspalte!
        if (typeof buildSettingsColumnForNode === 'function') {
            buildSettingsColumnForNode(nodeIp, channelName, tabColor, nodeMac);
        }

        // 1) Hidden Select befüllen
        if (settingsTargetSelect) {
            const opt = document.createElement("option");
            opt.value = nodeIp;
            opt.textContent = channelName;
            opt.dataset.sensorMac = nodeMac;
            settingsTargetSelect.appendChild(opt);
        }

        // UI aktualisieren
        if (nodesList) {
            const div = document.createElement('div');
            div.style.padding = '4px 8px';
            div.style.background = 'rgba(255,255,255,0.05)';
            div.style.borderRadius = '4px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            
            const color = ['#4da6ff', '#ff4a4a', '#50c878', '#ffd600'][idx % 4];
            
            div.id = `sensorNodeListRow_${idx}`;
            div.innerHTML = `
                <span style="color:${color}; font-weight:bold;">CH ${idx+1} <span id="nodeWsState_${idx}" style="font-size:0.6rem;opacity:0.6; margin-left:4px;">(● Sucht...)</span></span>
                <span style="font-family:monospace;">${nodeMac || nodeIp}</span>
            `;
            nodesList.appendChild(div);
        }
        
        if (!isMasterNode && !window.isOfflineReplayMode) {
             node.connect();
        }
    });

    // uPlot-Diagramm Serien dynamically anlegen
    rebuildAccChartForSensorCount(nodes.length);
    rebuildGyroChartForSensorCount(nodes.length);
    
    // Initialisiere Data Array (Zeit + 4 * N für ACC, Zeit + 3 * N für GYRO)
    window.multiChartData = Array(nodes.length * 4 + 1).fill().map(() => []);
    window.multiGyroChartData = Array(nodes.length * 3 + 1).fill().map(() => []);
    
    if (window.setFftSensorCount) {
         window.setFftSensorCount(nodes.length);
         window.multiFftData = Array(nodes.length * 3 + 1).fill().map(() => []); 
    }

    if (window.setGyroFftSensorCount) {
         window.setGyroFftSensorCount(nodes.length);
         window.multiGyroFftData = Array(nodes.length * 3 + 1).fill().map(() => []); 
    }

    if (window.setRmsSensorCount) {
         window.setRmsSensorCount(nodes.length);
    }

    if (window.setGyroRmsSensorCount) {
         window.setGyroRmsSensorCount(nodes.length);
    }
};

async function discoverNodes() {
    try {
        const protocol = window.location.protocol === "https:" ? "https:" : "http:";
        let apiHost = window.location.hostname;
        if(!apiHost || apiHost === "localhost" || apiHost === "127.0.0.1") apiHost = "192.168.4.1";
        
        const response = await fetch(`${protocol}//${apiHost}/api/nodes`);
        const rawNodes = await response.json();
        const nodes = Array.isArray(rawNodes)
            ? rawNodes.map((entry, idx) => {
                if (typeof entry === "string") {
                    return { ip: entry, mac: "", isMaster: idx === 0 };
                }
                return {
                    ip: entry?.ip || "",
                    mac: entry?.mac || "",
                    isMaster: Boolean(entry?.isMaster),
                };
            }).filter(node => node.ip)
            : [];
        
        window.initializeDashboardNodes(nodes);

    } catch (e) {
        const nodesList = document.getElementById('nodesList');
        if (nodesList) nodesList.innerHTML = '<div style="color:#ff6b6b;font-size:0.75rem;">Nodes nicht erreichbar.</div>';
        console.error("Discovery Error:", e);
    }
}

// === WebSocket starten ===
function connectWebSocket() {
    discoverNodes();
    document.getElementById('btnDiscoverNodes')?.addEventListener('click', discoverNodes);

    setInterval(async () => {
        if (window.isOfflineReplayMode) return;
        try {
            const protocol = window.location.protocol === "https:" ? "https:" : "http:";
            let apiHost = window.location.hostname;
            if(!apiHost || apiHost === "localhost" || apiHost === "127.0.0.1") apiHost = "192.168.4.1";
            
            // MASTER POLLING (verhindert Timeout im Master = CH1)
            const response = await fetch(`${protocol}//${apiHost}/api/nodes`);
            const rawNodes = await response.json();
            const nodes = Array.isArray(rawNodes)
                ? rawNodes.map((entry, idx) => {
                    if (typeof entry === "string") return { ip: entry, mac: "", isMaster: idx === 0 };
                    return { ip: entry?.ip || "", mac: entry?.mac || "", isMaster: Boolean(entry?.isMaster) };
                }).filter(n => n.ip)
                : [];
                
            let changed = false;
            if (!window.activeSensors || nodes.length !== window.activeSensors.length) {
                changed = true;
            } else {
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].ip !== window.activeSensors[i].ip || nodes[i].mac !== window.activeSensors[i].mac) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) {
                console.log("Topology change detected, but auto-reset is intentionally disabled to prevent WebSocket closures.");
                // discoverNodes(); // AUSKOMMENTIERT: Dies hat alle laufenden Workers grundlos terminiert!
            }

        } catch(e) {}
    }, 5000); // 5 Sekunden-Intervall ist ausreichend für den Reset des ESP-IDF 5s-Timeouts
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams(window.location.search);
    const customWsHost = sanitizeCustomWsHost(params.get("ws")) || persistedCustomWsHost;
    const previewHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", ""]);
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

    console.log("[WS] Verbinde zu Master WebSocket:", url);
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

window.updateDashboard = function updateDashboard() {
    const now = performance.now();
    if (window.activeSensors) {
        window.activeSensors.forEach((node, idx) => {
             const isDisconnected = !window.isOfflineReplayMode && (!node.lastDataMs || now - node.lastDataMs > 10000);
             if (node.wasDisconnected !== isDisconnected) {
                 node.wasDisconnected = isDisconnected;
                 const host = document.getElementById("multiNodeSettingsHost");
                 const tabs = document.getElementById("sensorTabsContainer");
                 
                 if (host && host.children[idx]) {
                     host.children[idx].style.display = isDisconnected ? 'none' : 'flex';
                 }
                 if (tabs && tabs.children[idx]) {
                     tabs.children[idx].style.display = isDisconnected ? 'none' : '';
                 }
                 
                 if (window.fftPlot) {
                     window.fftPlot.setSeries(idx * 3 + 1, { show: !isDisconnected });
                     window.fftPlot.setSeries(idx * 3 + 2, { show: !isDisconnected });
                     window.fftPlot.setSeries(idx * 3 + 3, { show: !isDisconnected });
                 }
                 if (window.gyroFftPlot) {
                     window.gyroFftPlot.setSeries(idx * 3 + 1, { show: !isDisconnected });
                     window.gyroFftPlot.setSeries(idx * 3 + 2, { show: !isDisconnected });
                     window.gyroFftPlot.setSeries(idx * 3 + 3, { show: !isDisconnected });
                 }
                 if (window.chart) {
                     window.chart.setSeries(idx * 3 + 1, { show: !isDisconnected });
                     window.chart.setSeries(idx * 3 + 2, { show: !isDisconnected });
                     window.chart.setSeries(idx * 3 + 3, { show: !isDisconnected });
                 }
                 if (window.gyroChart) {
                     window.gyroChart.setSeries(idx * 3 + 1, { show: !isDisconnected });
                     window.gyroChart.setSeries(idx * 3 + 2, { show: !isDisconnected });
                     window.gyroChart.setSeries(idx * 3 + 3, { show: !isDisconnected });
                 }
                 if (window.rmsPlot) {
                     window.rmsPlot.setSeries(idx * 4 + 1, { show: !isDisconnected });
                     window.rmsPlot.setSeries(idx * 4 + 2, { show: !isDisconnected });
                     window.rmsPlot.setSeries(idx * 4 + 3, { show: !isDisconnected });
                     window.rmsPlot.setSeries(idx * 4 + 4, { show: !isDisconnected });
                 }
             }
        });
    }
    //console.log("[DASHBOARD] Update started, accBuffer size:", accBuffer.size);
    let lastAccSample = accBuffer.getLast() || { time: 0, x: 0, y: 0, z: 0, total: 0 };
    let lastAccRawSample = accRawBuffer.getLast() || { time: 0, x: 0, y: 0, z: 0, total: 0 };
    let lastGyroSample = gyroBuffer.getLast() || { time: 0, x: 0, y: 0, z: 0 };
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
            if (window.activeSensors && window.activeSensors[0]) {
                 window.activeSensors[0].currentTemperature = currentTemperature;
            }
        }
        else {
            console.log("Temperaturpuffer leer");
            currentTemperature = 0;
        }

        if (accBuffer.length > 0) {
            totalSeconds1 = lastAccSample.time * 0.000001;
        }

        const smoothedSampleRate = getSmoothedFilterSampleRate(Samplerate1);
        if (shouldRefreshFilterSampleRate(smoothedSampleRate)) {
            currentSampleRate = smoothedSampleRate;
            window.currentSampleRate = smoothedSampleRate;
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
        let accXHtml = "";
        let accYHtml = "";
        let accZHtml = "";
        let gyroXHtml = "";
        let gyroYHtml = "";
        let gyroZHtml = "";
        let tempHtml = "";
        let srHtml = "";
        let gyroSrHtml = "";
        let timeHtml = "";

        const visibleSensors = window.activeSensors ? window.activeSensors.filter(n => !n.isHiddenFromUI) : [];
        if (visibleSensors.length > 1) {
            const cardColors = ["#FFD600", "#50c878", "#ff4a4a", "#7ABBFF"]; 
            visibleSensors.forEach((node) => {
                const now = performance.now();
                const isDisconnected = !window.isOfflineReplayMode && (now - node.lastDataMs > 5000); // 5 Sekunden Timeout analog zu UI Watchdog
                
                let aSmp = node.accBuffer?.getLast();
                let gSmp = node.gyroBuffer?.getLast();
                
                let ax = (aSmp && !isDisconnected) ? aSmp.x.toFixed(1) : "---";
                let ay = (aSmp && !isDisconnected) ? aSmp.y.toFixed(1) : "---";
                let az = (aSmp && !isDisconnected) ? aSmp.z.toFixed(1) : "---";
                let gx = (gSmp && !isDisconnected) ? gSmp.x.toFixed(1) : "---";
                let gy = (gSmp && !isDisconnected) ? gSmp.y.toFixed(1) : "---";
                let gz = (gSmp && !isDisconnected) ? gSmp.z.toFixed(1) : "---";
                
                let tempNode = (Number.isFinite(node.currentTemperature) && !isDisconnected) ? node.currentTemperature.toFixed(1) : "---";
                let srNode = "---";
                if (node.accBuffer && node.accBuffer.length > 0 && !isDisconnected) {
                    srNode = estimateRecentSampleRateHz(node.accBuffer).toFixed(0);
                }
                
                let gyroSrNode = "---";
                if (node.gyroBuffer && node.gyroBuffer.length > 0 && !isDisconnected) {
                    gyroSrNode = estimateRecentSampleRateHz(node.gyroBuffer).toFixed(0);
                }
                let timeNode = (aSmp && !isDisconnected) ? formatRuntimeMicroseconds(aSmp.time, 2) : "---";

                const idx = node.channelIndex || 0;
                const colorHex = window.SENSOR_COLORS?.[idx % (window.SENSOR_COLORS?.length || 1)] || cardColors[idx % cardColors.length];
                const style = `display:block; font-size:0.65em; line-height:1.2em; color:${colorHex};`;
                
                accXHtml += `<span style="${style}">CH${idx+1}: ${ax}</span>`;
                accYHtml += `<span style="${style}">CH${idx+1}: ${ay}</span>`;
                accZHtml += `<span style="${style}">CH${idx+1}: ${az}</span>`;
                gyroXHtml += `<span style="${style}">CH${idx+1}: ${gx}</span>`;
                gyroYHtml += `<span style="${style}">CH${idx+1}: ${gy}</span>`;
                gyroZHtml += `<span style="${style}">CH${idx+1}: ${gz}</span>`;
                tempHtml += `<span style="${style}">CH${idx+1}: ${tempNode}</span>`;
                srHtml += `<span style="${style}">CH${idx+1}: ${srNode}</span>`;
                gyroSrHtml += `<span style="${style}">CH${idx+1}: ${gyroSrNode}</span>`;
                timeHtml += `<span style="${style}">CH${idx+1}: ${timeNode}</span>`;
            });
        } else {
            accXHtml = lastAccSample ? lastAccSample.x.toFixed(1) : "0.0";
            accYHtml = lastAccSample ? lastAccSample.y.toFixed(1) : "0.0";
            accZHtml = lastAccSample ? lastAccSample.z.toFixed(1) : "0.0";
            let ls = window.activeSensors?.[0]?.gyroBuffer?.getLast();
            gyroXHtml = ls ? ls.x.toFixed(1) : "0.0";
            gyroYHtml = ls ? ls.y.toFixed(1) : "0.0";
            gyroZHtml = ls ? ls.z.toFixed(1) : "0.0";
            tempHtml = currentTemperature.toFixed(1);
            srHtml = Samplerate1.toFixed(0);
            gyroSrHtml = (typeof gyroBuffer !== 'undefined' && gyroBuffer && gyroBuffer.length > 0) ? estimateRecentSampleRateHz(gyroBuffer).toFixed(0) : "0";
            timeHtml = lastAccSample ? formatRuntimeMicroseconds(lastAccSample.time, 2) : "0.00";
        }

        document.getElementById("temperature").innerHTML = tempHtml;
        document.getElementById("samplerate").innerHTML = srHtml;
        document.getElementById("gyrosamplerate").innerHTML = gyroSrHtml;
        document.getElementById("timestamp").innerHTML = timeHtml;

        document.getElementById("accX").innerHTML = accXHtml;
        document.getElementById("accY").innerHTML = accYHtml;
        document.getElementById("accZ").innerHTML = accZHtml;
        let gxEl = document.getElementById("gyroX"); if(gxEl) gxEl.innerHTML = gyroXHtml;
        let gyEl = document.getElementById("gyroY"); if(gyEl) gyEl.innerHTML = gyroYHtml;
        let gzEl = document.getElementById("gyroZ"); if(gzEl) gzEl.innerHTML = gyroZHtml;
        const targetIp = document.getElementById("settingsSensorTarget")?.value || "192.168.4.1";
        const multiNodesData = [];
        if (window.activeSensors) {
            window.activeSensors.forEach((node, idx) => {
                const now = performance.now();
                const isDisconnected = !window.isOfflineReplayMode && (now - node.lastDataMs > 5000);
                if (isDisconnected || node.isHiddenFromUI) return; // Hide disconnected sensors from 3D Shared World
                
                const accBuf = node.accBuffer;
                const accRawBuf = node.accRawBuffer;
                if (!accBuf || accBuf.length === 0) return;
                
                const aSmp = accBuf.getLast() || { time: 0, x: 0, y: 0, z: -1000 };
                const aRawSmp = accRawBuf?.getLast() || { time: 0, x: 0, y: 0, z: -1000 };
                const gSmp = node.gyroBuffer?.getLast() || { time: 0, x: 0, y: 0, z: 0 };
                const gRawSmp = node.gyroRawBuffer?.getLast() || { time: 0, x: 0, y: 0, z: 0 };
                
                const colorHex = window.SENSOR_COLORS?.[idx % window.SENSOR_COLORS.length] || "#FFFFFF";
                const colorNum = parseInt(colorHex.replace('#', '0x'), 16);
                
                multiNodesData.push({
                    ip: node.ip,
                    isTarget: (node.ip === targetIp),
                    color: colorNum,
                    raw: aRawSmp,
                    calibrated: aSmp,
                    calibratedCut: aSmp,
                    gyroRaw: gRawSmp,
                    gyroCalibrated: gSmp,
                    gyroCalibratedCut: gSmp,
                    trail: (node.ip === targetIp && window.globalMotionState) ? window.globalMotionState.trail : [],
                    velocity: (node.ip === targetIp && window.globalMotionState) ? window.globalMotionState.velocity : {x:0, y:0, z:0},
                    linearAcc: (node.ip === targetIp && window.globalMotionState) ? window.globalMotionState.acceleration : {x:0, y:0, z:0}
                });
            });
        }
        
        if (typeof accVectorViewport.setMultiNodeSamples === 'function') {
            accVectorViewport.setMultiNodeSamples(multiNodesData);
        } else {
            accVectorViewport.setAccelerationSamples(buildViewportAccelerationSamples(lastAccRawSample, lastAccSample));
            accVectorViewport.setGyroSamples(buildViewportGyroSamples(gyroRawBuffer.getLast(), lastGyroSample));
        }

        if (typeof motionViewport.setMultiNodeSamples === 'function') {
            motionViewport.setMultiNodeSamples(multiNodesData);
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
                if (filteredWindow.times.length > 0) {
                    preserveAllYScales(chart, () => {
                        chart.setData(alignPlotDataToSeriesCount(chart, [filteredWindow.times, filteredWindow.xs, filteredWindow.ys, filteredWindow.zs, filteredWindow.totals]));
                        window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: accLatestTimestamp } }));
                    });
                }
            } else {
                let chartUpdateData;
                if (window.activeSensors && window.activeSensors.length > 0) {
                    chartUpdateData = normalizeMultiChartDataForPlot(window.getMultiChartDataWindow(accMinTime));
                } else {
                    const { times, xs, ys, zs, totals } = getAccWindowData(displayDurationSeconds, accMinTime);
                    chartUpdateData = [times, xs, ys, zs, totals];
                }
                
                if (chartUpdateData && chartUpdateData.length > 0) {
                    preserveAllYScales(chart, () => {
                        chart.setData(alignPlotDataToSeriesCount(chart, chartUpdateData));
                        window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: accLatestTimestamp } }));
                    });
                }
            }

        }

        if (gyroChart && gyroChartVisible && !gyroChartPaused && (gyroBuffer.length > 0 || (window.activeSensors && window.activeSensors.length > 0))) {
            if (gyroFilterEnabled) {
                let chartUpdateData;
                if (window.activeSensors && window.activeSensors.length > 0) {
                    chartUpdateData = normalizeMultiChartDataForPlot(window.getMultiGyroChartDataWindow(gyroMinTime));
                } else {
                    const gyroWindow = computeFilteredWindowForDisplay('gyro', gyroMinTime, gyroMaxTime);
                    chartUpdateData = [gyroWindow.times, gyroWindow.xs, gyroWindow.ys, gyroWindow.zs];
                }
                
                if (chartUpdateData && chartUpdateData.length > 0) {
                    preserveAllYScales(gyroChart, () => {
                        gyroChart.setData(alignPlotDataToSeriesCount(gyroChart, chartUpdateData));
                        if (!accChartVisible && chartUpdateData[0] && chartUpdateData[0].length > 0) {
                            window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: gyroLatestTimestamp } }));
                        }
                    });
                }
            } else {
                let chartUpdateData;
                if (window.activeSensors && window.activeSensors.length > 0) {
                    chartUpdateData = normalizeMultiChartDataForPlot(window.getMultiGyroChartDataWindow(gyroMinTime));
                } else {
                    const gyroWindow = getGyroWindowData(displayDurationSeconds, gyroMinTime);
                    chartUpdateData = [gyroWindow.times, gyroWindow.xs, gyroWindow.ys, gyroWindow.zs];
                }
                
                if (chartUpdateData && chartUpdateData.length > 0) {
                    preserveAllYScales(gyroChart, () => {
                        gyroChart.setData(alignPlotDataToSeriesCount(gyroChart, chartUpdateData));
                        if (!accChartVisible && chartUpdateData[0] && chartUpdateData[0].length > 0) {
                            window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: gyroLatestTimestamp } }));
                        }
                    });
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

function resizeLiveCharts() {
    chart?.setSize(getSize());
    gyroChart?.setSize(getGyroChartSize());
}

function resizeFftRmsCharts() {
    fftPlot?.setSize(getFftChartSize());
    rmsPlot?.setSize(getRmsChartSize());
}

function resizeGyroFftRmsCharts() {
    gyroFftPlot?.setSize(getGyroFftChartSize());
    gyroRmsPlot?.setSize(getGyroRmsChartSize());
}

function updateAllChartPanelHeights() {
    updateLiveChartPanelHeights();
    updateFftRmsPanelHeights();
    updateGyroFftRmsPanelHeights();
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

        const setRecordingButtonState = (button, activeContent, idleContent) => {
            if (!button) {
                return;
            }

            button.innerHTML = isRecording ? activeContent : idleContent;
            button.classList.toggle('active', isRecording);
        };

        setRecordingButtonState(recordBtn, '<i class="fas fa-stop"></i> Stop', '<i class="fas fa-circle"></i> Record');

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

        setRecordingButtonState(recBtn2, '⏹', '🔴');
        setRecordingButtonState(rmsRecordBtn, '⏹', '🔴');
        setRecordingButtonState(gyroRmsRecordBtn, '⏹', '🔴');
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

    [recordBtn, recBtn2].forEach(button => {
        button?.addEventListener("click", window.toggleRecording);
    });

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

    const syncYAxesBtn = document.getElementById("syncYAxesBtn");
    const syncGyroYAxesBtn = document.getElementById("syncGyroYAxesBtn");

    if (syncYAxesBtn) {
        syncYAxesBtn.addEventListener("click", () => {
            window.isAccYAxisSynced = !window.isAccYAxisSynced;
            syncYAxesBtn.classList.toggle("active", window.isAccYAxisSynced);
            syncYAxesBtn.textContent = window.isAccYAxisSynced ? "🔗 Sync: ON" : "🔗 Sync: OFF";
            
            if (window.isAccYAxisSynced && chart && chart.scales && chart.scales.y) {
                const yMin = chart.scales.y.min;
                const yMax = chart.scales.y.max;
                if (Number.isFinite(yMin) && Number.isFinite(yMax)) {
                    for (let key in chart.scales) {
                        if (key.startsWith("y") && key !== "y") {
                            chart.setScale(key, { min: yMin, max: yMax });
                        }
                    }
                }
            }
        });
    }

    if (syncGyroYAxesBtn) {
        syncGyroYAxesBtn.addEventListener("click", () => {
            window.isGyroYAxisSynced = !window.isGyroYAxisSynced;
            syncGyroYAxesBtn.classList.toggle("active", window.isGyroYAxisSynced);
            syncGyroYAxesBtn.textContent = window.isGyroYAxisSynced ? "🔗 Sync: ON" : "🔗 Sync: OFF";
            
            if (window.isGyroYAxisSynced && gyroChart && gyroChart.scales && gyroChart.scales.y) {
                const yMin = gyroChart.scales.y.min;
                const yMax = gyroChart.scales.y.max;
                if (Number.isFinite(yMin) && Number.isFinite(yMax)) {
                    for (let key in gyroChart.scales) {
                        if (key.startsWith("y") && key !== "y") {
                            gyroChart.setScale(key, { min: yMin, max: yMax });
                        }
                    }
                }
            }
        });
    }

    syncRecordingButtons();
}

function initFFTChart() {
    fftPlot = initFftLikeChart({
        hostId: "fftChart",
        legendHostId: "fftChartLegendHost",
        title: 'ACC FFT',
        getChartSize: getFftChartSize,
        averageStroke: "#FFD600",
        averageFill: "rgba(255, 213, 0, 0.5)",
        currentStroke: "rgba(110,190,255,0.45)",
        peakBadgeId: 'fftPeakBadge'
    });

    bindFftTooltip(fftPlot, document.getElementById("fftChart"), "Hz");
}

function bindFftTooltip(plot, hostEl, unit) {
    if (!plot || !hostEl) return;

    let tooltip = document.getElementById("fft-custom-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "fft-custom-tooltip";
        tooltip.style.position = "absolute";
        tooltip.style.background = "rgba(24, 28, 36, 0.95)";
        tooltip.style.color = "#FFD600";
        tooltip.style.padding = "4px 8px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "13px";
        tooltip.style.fontFamily = "monospace";
        tooltip.style.border = "1px solid rgba(255, 214, 0, 0.5)";
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.zIndex = "999999";
        tooltip.style.whiteSpace = "nowrap";
        tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
        document.body.appendChild(tooltip);
    }

    hostEl.addEventListener("mousemove", (e) => {
        // Fix for orphaned plot instances: always use the latest module-scoped reference
        const activePlot = hostEl.id === "gyroFftChart" ? gyroFftPlot : fftPlot;
        if (!activePlot) return;

        const over = hostEl.querySelector(".u-over");
        if (!over) {
            tooltip.style.display = "none";
            return;
        }

        const rect = over.getBoundingClientRect();
        
        // Check if mouse is strictly inside the chart area
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            tooltip.style.display = "none";
            return;
        }

        const left = e.clientX - rect.left;
        const top = e.clientY - rect.top;

        // Force uPlot to update its internal cursor state (this calculates the closest data index)
        activePlot.setCursor({ left, top });

        const idx = activePlot.cursor.idx;
        if (idx == null || idx < 0 || !activePlot.data[0] || idx >= activePlot.data[0].length) {
            tooltip.style.display = "none";
            return;
        }

        const valX = activePlot.data[0][idx];

        if (valX == null || !Number.isFinite(valX)) {
            tooltip.style.display = "none";
            return;
        }

        tooltip.textContent = valX.toFixed(2) + " " + unit;
        tooltip.style.display = "block";

        const tooltipWidth = tooltip.offsetWidth || 100;
        const tooltipHeight = tooltip.offsetHeight || 30;
        let posX = e.clientX + 15;
        let posY = e.clientY - tooltipHeight / 2;

        if (posX + tooltipWidth > window.innerWidth) posX = e.clientX - tooltipWidth - 15;
        if (posY < 0) posY = 10;
        if (posY + tooltipHeight > window.innerHeight) posY = window.innerHeight - tooltipHeight - 10;

        tooltip.style.left = Math.round(posX) + "px";
        tooltip.style.top = Math.round(posY) + "px";
    });

    hostEl.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
    });
}

function initRMSChart() {
    const rmsSize = getRmsChartSize();

    const rmsopts = createRmsChartOptions({
        size: rmsSize,
        title: 'ACC RMS',
        yRange: (s, min, max) => {
            // Symmetrisch: CH2 ist gespiegelt (negativ), daher beide Seiten gleich groß
            const absMax = Math.max(250, Math.abs(min ?? 0) * 1.1, Math.abs(max ?? 0) * 1.1);
            return [-absMax, absMax];
        },
        series: [
            {label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 2) },
            { label: "Acc X (mg)", stroke: "#FFD600" },
            { label: "Acc Y (mg)", stroke: "#ec3030ff" },
            { label: "Acc Z (mg)", stroke: "#7a96e2ff" },
            { label: "Acc Total (mg)", stroke: "#14c53bff", fill: "rgba(20,197,59,0.2)" },
        ],
        legendHostId: "rmsChartLegendHost",
        formatMicrosecondsToHMS,
    });

    rmsPlot = new uPlot(rmsopts, [[], [], [], [], []], document.getElementById("rmsChart"));
    installManualLegendToggle(rmsPlot, "rmsChartLegendHost");
    
    // Bind overlays immediately after chart is defined
    bindYAxisOverlay("rms-y-axis-overlay", rmsPlot, true);
    bindRmsXAxisOverlay("rms-x-axis-overlay", rmsPlot, false);
    syncAxisOverlayPositions(rmsPlot, "rmsPanel", "rms-y-axis-overlay", "rms-x-axis-overlay");

    bindRmsTooltip("rmsChart", "mg");
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
    gyroFftPlot = initFftLikeChart({
        hostId: 'gyroFftChart',
        legendHostId: 'gyroFftChartLegendHost',
        title: 'Gyro FFT',
        getChartSize: getGyroFftChartSize,
        averageStroke: '#4dd0e1',
        averageFill: 'rgba(77,208,225,0.22)',
        currentStroke: 'rgba(255,183,77,0.5)',
        peakBadgeId: 'gyroFftPeakBadge'
    });
    bindFftTooltip(gyroFftPlot, document.getElementById("gyroFftChart"), "Hz");
}

function initFftLikeChart({ hostId, legendHostId, title, getChartSize, averageStroke, averageFill, currentStroke, peakBadgeId }) {
    const fftHost = document.getElementById(hostId);
    const fftSize = getChartSize();
    const fftWidth = Math.max(320, fftSize.width || Math.round(fftHost?.clientWidth || 800));
    const fftHeight = Math.max(250, fftSize.height || 500);
    const fftOptions = createFftChartOptions({
        width: fftWidth,
        height: fftHeight,
        title,
        averageStroke,
        averageFill,
        currentStroke,
        legendHostId,
        axisStrokeFactory: "white",
        cursorUnit: "Hz",
        createCursorPlugin: createCursorXPlugin,
    });

    const plot = new uPlot(fftOptions, [[0, 1], [0, 0], [0, 0], [0, 0]], fftHost);
    installManualLegendToggle(plot, legendHostId);
    updatePeakFrequencyBadge(peakBadgeId, null, null);
    return plot;
}

function updatePeakFrequencyBadge(elementId, freqs, data) {
    const badge = document.getElementById(elementId);
    if (!badge) {
        return;
    }

    if (!freqs || !data || freqs.length === 0 || data.length === 0) {
        badge.textContent = 'Peak -- Hz | Amp --';
        return;
    }

    // Check if `data` is multiFftData (Array of Arrays)
    const isMulti = Array.isArray(data) && data.length > 1 && Array.isArray(data[1]);
    let textParts = [];

    const numChannels = isMulti ? Math.floor((data.length - 1) / 3) : 1;
    const startIndex = freqs.length > 1 ? 1 : 0;

    for (let ch = 0; ch < numChannels; ch++) {
        const mags = isMulti ? data[1 + ch * 3] : data; // Use "Current" series
        if (!mags || !mags.length) continue;

        let bestIndex = -1;
        let bestMagnitude = -Infinity;

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

        if (bestIndex >= 0) {
            const peakFreq = Number(freqs[bestIndex]);
            const peakMag = Number(mags[bestIndex]);
            const formattedFreq = peakFreq >= 100 ? peakFreq.toFixed(0) : peakFreq.toFixed(1);
            if (numChannels > 1) {
                textParts.push(`CH${ch+1} ${formattedFreq}Hz`);
            } else {
                const formattedMag = peakMag >= 1000 ? peakMag.toFixed(0) : peakMag.toFixed(1);
                textParts.push(`Peak ${formattedFreq} Hz | Amp ${formattedMag}`);
            }
        }
    }

    if (textParts.length === 0) {
        badge.textContent = 'Peak -- Hz | Amp --';
    } else {
        badge.textContent = textParts.join('  |  ');
    }
}

function initGyroRMSChart() {
    const rmsSize = getGyroRmsChartSize();

    const rmsopts = createRmsChartOptions({
        size: rmsSize,
        title: 'Gyro RMS',
        yRange: (s, min, max) => [0, Math.max(1.0, (max == null ? 1 : max * 1.1))],
        series: [
            { label: 'Zeit', value: (u, v) => formatMicrosecondsToHMS(v, 2) },
            { label: 'Gyro X (m°/s)', stroke: '#4dd0e1' },
            { label: 'Gyro Y (m°/s)', stroke: '#ffb74d' },
            { label: 'Gyro Z (m°/s)', stroke: '#81c784' },
            { label: 'Gyro Total (m°/s)', stroke: '#ce93d8', fill: 'rgba(206,147,216,0.18)' },
        ],
        legendHostId: 'gyroRmsChartLegendHost',
        formatMicrosecondsToHMS,
    });

    gyroRmsPlot = new uPlot(rmsopts, [[], [], [], [], []], document.getElementById('gyroRmsChart'));
    installManualLegendToggle(gyroRmsPlot, 'gyroRmsChartLegendHost');

    // Bind overlays immediately after chart is defined
    bindYAxisOverlay("gyro-rms-y-axis-overlay", gyroRmsPlot, true);
    bindRmsXAxisOverlay("gyro-rms-x-axis-overlay", gyroRmsPlot, true);
    syncAxisOverlayPositions(gyroRmsPlot, "gyroRmsPanel", "gyro-rms-y-axis-overlay", "gyro-rms-x-axis-overlay");

    bindRmsTooltip("gyroRmsChart", "m°/s");
}

function bindRmsTooltip(hostId, unit) {
    const hostEl = document.getElementById(hostId);
    if (!hostEl) return;

    let tooltip = document.getElementById("rms-custom-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "rms-custom-tooltip";
        tooltip.style.position = "absolute";
        tooltip.style.background = "rgba(24, 28, 36, 0.95)";
        tooltip.style.color = "#FFD600";
        tooltip.style.padding = "4px 8px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "13px";
        tooltip.style.fontFamily = "monospace";
        tooltip.style.border = "1px solid rgba(255, 214, 0, 0.5)";
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.zIndex = "999999";
        tooltip.style.whiteSpace = "nowrap";
        tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
        document.body.appendChild(tooltip);
    }

    hostEl.addEventListener("mousemove", (e) => {
        // Module-scoped robust reference
        const activePlot = hostEl.id === "gyroRmsChart" ? gyroRmsPlot : rmsPlot;
        if (!activePlot) return;

        const over = hostEl.querySelector(".u-over");
        if (!over) {
            tooltip.style.display = "none";
            return;
        }

        const rect = over.getBoundingClientRect();
        
        // Check if mouse is strictly inside the chart area
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            tooltip.style.display = "none";
            return;
        }

        const top = e.clientY - rect.top;
        const left = e.clientX - rect.left;

        activePlot.setCursor({ left, top });

        const valY = activePlot.posToVal(top, "y");

        if (valY == null || !Number.isFinite(valY)) {
            tooltip.style.display = "none";
            return;
        }

        tooltip.textContent = valY.toFixed(2) + " " + unit;
        tooltip.style.display = "block";

        const tooltipWidth = tooltip.offsetWidth || 100;
        const tooltipHeight = tooltip.offsetHeight || 30;
        let posX = e.clientX + 15;
        let posY = e.clientY - tooltipHeight / 2;

        if (posX + tooltipWidth > window.innerWidth) posX = e.clientX - tooltipWidth - 15;
        if (posY < 0) posY = 10;
        if (posY + tooltipHeight > window.innerHeight) posY = window.innerHeight - tooltipHeight - 10;

        tooltip.style.left = Math.round(posX) + "px";
        tooltip.style.top = Math.round(posY) + "px";
    });

    hostEl.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
    });
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
        fftWorkerBusy = false;
        const { freqs, mags, timestamp, timeString } = e.data;

        if (!freqs || !mags) {
            console.warn("[Worker] Ungültige Daten empfangen:", e.data);
            return;
        }

        const maxFreq = Math.max(...freqs);

        window.latestWaterfallMags = window.latestWaterfallMags || [];
        window.latestWaterfallMags[0] = mags;

        let combinedMags = [mags];
        if (window.activeSensors && window.activeSensors.length > 0) {
            combinedMags = window.activeSensors
                .map((node, i) => (!node.isHiddenFromUI && !node.wasDisconnected) ? (window.latestWaterfallMags[i] || new Float32Array(mags.length)) : null)
                .filter(mag => mag !== null);
            if (combinedMags.length === 0) combinedMags = [new Float32Array(mags.length)];
        }

        if (window.waterfallRenderer && window.waterfallRenderer._lastChannelCount !== undefined && window.waterfallRenderer._lastChannelCount !== combinedMags.length) {
            window.waterfallRenderer.clear();
        }
        if (window.waterfallRenderer) window.waterfallRenderer._lastChannelCount = combinedMags.length;

        syncWaterfallRenderer({
            renderer: window.waterfallRenderer,
            maxHzInputId: 'waterfallMaxHz',
            maxFreq,
            magnitudes: combinedMags,
            timestamp,
            timeString,
            clockTimeStr: e.data.clockTimeStr,
            lastMaxWindowKey: 'waterfallLastMax',
            labelMaxId: 'wfLblMax',
            labelMidId: 'wfLblMid',
        });

        // MAX PUFFER
        bufferFFTResult(mags); // Magnitudenpuffer für die letzten 5 Sekunden
        const maxValues = computeMaxFFTValues();
        // MITTELWERT PUFFER
        bufferAverageFFT(mags); // In Mittelungspuffer stecken
        const meanValues = computeAverageFFT();

        // setData erwartet ein Array: [x, serie1, serie2]
        updateSharedMultiFftData({
            multiFftData: window.multiFftData,
            freqs,
            maxValues,
            meanValues,
            magnitudes: mags,
            channelIndex: 0,
        });

        updateSharedFftPlot({
            plot: fftPlot,
            multiFftData: window.multiFftData,
            isScrubbing: window.isFftHistoryScrubbing,
            fftDbOutput: fftDBoutput,
            peakBadgeId: 'fftPeakBadge',
            freqs,
            magnitudes: mags,
            updatePeakFrequencyBadge,
        });

    };
}

function setupGyroFFTWorker() {
    if (gyroFftWorker) {
        gyroFftWorker.terminate();
    }

    gyroFftWorker = new Worker('fft-worker.js');
    console.log('[Main] Gyro FFT Worker:', gyroFftWorker);

    gyroFftWorker.onmessage = (e) => {
        gyroFftWorkerBusy = false;
        const { freqs, mags, timestamp, timeString } = e.data;

        if (!freqs || !mags) {
            console.warn('[Gyro FFT Worker] Ungültige Daten empfangen:', e.data);
            return;
        }

        const maxFreq = Math.max(...freqs);

        window.latestGyroWaterfallMags = window.latestGyroWaterfallMags || [];
        window.latestGyroWaterfallMags[0] = mags;

        let combinedGyroMags = [mags];
        if (window.activeSensors && window.activeSensors.length > 0) {
            combinedGyroMags = window.activeSensors
                .map((node, i) => (!node.isHiddenFromUI && !node.wasDisconnected) ? (window.latestGyroWaterfallMags[i] || new Float32Array(mags.length)) : null)
                .filter(mag => mag !== null);
            if (combinedGyroMags.length === 0) combinedGyroMags = [new Float32Array(mags.length)];
        }

        if (window.gyroWaterfallRenderer && window.gyroWaterfallRenderer._lastChannelCount !== undefined && window.gyroWaterfallRenderer._lastChannelCount !== combinedGyroMags.length) {
            window.gyroWaterfallRenderer.clear();
        }
        if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer._lastChannelCount = combinedGyroMags.length;

        syncWaterfallRenderer({
            renderer: window.gyroWaterfallRenderer,
            maxHzInputId: 'gyroWaterfallMaxHz',
            maxFreq,
            magnitudes: combinedGyroMags,
            timestamp,
            timeString,
            clockTimeStr: e.data.clockTimeStr,
            lastMaxWindowKey: 'gyroWaterfallLastMax',
            labelMaxId: 'gwfLblMax',
            labelMidId: 'gwfLblMid',
        });

        bufferFFTResult(mags, gyroFftMaxBuffer, GYRO_FFT_RING_SIZE);
        const maxValues = computeMaxFFTValues(gyroFftMaxBuffer);
        bufferAverageFFT(mags, gyroAvgFFTBuffer, gyroN_AVG);
        const meanValues = computeAverageFFT(gyroAvgFFTBuffer);

        updateSharedMultiFftData({
            multiFftData: window.multiGyroFftData,
            freqs,
            maxValues,
            meanValues,
            magnitudes: mags,
            channelIndex: 0,
        });

        updateSharedFftPlot({
            plot: gyroFftPlot,
            multiFftData: window.multiGyroFftData,
            isScrubbing: window.isGyroFftHistoryScrubbing,
            fftDbOutput: fftDBoutput,
            peakBadgeId: 'gyroFftPeakBadge',
            freqs,
            magnitudes: mags,
            updatePeakFrequencyBadge,
        });
    };
}

function setupRMSWorker() {
    rmsWorker = createRmsWorkerRuntime({
        workerScript: 'rms-worker.js?v=27',
        existingWorker: rmsWorker,
        logLabel: '[Main] RMS Worker:',
        isPaused: () => rmsPaused,
        targetBuffer: rmsBuffer,
        getPlot: () => rmsPlot,
        getDurationSeconds: () => displayDurationSecondsRMS,
        getPanOffsetUs: () => rmsPanOffset,
        updateIntervalMs: RMS_UPDATE_INTERVAL,
        eventName: 'rmsDataUpdate',
    });
}

function setupGyroRMSWorker() {
    gyroRmsWorker = createRmsWorkerRuntime({
        workerScript: 'rms-worker.js',
        existingWorker: gyroRmsWorker,
        logLabel: '[Main] Gyro RMS Worker:',
        isPaused: () => gyroRmsPaused,
        targetBuffer: gyroRmsBuffer,
        getPlot: () => gyroRmsPlot,
        getDurationSeconds: () => gyroDisplayDurationSecondsRMS,
        getPanOffsetUs: () => gyroRmsPanOffset,
        updateIntervalMs: RMS_UPDATE_INTERVAL,
        eventName: 'gyroRmsDataUpdate',
    });
}


let displayDurationSecondsRMS = 20;
let gyroDisplayDurationSecondsRMS = 20;
let rmsPaused = false;
let gyroRmsPaused = false;

function bindRMSControls({ sliderId, valueId, pauseButtonId, recordButtonId, screenshotButtonId, chartId, getDuration, setDuration, getPaused, setPaused }) {
    bindRmsControlsRuntime({
        sliderId,
        valueId,
        pauseButtonId,
        recordButtonId,
        screenshotButtonId,
        chartId,
        getDuration,
        setDuration,
        getPaused,
        setPaused,
        isRecording: () => isRecording,
        toggleRecording: window.toggleRecording,
        html2canvasRef: globalThis.html2canvas,
    });
}

function setupRMSControls() {
    bindRMSControls({
        sliderId: 'rmsTimeSlider',
        valueId: 'rmsTimeValue',
        pauseButtonId: 'rmsPauseBtn',
        recordButtonId: 'rmsRecordBtn',
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
    rmsUpdateTimerId = startMultiSensorRmsUpdatesRuntime({
        existingTimerId: rmsUpdateTimerId,
        getPlot: () => rmsPlot,
        getNodesToProcess: () => (window.activeSensors && window.activeSensors.length > 0)
            ? window.activeSensors
            : [{ channelIndex: 0, _isFallback: true }],
        updateIntervalMs: RMS_UPDATE_INTERVAL,
        windowSize: RMS_WINDOW_SIZE,
        getDurationSeconds: () => displayDurationSecondsRMS,
        getPanOffsetUs: () => rmsPanOffset,
        eventName: 'rmsDataUpdate',
    });
}

function startGyroRMSUpdates() {
    gyroRmsUpdateTimerId = startGyroRmsUpdatesRuntime({
        existingTimerId: gyroRmsUpdateTimerId,
        getPlot: () => gyroRmsPlot,
        getNodesToProcess: () => (window.activeSensors && window.activeSensors.length > 0)
            ? window.activeSensors
            : [{ channelIndex: 0, _isFallback: true }],
        updateIntervalMs: RMS_UPDATE_INTERVAL,
        windowSize: RMS_WINDOW_SIZE,
        getDurationSeconds: () => displayDurationSecondsRMS,
        getPanOffsetUs: () => rmsPanOffset,
        eventName: 'gyroRmsDataUpdate',
    });
}

function bufferFFTResult(magArray, targetBuffer = fftMaxBuffer, ringSize = FFT_RING_SIZE) {
    if (targetBuffer.length > 0 && targetBuffer[0].length !== magArray.length) {
        targetBuffer.length = 0; // Clear the buffer due to size change
    }
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

window.generateStaticWaterfalls = async function(accData, gyroData, sampleRate, accTimes, gyroTimes) {
    console.log(`[Offline FFT] Generiere statischen Waterfall mit ${sampleRate}Hz (Async Multi-Channel Batch)...`);
    
    if (sampleRate > 0 && typeof currentSampleRate !== "undefined") {
        currentSampleRate = sampleRate;
        window.currentSampleRate = sampleRate;
    }
    
    const hasAcc = accData && accData.some(ch => ch && ch.length > 0);
    const hasGyro = gyroData && gyroData.some(ch => ch && ch.length > 0);
    
    if (hasAcc && window.waterfallRenderer) window.waterfallRenderer.clear();
    if (hasGyro && window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.clear();
    
    const frq = sampleRate > 0 ? sampleRate : (typeof currentSampleRate !== 'undefined' ? currentSampleRate : 1000);
    let step = Math.floor(frq * (FFT_UPDATE_INTERVAL / 1000));
    if (step < 10) step = 10;
    
    // Create temporary workers
    const accWorkers = [];
    const gyroWorkers = [];
    for(let ch=0; ch<4; ch++) {
        if (hasAcc && accData[ch] && accData[ch].length > 0) accWorkers[ch] = new Worker("fft-worker.js");
        if (hasGyro && gyroData[ch] && gyroData[ch].length > 0) gyroWorkers[ch] = new Worker("fft-worker.js");
    }

    function computeFftAsync(worker, windowArr) {
        return new Promise(resolve => {
            worker.onmessage = (e) => resolve(e.data.mags);
            const buf = Float32Array.from(windowArr);
            worker.postMessage({
                buffer: buf.buffer,
                sampleRate: frq,
                windowType: typeof FFT_WINDOW_TYPE !== 'undefined' ? FFT_WINDOW_TYPE : 'BLACKMAN',
                highpassCutoff: typeof fftHighPass !== 'undefined' ? fftHighPass : 0,
                dcCutoff: typeof DC_CUTOFF !== 'undefined' ? DC_CUTOFF : true,
                fftDBoutput: typeof fftDBoutput !== 'undefined' ? fftDBoutput : false
            }, [buf.buffer]);
        });
    }

    let accI = 0;
    let gyroI = 0;
    const masterAccData = hasAcc ? accData.find(ch => ch && ch.length > 0) : null;
    const masterGyroData = hasGyro ? gyroData.find(ch => ch && ch.length > 0) : null;
    
    while (hasAcc && masterAccData && accI <= masterAccData.length - FFT_WINDOW_SIZE) {
        const promises = [];
        const activeChannels = [];
        for(let ch=0; ch<4; ch++) {
            if (accWorkers[ch] && accData[ch] && accI <= accData[ch].length - FFT_WINDOW_SIZE) {
                const arr = accData[ch].slice(accI, accI + FFT_WINDOW_SIZE);
                promises.push(computeFftAsync(accWorkers[ch], arr));
                activeChannels.push(ch);
            }
        }
        
        if (promises.length > 0) {
            const results = await Promise.all(promises);
            let combinedMags = [];
            // Map results back to channels, inserting empty arrays for missing channels if necessary 
            // to ensure colors align with the correct strips
            let resIdx = 0;
            for(let ch=0; ch<4; ch++) {
                if (accWorkers[ch]) {
                    if (activeChannels.includes(ch)) {
                        let mags = results[resIdx++];
                        if (typeof getSharedFftCeiling !== 'undefined') {
                            const arr = new Float32Array(mags);
                            mags = Array.from(arr).map(v => getSharedFftCeiling(v, 'acc'));
                        }
                        combinedMags.push(new Float32Array(mags));
                    } else {
                        combinedMags.push(new Float32Array(1)); // dummy empty strip
                    }
                }
            }
            
            const timestampUs = accTimes ? accTimes[accI + FFT_WINDOW_SIZE - 1] : 0;
            const tString = typeof formatUsToTime === 'function' ? formatUsToTime(timestampUs) : (timestampUs/1000000).toFixed(2);
            let clockTimeStr = undefined;
            if (window.replayData && window.replayData.acc && window.replayData.acc[activeChannels[0]] && window.replayData.acc[activeChannels[0]][accI + FFT_WINDOW_SIZE - 1]) {
                clockTimeStr = window.replayData.acc[activeChannels[0]][accI + FFT_WINDOW_SIZE - 1].hms;
            }
            
            if (window.waterfallRenderer) window.waterfallRenderer.pushData(combinedMags, timestampUs/1000000, tString, clockTimeStr);
        }
        
        accI += step;
        // Yield to UI to prevent visible freezes
        await new Promise(r => setTimeout(r, 0));
    }
    
    while (hasGyro && masterGyroData && gyroI <= masterGyroData.length - FFT_WINDOW_SIZE) {
        const promises = [];
        const activeChannels = [];
        for(let ch=0; ch<4; ch++) {
            if (gyroWorkers[ch] && gyroData[ch] && gyroI <= gyroData[ch].length - FFT_WINDOW_SIZE) {
                const arr = gyroData[ch].slice(gyroI, gyroI + FFT_WINDOW_SIZE);
                promises.push(computeFftAsync(gyroWorkers[ch], arr));
                activeChannels.push(ch);
            }
        }
        
        if (promises.length > 0) {
            const results = await Promise.all(promises);
            let combinedMags = [];
            let resIdx = 0;
            for(let ch=0; ch<4; ch++) {
                if (gyroWorkers[ch]) {
                    if (activeChannels.includes(ch)) {
                        let mags = results[resIdx++];
                        if (typeof getSharedFftCeiling !== 'undefined') {
                            const arr = new Float32Array(mags);
                            mags = Array.from(arr).map(v => getSharedFftCeiling(v, 'gyro'));
                        }
                        combinedMags.push(new Float32Array(mags));
                    } else {
                        combinedMags.push(new Float32Array(1));
                    }
                }
            }
            
            const timestampUs = gyroTimes ? gyroTimes[gyroI + FFT_WINDOW_SIZE - 1] : 0;
            const tString = typeof formatUsToTime === 'function' ? formatUsToTime(timestampUs) : (timestampUs/1000000).toFixed(2);
            let clockTimeStr = undefined;
            if (window.replayData && window.replayData.gyro && window.replayData.gyro[activeChannels[0]] && window.replayData.gyro[activeChannels[0]][gyroI + FFT_WINDOW_SIZE - 1]) {
                clockTimeStr = window.replayData.gyro[activeChannels[0]][gyroI + FFT_WINDOW_SIZE - 1].hms;
            }
            
            if (window.gyroWaterfallRenderer) window.gyroWaterfallRenderer.pushData(combinedMags, timestampUs/1000000, tString, clockTimeStr);
        }
        
        gyroI += step;
        await new Promise(r => setTimeout(r, 0));
    }
    
    // Cleanup temporary workers
    for(let ch=0; ch<4; ch++) {
        if (accWorkers[ch]) accWorkers[ch].terminate();
        if (gyroWorkers[ch]) gyroWorkers[ch].terminate();
    }
    console.log("[Offline FFT] Multi-Channel Waterfall generation complete.");

};



function startFFTUpdates() {
    if (fftUpdateTimerId !== null) {
        clearInterval(fftUpdateTimerId);
    }

    fftUpdateTimerId = setInterval(() => {
        if (!fftPlot) return;
        
        let targetSize = currentSampleRate * FFT_WINDOW_TIME_S;
        let newPow = Math.round(Math.log2(targetSize));
        let oldPow = Math.log2(FFT_WINDOW_SIZE);
        if (Math.abs(newPow - oldPow) > 0.6 || isNaN(oldPow) || !window._lastFftTime || window._lastFftTime !== FFT_WINDOW_TIME_S) {
            FFT_WINDOW_SIZE = Math.pow(2, newPow);
            window._lastFftTime = FFT_WINDOW_TIME_S;
        }

        if (FFT_WINDOW_SIZE < 256) FFT_WINDOW_SIZE = 256;
        if (FFT_WINDOW_SIZE > 8192) FFT_WINDOW_SIZE = 8192; // 12000 Ringsize
        
        const nodesToProcess = (window.activeSensors && window.activeSensors.length > 0) 
            ? window.activeSensors 
            : [{ channelIndex: 0, _isFallback: true }]; // Fallback für Legacy Startup ohne discovery
            
        nodesToProcess.forEach((node) => {
            const bufferRef = node.channelIndex === 0 ? accBuffer : node.accBuffer;
            const workerRef = node.channelIndex === 0 ? fftWorker : node.fftWorker;
            
            if (!bufferRef || !workerRef) return;

            const arr = getSelectedData(FFT_AXIS_MODE, bufferRef, FFT_WINDOW_SIZE);
            const tarr = bufferRef.getFieldTypedArray('time', FFT_WINDOW_SIZE);
            const arrLen = arr.length;

            if (arrLen < FFT_WINDOW_SIZE) return;

            const idx0 = arrLen - 1;
            const idx1 = arrLen - FFT_WINDOW_SIZE;
            const t0 = tarr[idx0];
            const t1 = tarr[idx1];
            const delta = t0 - t1;

            if (delta <= 0) return;

            const exactFrq = Math.round((FFT_WINDOW_SIZE - 1) * (1000000 / delta));
            const frq = (exactFrq > 10) ? exactFrq : currentSampleRate;
            const windowArr = arr.slice(idx1, idx0 + 1);
            const buf = windowArr instanceof Float32Array ? windowArr : Float32Array.from(windowArr);

            workerRef.postMessage({
                buffer: buf.buffer,
                sampleRate: frq,
                windowType: typeof FFT_WINDOW_TYPE !== 'undefined' ? FFT_WINDOW_TYPE : 'BLACKMAN',
                highpassCutoff: typeof fftHighPass !== 'undefined' ? fftHighPass : 0,
                dcCutoff: typeof DC_CUTOFF !== 'undefined' ? DC_CUTOFF : true,
                fftDBoutput: typeof fftDBoutput !== 'undefined' ? fftDBoutput : false,
            }, [buf.buffer]);
        });
    }, FFT_UPDATE_INTERVAL);
}

function startGyroFFTUpdates() {
    if (gyroFftUpdateTimerId !== null) {
        clearInterval(gyroFftUpdateTimerId);
    }

    gyroFftUpdateTimerId = setInterval(() => {
        if (!gyroFftWorker || !gyroFftPlot) return;

        let targetSize = window.currentSampleRate * GYRO_FFT_WINDOW_TIME_S || currentSampleRate * GYRO_FFT_WINDOW_TIME_S;
        let newPow = Math.round(Math.log2(targetSize));
        let oldPow = Math.log2(GYRO_FFT_WINDOW_SIZE);
        if (Math.abs(newPow - oldPow) > 0.6 || isNaN(oldPow) || !window._lastGyroFftTime || window._lastGyroFftTime !== GYRO_FFT_WINDOW_TIME_S) {
            GYRO_FFT_WINDOW_SIZE = Math.pow(2, newPow);
            window._lastGyroFftTime = GYRO_FFT_WINDOW_TIME_S;
        }

        if (GYRO_FFT_WINDOW_SIZE < 256) GYRO_FFT_WINDOW_SIZE = 256;
        if (GYRO_FFT_WINDOW_SIZE > 8192) GYRO_FFT_WINDOW_SIZE = 8192;

        const nodesToProcess = (window.activeSensors && window.activeSensors.length > 0) 
            ? window.activeSensors 
            : [{ channelIndex: 0, _isFallback: true }];
            
        nodesToProcess.forEach((node) => {
            const bufferRef = node.channelIndex === 0 ? gyroBuffer : node.gyroBuffer;
            const workerRef = node.channelIndex === 0 ? gyroFftWorker : node.gyroFftWorker;
            
            if (!bufferRef || !workerRef) return;

            const arr = getSelectedData(GYRO_FFT_AXIS_MODE, bufferRef, GYRO_FFT_WINDOW_SIZE);
            const tarr = bufferRef.getFieldTypedArray('time', GYRO_FFT_WINDOW_SIZE);
            const arrLen = arr.length;

            if (arrLen < GYRO_FFT_WINDOW_SIZE) return;

            const idx0 = arrLen - 1;
            const idx1 = arrLen - GYRO_FFT_WINDOW_SIZE;
            const t0 = tarr[idx0];
            const t1 = tarr[idx1];

            if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
                return;
            }

            const delta = t0 - t1;

            if (delta <= 0) {
                return;
            }

            const estimatedSampleRate = Math.round((GYRO_FFT_WINDOW_SIZE - 1) * (1000000 / delta));
            if (!Number.isFinite(estimatedSampleRate) || estimatedSampleRate <= 0) {
                return;
            }

            const windowArr = arr.slice(idx1, idx0 + 1);
            const buf = windowArr instanceof Float32Array ? windowArr : Float32Array.from(windowArr);

            workerRef.postMessage({
                buffer: buf.buffer,
                sampleRate: estimatedSampleRate,
                windowType: GYRO_FFT_WINDOW_TYPE,
                highpassCutoff: gyroFftHighPass,
                dcCutoff: GYRO_DC_CUTOFF,
                fftDBoutput: fftDBoutput,
            }, [buf.buffer]);
        });
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
    if (targetBuffer.length > 0 && targetBuffer[0].length !== mags.length) {
        targetBuffer.length = 0; // Clear the buffer due to size change
    }
    if (targetBuffer.length >= limit) {
        targetBuffer.shift();
    }
    targetBuffer.push(mags);
}

function computeAverageFFT(targetBuffer = avgFFTBuffer) {
    if (targetBuffer.length === 0) return [];
    const len = targetBuffer[0].length;
    let avg = new Float32Array(len);
    for (let i = 0; i < targetBuffer.length; i++) {
        const buf = targetBuffer[i];
        if (buf.length !== len) continue; // Safety check
        for (let j = 0; j < len; j++) {
            avg[j] += buf[j];
        }
    }
    const count = targetBuffer.length;
    for (let j = 0; j < len; j++) {
        avg[j] /= count;
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







window.addEventListener("resize", e => {
    updateAllChartPanelHeights();
    resizeLiveCharts();
    resizeFftRmsCharts();
    resizeGyroFftRmsCharts();
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

function createCursorXPlugin(unit) {
    let tooltip;

    function init(u) {
        let over = u.root.querySelector(".u-over");
        tooltip = document.createElement("div");
        tooltip.className = "u-tooltip-x";
        tooltip.style.position = "absolute";
        
        // DEBUG ALARM: Wenn der User einen Doppelklick macht, zeigen wir den uPlot Status!
        over.addEventListener("dblclick", () => {
            alert(
                "UPLOT STATUS:\n" +
                "bbox.width: " + u.bbox.width + "\n" +
                "data[0].length: " + (u.data && u.data[0] ? u.data[0].length : 'null') + "\n" +
                "cursor.show: " + u.cursor.show + "\n" +
                "cursor.x: " + u.cursor.x + "\n" +
                "cursor.left: " + u.cursor.left + "\n" +
                "cursor.top: " + u.cursor.top
            );
        });

        tooltip.style.background = "rgba(24, 28, 36, 0.85)";
        tooltip.style.color = "#4dd0e1";
        tooltip.style.padding = "3px 6px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "12px";
        tooltip.style.fontFamily = "monospace";
        tooltip.style.border = "1px solid rgba(77, 208, 225, 0.3)";
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.zIndex = "100";
        tooltip.style.whiteSpace = "nowrap";
        over.appendChild(tooltip);
    }

    function setCursor(u) {
        // ALWAYS SHOW TOOLTIP AT FIXED POS FOR DEBUGGING
        tooltip.style.display = "block";
        tooltip.style.left = "50px";
        tooltip.style.top = "50px";
        tooltip.style.zIndex = "999999";
        
        const { left, top } = u.cursor;
        if (top < 0 || left < 0) {
            tooltip.textContent = `OUT: left=${left}`;
            return;
        }

        const valX = u.posToVal(left, "x");
        if (valX == null || !Number.isFinite(valX)) {
            tooltip.textContent = `NaN X! left=${Math.round(left)}`;
            return;
        }
        tooltip.textContent = `VAL: ${valX.toFixed(2)} ${unit}`;
    }

    return {
        hooks: {
            init: [init],
            setCursor: [setCursor],
        }
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
const options = createLiveChartOptions({
    size: getSize(),
    width: container.clientWidth,
    height: container.clientHeight,
    title: "ACC Live-Daten",
    yRange: [-1100, 1100],
    yTickSuffix: 'mg',
    series: [
        {label: "Zeit",value: (u, v) => formatMicrosecondsToHMS(v, 5) },
        { label: "Acc X (mg)", stroke: "#FFD600" },
        { label: "Acc Y (mg)", stroke: "#ec3030ff" },
        { label: "Acc Z (mg)", stroke: "#7a96e2ff" },
        { label: "Acc Total (mg)", stroke: "#14c53bff" },
    ],
    legendHostId: "accChartLegendHost",
    cursorUnit: 'mg',
    formatMicrosecondsToHMS,
    createCursorPlugin: createCursorYPlugin,
});

chart = new uPlot(options, [timestamps.slice(), values1.slice(), values2.slice(), values3.slice(), values4.slice()], document.getElementById("accChartHost"));

const gyroContainer = document.getElementById("gyrochart");
const gyroOptions = createLiveChartOptions({
    size: getGyroChartSize(),
    width: gyroContainer.clientWidth,
    height: gyroContainer.clientHeight,
    title: "Gyro Live-Daten",
    yRange: [-25000, 25000],
    yTickSuffix: 'm°/s',
    series: [
        { label: "Zeit", value: (u, v) => formatMicrosecondsToHMS(v, 5) },
        { label: "Gyro X (m°/s)", stroke: "#4dd0e1" },
        { label: "Gyro Y (m°/s)", stroke: "#ffb74d" },
        { label: "Gyro Z (m°/s)", stroke: "#81c784" },
    ],
    legendHostId: "gyroChartLegendHost",
    cursorUnit: 'm°/s',
    formatMicrosecondsToHMS,
    createCursorPlugin: createCursorYPlugin,
});

gyroChart = new uPlot(
    gyroOptions,
    [timestamps.slice(), values1.slice(), values2.slice(), values3.slice()],
    document.getElementById("gyroChartHost")
);

window.applyStaticReplayData = function(accData, gyroData, startTimeUs, endTimeUs) {
    applyStaticReplayDataHelper({
        accData,
        gyroData,
        startTimeUs,
        endTimeUs,
        chart,
        rmsPlot,
        gyroChart,
        gyroRmsPlot,
        rmsWindowSize: RMS_WINDOW_SIZE,
    });
    // syncTimeRangeUi(endTimeUs - startTimeUs);  // <-- REMOVED: Auto-expanding to 60s kills the renderer
};

window.updateReplayDashboard = function(absTimeUs, accSample, gyroSample) {
    updateReplayDashboardHelper({
        absTimeUs,
        accSample,
        gyroSample,
        replayRecordingDate: window.replayRecordingDate,
        displayDurationSeconds,
        replayStartTimeUs: window.replayStartTimeUs || 0,
        chart,
        gyroChart,
        rmsPlot,
        gyroRmsPlot,
        accVectorViewport,
        buildViewportAccelerationSamples,
        buildViewportGyroSamples,
        waterfallRenderer: window.waterfallRenderer,
        gyroWaterfallRenderer: window.gyroWaterfallRenderer,
        fftPlot,
        gyroFftPlot,
        currentSampleRate,
        nAvg: N_AVG,
        isOfflineReplayMode: window.isOfflineReplayMode,
    });
};

setupInitialOverlayInteractions();

let liveChartResizeObserver = createLiveChartResizeObserver();
observeChartPanels(liveChartResizeObserver);
registerRuntimeAxisListeners();

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

window.getPanOffset = () => liveChartPanOffset;
window.setPanOffset = (offset) => {
    liveChartPanOffset = Number.isFinite(offset) ? offset : 0;
    panOffset = liveChartPanOffset;
};





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

    chart.setData(alignPlotDataToSeriesCount(chart, [timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]));

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


async function saveUplotAsPNG(uplotInstance, filename = 'chart.png') {
    if (!uplotInstance || !uplotInstance.root) {
        console.error('Ungültige uPlot-Instanz');
        return;
    }

    // Aktuelle Größe merken
    const parent = uplotInstance.root.parentElement;
    const originalWidth = parent ? parent.clientWidth : uplotInstance.width;
    const originalHeight = parent ? parent.clientHeight : uplotInstance.height;

    // Auf 1920x1080 (FullHD) hochskalieren
    uplotInstance.setSize({ width: 1920, height: 1080 });

    // Warten auf uPlots interne Microtask-Queue (Draw cycle)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const canvas = uplotInstance.root.querySelector('canvas');
    if (!canvas) {
        console.error('Kein Canvas-Element in uPlot gefunden');
        uplotInstance.setSize({ width: originalWidth, height: originalHeight });
        return;
    }

    const titleEl = uplotInstance.root.querySelector('.u-title');
    const titleText = titleEl ? titleEl.textContent : '';
    const titleHeight = titleText ? 70 : 0;

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvas.width;
    finalCanvas.height = canvas.height + titleHeight;
    const ctx = finalCanvas.getContext('2d');

    if (titleText) {
        ctx.fillStyle = '#eef6ff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(titleText, finalCanvas.width / 2, titleHeight / 2);
    }

    ctx.drawImage(canvas, 0, titleHeight);

    const dataURL = finalCanvas.toDataURL('image/png');

    // Sofort zurücksetzen
    uplotInstance.setSize({ width: originalWidth, height: originalHeight });

    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function saveCombinedUplotsAsPNG(chart1, chart2, filename = 'combined-chart-screenshot.png') {
    if (!chart1 && !chart2) {
        console.error('Keine uPlot-Instanzen für Kombi-Screenshot vorhanden');
        return;
    }
    
    if (!chart1) return saveUplotAsPNG(chart2, filename);
    if (!chart2) return saveUplotAsPNG(chart1, filename);

    const p1 = chart1.root.parentElement;
    const p2 = chart2.root.parentElement;
    const origW1 = p1 ? p1.clientWidth : chart1.width;
    const origH1 = p1 ? p1.clientHeight : chart1.height;
    const origW2 = p2 ? p2.clientWidth : chart2.width;
    const origH2 = p2 ? p2.clientHeight : chart2.height;

    // Auf Einzel-FullHD hochskalieren
    chart1.setSize({ width: 1920, height: 1080 });
    chart2.setSize({ width: 1920, height: 1080 });

    // Microtask Wait
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const canvas1 = chart1.root.querySelector('canvas');
    const canvas2 = chart2.root.querySelector('canvas');

    if (!canvas1 || !canvas2) {
        chart1.setSize({ width: origW1, height: origH1 });
        chart2.setSize({ width: origW2, height: origH2 });
        return;
    }

    const titleEl1 = chart1.root.querySelector('.u-title');
    const titleText1 = titleEl1 ? titleEl1.textContent : '';
    const titleHeight1 = titleText1 ? 70 : 0;

    const titleEl2 = chart2.root.querySelector('.u-title');
    const titleText2 = titleEl2 ? titleEl2.textContent : '';
    const titleHeight2 = titleText2 ? 70 : 0;

    const combinedCanvas = document.createElement('canvas');
    const gap = 40;
    combinedCanvas.width = Math.max(canvas1.width, canvas2.width);
    combinedCanvas.height = canvas1.height + canvas2.height + gap + titleHeight1 + titleHeight2;
    const ctx = combinedCanvas.getContext('2d');

    ctx.clearRect(0, 0, combinedCanvas.width, combinedCanvas.height);
    let currentY = 0;

    if (titleText1) {
        ctx.fillStyle = '#eef6ff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(titleText1, combinedCanvas.width / 2, currentY + (titleHeight1 / 2));
        currentY += titleHeight1;
    }

    ctx.drawImage(canvas1, 0, currentY);
    currentY += canvas1.height + gap;

    if (titleText2) {
        ctx.fillStyle = '#eef6ff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(titleText2, combinedCanvas.width / 2, currentY + (titleHeight2 / 2));
        currentY += titleHeight2;
    }

    ctx.drawImage(canvas2, 0, currentY);

    const dataURL = combinedCanvas.toDataURL('image/png');

    chart1.setSize({ width: origW1, height: origH1 });
    chart2.setSize({ width: origW2, height: origH2 });

    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Button-Eventlistener setzen
const screenshotButton = document.getElementById('SSBtn2');
if (screenshotButton) {
    screenshotButton.addEventListener('click', () => {
        saveUplotAsPNG(chart, 'acc-screenshot.png');
    });
}

const gyroScreenshotButton = document.getElementById('gyroSSBtn');
if (gyroScreenshotButton) {
    gyroScreenshotButton.addEventListener('click', () => {
        saveUplotAsPNG(gyroChart, 'gyro-screenshot.png');
    });
}

const comboScreenshotButton = document.getElementById('comboSSBtn');
if (comboScreenshotButton) {
    comboScreenshotButton.addEventListener('click', () => {
        saveCombinedUplotsAsPNG(chart, gyroChart, 'combined-screenshot.png');
    });
}

const fftScreenshotButton = document.getElementById('fftSSBtn');
if (fftScreenshotButton) {
    fftScreenshotButton.addEventListener('click', () => {
        saveUplotAsPNG(fftPlot, 'acc-fft-screenshot.png');
    });
}

const comboFftRmsScreenshotButton = document.getElementById('comboFftRmsSSBtn');
if (comboFftRmsScreenshotButton) {
    comboFftRmsScreenshotButton.addEventListener('click', () => {
        saveCombinedUplotsAsPNG(fftPlot, rmsPlot, 'acc-fft-rms-shot.png');
    });
}

const gyroFftScreenshotButton = document.getElementById('gyroFftSSBtn');
if (gyroFftScreenshotButton) {
    gyroFftScreenshotButton.addEventListener('click', () => {
        saveUplotAsPNG(gyroFftPlot, 'gyro-fft-screenshot.png');
    });
}

const comboGyroFftRmsScreenshotButton = document.getElementById('comboGyroFftRmsSSBtn');
if (comboGyroFftRmsScreenshotButton) {
    comboGyroFftRmsScreenshotButton.addEventListener('click', () => {
        saveCombinedUplotsAsPNG(gyroFftPlot, gyroRmsPlot, 'gyro-fft-rms-shot.png');
    });
}

const rmsScreenshotButton = document.getElementById('rmsSSBtn');
if (rmsScreenshotButton) {
    rmsScreenshotButton.addEventListener('click', () => {
        saveUplotAsPNG(rmsPlot, 'acc-rms-screenshot.png');
    });
}

const gyroRmsScreenshotButton = document.getElementById('gyroRmsSSBtn');
if (gyroRmsScreenshotButton) {
    gyroRmsScreenshotButton.addEventListener('click', () => {
        saveUplotAsPNG(gyroRmsPlot, 'gyro-rms-screenshot.png');
    });
}

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

document.getElementById("openBtn")?.addEventListener("click", openPopup);
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
    console.log("Starte Kalibrierung der Welt (einfach)...");
    accBufferCALIB.clear(); // Buffer leeren für Kalibrierung
    gyroBufferCALIB.clear();
    worldSimpleGyroCaptureActive = true;
    
    // Dynamisches Worker-Routing basierend auf Klick-Herkunft (CH1 vs CH2+)
    let targetWorker = decodeWorker; // Fallback auf globale Pipeline
    let pendingIp = window.pendingCalibrationIp;
    let targetNode = pendingIp ? window.getNodeByIp(pendingIp) : null;
    
    if (targetNode && targetNode.decodeWorker && !targetNode.isMaster) {
        targetWorker = targetNode.decodeWorker;
        console.log(`[Calibration] Routing START command to Node ${pendingIp}`);
    }

    // START-Kommando senden an den korrekten Worker
    targetWorker.postMessage({
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
            targetWorker.postMessage({
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
            console.log('Kalibrierungsquaternion Variante World + Axis:', quatsimple);
            
            // ACC-Rauschen berechnen (5 Sigma der am stärksten rauschenden Achse für starkes Deadband)
            // Fallback auf 2mg, falls das Signal wegen Float-Auflösung exakt starr ist!
            const accNoiseStdDevRaw = Math.max(accStats.x.stdDev, accStats.y.stdDev, accStats.z.stdDev);
            const accNoiseThreshold = Math.max(2, accNoiseStdDevRaw * 5);
            console.log(`[Calibration] Ermitteltes ACC Grundrauschen (Noise-Gate 5 Sigma): ${accNoiseThreshold.toFixed(2)} mg`);

            if (targetNode && !targetNode.isMaster) {
                // Dezentral an Sensor koppeln
                targetNode.calibrationState = { scale: accelCalibrationScale, quat: quatsimple, gyroZero: gyroZeroState, accNoise: accNoiseThreshold };
                targetNode.orientationMode = 2; // Auto-Select World Simple
                
                // Unmittelbar auf den aktiven Worker anwenden!
                if (targetNode.decodeWorker) {
                    targetNode.decodeWorker.postMessage({ type: 'accelCalibrationScale', payload: { scale: accelCalibrationScale }});
                    targetNode.decodeWorker.postMessage({ type: 'worldSimpleGyroState', payload: gyroZeroState });
                    if (quatsimple) targetNode.decodeWorker.postMessage({ type: 'calibdata', payload: { type: 2, quaternion: quatsimple }});
                    targetNode.decodeWorker.postMessage({ type: 'calibmode', payload: { mode: 2 }});
                }
                
                // Update UI Dropdown
                const safeIp = targetNode.ip.replace(/\\./g, "_");
                const csddDropdown = document.getElementById(`CSDD_${safeIp}`);
                if (csddDropdown) {
                    csddDropdown.value = "0"; // Note: value "0" in CSDD corresponds to World Simple UI label for some reason
                    // Actually, let's trigger the onchange safely if we use the helper
                    if (window.nodeDropdowns && window.nodeDropdowns[targetNode.ip] && window.nodeDropdowns[targetNode.ip].csdd) {
                       window.nodeDropdowns[targetNode.ip].csdd.setValue("0", true);
                    }
                }
                
                console.log(`[Calibration] Gespeichert für Node ${pendingIp}`);
                window.persistNodeCalibration(targetNode);
            } else {
                // Global (CH1) - Finde expliziten Node, um State zu verknüpfen
                if (window.activeSensors) {
                    const masterNode = window.activeSensors.find(n => n.isMaster);
                    if (masterNode) {
                        masterNode.calibrationState = masterNode.calibrationState || {};
                        masterNode.calibrationState.scale = accelCalibrationScale;
                        masterNode.calibrationState.quat = quatsimple;
                        masterNode.calibrationState.gyroZero = gyroZeroState;
                        masterNode.calibrationState.accNoise = accNoiseThreshold;
                        window.persistNodeCalibration(masterNode);
                    }
                }
                
                setOrientationCalibrationQuaternion(quatsimple, { persistState: false });
                setAccelCalibrationScale(accelCalibrationScale, { persistState: false });
                setWorldSimpleGyroState(gyroZeroState, { persistState: false });
                persistCalibrationCookie();
                applyOrientationMode(2, { syncDropdown: true, optionLabel: 'World Simple' });
            }

            if (targetWorker) {
                targetWorker.postMessage({
                    type: 'accelCalibrationScale',
                    payload: { scale: accelCalibrationScale }
                });
                targetWorker.postMessage({
                    type: 'calibdata',
                    payload: { type: 2, quaternion: quatsimple }
                });
                targetWorker.postMessage({
                    type: 'calibmode',
                    payload: { mode: 2 }
                });
                targetWorker.postMessage({
                    type: 'gravity',
                    payload: { gravity: tempgravity }
                });
            }

            document.getElementById("btn1").disabled = false; // Button wieder aktivieren

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
    
    // Dynamisches Worker-Routing basierend auf Klick-Herkunft (CH1 vs CH2+)
    let targetWorker = decodeWorker; // Fallback auf globale Pipeline
    let pendingIp = window.pendingCalibrationIp;
    let targetNode = pendingIp ? window.getNodeByIp(pendingIp) : null;
    
    if (targetNode && targetNode.decodeWorker && !targetNode.isMaster) {
        targetWorker = targetNode.decodeWorker;
        console.log(`[Calibration] Routing START command to Node ${pendingIp}`);
    }

    // START-Kommando senden
    targetWorker.postMessage({
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
            targetWorker.postMessage({
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
    
    // Dynamisches Worker-Routing basierend auf Klick-Herkunft (CH1 vs CH2+)
    let targetWorker = decodeWorker; // Fallback auf globale Pipeline
    let pendingIp = window.pendingCalibrationIp;
    let targetNode = pendingIp ? window.getNodeByIp(pendingIp) : null;
    
    if (targetNode && targetNode.decodeWorker && !targetNode.isMaster) {
        targetWorker = targetNode.decodeWorker;
        console.log(`[Calibration] Routing START command to Node ${pendingIp}`);
    }

    // START-Kommando senden
    targetWorker.postMessage({
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
            targetWorker.postMessage({
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
            console.log('Kalibrierungsquaternion Variante World + Axis:', quatsimple);
            
            let targetWorker = decodeWorker;
            let targetNode = pendingIp ? window.getNodeByIp(pendingIp) : null;
            if (targetNode && !targetNode.isMaster && targetNode.decodeWorker) {
                targetWorker = targetNode.decodeWorker;
            }

            if (targetNode && !targetNode.isMaster) {
                if (!targetNode.calibrationState) targetNode.calibrationState = {};
                targetNode.calibrationState.quat = quatsimple;
                targetNode.orientationMode = 2; // "World + Axis" (World Simple with yaw)
                
                // Update UI Dropdown
                const safeIp = targetNode.ip.replace(/\./g, "_");
                const csddDropdown = document.getElementById(`CSDD_${safeIp}`);
                if (csddDropdown) {
                    csddDropdown.value = "0"; // Map UI representation
                    if (window.nodeDropdowns && window.nodeDropdowns[targetNode.ip] && window.nodeDropdowns[targetNode.ip].csdd) {
                       window.nodeDropdowns[targetNode.ip].csdd.setValue("0", true);
                    }
                }
                
                console.log(`[Calibration] Gespeichert für Node ${pendingIp}`);
                window.persistNodeCalibration(targetNode);
            } else {
                setOrientationCalibrationQuaternion(quatsimple, { persistState: false });
                applyOrientationMode(2, { syncDropdown: true, optionLabel: 'World + Axis' });
                persistCalibrationCookie();
            }

            if (targetWorker) {
                targetWorker.postMessage({
                    type: 'calibdata',
                    payload: { type: 2, quaternion: quatsimple }
                });
                targetWorker.postMessage({
                    type: 'calibmode',
                    payload: { mode: 2 }
                });
            }

            document.getElementById("btn1").disabled = false; // Button wieder aktivieren
            
            btn2.disabled = false; // Button wieder aktivieren
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

// ================= FFT UI SETUP =================
new UniDropdown(document.getElementById("dropdown1"), {
    type: "select",
    label: "Time (s)",
    items: [
        { value: 0.1, label: "0.1 s" },
        { value: 0.25, label: "0.25 s" },
        { value: 0.5, label: "0.5 s" },
        { value: 1.0, label: "1.0 s" },
        { value: 2.0, label: "2.0 s" }
    ],
    defaultValue: FFT_WINDOW_TIME_S,
    onChange: (value) => { FFT_WINDOW_TIME_S = Number(value); }
});
new UniDropdown(document.getElementById("dropdown2"), {
    type: "select",
    label: "Rate",
    items: [
      { value: 1000/60, label: "60 fps" },
      { value: 1000/30, label: "30 fps" },
      { value: 1000/20, label: "20 fps" },
      { value: 1000/10, label: "10 fps" },
      { value: 1000/5, label: "5 fps" }
    ],
    defaultValue: FFT_UPDATE_INTERVAL,
    onChange: (value) => { FFT_UPDATE_INTERVAL = Number(value); }
});
new UniDropdown(document.getElementById("dropdown3"), {
    type: "select",
    label: "Avg",
    items: [5,10,15,20,25,50,100,150,300].map(v => ( { value: v, label: `${v}` } )),
    defaultValue: N_AVG,
    onChange: (value) => { N_AVG = Number(value); }
});
new UniDropdown(document.getElementById("dropdown6"), {
    type: "select",
    label: "AXIS",
    items: [
      { value: "COMBI", label: "KOMBINIERT" },
      { value: "ONLYX", label: "X" },
      { value: "ONLYY", label: "Y" },
      { value: "ONLYZ", label: "Z" }
    ],
    defaultValue: FFT_AXIS_MODE,
    onChange: (value) => { FFT_AXIS_MODE = value; }
});
new UniDropdown(document.getElementById("dropdown4"), {
    type: "select",
    label: "Window",
    items: [
      { value: "BLACKMAN", label: "BLACKMAN" },
      { value: "HANNING", label: "HANNING" },
      { value: "HAMMING", label: "HAMMING" },
      { value: "RECTANGULAR", label: "RECTANGULAR" }
    ],
    defaultValue: FFT_WINDOW_TYPE,
    onChange: (value) => { FFT_WINDOW_TYPE = value; }
});
new UniDropdown(document.getElementById("dropdown5"), {
    type: "select",
    label: "DC",
    items: [
      { value: true, label: "YES" },
      { value: false, label: "NO" }
    ],
    defaultValue: DC_CUTOFF,
    onChange: (value) => { DC_CUTOFF = (value === "true" || value === true); }
});
new UniDropdown(document.getElementById("sliderDropdown"), {
    type: "logslider",
    label: "HPF",
    minValue: 0.001,
    maxValue: 100,
    defaultValue: fftHighPass,
    alpha: 0.3,
    onChange: (value) => { fftHighPass = value; }
});

// GYRO FFT
new UniDropdown(document.getElementById("gyroDropdown1"), {
    type: "select",
    label: "Time (s)",
    items: [
        { value: 0.1, label: "0.1 s" },
        { value: 0.25, label: "0.25 s" },
        { value: 0.5, label: "0.5 s" },
        { value: 1.0, label: "1.0 s" },
        { value: 2.0, label: "2.0 s" }
    ],
    defaultValue: GYRO_FFT_WINDOW_TIME_S,
    onChange: (value) => { GYRO_FFT_WINDOW_TIME_S = Number(value); }
});
new UniDropdown(document.getElementById("gyroDropdown2"), {
    type: "select",
    label: "Rate",
    items: [
      { value: 1000/60, label: "60 fps" },
      { value: 1000/30, label: "30 fps" },
      { value: 1000/20, label: "20 fps" },
      { value: 1000/10, label: "10 fps" },
      { value: 1000/5, label: "5 fps" }
    ],
    defaultValue: GYRO_FFT_UPDATE_INTERVAL,
    onChange: (value) => { GYRO_FFT_UPDATE_INTERVAL = Number(value); }
});
new UniDropdown(document.getElementById("gyroDropdown3"), {
    type: "select",
    label: "Avg",
    items: [5,10,15,20,25,50,100,150,300].map(v => ( { value: v, label: `${v}` } )),
    defaultValue: gyroN_AVG,
    onChange: (value) => { gyroN_AVG = Number(value); }
});
new UniDropdown(document.getElementById("gyroDropdown6"), {
    type: "select",
    label: "AXIS",
    items: [
      { value: "COMBI", label: "KOMBINIERT" },
      { value: "ONLYX", label: "X" },
      { value: "ONLYY", label: "Y" },
      { value: "ONLYZ", label: "Z" }
    ],
    defaultValue: GYRO_FFT_AXIS_MODE,
    onChange: (value) => { GYRO_FFT_AXIS_MODE = value; }
});
new UniDropdown(document.getElementById("gyroDropdown4"), {
    type: "select",
    label: "Window",
    items: [
      { value: "BLACKMAN", label: "BLACKMAN" },
      { value: "HANNING", label: "HANNING" },
      { value: "HAMMING", label: "HAMMING" },
      { value: "RECTANGULAR", label: "RECTANGULAR" }
    ],
    defaultValue: GYRO_FFT_WINDOW_TYPE,
    onChange: (value) => { GYRO_FFT_WINDOW_TYPE = value; }
});
new UniDropdown(document.getElementById("gyroDropdown5"), {
    type: "select",
    label: "DC",
    items: [
      { value: true, label: "YES" },
      { value: false, label: "NO" }
    ],
    defaultValue: GYRO_DC_CUTOFF,
    onChange: (value) => { GYRO_DC_CUTOFF = (value === "true" || value === true); }
});
new UniDropdown(document.getElementById("gyroSliderDropdown"), {
    type: "logslider",
    label: "HPF",
    minValue: 0.001,
    maxValue: 100,
    defaultValue: gyroFftHighPass,
    alpha: 0.3,
    onChange: (value) => { gyroFftHighPass = value; }
});

document.getElementById('gravityBtn')?.classList.toggle('toggle-on', gravityCutEnabled);

function setGravityCutEnabled(enabled, { persistState = true, notifyWorker = true } = {}) {
    const normalizedEnabled = Boolean(enabled);
    gravityCutEnabled = normalizedEnabled;
    document.getElementById('gravityBtn')?.classList.toggle('toggle-on', normalizedEnabled);

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
window.setGravityCutEnabled = setGravityCutEnabled;

document.getElementById('gravityBtn')?.addEventListener('click', function () {
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

// ====== UI WATCHDOG ======
// Überwacht die SensorNodes auf fehlende Daten (> 5s) und blendet sie aus.
setInterval(() => {
    if (window.isOfflineReplayMode) return;
    if (!window.activeSensors || window.activeSensors.length <= 1) return;
    
    const now = performance.now();
    let uiChanged = false;

    for (let i = 1; i < window.activeSensors.length; i++) {
        const node = window.activeSensors[i];
        if (!node) continue;
        
        // Timeout nach 5 Sekunden ohne Daten (oder Verbindungsaufbau)
        if (!window.isOfflineReplayMode && node.lastDataMs && (now - node.lastDataMs > 5000)) {
            if (!node.isHiddenFromUI && !node.isMaster) {
                node.isHiddenFromUI = true;
                
                // 1) Aus Verbundene Sensoren-Liste entfernen
                const listRow = document.getElementById(`sensorNodeListRow_${i}`);
                if (listRow) listRow.style.display = 'none';
                
                // 2) Tab-Button verstecken
                const tabBtn = document.getElementById(`sensorTabBtn_${i}`);
                if (tabBtn) tabBtn.style.display = 'none';
                
                // Falls dieser Tab gerade aktiv war, auf Master switchen
                if (tabBtn && tabBtn.classList.contains("active-sensor-tab")) {
                    const masterTab = document.getElementById("sensorTabBtn_0");
                    if (masterTab) masterTab.click();
                }
                
                // 3) Settings-Spalte verstecken
                const multiNodeSettingsHost = document.getElementById("multiNodeSettingsHost");
                if (multiNodeSettingsHost && multiNodeSettingsHost.children[i]) {
                    multiNodeSettingsHost.children[i].style.display = 'none';
                }
                
                console.warn(`[Watchdog] Node CH${i+1} aus UI ausgeblendet (timeout)`);
                uiChanged = true;
            }
        } else if (window.isOfflineReplayMode || (node.lastDataMs && (now - node.lastDataMs <= 5000))) {
            if (node.isHiddenFromUI) {
                node.isHiddenFromUI = false;
                
                // Wieder einblenden
                const listRow = document.getElementById(`sensorNodeListRow_${i}`);
                if (listRow) listRow.style.display = 'flex';
                
                const tabBtn = document.getElementById(`sensorTabBtn_${i}`);
                if (tabBtn) tabBtn.style.display = ''; // default block/inline
                
                const multiNodeSettingsHost = document.getElementById("multiNodeSettingsHost");
                if (multiNodeSettingsHost && multiNodeSettingsHost.children[i]) {
                    multiNodeSettingsHost.children[i].style.display = ''; // default
                }
                
                console.info(`[Watchdog] Node CH${i+1} wieder in UI eingeblendet (neue Daten)`);
                uiChanged = true;
            }
        }
    }

    if (uiChanged && typeof updateRelativeAnalysisNodeSelector === 'function') {
         updateRelativeAnalysisNodeSelector(window.activeSensors);
    }
    if (uiChanged && typeof accVectorViewport !== 'undefined' && accVectorViewport && typeof accVectorViewport.updateNodeSelector === 'function') {
         accVectorViewport.updateNodeSelector(window.activeSensors);
    }
}, 2000);

// Initialize Relativ-Tab Sub-Navigation & Charts
initRelativeAnalysisUI();
initRelativeDiffRmsChart();
initRelativeTranslationChart();
initRelativeKinematicViewport();
initRelativeLissajousChart();
startRelativeDiffRmsRuntime();

// Bind UI event listeners (SYNC ALL, Identify etc)
setupButtons();
