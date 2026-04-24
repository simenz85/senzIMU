let ws = null;
let wsUrl = null;
let shouldReconnect = true;
let pingInterval = null;
let pongTimeout = null;
let decodePort = null;

const MAX_PENDING_BINARY_FRAMES = 12;
const MAX_INFLIGHT_BINARY_FRAMES = 4;
const DECODE_ACK_TIMEOUT_MS = 2000;
const WORKER_STATS_INTERVAL_MS = 100;

let pendingBinaryFrames = [];
let inflightBinaryFrames = 0;
let binaryFlushScheduled = false;
let droppedBinaryFrames = 0;
let directDecodePathEnabled = false;
let lastDecodeAckAt = 0;
let forwardedBinaryFrames = 0;
let forwardedBinaryBytes = 0;
let lastWorkerStatsSentAt = 0;

// Reconnect-Konfiguration
const RECONNECT_MIN_DELAY = 100; // 1 Sek
const RECONNECT_MAX_DELAY = 3000; // 3 Sek

// Heartbeat-Konfiguration
const PING_INTERVAL_MS = 3000;  // Alle 3 Sekunden Ping senden, um IDF Timeout zuvorzukommen
const PONG_WAIT_MS = 5000;      // 5 Sek warten auf Antwort

function log(...args) {
    console.log("[WS-WORKER]", ...args);
}

function clearBinaryForwardingState() {
    pendingBinaryFrames = [];
    inflightBinaryFrames = 0;
    binaryFlushScheduled = false;
}

function emitWorkerStats(extraPayload = {}, force = false) {
    const now = Date.now();
    if (!force && (now - lastWorkerStatsSentAt) < WORKER_STATS_INTERVAL_MS) {
        return;
    }

    lastWorkerStatsSentAt = now;
    postMessage({
        type: 'workerStats',
        payload: {
            droppedBinaryFrames,
            pendingBinaryFrames: pendingBinaryFrames.length,
            inflightBinaryFrames,
            forwardedBinaryFrames,
            forwardedBinaryBytes,
            directDecodePathEnabled,
            ...extraPayload,
        },
    });
}

function flushPendingFramesToMainThread() {
    while (pendingBinaryFrames.length > 0) {
        const frame = pendingBinaryFrames.shift();
        forwardedBinaryFrames += 1;
        forwardedBinaryBytes += frame.byteLength || 0;
        postMessage({ type: 'data', payload: frame }, [frame]);
    }
}

function disableDirectDecodePath(reason) {
    directDecodePathEnabled = false;
    clearBinaryForwardingState();
    flushPendingFramesToMainThread();
    emitWorkerStats({ fallbackReason: reason || 'unknown' }, true);
}

function flushBinaryFrames() {
    binaryFlushScheduled = false;

    if (!decodePort || !directDecodePathEnabled) {
        return;
    }

    if (inflightBinaryFrames >= MAX_INFLIGHT_BINARY_FRAMES && pendingBinaryFrames.length > 0) {
        const ackLagMs = Date.now() - lastDecodeAckAt;
        if (ackLagMs > DECODE_ACK_TIMEOUT_MS) {
            disableDirectDecodePath('decode-ack-timeout');
            return;
        }
    }

    while (inflightBinaryFrames < MAX_INFLIGHT_BINARY_FRAMES && pendingBinaryFrames.length > 0) {
        const frame = pendingBinaryFrames.shift();
        inflightBinaryFrames += 1;
        forwardedBinaryFrames += 1;
        forwardedBinaryBytes += frame.byteLength || 0;
        decodePort.postMessage(frame, [frame]);
    }

    emitWorkerStats();
}

function scheduleBinaryFlush() {
    if (binaryFlushScheduled) {
        return;
    }

    binaryFlushScheduled = true;
    setTimeout(flushBinaryFrames, 0);
}

function enqueueBinaryFrame(arrayBuffer) {
    if (!decodePort || !directDecodePathEnabled) {
        forwardedBinaryFrames += 1;
        forwardedBinaryBytes += arrayBuffer.byteLength || 0;
        postMessage({ type: 'data', payload: arrayBuffer }, [arrayBuffer]);
        return;
    }

    if (pendingBinaryFrames.length >= MAX_PENDING_BINARY_FRAMES) {
        pendingBinaryFrames.shift();
        droppedBinaryFrames += 1;
    }

    pendingBinaryFrames.push(arrayBuffer);
    scheduleBinaryFlush();
}

