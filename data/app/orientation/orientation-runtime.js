import { sanitizeAccelCalibrationScale, sanitizeGyroZeroState } from './calibration-store.js';
import {
    applyQuaternionWXYZToSample,
    applyQuaternionXYZWToSample,
    applyReferenceToSample,
    convertQuaternionWXYZtoXYZW,
    getIdentityQuaternionXYZW,
    isIdentityQuaternionXYZW,
    multiplyQuaternionsXYZW,
    normalizeQuaternionXYZW,
} from './orientation-math.js';

export function resolveGravityCutVectorSample(gravityMagnitude, currentOrientationMode, adjustmentQuaternion) {
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

    if (!adjustmentQuaternion || isIdentityQuaternionXYZW(adjustmentQuaternion)) {
        return gravityVector;
    }

    return applyQuaternionXYZWToSample(gravityVector, adjustmentQuaternion) || gravityVector;
}

export function applyGravityCutToSample(sample, gravityMagnitude, gravityVector = null) {
    if (!sample) {
        return null;
    }

    const normalizedGravity = Number.isFinite(gravityMagnitude) && gravityMagnitude > 0 ? gravityMagnitude : 1000;
    const resolvedGravityVector = gravityVector || {
        time: 0,
        x: 0,
        y: 0,
        z: -normalizedGravity,
        total: normalizedGravity,
    };
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

export function applyAccelCalibrationScale(sample, scale) {
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

export function getViewportGravityMagnitude(tempgravity) {
    if (Number.isFinite(tempgravity) && tempgravity > 0) {
        return tempgravity;
    }

    return 1000;
}

export function getViewportBaseQuaternionXYZW(currentOrientationMode, calibrationQuaternion, ausrichtungQuaternion) {
    const normalizedCalibrationQuaternion = normalizeQuaternionXYZW(calibrationQuaternion);
    const normalizedAusrichtungQuaternion = convertQuaternionWXYZtoXYZW(ausrichtungQuaternion);

    if (currentOrientationMode === 2) {
        return normalizedCalibrationQuaternion || normalizedAusrichtungQuaternion;
    }

    if (currentOrientationMode === 1) {
        return normalizedAusrichtungQuaternion || normalizedCalibrationQuaternion;
    }

    return normalizedCalibrationQuaternion || normalizedAusrichtungQuaternion;
}

export function getViewportAdjustmentQuaternionXYZW(adjustmentQuaternion) {
    return normalizeQuaternionXYZW(adjustmentQuaternion) || getIdentityQuaternionXYZW();
}

export function getViewportEffectiveQuaternionXYZW(currentOrientationMode, adjustmentQuaternion, baseQuaternion) {
    if (currentOrientationMode === 0) {
        return null;
    }

    return multiplyQuaternionsXYZW(adjustmentQuaternion, baseQuaternion) || adjustmentQuaternion;
}

export function updateWorldSimpleGyroState(gyroState) {
    return sanitizeGyroZeroState(gyroState);
}

export function updateAccelCalibrationScale(scale) {
    return sanitizeAccelCalibrationScale(scale);
}

export function resolveOrientationMode(mode, enableFusionPipeline, optionLabel, getOrientationLabelForMode) {
    let normalizedMode = Number(mode);
    if (!Number.isFinite(normalizedMode)) {
        return null;
    }

    if (!enableFusionPipeline && normalizedMode === 1) {
        normalizedMode = 0;
    }

    return {
        mode: normalizedMode,
        label: optionLabel || getOrientationLabelForMode(normalizedMode),
    };
}

export function buildViewportBaseAccelerationSample(rawSample, context) {
    if (!rawSample) {
        return null;
    }

    const {
        currentOrientationMode,
        currentReferenceState,
        adjustmentQuaternion,
        effectiveQuaternion,
        ausrichtungQuaternion,
        currentAccelCalibrationScale,
    } = context;

    if (currentOrientationMode === 3 && currentReferenceState) {
        const referenceSample = applyReferenceToSample(rawSample, currentReferenceState);
        if (!referenceSample || isIdentityQuaternionXYZW(adjustmentQuaternion)) {
            return referenceSample;
        }

        return applyQuaternionXYZWToSample(referenceSample, adjustmentQuaternion) || referenceSample;
    }

    if (currentOrientationMode !== 0) {
        if (currentOrientationMode === 1) {
            if (effectiveQuaternion) {
                return applyQuaternionXYZWToSample(rawSample, effectiveQuaternion) || rawSample;
            }

            return applyQuaternionWXYZToSample(rawSample, ausrichtungQuaternion) || rawSample;
        }

        if (effectiveQuaternion) {
            return applyAccelCalibrationScale(
                applyQuaternionXYZWToSample(rawSample, effectiveQuaternion),
                currentAccelCalibrationScale,
            ) || rawSample;
        }
    }

    return rawSample;
}

export function buildViewportAccelerationSamples(rawSample, processedSample, context) {
    const raw = rawSample || processedSample || null;
    let calibrated = processedSample || raw;
    let calibratedCut = null;
    const gravityMagnitude = getViewportGravityMagnitude(context.gravityMagnitude);
    const gravityVector = resolveGravityCutVectorSample(
        gravityMagnitude,
        context.currentOrientationMode,
        context.adjustmentQuaternion,
    );

    if (raw) {
        calibrated = buildViewportBaseAccelerationSample(raw, context) || calibrated;
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

export function buildViewportGyroSamples(rawSample, processedSample, context) {
    const raw = rawSample || processedSample || null;
    let calibrated = processedSample || raw;
    let calibratedCut = processedSample || raw;

    if (raw) {
        if (context.currentOrientationMode === 3 && context.currentReferenceState) {
            const referenceGyro = {
                time: Number(raw.time || 0),
                x: Number(raw.x || 0) - Number(context.currentReferenceState.gx || 0),
                y: Number(raw.y || 0) - Number(context.currentReferenceState.gy || 0),
                z: Number(raw.z || 0) - Number(context.currentReferenceState.gz || 0),
            };
            calibrated = isIdentityQuaternionXYZW(context.adjustmentQuaternion)
                ? referenceGyro
                : (applyQuaternionXYZWToSample(referenceGyro, context.adjustmentQuaternion) || referenceGyro);
            calibrated.total = Math.hypot(calibrated.x, calibrated.y, calibrated.z);
            calibratedCut = calibrated;
        } else if (context.currentOrientationMode === 1) {
            calibrated = context.effectiveQuaternion
                ? (applyQuaternionXYZWToSample(raw, context.effectiveQuaternion) || calibrated)
                : (applyQuaternionWXYZToSample(raw, context.ausrichtungQuaternion) || calibrated);
            calibratedCut = calibrated;
        } else if (context.effectiveQuaternion) {
            const worldSimpleGyroRaw = context.currentOrientationMode === 2 && context.currentWorldSimpleGyroState
                ? {
                    time: Number(raw.time || 0),
                    x: Number(raw.x || 0) - Number(context.currentWorldSimpleGyroState.x || 0),
                    y: Number(raw.y || 0) - Number(context.currentWorldSimpleGyroState.y || 0),
                    z: Number(raw.z || 0) - Number(context.currentWorldSimpleGyroState.z || 0),
                }
                : raw;
            calibrated = applyQuaternionXYZWToSample(worldSimpleGyroRaw, context.effectiveQuaternion) || calibrated;
            calibratedCut = calibrated;
        }
    }

    return {
        raw,
        calibrated,
        calibratedCut,
    };
}

export function buildLiveAccelerationSample(rawSample, processedSample, context) {
    const raw = rawSample || processedSample || null;
    if (!raw) {
        return null;
    }

    if (context.currentOrientationMode === 0) {
        return processedSample || raw;
    }

    const calibratedSample = buildViewportBaseAccelerationSample(raw, context) || processedSample || raw;
    if (context.gravityCutEnabled) {
        const gravityMagnitude = getViewportGravityMagnitude(context.gravityMagnitude);
        const gravityVector = resolveGravityCutVectorSample(
            gravityMagnitude,
            context.currentOrientationMode,
            context.adjustmentQuaternion,
        );
        return applyGravityCutToSample(calibratedSample, gravityMagnitude, gravityVector) || calibratedSample;
    }

    return calibratedSample;
}

export function buildMotionAccelerationSample(rawSample, processedSample, context) {
    const raw = rawSample || processedSample || null;
    if (!raw) {
        return null;
    }

    const gravityMagnitude = getViewportGravityMagnitude(context.gravityMagnitude);
    const gravityVector = resolveGravityCutVectorSample(
        gravityMagnitude,
        context.currentOrientationMode,
        context.adjustmentQuaternion,
    );
    const calibratedSample = buildViewportBaseAccelerationSample(raw, context) || processedSample || raw;
    return applyGravityCutToSample(calibratedSample, gravityMagnitude, gravityVector) || calibratedSample;
}

export function buildLiveGyroSample(rawSample, processedSample, context) {
    const raw = rawSample || processedSample || null;
    if (!raw) {
        return null;
    }

    if (context.currentOrientationMode === 0) {
        return processedSample || raw;
    }

    const samples = buildViewportGyroSamples(raw, processedSample, context);
    return samples.calibrated || processedSample || raw;
}

export function syncMotionWorkerTransform({
    enableMotionView,
    motionWorker,
    effectiveQuaternion,
    currentOrientationMode,
    gravityMagnitude,
    reset = false,
}) {
    if (!enableMotionView) {
        return;
    }

    motionWorker.postMessage({
        type: 'transform',
        payload: {
            quaternion: effectiveQuaternion,
            active: currentOrientationMode !== 0,
            gravityMagnitudeMg: gravityMagnitude,
            reset,
        },
    });
}

export function syncViewportBaseQuaternion({ accVectorViewport, baseQuaternion, silent = true }) {
    accVectorViewport.setBaseQuaternion(baseQuaternion || getIdentityQuaternionXYZW(), { silent, commit: false });
}

export function syncViewportPostTransformQuaternion({
    decodeWorker,
    quaternion,
    persistState = false,
    resetLiveBuffers = false,
    onResetLiveBuffers,
    onPersistState,
}) {
    decodeWorker.postMessage({
        type: 'postTransformQuaternion',
        payload: {
            quaternion: quaternion || getIdentityQuaternionXYZW(),
        }
    });

    if (resetLiveBuffers) {
        onResetLiveBuffers?.();
    }

    if (persistState) {
        onPersistState?.();
    }
}

export function setOrientationCalibrationQuaternion({
    quaternion,
    decodeWorker,
    onQuaternionStored,
    onSyncViewportBaseQuaternion,
    onSyncMotionWorkerTransform,
    persistState = true,
    onPersistState,
}) {
    const normalizedQuaternion = normalizeQuaternionXYZW(quaternion);
    onQuaternionStored?.(normalizedQuaternion ? normalizedQuaternion.slice() : null);
    decodeWorker.postMessage({
        type: 'calibdata',
        payload: {
            type: 2,
            quaternion: normalizedQuaternion,
        }
    });
    onSyncViewportBaseQuaternion?.();
    onSyncMotionWorkerTransform?.();

    if (persistState) {
        onPersistState?.();
    }
}

export function calculateStats(values) {
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

export function getBufferAxisStats(buffer, fieldName) {
    return calculateStats(buffer.getFieldTypedArray(fieldName, buffer.length));
}

export function buildCalibrationStatsTableHtml(accSampleCount, gyroSampleCount, accStats, gyroStats) {
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

export function buildSingleSensorStatsTableHtml(sensorLabel, sampleCount, stats, unit) {
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