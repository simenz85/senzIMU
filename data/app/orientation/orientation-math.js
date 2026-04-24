export function normalizeQuaternionXYZW(quaternion) {
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

export function getIdentityQuaternionXYZW() {
    return [0, 0, 0, 1];
}

export function isIdentityQuaternionXYZW(quaternion) {
    const normalizedQuaternion = normalizeQuaternionXYZW(quaternion);
    if (!normalizedQuaternion) {
        return false;
    }

    return Math.abs(normalizedQuaternion[0]) <= 1e-6
        && Math.abs(normalizedQuaternion[1]) <= 1e-6
        && Math.abs(normalizedQuaternion[2]) <= 1e-6
        && Math.abs(normalizedQuaternion[3] - 1) <= 1e-6;
}

export function convertQuaternionWXYZtoXYZW(quaternion) {
    if (!Array.isArray(quaternion) || quaternion.length < 4) {
        return null;
    }

    return normalizeQuaternionXYZW([quaternion[1], quaternion[2], quaternion[3], quaternion[0]]);
}

export function applyQuaternionXYZWToSample(sample, quaternion) {
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

export function multiplyQuaternionsXYZW(leftQuaternion, rightQuaternion) {
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

export function applyQuaternionWXYZToSample(sample, quaternion) {
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

export function applyReferenceToSample(sample, referenceState) {
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