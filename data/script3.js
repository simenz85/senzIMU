/********************************************************************
 * RINGBUFFER-KLASSEN
 ********************************************************************/
class RingBuffer {
  constructor(size, ArrayType = Float32Array) {
    this.size = size;
    this.buffer = new ArrayType(size);
    this.index = 0;
    this.length = 0;
  }
  push(value) {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.length < this.size) this.length++;
  }
  toArray() {
    if (this.length < this.size) return Array.from(this.buffer.slice(0, this.length));
    const out = new this.buffer.constructor(this.length);
    out.set(this.buffer.subarray(this.index));
    out.set(this.buffer.subarray(0, this.index), this.size - this.index);
    return Array.from(out);
  }
}

class MultiRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.index = 0;
    this.size = 0;
  }

  push(sample) {
    this.buffer[this.index] = sample; // sample = { time, x, y, z }
    this.index = (this.index + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  pushMany(samples) {
    for (const s of samples) this.push(s);
  }

  getLast(n) {
    const count = Math.min(n, this.size);
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      const idx = (this.index - count + i + this.capacity) % this.capacity;
      result[i] = this.buffer[idx];
    }
    return result;
  }

  // optional: columns extrahieren
  getFields(fieldName, n) {
    return this.getLast(n).map(s => s[fieldName]);
  }
}

class MultiRingBuffer2 {
  constructor(channelTypes, size, channelNames) {
    this.channels = channelTypes.map(C => new C(size));
    this.index = 0;
    this.length = 0;
    this.size = size;
    this._lastSlices = Array(channelTypes.length).fill(null);
    this._lastSlicesCount = Array(channelTypes.length).fill(null);
    this._lastSlicesIndex = Array(channelTypes.length).fill(null);

    this.channelMap = channelNames.reduce((map, name, idx) => {
      map[name] = idx;
      return map;
    }, {});
    this.channelNames = channelNames;
  }

  push(values) {
    if (!Array.isArray(values) || values.length !== this.channels.length) {
      throw new Error(`push(): values muss Array mit ${this.channels.length} Elementen sein.`);
    }
    for (let ch = 0; ch < values.length; ch++) {
      this.channels[ch][this.index] = values[ch];
      this._lastSlices[ch] = null;
    }
    this.index = (this.index + 1) % this.size;
    if (this.length < this.size) this.length++;
  }

  getChannelTypedArray(channel) {
    const buf = this.channels[channel];
    if (this.length < this.size) {
      return buf.subarray(0, this.length);
    } else {
      if (this._lastSlices[channel]) return this._lastSlices[channel];
      let arr = new buf.constructor(this.size);
      arr.set(buf.subarray(this.index));
      arr.set(buf.subarray(0, this.index), this.size - this.index);
      this._lastSlices[channel] = arr;
      return arr;
    }
  }

  getLast() {
    if (this.length === 0) return null;
    const lastIdx = (this.index + this.size - 1) % this.size;
    const result = {};
    for (let i = 0; i < this.channels.length; i++) {
      result[this.channelNames[i]] = this.channels[i][lastIdx];
    }
    return result;
  }

  getFieldTypedArray(fieldName, N) {
    const ch = this.channelMap[fieldName];
    if (ch === undefined) throw new Error(`Unknown field name: ${fieldName}`);
    const buf = this.channels[ch];
    const len = this.length;
    const count = Math.min(N, len);

    if (len < this.size) {
      return buf.subarray(len - count, len);
    } else {
      if (this._lastSlices[ch] &&
        this._lastSlicesCount[ch] === count &&
        this._lastSlicesIndex[ch] === this.index) {
        return this._lastSlices[ch];
      }
      const arr = new buf.constructor(count);
      let startIdx = (this.index + this.size - count) % this.size;

      if (startIdx + count <= this.size) {
        arr.set(buf.subarray(startIdx, startIdx + count));
      } else {
        const firstPartLen = this.size - startIdx;
        arr.set(buf.subarray(startIdx, this.size));
        arr.set(buf.subarray(0, count - firstPartLen), firstPartLen);
      }
      this._lastSlices[ch] = arr;
      this._lastSlicesCount[ch] = count;
      this._lastSlicesIndex[ch] = this.index;
      return arr;
    }
  }
}