function attachDecodePort(port) {
    decodePort = port;
    directDecodePathEnabled = true;
    clearBinaryForwardingState();
    lastDecodeAckAt = Date.now();

    decodePort.onmessage = (event) => {
        if (event.data?.type === 'ack') {
            inflightBinaryFrames = Math.max(0, inflightBinaryFrames - 1);
            lastDecodeAckAt = Date.now();
            if (pendingBinaryFrames.length > 0) {
                scheduleBinaryFlush();
            }
            emitWorkerStats();
            return;
        }

        if (event.data?.type === 'decodeStats') {
            emitWorkerStats(event.data.payload, true);
            return;
        }

        if (event.data?.type === 'ready') {
            lastDecodeAckAt = Date.now();
            emitWorkerStats({ decodePortReady: true }, true);
        }
    };

    if (typeof decodePort.start === 'function') {
        decodePort.start();
    }
}

function connectWebSocket(url) {
    if (!shouldReconnect) return;
    log("Connecting to", url);
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        log("Connection opened");
        postMessage({ type: 'connected', payload: { url } });
        
        // Asynchrone Anforderung der IMU-Konfiguration erst NACHDEM der Handshake durch ist
        ws.send("get_config");

        // Starte Ping/Heartbeat alle 3 Sekunden
        startHeartbeat();
    };

    ws.onmessage = (event) => {
        resetPongTimeout();

        if (event.data instanceof ArrayBuffer) {
            enqueueBinaryFrame(event.data);
        } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
            event.data.arrayBuffer()
                .then((arrayBuffer) => {
                    enqueueBinaryFrame(arrayBuffer);
                })
                .catch((error) => {
                    console.error("[WS-WORKER] Failed to convert Blob payload:", error);
                    postMessage({ type: 'error', payload: 'Blob payload conversion failed' });
                });
        } else {
            if (typeof event.data === 'string') {
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed?.type === 'espStats') {
                        postMessage({ type: 'espStats', payload: parsed });
                        return;
                    }
                    if (parsed?.type === 'firmwareVer') {
                        postMessage({ type: 'firmwareVer', payload: parsed.version });
                        return;
                    }
                    if (parsed?.type === 'node_registered') {
                        postMessage({ type: 'node_registered', payload: parsed });
                        return;
                    }
                } catch (error) {
                }
            }

            postMessage({ type: 'data', payload: event.data });
        }
    };

    ws.onerror = (event) => {
        console.error("[WS-WORKER] WebSocket error:", event);
        postMessage({
            type: 'error',
            payload: {
                url,
                message: 'WebSocket error occurred',
                readyState: ws ? ws.readyState : null,
            },
        });
    };

    ws.onclose = (event) => {
        log(`Connection closed (code=${event.code}, reason="${event.reason}")`);
        postMessage({
            type: 'closed',
            payload: {
                url,
                code: event.code,
                reason: event.reason || '',
                wasClean: event.wasClean,
            },
        });

        stopHeartbeat(); // Stoppt Ping/Pong-Intervalle

        if (shouldReconnect && wsUrl) {
            const delay = RECONNECT_MIN_DELAY + Math.random() * (RECONNECT_MAX_DELAY - RECONNECT_MIN_DELAY);
            log(`Reconnecting in ${Math.round(delay)} ms...`);
            setTimeout(() => connectWebSocket(wsUrl), delay);
        }
    };
}

function startHeartbeat() {
    if (pingInterval) clearInterval(pingInterval);

    pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                // Sende explizites JSON PING. Der Handler im C++ Code ("COMMAND": "PING") ignoriert dies,
                // ABER es weckt den ESP-IDF Traffic auf und verhindert den 5-Sekunden Timeout absolut zuverlässig!
                ws.send(JSON.stringify({ "COMMAND": "PING" }));
            } catch (err) {
                console.error("[WS-WORKER] Failed to send ping:", err);
            }
        }
    }, PING_INTERVAL_MS);
}

function stopHeartbeat() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
    }
}

function startPongTimeout() {
    if (pongTimeout) clearTimeout(pongTimeout);
    pongTimeout = setTimeout(() => {
        console.warn("[WS-WORKER] Pong timeout — closing and reconnecting");
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(4000, "Pong timeout"); // eigener Code für Timeout
        }
    }, PONG_WAIT_MS);
}

function resetPongTimeout() {
    if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
    }
}

onmessage = function (event) {
    const { type, wsServerUrl, msgContent } = event.data;

    if (type === 'attachDecodePort') {
        const port = event.data.port ?? event.ports?.[0] ?? null;
        if (port) {
            attachDecodePort(port);
        } else {
            disableDirectDecodePath('missing-decode-port');
        }
        return;
    }

    if (type === 'connect') {
        log("Connect command received");
        wsUrl = wsServerUrl;
        shouldReconnect = true;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1000, "Switching connection");
        } else {
            connectWebSocket(wsUrl);
        }

    } else if (type === 'disconnect') {
        log("Disconnect command received");
        shouldReconnect = false;
        if (ws) {
            ws.close(1000, "Normal closure");
        }

    } else if (type === 'send') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(msgContent);
            log("Message sent:", msgContent);
        } else {
            console.warn("[WS-WORKER] Cannot send, WebSocket not open");
        }
    }
};
