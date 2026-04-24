import { normalizeQuaternionXYZW } from './orientation-math.js';

export function setCookieValue(name, value, maxAgeSeconds) {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
}

export function setLocalStorageValue(name, value) {
    try {
        globalThis.localStorage?.setItem(name, value);
    } catch (error) {
        console.warn('Lokaler Persistenzspeicher konnte nicht geschrieben werden:', error);
    }
}

export function getCookieValue(name) {
    const prefix = `${name}=`;
    const cookies = document.cookie ? document.cookie.split('; ') : [];

    for (const cookie of cookies) {
        if (cookie.startsWith(prefix)) {
            return decodeURIComponent(cookie.slice(prefix.length));
        }
    }

    return null;
}

export function getLocalStorageValue(name) {
    try {
        return globalThis.localStorage?.getItem(name) ?? null;
    } catch (error) {
        console.warn('Lokaler Persistenzspeicher konnte nicht gelesen werden:', error);
        return null;
    }
}

export function clearCookieValue(name) {
    document.cookie = `${name}=; max-age=0; path=/; samesite=lax`;
}

export function clearLocalStorageValue(name) {
    try {
        globalThis.localStorage?.removeItem(name);
    } catch (error) {
        console.warn('Lokaler Persistenzspeicher konnte nicht gelöscht werden:', error);
    }
}

