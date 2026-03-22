const GRAVITY_TO_MS2 = 9.80665 / 1000;
const EMIT_INTERVAL_MS = 33;
const MAX_TRAIL_POINTS = 2400;
const MAX_EMITTED_TRAIL_POINTS = 480;
const STATIONARY_HOLD_SECONDS = 0.22;
const ZERO_VELOCITY_THRESHOLD_MS = 0.08;
const BRAKING_DEADBAND_FACTOR = 0.35;
const BRAKING_VELOCITY_THRESHOLD_MS = 0.12;
const BRAKING_MIN_OPPOSING_ACCEL_MS2 = 0.015;
const BRAKING_STATIONARY_BLOCK_VELOCITY_MS = 0.03;
const BRAKING_CHANGE_THRESHOLD_MS2 = 0.008;
const BRAKING_JERK_THRESHOLD_MS3 = 0.8;
const MOTION_BIAS_LEARN_TIME_SECONDS = 1.4;
const MOTION_BIAS_MAX_MS2 = 0.6;

let mode = 'motion';
let orientationActive = false;
let displayTrailSeconds = 5;
let deadbandMg = 10;
let stationaryAccelThresholdMs2 = 0.12;
let stationaryGyroThresholdMdps = 8000;
let motionVelocityLeak = 0.99998;
let vibrationVelocityLeak = 0.94;
let vibrationPositionLeak = 0.985;
let vibrationHighPassAlpha = 0.92;

let position = { x: 0, y: 0, z: 0 };
let velocity = { x: 0, y: 0, z: 0 };
let linearAcc = { x: 0, y: 0, z: 0 };
let lastTimeUs = null;
let lastGyroNormMdps = 0;
let trail = [];
let vibrationTrailPosition = { x: 0, y: 0, z: 0 };
let vibrationHighPass = { x: 0, y: 0, z: 0 };
let previousLinearAcc = { x: 0, y: 0, z: 0 };
let previousMotionInputAcc = { x: 0, y: 0, z: 0 };
let motionBias = { x: 0, y: 0, z: 0 };
let lastEmitAtMs = 0;
let stationaryTimeSeconds = 0;

function clampDt(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return null;
    }

    if (seconds > 0.2) {
        return 0.2;
    }

    return seconds;
}

function resetState({ keepConfig = true } = {}) {
    position = { x: 0, y: 0, z: 0 };
    velocity = { x: 0, y: 0, z: 0 };
    linearAcc = { x: 0, y: 0, z: 0 };
    lastTimeUs = null;
    lastGyroNormMdps = 0;
    trail = [];
    vibrationTrailPosition = { x: 0, y: 0, z: 0 };
    vibrationHighPass = { x: 0, y: 0, z: 0 };
    previousLinearAcc = { x: 0, y: 0, z: 0 };
    previousMotionInputAcc = { x: 0, y: 0, z: 0 };
    motionBias = { x: 0, y: 0, z: 0 };
    lastEmitAtMs = 0;
    stationaryTimeSeconds = 0;

    if (!keepConfig) {
        mode = 'motion';
        orientationActive = false;
        displayTrailSeconds = 5;
        deadbandMg = 10;
        stationaryAccelThresholdMs2 = 0.12;
        stationaryGyroThresholdMdps = 8000;
        motionVelocityLeak = 0.99998;
        vibrationVelocityLeak = 0.94;
        vibrationPositionLeak = 0.985;
        vibrationHighPassAlpha = 0.92;
    }
}

function updateTrail(timeUs) {
    const trailPoint = mode === 'vibration' ? vibrationTrailPosition : position;
    trail.push({ timeUs, x: trailPoint.x, y: trailPoint.y, z: trailPoint.z });

    const minTimeUs = timeUs - (displayTrailSeconds * 1_000_000);
    let trimCount = 0;
    while (trimCount < trail.length && trail[trimCount].timeUs < minTimeUs) {
        trimCount += 1;
    }
    if (trimCount > 0) {
        trail.splice(0, trimCount);
    }

    if (trail.length > MAX_TRAIL_POINTS) {
        trail.splice(0, trail.length - MAX_TRAIL_POINTS);
    }
}

