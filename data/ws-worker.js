let ws = null;
let wsUrl = null;
let shouldReconnect = true;
let pingInterval = null;
let pongTimeout = null;

// Reconnect-Konfiguration
const RECONNECT_MIN_DELAY = 100; // 1 Sek
const RECONNECT_MAX_DELAY = 3000; // 3 Sek

// Heartbeat-Konfiguration
const PING_INTERVAL_MS = 20000; // 20 Sekunden
const PONG_WAIT_MS = 5000;      // 5 Sek warten auf Antwort

function log(...args) {
    console.log("[WS-WORKER]", ...args);
}

function connectWebSocket(url) {
    log("Connecting to", url);
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        log("Connection opened");
        postMessage({ type: 'connected' });

        // Starte Ping/Heartbeat
        //startHeartbeat();
    };

    ws.onmessage = (event) => {
        resetPongTimeout();

        if (event.data instanceof ArrayBuffer) {
            postMessage({ type: 'data', payload: event.data }, [event.data]);
        } else {
            postMessage({ type: 'data', payload: event.data });
        }
    };

    ws.onerror = (event) => {
        console.error("[WS-WORKER] WebSocket error:", event);
        postMessage({ type: 'error', payload: 'WebSocket error occurred' });
    };

    ws.onclose = (event) => {
        log(`Connection closed (code=${event.code}, reason="${event.reason}")`);
        postMessage({ type: 'closed' });

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
                // Text-Ping senden (Server-spezifisch)
                ws.send("ping");
                // Timeout setzen, falls kein Pong/Nachricht kommt
                startPongTimeout();
                // log("Ping sent");
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
        if (ws && ws.readyState === WebSocket.OPEN) {
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