export function sanitizeAppSettingsBoolean(value, fallback = false) {
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

export function sanitizeCustomWsHost(value) {
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

export function sanitizeReferenceState(referenceState) {
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

export function sanitizeGyroZeroState(gyroState) {
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

export function sanitizeAccelCalibrationScale(scale) {
    const normalizedScale = Number(scale);
    if (!Number.isFinite(normalizedScale) || normalizedScale <= 0) {
        return 1;
    }

    return normalizedScale;
}

export function sanitizeViewportDisplaySettings(settings) {
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

    const backgroundPreset = sanitizeBackgroundPreset(settings.backgroundPreset);

    return { arrowOpacity, axisColors, vectorColors, backgroundPreset };
}

export function sanitizeMotionViewportDisplaySettings(settings) {
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

    const backgroundPreset = sanitizeBackgroundPreset(settings.backgroundPreset);

    return { arrowOpacity, axisColors, vectorColors, backgroundPreset };
}

export function parseAppSettingsPersistedState(rawState, appSettingsCookieVersion) {
    const parsed = JSON.parse(rawState);
    const version = Number(parsed?.version);

    if (version !== appSettingsCookieVersion) {
        return null;
    }

    return {
        version,
        telemetryPanelHidden: sanitizeAppSettingsBoolean(parsed?.telemetryPanelHidden, true),
        gravityCutEnabled: sanitizeAppSettingsBoolean(parsed?.gravityCutEnabled, false),
        customWsHost: sanitizeCustomWsHost(parsed?.customWsHost),
    };
}

export function buildLegacyAppSettingsState({ legacyTelemetryHidden, legacyWsHost, appSettingsCookieVersion }) {
    if (legacyTelemetryHidden === null && !legacyWsHost) {
        return null;
    }

    return {
        version: appSettingsCookieVersion,
        telemetryPanelHidden: sanitizeAppSettingsBoolean(legacyTelemetryHidden, true),
        gravityCutEnabled: false,
        customWsHost: sanitizeCustomWsHost(legacyWsHost),
    };
}

export function clearLegacyAppSettingsStorage({ appSettingsStorageKey, telemetryPanelHiddenKey, legacyWsHostStorageKey }) {
    clearLocalStorageValue(appSettingsStorageKey);
    clearLocalStorageValue(telemetryPanelHiddenKey);
    clearLocalStorageValue(legacyWsHostStorageKey);
}

export function readAppSettingsCookieState({
    appSettingsCookieName,
    appSettingsStorageKey,
    appSettingsCookieVersion,
    legacyTelemetryHidden,
    legacyWsHost,
}) {
    const rawCookie = getCookieValue(appSettingsCookieName);
    if (rawCookie) {
        try {
            const state = parseAppSettingsPersistedState(rawCookie, appSettingsCookieVersion);
            if (!state) {
                clearCookieValue(appSettingsCookieName);
                // Fallthrough to LocalStorage
            } else {
                return { state, source: 'cookie' };
            }
        } catch (error) {
            console.warn('App-Settings-Cookie konnte nicht gelesen werden:', error);
            clearCookieValue(appSettingsCookieName);
        }
    }

    const rawStorage = getLocalStorageValue(appSettingsStorageKey);
    if (rawStorage) {
        try {
            const state = parseAppSettingsPersistedState(rawStorage, appSettingsCookieVersion);
            if (!state) {
                clearLocalStorageValue(appSettingsStorageKey);
            } else {
                return { state, source: 'localStorage' };
            }
        } catch (error) {
            console.warn('App-Settings-Backup konnte nicht gelesen werden:', error);
            clearLocalStorageValue(appSettingsStorageKey);
        }
    }

    const legacyState = buildLegacyAppSettingsState({
        legacyTelemetryHidden,
        legacyWsHost,
        appSettingsCookieVersion,
    });
    if (legacyState) {
        return { state: legacyState, source: 'legacy' };
    }

    return null;
}

export function parseCalibrationPersistedState(rawState, calibrationCookieVersion) {
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

    if (state.version !== calibrationCookieVersion) {
        return null;
    }

    if (!Number.isFinite(state.gravityMagnitude) || state.gravityMagnitude <= 0) {
        state.gravityMagnitude = null;
    }

    return state;
}

export function readCalibrationCookieState({ calibrationCookieName, calibrationStorageKey, calibrationCookieVersion }) {
    const rawCookie = getCookieValue(calibrationCookieName);
    if (rawCookie) {
        try {
            const state = parseCalibrationPersistedState(rawCookie, calibrationCookieVersion);
            if (!state) {
                clearCookieValue(calibrationCookieName);
                // Fallthrough to LocalStorage if cookie is outdated
            } else {
                return { state, source: 'cookie' };
            }
        } catch (error) {
            console.warn('Kalibrierungs-Cookie konnte nicht gelesen werden:', error);
            clearCookieValue(calibrationCookieName);
        }
    }

    const rawStorage = getLocalStorageValue(calibrationStorageKey);
    if (!rawStorage) {
        return null;
    }

    try {
        const state = parseCalibrationPersistedState(rawStorage, calibrationCookieVersion);
        if (!state) {
            clearLocalStorageValue(calibrationStorageKey);
            return null;
        }

        return { state, source: 'localStorage' };
    } catch (error) {
        console.warn('Kalibrierungs-Backup konnte nicht gelesen werden:', error);
        clearLocalStorageValue(calibrationStorageKey);
        return null;
    }
}

export function buildCurrentAppSettingsState({
    appSettingsCookieVersion,
    telemetryPanelHidden,
    gravityCutEnabled,
    customWsHost,
}) {
    return {
        version: appSettingsCookieVersion,
        savedAt: Date.now(),
        telemetryPanelHidden: Boolean(telemetryPanelHidden),
        gravityCutEnabled: Boolean(gravityCutEnabled),
        customWsHost: sanitizeCustomWsHost(customWsHost),
    };
}

export function persistAppSettingsCookie({
    appSettingsCookieName,
    appSettingsStorageKey,
    appSettingsCookieMaxAgeSeconds,
    state,
}) {
    const serializedState = JSON.stringify(state);
    setCookieValue(appSettingsCookieName, serializedState, appSettingsCookieMaxAgeSeconds);
    if (appSettingsStorageKey) {
        setLocalStorageValue(appSettingsStorageKey, serializedState);
    }
}

export function buildCurrentCalibrationCookieState({
    calibrationCookieVersion,
    mode,
    worldSimpleQuaternion,
    viewportAdjustmentQuaternion,
    referenceState,
    worldSimpleGyroState,
    accelCalibrationScale,
    gravityMagnitude,
    viewportDisplaySettings,
    motionViewportDisplaySettings,
    orientationLabel,
}) {
    const state = {
        version: calibrationCookieVersion,
        mode: Number.isFinite(mode) ? Number(mode) : 0,
        savedAt: Date.now(),
    };

    const normalizedQuaternion = normalizeQuaternionXYZW(worldSimpleQuaternion);
    if (normalizedQuaternion) {
        state.worldSimpleQuaternion = normalizedQuaternion;
    }

    const normalizedViewportAdjustmentQuaternion = normalizeQuaternionXYZW(viewportAdjustmentQuaternion);
    if (normalizedViewportAdjustmentQuaternion && !isIdentityQuaternion(normalizedViewportAdjustmentQuaternion)) {
        state.viewportAdjustmentQuaternion = normalizedViewportAdjustmentQuaternion;
    }

    const sanitizedReferenceState = sanitizeReferenceState(referenceState);
    if (sanitizedReferenceState) {
        state.referenceState = sanitizedReferenceState;
    }

    const sanitizedWorldSimpleGyroState = sanitizeGyroZeroState(worldSimpleGyroState);
    if (sanitizedWorldSimpleGyroState) {
        state.worldSimpleGyroState = sanitizedWorldSimpleGyroState;
    }

    const sanitizedAccelCalibrationScale = sanitizeAccelCalibrationScale(accelCalibrationScale);
    if (Math.abs(sanitizedAccelCalibrationScale - 1) > 1e-6) {
        state.accelCalibrationScale = sanitizedAccelCalibrationScale;
    }

    if (Number.isFinite(gravityMagnitude) && gravityMagnitude > 0) {
        state.gravityMagnitude = Number(gravityMagnitude);
    }

    const sanitizedViewportDisplaySettings = sanitizeViewportDisplaySettings(viewportDisplaySettings);
    if (sanitizedViewportDisplaySettings) {
        state.viewportDisplaySettings = sanitizedViewportDisplaySettings;
    }

    const sanitizedMotionViewportDisplaySettings = sanitizeMotionViewportDisplaySettings(motionViewportDisplaySettings);
    if (sanitizedMotionViewportDisplaySettings) {
        state.motionViewportDisplaySettings = sanitizedMotionViewportDisplaySettings;
    }

    if (orientationLabel) {
        state.orientationLabel = orientationLabel;
    }

    return state;
}

export function persistCalibrationCookieState({
    calibrationCookieName,
    calibrationStorageKey,
    calibrationCookieMaxAgeSeconds,
    state,
}) {
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
        clearCookieValue(calibrationCookieName);
        clearLocalStorageValue(calibrationStorageKey);
        return;
    }

    const serializedState = JSON.stringify(state);
    setCookieValue(calibrationCookieName, serializedState, calibrationCookieMaxAgeSeconds);
    setLocalStorageValue(calibrationStorageKey, serializedState);
}

export function restoreAppSettingsFromPersistence({
    persisted,
    fallbackState,
    onCustomWsHost,
    applyTelemetryPanelHidden,
    setGravityCutEnabled,
    onLegacyStateMigrated,
}) {
    const state = persisted?.state || fallbackState;

    onCustomWsHost(sanitizeCustomWsHost(state.customWsHost));
    applyTelemetryPanelHidden(state.telemetryPanelHidden, { persistState: false });
    setGravityCutEnabled(state.gravityCutEnabled, { persistState: false, notifyWorker: true });

    if (persisted && persisted.source !== 'cookie') {
        onLegacyStateMigrated?.();
    }
}

export function restoreCalibrationFromPersistence({
    persisted,
    setOrientationCalibrationQuaternion,
    applyReferenceState,
    setWorldSimpleGyroState,
    setAccelCalibrationScale,
    applyGravityMagnitude,
    applyOrientationMode,
    applyViewportAdjustmentQuaternion,
    syncViewportPostTransformQuaternion,
    applyViewportDisplaySettings,
    applyMotionViewportDisplaySettings,
    onLocalStorageStateMigrated,
    persistCalibrationCookie,
}) {
    if (!persisted?.state) {
        return;
    }

    const { state, source } = persisted;

    if (state.worldSimpleQuaternion) {
        setOrientationCalibrationQuaternion(state.worldSimpleQuaternion, { persistState: false });
    }

    if (state.referenceState) {
        applyReferenceState(state.referenceState);
    }

    if (state.worldSimpleGyroState) {
        setWorldSimpleGyroState(state.worldSimpleGyroState, { persistState: false });
    }

    setAccelCalibrationScale(state.accelCalibrationScale, { persistState: false });

    if (state.gravityMagnitude) {
        applyGravityMagnitude(state.gravityMagnitude);
    }

    applyOrientationMode(state.mode, {
        syncDropdown: true,
        optionLabel: state.orientationLabel,
        persistState: false,
    });

    applyViewportAdjustmentQuaternion(state.viewportAdjustmentQuaternion);
    syncViewportPostTransformQuaternion({ persistState: false, resetLiveBuffers: false });

    if (state.viewportDisplaySettings) {
        applyViewportDisplaySettings(state.viewportDisplaySettings);
    }

    if (state.motionViewportDisplaySettings) {
        applyMotionViewportDisplaySettings(state.motionViewportDisplaySettings);
    }

    if (source === 'localStorage') {
        onLocalStorageStateMigrated?.();
    }

    persistCalibrationCookie();

    console.log('Kalibrierung aus Cookie wiederhergestellt:', state);
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

function sanitizeBackgroundPreset(value) {
    const allowedBackgroundPresets = new Set(['steel', 'steel-soft', 'steel-light', 'aurora', 'dusk', 'ember', 'polar', 'mint', 'sunrise', 'noir', 'lab']);
    return typeof value === 'string'
        && allowedBackgroundPresets.has(value.trim().toLowerCase())
        ? value.trim().toLowerCase()
        : 'steel';
}

function isIdentityQuaternion(quaternion) {
    return Math.abs(quaternion[0]) <= 1e-6
        && Math.abs(quaternion[1]) <= 1e-6
        && Math.abs(quaternion[2]) <= 1e-6
        && Math.abs(quaternion[3] - 1) <= 1e-6;
}