function zoomAxis(axis, factor, pointerPos) {
  const sc = chart.scales[axis];
  const range = sc.max - sc.min;
  const newRange = range * factor;
  const newMin = sc.min + range * pointerPos - newRange * pointerPos;
  const newMax = newMin + newRange;
  if (newMax - newMin < 1e-9) return;

  // Vor dem Setzen: anderen Achsenbereich sichern
  let otherMin, otherMax;
  if (axis === "x") {
    otherMin = chart.scales.y.min;
    otherMax = chart.scales.y.max;
  } else if (axis === "y") {
    otherMin = chart.scales.x.min;
    otherMax = chart.scales.x.max;
  }
  chart.setScale(axis, { min: newMin, max: newMax });
  // Danach: anderen Achsenbereich sofort wieder setzen
  if (axis === "x" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("y", { min: otherMin, max: otherMax });
  }
  if (axis === "y" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("x", { min: otherMin, max: otherMax });
  }
  console.log("ZOOM AXIS " + axis);
}

function panAxis(axis, deltaPx, axisPxLength) {
  if (axisPxLength === 0) return;
  const sc = chart.scales[axis];
  const range = sc.max - sc.min;
  const delta = -(deltaPx / axisPxLength) * range;

  // Vor dem Setzen: anderen Achsenbereich sichern
  let otherMin, otherMax;
  if (axis === "x") {
    otherMin = chart.scales.y.min;
    otherMax = chart.scales.y.max;
  } else if (axis === "y") {
    otherMin = chart.scales.x.min;
    otherMax = chart.scales.x.max;
  }

  chart.setScale(axis, { min: sc.min + delta, max: sc.max + delta });
  // Danach: anderen Achsenbereich sofort wieder setzen
  if (axis === "x" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("y", { min: otherMin, max: otherMax });
  }
  if (axis === "y" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("x", { min: otherMin, max: otherMax });
  }
}

function updateCursor(el, dragging, canDrag) {
  if (dragging) {
    el.style.cursor = "grabbing";
  } else {
    el.style.cursor = canDrag ? (el.id === "y-axis-overlay" ? "ns-resize" : "ew-resize") : "default";
  }
}

// Y Axis Overlay
(() => {
  const yOverlay = document.getElementById("y-axis-overlay");
  let isPanning = false;
  let lastY = 0;
  yOverlay.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = yOverlay.getBoundingClientRect();
    const pointerPos = (e.clientY - rect.top) / rect.height;
    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    zoomAxis("y", factor, pointerPos);
  }, { passive: false });
  yOverlay.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    isPanning = true;
    lastY = e.clientY;
    updateCursor(yOverlay, true, true);
  });
  window.addEventListener("mousemove", e => {
    if (!isPanning) return;
    e.preventDefault();
    const deltaY = lastY - e.clientY;
    lastY = e.clientY;
    panAxis("y", deltaY, yOverlay.getBoundingClientRect().height);
  });
  window.addEventListener("mouseup", e => {
    if (isPanning) {
      isPanning = false;
      updateCursor(yOverlay, false, true);
    }
  });
  yOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(yOverlay, false, true));
  yOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(yOverlay, false, false));
})();

