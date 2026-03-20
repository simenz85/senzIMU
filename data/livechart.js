class LiveChart {
    constructor(container, userOptions = {}) {
        this.container = container;
        this.maxPoints = userOptions.maxPoints || 300;
        this.panOffset = 0;
        this.paused = false;

        // Chart-Setup
        const options = {
            title: userOptions.title || "Live-Chart",
            width: userOptions.width || 900,
            height: userOptions.height || 500,
            scales: {
                x: { time: true },
                y: { range: userOptions.yRange || [0, 100] }
            },
            series: userOptions.series || [
                { label: "Zeit", value: (u, v) => v === null ? "-" : new Date(v * 1000).toLocaleTimeString() },
                { label: "Wert", stroke: userOptions.color || "blue", width: 2 }
            ],
            cursor: { drag: { x: true, y: true, setScale: true } },
        };

        this.chart = new uPlot(options, [[], []], container.querySelector("#chart"));

        // Pause Button
        this.pauseBtn = container.querySelector("#pauseBtn");
        this.pauseBtn.onclick = () => {
            this.paused = !this.paused;
            this.pauseBtn.textContent = this.paused ? "Fortsetzen" : "Pause";
        };

        // Reset Button
        container.querySelector("#resetBtn").addEventListener("click", () => {
            this.setPanOffset(0);
            this.chart.setScale("x", { min: null, max: null });
            this.chart.setScale("y", { min: null, max: null });
        });

        // Maussteuerung
        this.#initYAxisOverlay();
        this.#initXAxisOverlay();
        this.#initZoomBox();
    }

    /**
     * Kompletten Datensatz ins Chart setzen.
     * @param {Array[]} allSeriesArray - Array wie [x[], y1[], y2[], ...]
     */
    setData(allSeriesArray) {
        if (this.paused) return;

        // ggf. auf maxPoints beschränken
        if (this.maxPoints && allSeriesArray[0].length > this.maxPoints) {
            allSeriesArray = allSeriesArray.map(series =>
                series.slice(series.length - this.maxPoints)
            );
        }

        this.chart.setData(allSeriesArray);

        // für Live-Pan-Handling
        const latestTimestamp = allSeriesArray[allSeriesArray.length - 1];
        window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp } }));
    }

    getPanOffset() { return this.panOffset; }
    setPanOffset(offset) { this.panOffset = offset; }

    // === Private Helfer ===
    #zoomAxis(axis, factor, pointerPos) {
        const sc = this.chart.scales[axis];
        const range = sc.max - sc.min;
        const newRange = range * factor;
        const newMin = sc.min + range * pointerPos - newRange * pointerPos;
        const newMax = newMin + newRange;
        if (newMax - newMin < 1e-9) return;
        this.chart.setScale(axis, { min: newMin, max: newMax });
    }

    #panAxis(axis, deltaPx, axisPxLength) {
        if (axisPxLength === 0) return;
        const sc = this.chart.scales[axis];
        const range = sc.max - sc.min;
        const delta = -(deltaPx / axisPxLength) * range;
        this.chart.setScale(axis, { min: sc.min + delta, max: sc.max + delta });
    }

    #updateCursor(el, dragging, canDrag) {
        if (dragging) {
            el.style.cursor = "grabbing";
        } else {
            el.style.cursor = canDrag ? (el.id === "y-axis-overlay" ? "ns-resize" : "ew-resize") : "default";
        }
    }

    #initYAxisOverlay() {
        const yOverlay = this.container.querySelector("#y-axis-overlay");
        let isPanning = false;
        let lastY = 0;

        yOverlay.addEventListener("wheel", e => {
            e.preventDefault();
            const rect = yOverlay.getBoundingClientRect();
            const pointerPos = (e.clientY - rect.top) / rect.height;
            const factor = e.deltaY < 0 ? 0.85 : 1.15;
            this.#zoomAxis("y", factor, pointerPos);
        }, { passive: false });

        yOverlay.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            e.preventDefault();
            isPanning = true;
            lastY = e.clientY;
            this.#updateCursor(yOverlay, true, true);
        });

        window.addEventListener("mousemove", e => {
            if (!isPanning) return;
            e.preventDefault();
            const deltaY = lastY - e.clientY;
            lastY = e.clientY;
            this.#panAxis("y", deltaY, yOverlay.getBoundingClientRect().height);
        });

        window.addEventListener("mouseup", e => {
            if (isPanning) {
                isPanning = false;
                this.#updateCursor(yOverlay, false, true);
            }
        });

        yOverlay.addEventListener("mouseenter", () => !isPanning && this.#updateCursor(yOverlay, false, true));
        yOverlay.addEventListener("mouseleave", () => !isPanning && this.#updateCursor(yOverlay, false, false));
    }

    #initXAxisOverlay() {
        const xOverlay = this.container.querySelector("#x-axis-overlay");
        let isPanning = false;
        let lastX = 0;

        xOverlay.addEventListener("wheel", e => {
            e.preventDefault();
            const rect = xOverlay.getBoundingClientRect();
            const pointerPos = (e.clientX - rect.left) / rect.width;
            const factor = e.deltaY < 0 ? 0.85 : 1.15;
            this.#zoomAxis("x", factor, pointerPos);
        }, { passive: false });

        xOverlay.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            e.preventDefault();
            isPanning = true;
            lastX = e.clientX;
            this.#updateCursor(xOverlay, true, true);
        });

        window.addEventListener("mousemove", e => {
            if (!isPanning) return;
            e.preventDefault();
            const deltaX = e.clientX - lastX;
            lastX = e.clientX;

            const scX = this.chart.scales.x;
            const range = scX.max - scX.min;
            const widthPx = xOverlay.getBoundingClientRect().width;
            const deltaSec = -(deltaX / widthPx) * range;

            this.panOffset += deltaSec;
            if (this.panOffset > 0) this.panOffset = 0;

            this.chart.setScale("x", {
                min: scX.min + deltaSec,
                max: scX.max + deltaSec
            });
        });

        window.addEventListener("mouseup", e => {
            if (isPanning) {
                isPanning = false;
                this.#updateCursor(xOverlay, false, true);
            }
        });

        xOverlay.addEventListener("mouseenter", () => !isPanning && this.#updateCursor(xOverlay, false, true));
        xOverlay.addEventListener("mouseleave", () => !isPanning && this.#updateCursor(xOverlay, false, false));

        window.addEventListener("liveDataUpdate", (e) => {
            const latest = e.detail.latestTimestamp;
            const visibleRange = this.chart.scales.x.max - this.chart.scales.x.min;
            if (this.panOffset > -0.5) {
                this.panOffset = 0;
                this.chart.setScale("x", { min: latest - visibleRange, max: latest });
            } else {
                this.chart.setScale("x", {
                    min: latest - visibleRange + this.panOffset,
                    max: latest + this.panOffset
                });
            }
        });
    }

    #initZoomBox() {
        let zoomBoxing = false;
        let zoomStart = null;
        this.chart.over.addEventListener("contextmenu", e => e.preventDefault());
        this.chart.over.addEventListener("mousedown", e => {
            if (e.button === 2) {
                zoomBoxing = true;
                zoomStart = { x: e.offsetX, y: e.offsetY };
                this.chart.over.style.cursor = "crosshair";
            }
        });
        this.chart.over.addEventListener("mouseup", e => {
            if (e.button === 2 && zoomBoxing) {
                zoomBoxing = false;
                this.chart.over.style.cursor = "";
                const xMin = this.chart.posToVal(Math.min(zoomStart.x, e.offsetX), "x");
                const xMax = this.chart.posToVal(Math.max(zoomStart.x, e.offsetX), "x");
                const yMin = this.chart.posToVal(Math.max(zoomStart.y, e.offsetY), "y");
                const yMax = this.chart.posToVal(Math.min(zoomStart.y, e.offsetY), "y");
                if (xMax > xMin && yMax > yMin) {
                    this.chart.setScale("x", { min: xMin, max: xMax });
                    this.chart.setScale("y", { min: yMin, max: yMax });
                }
            }
        });

        this.chart.over.addEventListener("dblclick", () => {
            this.setPanOffset(0);
            this.chart.setScale("x", { auto: true });
            this.chart.setScale("y", { auto: true });
        });
    }
}

window.LiveChart = LiveChart;
