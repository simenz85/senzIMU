class WaterfallRenderer {
    constructor(containerId, canvasId, prefix = 'wf') {
        this.containerId = containerId;
        this.prefix = prefix;
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false });
        this.theme = 'fire';
        this.colorTable = this.createColorTable(this.theme);
        
        this.colCanvas = document.createElement('canvas');
        this.colCtx = this.colCanvas.getContext('2d', { willReadFrequently: true });
        this.colCanvas.width = 1;

        // Configuration
        this.maxMagnitude = 1000;
        this.scrollSpeed = 1;
        this.nyquistFreq = 3300; 
        this.maxDrawFreq = 3300; 
        
        this.active = true;
        
        // History buffer
        this.history = [];      // Array of Float32Array (mags)
        this.timestamps = [];   // Array of Numbers (device numerical seconds)
        this.timeStrings = [];  // Array of Strings (device format "MM:SS.ss")
        this.clockStrings = []; // Absolute Wall-Clock string ("HH:MM:SS.ss")
        this.maxHistory = 10000; // ~2.5 mins at 6.6kHz
        this.scrollOffset = 0;  // 0 = Live, >0 = Lookback

        // Interaction
        this.mouseX = -1;
        this.mouseY = -1;
        this.clientX = -1;
        this.clientY = -1;
        this.mouseHoverText = "";

        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this.hideTooltip());
        this.canvas.addEventListener('wheel', (e) => this.handleMouseWheel(e), { passive: false });
        
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'p' || e.key === 'P') && this.active && document.getElementById(this.containerId).style.display !== 'none') {
                this.downloadScreenshot();
            }
        });

        this.scrollbar = document.getElementById(`${this.prefix}Scrollbar`);
        this.scrollbarUpdating = false;
        if (this.scrollbar) {
            this.scrollbar.addEventListener('input', (e) => {
                if (this.scrollbarUpdating) return;
                const visibleCols = Math.ceil(this.canvas.width / this.scrollSpeed);
                const maxScroll = Math.max(0, this.history.length - visibleCols);
                this.scrollOffset = maxScroll - parseInt(this.scrollbar.value, 10);
                this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
                this.renderHistory();
                this.updateLabels();
            });
        }
    }

    clear() {
        this.history = [];
        this.timestamps = [];
        this.timeStrings = [];
        this.clockStrings = [];
        this.scrollOffset = 0;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.updateLabels();
        if (this.scrollbar) {
            this.scrollbarUpdating = true;
            this.scrollbar.value = 0;
            this.scrollbar.max = 0;
            this.scrollbarUpdating = false;
        }
    }
    syncScrollbar() {
        if (!this.scrollbar) return;
        const visibleCols = Math.ceil(this.canvas.width / this.scrollSpeed);
        const maxScroll = Math.max(0, this.history.length - visibleCols);
        
        this.scrollbarUpdating = true;
        this.scrollbar.max = maxScroll;
        this.scrollbar.value = maxScroll - this.scrollOffset;
        
        if (maxScroll > 0) {
            this.scrollbar.style.opacity = '1';
            this.scrollbar.style.pointerEvents = 'auto';
        } else {
            this.scrollbar.style.opacity = '0';
            this.scrollbar.style.pointerEvents = 'none';
        }
        this.scrollbarUpdating = false;
    }

    setTheme(themeName) {
        this.theme = themeName;
        this.colorTable = this.createColorTable(themeName);
        this.renderHistory();
        
        let gradient = 'linear-gradient(to right, black, red, orange, yellow, white)';
        if (themeName === 'ocean') gradient = 'linear-gradient(to right, black, darkblue, deepskyblue, lightcyan)';
        else if (themeName === 'mono') gradient = 'linear-gradient(to right, black, gray, white)';
        else if (themeName === 'matrix') gradient = 'linear-gradient(to right, black, darkgreen, lime, white)';
        else if (themeName === 'plasma') gradient = 'linear-gradient(to right, black, purple, red, yellow)';
        else if (themeName === 'magma') gradient = 'linear-gradient(to right, black, darkred, orange, white)';

        const colorBar = document.getElementById(`${this.prefix}ColorBar`);
        if (colorBar) colorBar.style.background = gradient;
        
        this.refreshCursorData();
    }
    
    setScrollSpeed(speed) {
        this.scrollSpeed = Math.max(1, Math.min(10, speed));
        this.renderHistory();
    }
    
    setFrequencyBounds(nyquist, maxDraw) {
        this.nyquistFreq = Math.max(1, nyquist);
        this.maxDrawFreq = Math.max(1, Math.min(nyquist, maxDraw));
        this.renderHistory();
    }
    
    getCrosshairColor() {
        if (this.theme === 'ocean') return 'rgba(255, 214, 0, 0.8)';
        if (this.theme === 'mono') return 'rgba(255, 50, 50, 0.8)';
        if (this.theme === 'matrix') return 'rgba(255, 255, 255, 0.8)';
        if (this.theme === 'plasma') return 'rgba(0, 255, 255, 0.8)';
        if (this.theme === 'magma') return 'rgba(0, 255, 255, 0.8)';
        return 'rgba(0, 255, 255, 0.8)';
    }

    createColorTable(themeName) {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let v = i / 255.0;
            let r = 0, g = 0, b = 0;
            
            if (themeName === 'ocean') {
                if (v < 0.33) b = Math.min(255, v * 3 * 255);
                else if (v < 0.66) { b = 255; g = Math.min(255, (v - 0.33) * 3 * 255); }
                else { b = Math.max(0, 255 - (v - 0.66) * 3 * 255); g = 255; r = Math.min(255, (v - 0.66) * 3 * 255); }
            } else if (themeName === 'mono') {
                r = g = b = Math.floor(v * 255);
            } else if (themeName === 'matrix') {
                if (v < 0.25) { g = Math.min(255, v * 4 * 128); }
                else if (v < 0.75) { g = Math.min(255, 128 + (v - 0.25) * 2 * 127); }
                else { g = 255; r = b = Math.min(255, (v - 0.75) * 4 * 255); }
            } else if (themeName === 'plasma') {
                if (v < 0.33) { r = Math.min(255, v * 3 * 128); b = Math.min(255, v * 3 * 128); }
                else if (v < 0.66) { r = Math.min(255, 128 + (v - 0.33) * 3 * 127); b = Math.max(0, 128 - (v - 0.33) * 3 * 128); }
                else { r = 255; g = Math.min(255, (v - 0.66) * 3 * 255); }
            } else if (themeName === 'magma') {
                if (v < 0.33) { r = Math.min(255, v * 3 * 180); }
                else if (v < 0.66) { r = Math.min(255, 180 + (v - 0.33) * 3 * 75); g = Math.min(255, (v - 0.33) * 3 * 200); }
                else { r = 255; g = Math.min(255, 200 + (v - 0.66) * 3 * 55); b = Math.min(255, (v - 0.66) * 3 * 255); }
            } else {
                if (v < 0.25) r = Math.min(255, v * 4 * 255);
                else if (v < 0.5) { r = 255; g = Math.min(255, (v - 0.25) * 4 * 128); }
                else if (v < 0.75) { r = 255; g = Math.min(255, 128 + (v - 0.5) * 4 * 127); }
                else { r = 255; g = 255; b = Math.min(255, (v - 0.75) * 4 * 255); }
            }
            table[i] = (255 << 24) | (Math.floor(b) << 16) | (Math.floor(g) << 8) | Math.floor(r);
        }
        return table;
    }

    setMaxMagnitude(val) {
        this.maxMagnitude = val > 0 ? val : 1;
        this.renderHistory();
    }

    resize(width, height) {
        width = Math.max(1, width);
        height = Math.max(1, height);

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.colCanvas.height = height;

            this.ctx.fillStyle = "black";
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            if (this.history.length > 0) this.renderHistory();
            this.syncScrollbar();
        }
    }

    handleMouseWheel(e) {
        if (!this.history.length) return;
        e.preventDefault(); 
        
        const direction = Math.sign(e.deltaY);
        this.scrollOffset += direction * 30; // 30 Frames per wheel tick
        
        const visibleCols = Math.ceil(this.canvas.width / this.scrollSpeed);
        const maxScroll = Math.max(0, this.history.length - visibleCols);
        
        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
        
        this.renderHistory();
        this.updateLabels();
        this.syncScrollbar();
    }

    returnToLive() {
        this.scrollOffset = 0;
        this.renderHistory();
        this.updateLabels();
        this.syncScrollbar();
    }

    downloadScreenshot() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        const graphH = this.canvas.height;
        const barH = 28;
        tempCanvas.height = graphH + barH;
        
        const ctx = tempCanvas.getContext('2d');
        const imgData = ctx.createImageData(tempCanvas.width, graphH);
        const buf32 = new Uint32Array(imgData.data.buffer);
        
        // Custom color table with alpha transparency for the noise floor
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let v = i / 255.0;
            
            // FADEOUT NOISE FLOOR TO TRANSPARENT
            let a = 255;
            if (v < 0.15) {
                a = Math.floor((v / 0.15) * 255);
            }
            
            // Extract r, g, b from the currently active colorTable
            const baseColor = this.colorTable[i];
            const r = baseColor & 0xFF;
            const g = (baseColor >> 8) & 0xFF;
            const b = (baseColor >> 16) & 0xFF;
            
            table[i] = (a << 24) | (b << 16) | (g << 8) | r;
        }

        const visibleCols = Math.ceil(tempCanvas.width / this.scrollSpeed);
        const startIdx = Math.max(0, this.history.length - visibleCols - this.scrollOffset);
        const endIdx = this.history.length - 1 - this.scrollOffset;
        
        buf32.fill(0); // Transparent fill
        
        let targetX = tempCanvas.width - 1;
        for (let i = endIdx; i >= startIdx; i--) {
            const mags = this.history[i];
            if (!mags) continue;
            
            for (let w = 0; w < this.scrollSpeed; w++) {
                if (targetX < 0) break;
                for (let y = 0; y < graphH; y++) {
                    const ratio = 1.0 - (y / graphH);
                    const currentFreq = ratio * this.maxDrawFreq;
                    const mapIdx = Math.floor((currentFreq / this.nyquistFreq) * mags.length);
                    
                    if (mapIdx >= 0 && mapIdx < mags.length) {
                        const mag = mags[mapIdx];
                        let v = mag / this.maxMagnitude;
                        v = Math.max(0, Math.min(1, v));
                        const cIndex = Math.floor(v * 255);
                        
                        const pxIdx = y * tempCanvas.width + targetX;
                        buf32[pxIdx] = table[cIndex];
                    }
                }
                targetX--;
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        
        // Timeline Bar Background
        ctx.fillStyle = 'rgba(16, 20, 26, 0.95)';
        ctx.fillRect(0, graphH, tempCanvas.width, barH);
        
        ctx.font = 'bold 12px monospace';
        
        // Y-Axis Overlay
        const yLabels = [
            { t: `${Math.round(this.maxDrawFreq)} Hz`, y: 10, align: 'top' },
            { t: `${Math.round(this.maxDrawFreq/2)} Hz`, y: graphH/2 - 6, align: 'top' },
            { t: `0 Hz`, y: graphH - 10, align: 'bottom' }
        ];

        for (let l of yLabels) {
            ctx.textBaseline = l.align;
            const textW = ctx.measureText(l.t).width;
            
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 0;
            let boxY = l.align === 'bottom' ? l.y - 14 : l.y;
            ctx.fillRect(8, boxY, textW + 8, 16);
            
            ctx.fillStyle = '#FFD600';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(l.t, 12, l.y + (l.align === 'top' ? 2 : -2));
        }
        
        // X-Axis Overlay (Timeline)
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFD600';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 0; // Better readability for the bottom bar
        const midIdx = Math.floor((startIdx + endIdx) / 2);
        const tLeft = this.clockStrings[startIdx] || "";
        const tMid = this.clockStrings[midIdx] || "";
        const tRight = this.clockStrings[endIdx] || "";
        ctx.fillText(tLeft, 40, graphH + barH / 2);
        ctx.fillText(tMid, tempCanvas.width / 2, graphH + barH / 2);
        ctx.textAlign = 'right';
        ctx.fillText(tRight, tempCanvas.width - 20, graphH + barH / 2);
        
        // Crosshair and Hover Text
        if (this.mouseX >= 0 && this.mouseY >= 0 && this.mouseHoverText) {
            const crossColor = this.getCrosshairColor();
            
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.moveTo(0, this.mouseY);
            ctx.lineTo(tempCanvas.width, this.mouseY);
            ctx.moveTo(this.mouseX, 0);
            ctx.lineTo(this.mouseX, graphH);
            ctx.strokeStyle = crossColor;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.font = 'bold 12px monospace';
            const ttWidth = ctx.measureText(this.mouseHoverText).width;
            
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            ctx.shadowBlur = 0;
            ctx.fillRect(this.mouseX + 4, this.mouseY - 24, ttWidth + 8, 18);
            
            ctx.fillStyle = '#FFD600';
            ctx.shadowColor = 'rgba(0,0,0,1)';
            ctx.shadowBlur = 4;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(this.mouseHoverText, this.mouseX + 8, this.mouseY - 8);
        }
        
        // Legend in Screenshot
        const lX = tempCanvas.width - 160;
        const lY = graphH - 35; 
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(lX, lY, 145, 22);
        
        ctx.font = 'bold 11px monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#FFD600';
        ctx.fillText("0", lX + 8, lY + 11);
        
        // Draw the gradient using the active color table
        for (let i = 0; i < 80; i++) {
            const tableIdx = Math.floor((i / 79) * 255);
            const col = this.colorTable[tableIdx];
            const r = col & 0xFF;
            const g = (col >> 8) & 0xFF;
            const b = (col >> 16) & 0xFF;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(lX + 22 + i, lY + 6, 1, 10);
        }
        
        ctx.textAlign = 'right';
        ctx.fillStyle = '#FFD600';
        ctx.fillText(this.maxMagnitude.toString(), lX + 138, lY + 11);

        const link = document.createElement('a');
        link.download = `SenzIMU_Spectrogram_${Date.now()}.png`;
        link.href = tempCanvas.toDataURL("image/png");
        link.click();
    }

    handleMouseMove(e) {
        if (!this.history.length) return;
        this.clientX = e.clientX;
        this.clientY = e.clientY;
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        this.refreshCursorData();
    }
    
    refreshCursorData() {
        if (this.mouseX < 0 || this.mouseY < 0 || !this.history.length) return;
        
        const ratio = 1.0 - (this.mouseY / this.canvas.height);
        const hz = (ratio * this.maxDrawFreq).toFixed(1);
        
        const latestIdx = this.history.length - 1 - this.scrollOffset;
        const colDelta = Math.floor((this.canvas.width - this.mouseX) / this.scrollSpeed);
        const histIdx = Math.max(0, latestIdx - colDelta);
        const cursorStrTime = this.clockStrings[histIdx] || "";
        
        this.mouseHoverText = `${hz} Hz  |  ${cursorStrTime}`;
        this.showTooltip(this.clientX, this.clientY, this.mouseHoverText);
        
        const wfCrossV = document.getElementById(`${this.prefix}CrossV`);
        const wfCrossH = document.getElementById(`${this.prefix}CrossH`);
        if (wfCrossV && wfCrossH) {
            const crossColor = this.getCrosshairColor();
            wfCrossV.style.display = 'block';
            wfCrossH.style.display = 'block';
            wfCrossV.style.left = (this.mouseX + 8) + 'px';
            wfCrossH.style.top = (this.mouseY + 8) + 'px';
            wfCrossV.style.borderLeftColor = crossColor;
            wfCrossH.style.borderTopColor = crossColor;
            wfCrossV.style.background = crossColor.replace('0.8', '0.2');
            wfCrossH.style.background = crossColor.replace('0.8', '0.2');
        }
    }
    
    showTooltip(x, y, text) {
        let tt = document.getElementById(`${this.prefix}HoverTooltip`);
        if (!tt) {
            tt = document.createElement('div');
            tt.id = `${this.prefix}HoverTooltip`;
            tt.style.position = 'fixed';
            tt.style.pointerEvents = 'none';
            tt.style.background = 'rgba(0,0,0,0.85)';
            tt.style.color = '#FFD600';
            tt.style.padding = '5px 10px';
            tt.style.borderRadius = '6px';
            tt.style.fontSize = '12px';
            tt.style.fontFamily = 'monospace';
            tt.style.fontWeight = 'bold';
            tt.style.zIndex = '9999';
            tt.style.border = '1px solid rgba(255, 214, 0, 0.5)';
            tt.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
            document.body.appendChild(tt);
        }
        tt.style.display = 'block';
        tt.style.left = (x + 15) + 'px';
        tt.style.top = (y + 15) + 'px';
        tt.textContent = text;
    }
    
    hideTooltip() {
        this.mouseX = -1;
        this.mouseY = -1;
        this.clientX = -1;
        this.clientY = -1;
        this.mouseHoverText = "";
        
        const tt = document.getElementById(`${this.prefix}HoverTooltip`);
        if (tt) tt.style.display = 'none';
        
        const wfCrossV = document.getElementById(`${this.prefix}CrossV`);
        const wfCrossH = document.getElementById(`${this.prefix}CrossH`);
        if (wfCrossV) wfCrossV.style.display = 'none';
        if (wfCrossH) wfCrossH.style.display = 'none';
    }

    renderHistory() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (w === 0 || h === 0 || this.history.length === 0) return;
        
        const s = this.scrollSpeed;
        const imgData = this.ctx.createImageData(w, h);
        const data32 = new Uint32Array(imgData.data.buffer);
        
        // Fill block black
        data32.fill((255 << 24)); 
        
        const cropRatio = Math.min(1.0, this.maxDrawFreq / this.nyquistFreq);
        const latestIdx = this.history.length - 1 - this.scrollOffset;
        let colDrawCount = 0;
        
        // Draw from right to left
        for (let x = w - 1; x >= 0; x -= s) {
            const histIdx = latestIdx - colDrawCount;
            if (histIdx < 0) break;
            
            const mags = this.history[histIdx];
            const binsToDraw = Math.max(1, Math.floor(mags.length * cropRatio));
            
            for (let y = 0; y < h; y++) {
                const normalizedY = 1.0 - (y / h); 
                const binIndex = Math.floor(normalizedY * binsToDraw);
                const mag = mags[Math.min(mags.length - 1, binIndex)] || 0;
                
                const intensity = Math.max(0, Math.min(255, Math.floor((mag / this.maxMagnitude) * 255)));
                const color = this.colorTable[intensity];
                
                for (let sx = 0; sx < s; sx++) {
                    const drawX = x - sx;
                    if (drawX >= 0) {
                       data32[y * w + drawX] = color;
                    }
                }
            }
            colDrawCount++;
        }
        this.ctx.putImageData(imgData, 0, 0);
    }

    updateLabels() {
        const wfSpan = document.getElementById(`${this.prefix}LblSpan`);
        const wfPos = document.getElementById(`${this.prefix}LblPos`);
        const wfBtn = document.getElementById(`${this.prefix}BtnLive`);
        
        if (!wfSpan || !wfPos || !this.history.length) return;
        
        const s = this.scrollSpeed;
        const visibleCols = Math.ceil(this.canvas.width / s);
        
        const rightIdx = Math.max(0, this.history.length - 1 - this.scrollOffset);
        const leftIdx = Math.max(0, rightIdx - visibleCols + 1);
        const midIdx = Math.floor((leftIdx + rightIdx) / 2);
        
        const tEnd = this.timestamps[rightIdx];
        const tStart = this.timestamps[leftIdx];
        const diffSpan = Math.abs(tEnd - tStart);
        wfSpan.textContent = `Fenster: ~${diffSpan.toFixed(1)} s`;
        
        if (this.scrollOffset === 0) {
            wfPos.textContent = "Pos: LIVE";
            wfPos.style.color = "#4caf50";
            if (wfBtn) wfBtn.style.display = "none";
        } else {
            const liveEnd = this.timestamps[this.history.length - 1];
            const lookback = liveEnd - tEnd;
            wfPos.textContent = `Scroll: -${lookback.toFixed(1)} s`;
            wfPos.style.color = "#FFD600";
            if (wfBtn) wfBtn.style.display = "inline-block";
        }
        
        const lblLeft = document.getElementById(`${this.prefix}LblTimeLeft`);
        const lblMid = document.getElementById(`${this.prefix}LblTimeMid`);
        const lblRight = document.getElementById(`${this.prefix}LblTimeRight`);
        
        if (lblLeft) lblLeft.textContent = this.clockStrings[leftIdx] || '';
        if (lblMid) lblMid.textContent = this.clockStrings[midIdx] || '';
        if (lblRight) lblRight.textContent = this.clockStrings[rightIdx] || '';
        
        const lblYMax = document.getElementById(`${this.prefix}LblMax`);
        const lblYMid = document.getElementById(`${this.prefix}LblMid`);
        if (lblYMax) lblYMax.textContent = `${Math.round(this.maxDrawFreq)} Hz`;
        if (lblYMid) lblYMid.textContent = `${Math.round(this.maxDrawFreq / 2)} Hz`;
    }

    pushData(mags, optTsNum, optTsString, optClockTimeStr) {
        if (!mags || mags.length === 0) return;
        
        let tsString;
        let tsNum;

        if (optTsNum !== undefined && optTsString !== undefined) {
            tsNum = optTsNum;
            tsString = optTsString;
        } else {
            // Read timestamp from DOM
            let tsEl = document.getElementById('timestamp');
            tsString = tsEl ? tsEl.textContent : "0.00";
            let parts = tsString.split(':');
            tsNum = 0;
            if (parts.length === 3) tsNum = parseInt(parts[0], 10)*3600 + parseInt(parts[1], 10)*60 + parseFloat(parts[2]);
            else if (parts.length === 2) tsNum = parseInt(parts[0], 10)*60 + parseFloat(parts[1]);
            else tsNum = parseFloat(parts[0]) || 0;
        }
        
        let clockTime = optClockTimeStr;
        if (!clockTime) {
            const now = new Date();
            const hh = now.getHours().toString().padStart(2, '0');
            const mm = now.getMinutes().toString().padStart(2, '0');
            const ss = now.getSeconds().toString().padStart(2, '0');
            const ms = now.getMilliseconds().toString().padStart(3, '0');
            clockTime = `${hh}:${mm}:${ss}.${ms}`;
        }
        
        // 1. Buffer incoming data
        this.history.push(new Float32Array(mags));
        this.timestamps.push(tsNum);
        this.timeStrings.push(tsString);
        this.clockStrings.push(clockTime);
        
        if (this.scrollOffset > 0) {
            this.scrollOffset++;
        }
        
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.timestamps.shift();
            this.timeStrings.shift();
            this.clockStrings.shift();
            
            if (this.scrollOffset > 0) {
                this.scrollOffset--;
            }
        }

        // 2. If scrolled away or tab is hidden, do not paint it live
        if (this.scrollOffset > 0 || !this.active) {
            if (this.active) {
                this.updateLabels();
                this.syncScrollbar();
            }
            return;
        }
        
        // 3. Live Drawing Fast-Mode
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (w === 0 || h === 0) return;

        const s = this.scrollSpeed;
        if (w > s) {
            this.ctx.drawImage(this.canvas, s, 0, w - s, h, 0, 0, w - s, h);
        }

        const imgData = this.colCtx.createImageData(1, h);
        const data32 = new Uint32Array(imgData.data.buffer);
        const cropRatio = Math.min(1.0, this.maxDrawFreq / this.nyquistFreq);
        const binsToDraw = Math.max(1, Math.floor(mags.length * cropRatio));

        for (let y = 0; y < h; y++) {
            const normalizedY = 1.0 - (y / h); 
            const binIndex = Math.floor(normalizedY * binsToDraw);
            const mag = mags[Math.min(mags.length - 1, binIndex)] || 0;
            
            const intensity = Math.max(0, Math.min(255, Math.floor((mag / this.maxMagnitude) * 255)));
            data32[y] = this.colorTable[intensity];
        }

        this.colCtx.putImageData(imgData, 0, 0);
        this.ctx.drawImage(this.colCanvas, 0, 0, 1, h, w - s, 0, s, h);
        
        if (this.mouseX >= 0 && this.mouseY >= 0) {
            this.refreshCursorData();
        }
        
        this.updateLabels();
        this.syncScrollbar();
    }
}

window.WaterfallRenderer = WaterfallRenderer;