function buildEmittedTrail() {
    if (trail.length <= MAX_EMITTED_TRAIL_POINTS) {
        return trail.map((point) => ({ x: point.x, y: point.y, z: point.z }));
    }

    const sampled = [];
    const stride = Math.max(1, Math.ceil(trail.length / MAX_EMITTED_TRAIL_POINTS));
    for (let index = 0; index < trail.length; index += stride) {
        const point = trail[index];
        sampled.push({ x: point.x, y: point.y, z: point.z });
    }

    const lastPoint = trail[trail.length - 1];
    const emittedLastPoint = sampled[sampled.length - 1];
    if (!emittedLastPoint || emittedLastPoint.x !== lastPoint.x || emittedLastPoint.y !== lastPoint.y || emittedLastPoint.z !== lastPoint.z) {
        sampled.push({ x: lastPoint.x, y: lastPoint.y, z: lastPoint.z });
    }

    return sampled;
}

function getLinearAccelerationMs2(sample) {
    return {
        x: Number(sample?.x || 0) * GRAVITY_TO_MS2,
        y: Number(sample?.y || 0) * GRAVITY_TO_MS2,
        z: Number(sample?.z || 0) * GRAVITY_TO_MS2,
    };
}

function applyPerAxisDeadband(vector, thresholdMs2) {
    return {
        x: Math.abs(vector.x) < thresholdMs2 ? 0 : vector.x,
        y: Math.abs(vector.y) < thresholdMs2 ? 0 : vector.y,
        z: Math.abs(vector.z) < thresholdMs2 ? 0 : vector.z,
    };
}

function subtractVector(vector, correction) {
    return {
        x: Number(vector.x || 0) - Number(correction.x || 0),
        y: Number(vector.y || 0) - Number(correction.y || 0),
        z: Number(vector.z || 0) - Number(correction.z || 0),
    };
}

function clampMagnitude(value, limit) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(-limit, Math.min(limit, value));
}

function updateMotionBias(dtSeconds, sample) {
    const alpha = Math.min(0.35, Math.max(0.002, dtSeconds / MOTION_BIAS_LEARN_TIME_SECONDS));
    motionBias.x += (Number(sample.x || 0) - motionBias.x) * alpha;
    motionBias.y += (Number(sample.y || 0) - motionBias.y) * alpha;
    motionBias.z += (Number(sample.z || 0) - motionBias.z) * alpha;

    motionBias.x = clampMagnitude(motionBias.x, MOTION_BIAS_MAX_MS2);
    motionBias.y = clampMagnitude(motionBias.y, MOTION_BIAS_MAX_MS2);
    motionBias.z = clampMagnitude(motionBias.z, MOTION_BIAS_MAX_MS2);
}

function getVelocityDirection() {
    const velocityNorm = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (!(velocityNorm > 1e-9)) {
        return { direction: null, norm: 0 };
    }

    return {
        norm: velocityNorm,
        direction: {
            x: velocity.x / velocityNorm,
            y: velocity.y / velocityNorm,
            z: velocity.z / velocityNorm,
        },
    };
}

function getSignedAccelerationAlongVelocity(acceleration) {
    const { direction, norm } = getVelocityDirection();
    if (!direction || norm < BRAKING_STATIONARY_BLOCK_VELOCITY_MS) {
        return 0;
    }

    return acceleration.x * direction.x
        + acceleration.y * direction.y
        + acceleration.z * direction.z;
}

function getLongitudinalComponent(acceleration) {
    const { direction, norm } = getVelocityDirection();
    if (!direction || norm < BRAKING_STATIONARY_BLOCK_VELOCITY_MS) {
        return null;
    }

    const signedComponent = getSignedAccelerationAlongVelocity(acceleration);
    return {
        x: direction.x * signedComponent,
        y: direction.y * signedComponent,
        z: direction.z * signedComponent,
    };
}

function isBrakingAcceleration(acceleration) {
    const { norm } = getVelocityDirection();
    if (norm < BRAKING_STATIONARY_BLOCK_VELOCITY_MS) {
        return false;
    }

    return getSignedAccelerationAlongVelocity(acceleration) <= -BRAKING_MIN_OPPOSING_ACCEL_MS2;
}