// X Axis Overlay mit Persistenz von Pan-Offset
(() => {
  const xOverlay = document.getElementById("x-axis-overlay");
  let isPanning = false;
  let lastX = 0;

  // Pan-Offset in Sekunden, initial 0 = Ansicht ganz rechts
  let panOffset = 0;

  xOverlay.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = xOverlay.getBoundingClientRect();
    const pointerPos = (e.clientX - rect.left) / rect.width;
    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    zoomAxis("x", factor, pointerPos);
  }, { passive: false });

  xOverlay.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    isPanning = true;
    lastX = e.clientX;
    updateCursor(xOverlay, true, true);
  });

  window.addEventListener("mousemove", e => {
    if (!isPanning) return;
    e.preventDefault();
    const deltaX = e.clientX - lastX;
    lastX = e.clientX;

    const scX = chart.scales.x;
    const range = scX.max - scX.min;
    const widthPx = xOverlay.getBoundingClientRect().width;
    const deltaSec = -(deltaX / widthPx) * range;

    panOffset += deltaSec;

    // Begrenzung: Kein verschieben nach rechts über Live-Ende hinaus (max 0)
    if (panOffset > 0) panOffset = 0;

    // Sichtbarkeitsbereich durch Offset verschieben
    chart.setScale("x", {
      min: scX.min + deltaSec,
      max: scX.max + deltaSec
    });
  });

  window.addEventListener("mouseup", e => {
    if (isPanning) {
      isPanning = false;
      updateCursor(xOverlay, false, true);
    }
  });

  xOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(xOverlay, false, true));
  xOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(xOverlay, false, false));

  // Live-Daten Update erweitert: benutzt panOffset um Ansicht zu verschieben
  window.addEventListener("liveDataUpdate", (e) => {
    const latest = e.detail.latestTimestamp;
    const visibleRange = chart.scales.x.max - chart.scales.x.min;

    // Nur automatic scroll wenn panOffset nahe 0 ist (<= -0.5 Sek)
    if (panOffset > -0.5) {
      panOffset = 0;
      chart.setScale("x", { min: latest - visibleRange, max: latest });
    } else {
      // sonst Ansicht mit panOffset beibehalten (schiebt Fenster nach links)
      chart.setScale("x", {
        min: latest - visibleRange + panOffset,
        max: latest + panOffset
      });
    }
  });

  // Expose panOffset zum restlichen Script (für Live-Daten Update)
  window.getPanOffset = () => panOffset;
  window.setPanOffset = (offset) => { panOffset = offset; };
})();

// Rechte Maustaste Zoombox
let zoomBoxing = false;
let zoomStart = null;

chart.over.addEventListener("contextmenu", e => e.preventDefault());

chart.over.addEventListener("wheel", e => {
  e.preventDefault();

  // Relative Mausposition im Chart-Overlay
  const rect = chart.over.getBoundingClientRect();
  const pointerPosX = (e.clientX - rect.left) / rect.width;
  const pointerPosY = (e.clientY - rect.top) / rect.height;

  // Zoom-Faktor: Mausrad hoch = Faktor < 1 (reinzoomen), sonst > 1 (rauszoomen)
  const factor = e.deltaY < 0 ? 0.85 : 1.15;

  function zoomAxis(axis, factor, pointerPos) {
    const sc = chart.scales[axis];
    const range = sc.max - sc.min;
    const newRange = range * factor;
    const newMin = sc.min + range * pointerPos - newRange * pointerPos;
    const newMax = newMin + newRange;
    if (newMax - newMin < 1e-9) return;
    chart.setScale(axis, { min: newMin, max: newMax });
  }

  zoomAxis('x', factor, pointerPosX);
  zoomAxis('y', factor, pointerPosY);
}, { passive: false });

chart.over.addEventListener("mousedown", e => {
  if (e.button === 2) {
    zoomBoxing = true;
    zoomStart = { x: e.offsetX, y: e.offsetY };
    chart.over.style.cursor = "crosshair";
  }
});

chart.over.addEventListener("mouseup", e => {
  if (e.button === 2 && zoomBoxing) {
    zoomBoxing = false;
    chart.over.style.cursor = "";

    const x0 = zoomStart.x, y0 = zoomStart.y;
    const x1 = e.offsetX, y1 = e.offsetY;

    const xMin = chart.posToVal(Math.min(x0, x1), "x");
    const xMax = chart.posToVal(Math.max(x0, x1), "x");
    const yMin = chart.posToVal(Math.max(y0, y1), "y");
    const yMax = chart.posToVal(Math.min(y0, y1), "y");

    if (xMax > xMin && yMax > yMin) {
      chart.setScale("x", { min: xMin, max: xMax });
      chart.setScale("y", { min: yMin, max: yMax });
    }
  }
});

