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

        const plotHost = container.querySelector("#chart") || container.querySelector(".chart-plot-host") || container;
        this.chart = new uPlot(options, [[], []], plotHost);

        // Pause Button
        this.pauseBtn = container.querySelector("#pauseBtn") || container.querySelector("[id^='pauseBtn']");
        if (this.pauseBtn) {
            this.pauseBtn.onclick = () => {
                this.paused = !this.paused;
                this.pauseBtn.textContent = this.paused ? "Fortsetzen" : "Pause";
            };
        }

        // Reset Button
        const resetBtn = container.querySelector("#resetBtn") || document.getElementById("resetZoomBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                this.setPanOffset(0);
                this.chart.setScale("x", { min: null, max: null });
                this.chart.setScale("y", { min: null, max: null });
            });
        }

        // Maussteuerung
        this.#initYAxisOverlay();
        this.#initXAxisOverlay();
        this.#initZoomBox();
        this.#initTouchGestures();
    }

    setSensorCount(n) {
        const baseColors = [
            ["#4da6ff", "#0073e6", "#004d99"], // CH1 (Blautöne)
            ["#ff4a4a", "#cc0000", "#800000"], // CH2 (Rottöne)
            ["#50c878", "#228b22", "#006400"], // CH3 (Grüntöne)
            ["#ffd600", "#b39b00", "#665900"], // CH4 (Gelbtöne)
        ];

        let newSeries = [
            { label: "Zeit", value: (u, v) => v === null ? "-" : new Date(v * 1000).toLocaleTimeString() }
        ];

        for (let i = 0; i < n; i++) {
            const colors = baseColors[i % baseColors.length];
            newSeries.push({ label: `CH${i+1} X`, stroke: colors[0], width: 2, points: { show: false } });
            newSeries.push({ label: `CH${i+1} Y`, stroke: colors[1], width: 2, points: { show: false } });
            newSeries.push({ label: `CH${i+1} Z`, stroke: colors[2], width: 2, points: { show: false } });
        }

        // Neues Chart mit geänderten Optionen aufbauen (uPlot erlaubt dynamische Series nur via Re-Init oder .addSeries API in v1.6+)
        const opt = this.chart.axes ? Object.assign({}, this.chart.axes) : {};
        const oldOpts = this.chart;
        
        let newOpts = {
            title: "Live-Chart Multi-Channel",
            width: this.chart.width,
            height: this.chart.height,
            scales: { x: { time: true }, y: { range: [-100, 100] } },
            series: newSeries,
            cursor: { drag: { x: true, y: true, setScale: true } }
        };

        const parent = this.chart.root.parentNode;
        this.chart.destroy();
        this.chart = new uPlot(newOpts, Array(n * 3 + 1).fill().map(() => []), parent);
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
        const yOverlay = this.container.querySelector("#y-axis-overlay") || this.container.querySelector("[id$='y-axis-overlay']");
        if (!yOverlay) return;
        // Ensure overlays don't block touch gestures
        yOverlay.style.touchAction = "none";
        yOverlay.style.pointerEvents = "auto";
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

        // Touch-Unterstützung für Mobilgeräte (nur Y-Achse)
        let yTouchIsPanning = false;
        let yTouchLastPinchDist = 0;
        let yTouchLastY = 0;

        yOverlay.addEventListener("touchstart", e => {
            e.preventDefault();
            if (e.touches.length === 1) {
                yTouchIsPanning = true;
                yTouchLastY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                yTouchIsPanning = false;
                yTouchLastPinchDist = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
            }
        }, { passive: false });

        yOverlay.addEventListener("touchmove", e => {
            e.preventDefault();
            if (yTouchIsPanning && e.touches.length === 1) {
                const deltaY = yTouchLastY - e.touches[0].clientY;
                yTouchLastY = e.touches[0].clientY;
                this.#panAxis("y", deltaY, yOverlay.getBoundingClientRect().height);
            } else if (e.touches.length === 2) {
                const currentDist = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
                if (yTouchLastPinchDist > 0 && currentDist > 0) {
                    const factor = yTouchLastPinchDist / currentDist;
                    const center = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    const rect = yOverlay.getBoundingClientRect();
                    const pointerPos = (center - rect.top) / rect.height;
                    this.#zoomAxis("y", factor, pointerPos);
                }
                yTouchLastPinchDist = currentDist;
            }
        }, { passive: false });

        yOverlay.addEventListener("touchend", e => {
            if (e.touches.length === 1) {
                yTouchIsPanning = true;
                yTouchLastY = e.touches[0].clientY;
            } else if (e.touches.length === 0) {
                yTouchIsPanning = false;
            }
        });
    }

    #initXAxisOverlay() {
        const xOverlay = this.container.querySelector("#x-axis-overlay") || this.container.querySelector("[id$='x-axis-overlay']");
        if (!xOverlay) return;
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

        // Touch-Unterstützung für Mobilgeräte (nur X-Achse)
        let xTouchIsPanning = false;
        let xTouchLastPinchDist = 0;
        let xTouchLastX = 0;

        xOverlay.addEventListener("touchstart", e => {
            e.preventDefault();
            if (e.touches.length === 1) {
                xTouchIsPanning = true;
                xTouchLastX = e.touches[0].clientX;
            } else if (e.touches.length === 2) {
                xTouchIsPanning = false;
                xTouchLastPinchDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
            }
        }, { passive: false });

        xOverlay.addEventListener("touchmove", e => {
            e.preventDefault();
            if (xTouchIsPanning && e.touches.length === 1) {
                const deltaX = e.touches[0].clientX - xTouchLastX;
                xTouchLastX = e.touches[0].clientX;
                const scX = this.chart.scales.x;
                const range = scX.max - scX.min;
                const widthPx = xOverlay.getBoundingClientRect().width;
                const deltaSec = -(deltaX / widthPx) * range;
                this.panOffset += deltaSec;
                if (this.panOffset > 0) this.panOffset = 0;
                this.chart.setScale("x", { min: scX.min + deltaSec, max: scX.max + deltaSec });
            } else if (e.touches.length === 2) {
                const currentDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
                if (xTouchLastPinchDist > 0 && currentDist > 0) {
                    const factor = xTouchLastPinchDist / currentDist;
                    const center = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const rect = xOverlay.getBoundingClientRect();
                    const pointerPos = (center - rect.left) / rect.width;
                    this.#zoomAxis("x", factor, pointerPos);
                }
                xTouchLastPinchDist = currentDist;
            }
        }, { passive: false });

        xOverlay.addEventListener("touchend", e => {
            if (e.touches.length === 1) {
                xTouchIsPanning = true;
                xTouchLastX = e.touches[0].clientX;
            } else if (e.touches.length === 0) {
                xTouchIsPanning = false;
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

    #initTouchGestures() {
        // Touch events für das gesamte Chart-Overlay (freie 2D Translation & Skalierung)
        const plotEl = this.chart.over;
        if (!plotEl) return;
        plotEl.style.touchAction = "none";

        let isPinching = false;
        let isPanning = false;

        let initialDistance = 0;
        let lastMidX = 0;
        let lastMidY = 0;
        
        let lastPanX = 0;
        let lastPanY = 0;

        const handleTouchStart = (e) => {
            if (e.touches.length === 2) {
                e.preventDefault(); 
                isPinching = true;
                isPanning = false;
                
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialDistance = Math.hypot(dx, dy);
                lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            } else if (e.touches.length === 1) {
                e.preventDefault(); // Verhindert normales Browser-Scrollen und uPlot Default Selection
                isPinching = false;
                isPanning = true;
                lastPanX = e.touches[0].clientX;
                lastPanY = e.touches[0].clientY;
            }
        };

        const handleTouchMove = (e) => {
            if (isPinching && e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const currentDistance = Math.hypot(dx, dy);
                
                const currentMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const currentMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                if (initialDistance > 0 && currentDistance > 0) {
                    const factor = initialDistance / currentDistance;
                    const rect = plotEl.getBoundingClientRect();
                    const pointerPosX = (currentMidX - rect.left) / rect.width;
                    const pointerPosY = (currentMidY - rect.top) / rect.height;

                    this.chart.batch(() => {
                        this.#zoomAxis("x", factor, pointerPosX);
                        this.#zoomAxis("y", factor, pointerPosY);
                        
                        // Pan while pinch
                        const deltaX = currentMidX - lastMidX;
                        const deltaY = lastMidY - currentMidY; 
                        
                        // X Pan
                        const scX = this.chart.scales.x;
                        const rangeX = scX.max - scX.min;
                        const deltaSecX = -(deltaX / rect.width) * rangeX;
                        this.panOffset += deltaSecX;
                        if (this.panOffset > 0) this.panOffset = 0;
                        this.chart.setScale("x", { min: scX.min + deltaSecX, max: scX.max + deltaSecX });

                        // Y Pan
                        this.#panAxis("y", deltaY, rect.height);
                    });
                }
                
                initialDistance = currentDistance;
                lastMidX = currentMidX;
                lastMidY = currentMidY;
                
            } else if (isPanning && e.touches.length === 1) {
                e.preventDefault();
                const currentX = e.touches[0].clientX;
                const currentY = e.touches[0].clientY;
                
                const deltaX = currentX - lastPanX;
                const deltaY = lastPanY - currentY;
                
                const rect = plotEl.getBoundingClientRect();
                
                this.chart.batch(() => {
                    // X Pan
                    const scX = this.chart.scales.x;
                    const rangeX = scX.max - scX.min;
                    const deltaSecX = -(deltaX / rect.width) * rangeX;
                    this.panOffset += deltaSecX;
                    if (this.panOffset > 0) this.panOffset = 0;
                    this.chart.setScale("x", { min: scX.min + deltaSecX, max: scX.max + deltaSecX });

                    // Y Pan
                    this.#panAxis("y", deltaY, rect.height);
                });
                
                lastPanX = currentX;
                lastPanY = currentY;
            }
        };

        const handleTouchEnd = (e) => {
            if (e.touches.length < 2) {
                isPinching = false;
            }
            if (e.touches.length === 0) {
                isPanning = false;
            } else if (e.touches.length === 1 && !isPanning) {
                // Wenn von Pinch zu Pan gewechselt wird
                isPanning = true;
                lastPanX = e.touches[0].clientX;
                lastPanY = e.touches[0].clientY;
            }
        };

        plotEl.addEventListener("touchstart", handleTouchStart, { passive: false });
        plotEl.addEventListener("touchmove", handleTouchMove, { passive: false });
        plotEl.addEventListener("touchend", handleTouchEnd, { passive: false });
        plotEl.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    }
}

window.LiveChart = LiveChart;