function isBrakingFromAccelerationChange(acceleration, previousAcceleration, dtSeconds) {
    if (!(dtSeconds > 0)) {
        return false;
    }

    const { norm } = getVelocityDirection();
    if (norm < BRAKING_STATIONARY_BLOCK_VELOCITY_MS) {
        return false;
    }

    const deltaAcceleration = subtractVector(acceleration, previousAcceleration);
    const signedDelta = getSignedAccelerationAlongVelocity(deltaAcceleration);
    const signedJerk = signedDelta / Math.max(dtSeconds, 1e-3);
    return signedDelta <= -BRAKING_CHANGE_THRESHOLD_MS2 && signedJerk <= -BRAKING_JERK_THRESHOLD_MS3;
}

function getAccelerationJerkNorm(acceleration, previousAcceleration, dtSeconds) {
    if (!(dtSeconds > 0)) {
        return 0;
    }

    const deltaAcceleration = subtractVector(acceleration, previousAcceleration);
    return Math.hypot(
        Number(deltaAcceleration.x || 0),
        Number(deltaAcceleration.y || 0),
        Number(deltaAcceleration.z || 0),
    ) / Math.max(dtSeconds, 1e-3);
}

function shapeMotionAcceleration(nextLinearAcc, options = {}) {
    const thresholdMs2 = Math.max(0, deadbandMg) * GRAVITY_TO_MS2;
    if (!(thresholdMs2 > 0)) {
        return { ...nextLinearAcc };
    }

    const { direction: velocityDirection, norm: velocityNorm } = getVelocityDirection();
    let filtered = applyPerAxisDeadband(nextLinearAcc, thresholdMs2);

    if (velocityNorm < BRAKING_VELOCITY_THRESHOLD_MS) {
        return filtered;
    }

    const signedAccelerationAlongVelocity =
        nextLinearAcc.x * velocityDirection.x
        + nextLinearAcc.y * velocityDirection.y
        + nextLinearAcc.z * velocityDirection.z;

    if (signedAccelerationAlongVelocity >= 0) {
        return filtered;
    }

    const brakingThresholdMs2 = thresholdMs2 * BRAKING_DEADBAND_FACTOR;
    if (Math.abs(signedAccelerationAlongVelocity) < brakingThresholdMs2) {
        return filtered;
    }

    const brakingComponent = {
        x: velocityDirection.x * signedAccelerationAlongVelocity,
        y: velocityDirection.y * signedAccelerationAlongVelocity,
        z: velocityDirection.z * signedAccelerationAlongVelocity,
    };
    const residualComponent = {
        x: nextLinearAcc.x - brakingComponent.x,
        y: nextLinearAcc.y - brakingComponent.y,
        z: nextLinearAcc.z - brakingComponent.z,
    };
    const filteredResidual = applyPerAxisDeadband(residualComponent, thresholdMs2);

    filtered = {
        x: filteredResidual.x + brakingComponent.x,
        y: filteredResidual.y + brakingComponent.y,
        z: filteredResidual.z + brakingComponent.z,
    };

    if (options.preserveLongitudinalChange) {
        const longitudinalComponent = getLongitudinalComponent(nextLinearAcc);
        if (longitudinalComponent) {
            const orthogonalComponent = {
                x: nextLinearAcc.x - longitudinalComponent.x,
                y: nextLinearAcc.y - longitudinalComponent.y,
                z: nextLinearAcc.z - longitudinalComponent.z,
            };
            const filteredOrthogonal = applyPerAxisDeadband(orthogonalComponent, thresholdMs2);
            filtered = {
                x: filteredOrthogonal.x + longitudinalComponent.x,
                y: filteredOrthogonal.y + longitudinalComponent.y,
                z: filteredOrthogonal.z + longitudinalComponent.z,
            };
        }
    }

    return filtered;
}