// Doppelklick reset
chart.over.addEventListener("dblclick", () => {
  window.setPanOffset(0);
  chart.setScale("x", { auto: true });
  chart.setScale("y", { auto: true });
});

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

  chart.setData([timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]);

  // Wenn Nutzer den Pan-Bereich manuell gesetzt hat, übernehmen wir den Offset
  // Sonst automatisch weiter scollen (xPanOffset wird intern im Overlay verwaltet)
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

function zoomAxis(axis, factor, pointerPos) {
  const sc = chart.scales[axis];
  const range = sc.max - sc.min;
  const newRange = range * factor;
  const newMin = sc.min + range * pointerPos - newRange * pointerPos;
  const newMax = newMin + newRange;
  if (newMax - newMin < 1e-9) return;

  // Vor dem Setzen: anderen Achsenbereich sichern
  let otherMin, otherMax;
  if (axis === "x") {
    otherMin = chart.scales.y.min;
    otherMax = chart.scales.y.max;
  } else if (axis === "y") {
    otherMin = chart.scales.x.min;
    otherMax = chart.scales.x.max;
  }
  chart.setScale(axis, { min: newMin, max: newMax });
  // Danach: anderen Achsenbereich sofort wieder setzen
  if (axis === "x" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("y", { min: otherMin, max: otherMax });
  }
  if (axis === "y" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("x", { min: otherMin, max: otherMax });
  }
  console.log("ZOOM AXIS " + axis);
}

function panAxis(axis, deltaPx, axisPxLength) {
  if (axisPxLength === 0) return;
  const sc = chart.scales[axis];
  const range = sc.max - sc.min;
  const delta = -(deltaPx / axisPxLength) * range;

  // Vor dem Setzen: anderen Achsenbereich sichern
  let otherMin, otherMax;
  if (axis === "x") {
    otherMin = chart.scales.y.min;
    otherMax = chart.scales.y.max;
  } else if (axis === "y") {
    otherMin = chart.scales.x.min;
    otherMax = chart.scales.x.max;
  }

  chart.setScale(axis, { min: sc.min + delta, max: sc.max + delta });
  // Danach: anderen Achsenbereich sofort wieder setzen
  if (axis === "x" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("y", { min: otherMin, max: otherMax });
  }
  if (axis === "y" && otherMin !== undefined && otherMax !== undefined) {
    chart.setScale("x", { min: otherMin, max: otherMax });
  }
}

function updateCursor(el, dragging, canDrag) {
  if (dragging) {
    el.style.cursor = "grabbing";
  } else {
    el.style.cursor = canDrag ? (el.id === "y-axis-overlay" ? "ns-resize" : "ew-resize") : "default";
  }
}

// Y Axis Overlay
(() => {
  const yOverlay = document.getElementById("y-axis-overlay");
  let isPanning = false;
  let lastY = 0;
  yOverlay.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = yOverlay.getBoundingClientRect();
    const pointerPos = (e.clientY - rect.top) / rect.height;
    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    zoomAxis("y", factor, pointerPos);
  }, { passive: false });
  yOverlay.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    isPanning = true;
    lastY = e.clientY;
    updateCursor(yOverlay, true, true);
  });
  window.addEventListener("mousemove", e => {
    if (!isPanning) return;
    e.preventDefault();
    const deltaY = lastY - e.clientY;
    lastY = e.clientY;
    panAxis("y", deltaY, yOverlay.getBoundingClientRect().height);
  });
  window.addEventListener("mouseup", e => {
    if (isPanning) {
      isPanning = false;
      updateCursor(yOverlay, false, true);
    }
  });
  yOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(yOverlay, false, true));
  yOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(yOverlay, false, false));
})();