function updateMotionState(dtSeconds, nextLinearAcc) {
    const biasCorrectedAcc = subtractVector(nextLinearAcc, motionBias);
    const candidateNorm = Math.hypot(biasCorrectedAcc.x, biasCorrectedAcc.y, biasCorrectedAcc.z);
    const gyroQuiet = lastGyroNormMdps <= stationaryGyroThresholdMdps;
    const brakingCandidate = isBrakingAcceleration(biasCorrectedAcc)
        || isBrakingFromAccelerationChange(biasCorrectedAcc, previousMotionInputAcc, dtSeconds);
    const stationaryCandidate = candidateNorm <= stationaryAccelThresholdMs2
        && gyroQuiet
        && !brakingCandidate;

    if (stationaryCandidate) {
        stationaryTimeSeconds += dtSeconds;
        updateMotionBias(dtSeconds, nextLinearAcc);
    } else {
        stationaryTimeSeconds = 0;
    }

    const correctedAcc = subtractVector(nextLinearAcc, motionBias);
    previousMotionInputAcc = { ...correctedAcc };
    const filteredAcc = shapeMotionAcceleration(correctedAcc, {
        preserveLongitudinalChange: brakingCandidate,
    });

    const integratedAcc = {
        x: (previousLinearAcc.x + filteredAcc.x) * 0.5,
        y: (previousLinearAcc.y + filteredAcc.y) * 0.5,
        z: (previousLinearAcc.z + filteredAcc.z) * 0.5,
    };

    velocity.x = (velocity.x + integratedAcc.x * dtSeconds) * motionVelocityLeak;
    velocity.y = (velocity.y + integratedAcc.y * dtSeconds) * motionVelocityLeak;
    velocity.z = (velocity.z + integratedAcc.z * dtSeconds) * motionVelocityLeak;

    const velocityNorm = Math.hypot(velocity.x, velocity.y, velocity.z);
    const shouldConfirmStationary = stationaryCandidate
        && stationaryTimeSeconds >= STATIONARY_HOLD_SECONDS
        && velocityNorm <= ZERO_VELOCITY_THRESHOLD_MS;

    if (shouldConfirmStationary) {
        velocity = { x: 0, y: 0, z: 0 };
        previousLinearAcc = { x: 0, y: 0, z: 0 };
        previousMotionInputAcc = { x: 0, y: 0, z: 0 };
        return { x: 0, y: 0, z: 0 };
    }

    position.x += velocity.x * dtSeconds;
    position.y += velocity.y * dtSeconds;
    position.z += velocity.z * dtSeconds;

    return filteredAcc;
}

function updateVibrationState(dtSeconds, nextLinearAcc) {
    vibrationHighPass.x = vibrationHighPassAlpha * (vibrationHighPass.x + nextLinearAcc.x - previousLinearAcc.x);
    vibrationHighPass.y = vibrationHighPassAlpha * (vibrationHighPass.y + nextLinearAcc.y - previousLinearAcc.y);
    vibrationHighPass.z = vibrationHighPassAlpha * (vibrationHighPass.z + nextLinearAcc.z - previousLinearAcc.z);

    velocity.x = (velocity.x + vibrationHighPass.x * dtSeconds) * vibrationVelocityLeak;
    velocity.y = (velocity.y + vibrationHighPass.y * dtSeconds) * vibrationVelocityLeak;
    velocity.z = (velocity.z + vibrationHighPass.z * dtSeconds) * vibrationVelocityLeak;

    vibrationTrailPosition.x += velocity.x * dtSeconds;
    vibrationTrailPosition.y += velocity.y * dtSeconds;
    vibrationTrailPosition.z += velocity.z * dtSeconds;

    position.x = (position.x + velocity.x * dtSeconds) * vibrationPositionLeak;
    position.y = (position.y + velocity.y * dtSeconds) * vibrationPositionLeak;
    position.z = (position.z + velocity.z * dtSeconds) * vibrationPositionLeak;

    previousLinearAcc = { ...nextLinearAcc };
}

function emitState(reason = 'update', options = {}) {
    const force = options.force === true;
    const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    if (!force && reason === 'batch' && (nowMs - lastEmitAtMs) < EMIT_INTERVAL_MS) {
        return;
    }

    lastEmitAtMs = nowMs;
    postMessage({
        type: 'state',
        reason,
        mode,
        orientationActive,
        sampleTimeUs: lastTimeUs,
        trailSeconds: displayTrailSeconds,
        position: { ...position },
        velocity: { ...velocity },
        linearAcc: { ...linearAcc },
        trailCount: trail.length,
        trail: buildEmittedTrail(),
    });
}