// X Axis Overlay mit Persistenz von Pan-Offset
(() => {
  const xOverlay = document.getElementById("x-axis-overlay");
  let isPanning = false;
  let lastX = 0;
  let panOffset = 0;

  xOverlay.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = xOverlay.getBoundingClientRect();
    const pointerPos = (e.clientX - rect.left) / rect.width;
    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    zoomAxis("x", factor, pointerPos);
  }, { passive: false });

  xOverlay.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    isPanning = true;
    lastX = e.clientX;
    updateCursor(xOverlay, true, true);
  });

  window.addEventListener("mousemove", e => {
    if (!isPanning) return;
    e.preventDefault();
    const deltaX = e.clientX - lastX;
    lastX = e.clientX;

    const scX = chart.scales.x;
    const range = scX.max - scX.min;
    const widthPx = xOverlay.getBoundingClientRect().width;
    const deltaSec = -(deltaX / widthPx) * range;

    panOffset += deltaSec;
    if (panOffset > 0) panOffset = 0;

    chart.setScale("x", {
      min: scX.min + deltaSec,
      max: scX.max + deltaSec
    });
  });

  window.addEventListener("mouseup", e => {
    if (isPanning) {
      isPanning = false;
      updateCursor(xOverlay, false, true);
    }
  });

  xOverlay.addEventListener("mouseenter", () => !isPanning && updateCursor(xOverlay, false, true));
  xOverlay.addEventListener("mouseleave", () => !isPanning && updateCursor(xOverlay, false, false));

  window.addEventListener("liveDataUpdate", (e) => {
    const latest = e.detail.latestTimestamp;
    const visibleRange = chart.scales.x.max - chart.scales.x.min;
    if (panOffset > -0.5) {
      panOffset = 0;
      chart.setScale("x", { min: latest - visibleRange, max: latest });
    } else {
      chart.setScale("x", {
        min: latest - visibleRange + panOffset,
        max: latest + panOffset
      });
    }
  });

  window.getPanOffset = () => panOffset;
  window.setPanOffset = (offset) => { panOffset = offset; };
})();

let zoomBoxing = false;
let zoomStart = null;

chart.over.addEventListener("contextmenu", e => e.preventDefault());

chart.over.addEventListener("wheel", e => {
  e.preventDefault();
  const rect = chart.over.getBoundingClientRect();
  const pointerPosX = (e.clientX - rect.left) / rect.width;
  const pointerPosY = (e.clientY - rect.top) / rect.height;
  const factor = e.deltaY < 0 ? 0.85 : 1.15;

  function zoomAxis(axis, factor, pointerPos) {
    const sc = chart.scales[axis];
    const range = sc.max - sc.min;
    const newRange = range * factor;
    const newMin = sc.min + range * pointerPos - newRange * pointerPos;
    const newMax = newMin + newRange;
    if (newMax - newMin < 1e-9) return;
    chart.setScale(axis, { min: newMin, max: newMax });
  }

  zoomAxis('x', factor, pointerPosX);
  zoomAxis('y', factor, pointerPosY);
}, { passive: false });

chart.over.addEventListener("mousedown", e => {
  if (e.button === 2) {
    zoomBoxing = true;
    zoomStart = { x: e.offsetX, y: e.offsetY };
    chart.over.style.cursor = "crosshair";
  }
});

chart.over.addEventListener("mouseup", e => {
  if (e.button === 2 && zoomBoxing) {
    zoomBoxing = false;
    chart.over.style.cursor = "";
    const x0 = zoomStart.x, y0 = zoomStart.y;
    const x1 = e.offsetX, y1 = e.offsetY;
    const xMin = chart.posToVal(Math.min(x0, x1), "x");
    const xMax = chart.posToVal(Math.max(x0, x1), "x");
    const yMin = chart.posToVal(Math.max(y0, y1), "y");
    const yMax = chart.posToVal(Math.min(y0, y1), "y");

    if (xMax > xMin && yMax > yMin) {
      chart.setScale("x", { min: xMin, max: xMax });
      chart.setScale("y", { min: yMin, max: yMax });
    }
  }
});

chart.over.addEventListener("dblclick", () => {
  window.setPanOffset(0);
  chart.setScale("x", { auto: true });
  chart.setScale("y", { auto: true });
});

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

  chart.setData([timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]);

  window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: lastTimestamp2 } }));

  if (yMinBefore !== undefined && yMaxBefore !== undefined) {
    chart.setScale("y", { min: yMinBefore, max: yMaxBefore });
  }
  if (xMinBefore !== undefined && xMaxBefore !== undefined) {
    chart.setScale("x", { min: xMinBefore, max: xMaxBefore });
  }
}
//setInterval(addLiveDataPoint, 1); // 33 FPS