function processBatch(payload) {
    const accSamples = Array.isArray(payload?.acc) ? payload.acc : [];
    const gyroSamples = Array.isArray(payload?.gyro) ? payload.gyro : [];
    if (!accSamples.length && !gyroSamples.length) {
        return;
    }

    if (gyroSamples.length) {
        const latestGyro = gyroSamples[gyroSamples.length - 1];
        lastGyroNormMdps = Math.hypot(
            Number(latestGyro?.x || 0),
            Number(latestGyro?.y || 0),
            Number(latestGyro?.z || 0),
        );
    }

    for (let index = 0; index < accSamples.length; index++) {
        const sample = accSamples[index];
        const timeUs = Number(sample?.time || 0);
        const nextLinearAcc = getLinearAccelerationMs2(sample || { x: 0, y: 0, z: 0 });

        if (lastTimeUs !== null) {
            const dtSeconds = clampDt((timeUs - lastTimeUs) * 1e-6);
            if (dtSeconds) {
                if (mode === 'vibration') {
                    updateVibrationState(dtSeconds, nextLinearAcc);
                    linearAcc = nextLinearAcc;
                } else {
                    linearAcc = updateMotionState(dtSeconds, nextLinearAcc);
                    previousLinearAcc = { ...linearAcc };
                }
                updateTrail(timeUs);
            }
        } else {
            linearAcc = mode === 'motion' ? shapeMotionAcceleration(nextLinearAcc) : nextLinearAcc;
            previousLinearAcc = { ...linearAcc };
            updateTrail(timeUs);
        }

        lastTimeUs = timeUs;
    }

    emitState('batch');
}

onmessage = (event) => {
    const data = event.data || {};

    if (data.type === 'config') {
        if (typeof data.payload?.mode === 'string') {
            mode = data.payload.mode === 'vibration' ? 'vibration' : 'motion';
        }
        if (Number.isFinite(Number(data.payload?.trailSeconds))) {
            displayTrailSeconds = Math.max(1, Math.min(30, Number(data.payload.trailSeconds)));
        }
        if (Number.isFinite(Number(data.payload?.deadbandMg))) {
            deadbandMg = Math.max(0, Math.min(500, Number(data.payload.deadbandMg)));
        }
        if (Number.isFinite(Number(data.payload?.stationaryAccelThresholdMs2))) {
            stationaryAccelThresholdMs2 = Math.max(0.01, Math.min(4, Number(data.payload.stationaryAccelThresholdMs2)));
        }
        if (Number.isFinite(Number(data.payload?.stationaryGyroThresholdMdps))) {
            stationaryGyroThresholdMdps = Math.max(100, Math.min(50000, Number(data.payload.stationaryGyroThresholdMdps)));
        }
        if (Number.isFinite(Number(data.payload?.motionVelocityLeak))) {
            motionVelocityLeak = Math.max(0.999, Math.min(1, Number(data.payload.motionVelocityLeak)));
        }
        if (Number.isFinite(Number(data.payload?.vibrationVelocityLeak))) {
            vibrationVelocityLeak = Math.max(0.6, Math.min(0.999, Number(data.payload.vibrationVelocityLeak)));
        }
        if (Number.isFinite(Number(data.payload?.vibrationPositionLeak))) {
            vibrationPositionLeak = Math.max(0.6, Math.min(0.999, Number(data.payload.vibrationPositionLeak)));
        }
        if (Number.isFinite(Number(data.payload?.vibrationHighPassAlpha))) {
            vibrationHighPassAlpha = Math.max(0.5, Math.min(0.999, Number(data.payload.vibrationHighPassAlpha)));
        }
        if (data.payload?.reset === true) {
            resetState({ keepConfig: true });
        }
        emitState('config', { force: true });
        return;
    }

    if (data.type === 'transform') {
        orientationActive = Boolean(data.payload?.active);
        if (data.payload?.reset === true) {
            resetState({ keepConfig: true });
        }
        emitState('transform', { force: true });
        return;
    }

    if (data.type === 'batch') {
        processBatch(data.payload);
        return;
    }

    if (data.type === 'reset') {
        resetState({ keepConfig: true });
        emitState('reset', { force: true });
    }
};