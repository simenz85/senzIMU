import { MultiRingBuffer2 } from "../buffers.js";

const BUFFERSIZE = 20000000;

export const accBuffer = new MultiRingBuffer2(
  [Float64Array, Float32Array, Float32Array, Float32Array, Float32Array],
  BUFFERSIZE,
  ['time', 'x', 'y', 'z', 'total']
);

export const gyroBuffer = new MultiRingBuffer2(
  [Float64Array, Float32Array, Float32Array, Float32Array],
  BUFFERSIZE,
  ['time', 'x', 'y', 'z']
);

export const tempBuffer = new MultiRingBuffer2(
  [Float64Array, Float32Array],
  BUFFERSIZE,
  ['time', 'temperature']
);

let chart  = null;
let dark = true;
let paused = false;
let autoScroll = true;
let lastTimestamp = 0;
let pausedLastTimestamp = 0;
let panOffset = 0;
let currentTimeRange = 5;
let yRanges = [{zoom:1, pan:0}, {zoom:1, pan:0}, {zoom:1, pan:0}];
let timestamps = [];
let values1 = [];
let values2 = [];
let values3 = [];
const maxPoints = 300000;
const now = Date.now();

export function initChart() {
  
  
const container = document.getElementById("livechart2");
  
const options = {
  ...getSize(),
  
  title: "Live-Daten mit 3 Serien",
      width: container.clientWidth,
      height: container.clientHeight,

  
    axes: [
        {
        scale: "x",
        label: "Zeit (s)",
        grid: { show: true },
        ticks: { format: (u, v) => new Date(v * 1000).toLocaleTimeString() },
        stroke: "white"
      },
      {
        scale: "y",
        label: "Wert",
        grid: { show: true },
        ticks: { format: (u, v) => v.toFixed(2) + " mg" },
        stroke: "white"
        }
    ],
  
  
  scales: {
    x: { time: true },
    y: { range: [-1500, 1500] }
  },
  series: [


      { label: "Zeit", value: (u, v) => v === null ? "-" : new Date(v * 1).toLocaleTimeString() },
      { label: "Acc X (mg)", stroke: "#FFD600" },
      { label: "Acc Y (mg)", stroke: "#ec3030ff" },
      { label: "Acc Z (mg)", stroke: "#7a96e2ff" },


  ],
  cursor: {
    drag: { x: true, y: true, setScale: true }
  },
};

  chart = new uPlot(options, [[], [], [], []], document.getElementById("livechart2"));
  window.chart = chart; // Mache chart global verfügbar für script2.js

        const pauseBtn2 = document.getElementById("pauseBtn2");
        let paused2 = false;
        pauseBtn2.textContent = "⏸"; // Start mit Pause-Symbol
        pauseBtn2.onclick = () => {
        paused = !paused;
        pauseBtn2.textContent = paused   ? "▶" : "⏸";
        };

  	function getSize() {				
    const container = document.getElementById("livechart2");
      return {
					width: container.clientWidth,
					height: container.clientHeight,
				}
			}

		window.addEventListener("resize", e => {
				chart.setSize(getSize());
			});


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
      if(dragging) {
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
        if(e.button !== 0) return;
        e.preventDefault();
        isPanning = true;
        lastY = e.clientY;
        updateCursor(yOverlay, true, true);
      });
      window.addEventListener("mousemove", e => {
        if(!isPanning) return;
        e.preventDefault();
        const deltaY = lastY - e.clientY;
        lastY = e.clientY;
        panAxis("y", deltaY, yOverlay.getBoundingClientRect().height);
      });
      window.addEventListener("mouseup", e => {
        if(isPanning) {
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
        if(e.button !== 0) return;
        e.preventDefault();
        isPanning = true;
        lastX = e.clientX;
        updateCursor(xOverlay, true, true);
      });

      window.addEventListener("mousemove", e => {
        if(!isPanning) return;
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
        if(isPanning) {
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

  // Zoom Funktion analog zu deinen zoomAxis
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
      if(e.button === 2){
        zoomBoxing = true;
        zoomStart = {x: e.offsetX, y: e.offsetY};
        chart.over.style.cursor = "crosshair";
      }
    });

    chart.over.addEventListener("mouseup", e => {
      if(e.button === 2 && zoomBoxing){
        zoomBoxing = false;
        chart.over.style.cursor = "";

        const x0 = zoomStart.x, y0 = zoomStart.y;
        const x1 = e.offsetX, y1 = e.offsetY;

        const xMin = chart.posToVal(Math.min(x0, x1), "x");
        const xMax = chart.posToVal(Math.max(x0, x1), "x");
        const yMin = chart.posToVal(Math.max(y0, y1), "y");
        const yMax = chart.posToVal(Math.min(y0, y1), "y");

        if(xMax > xMin && yMax > yMin){
          chart.setScale("x", {min: xMin, max: xMax});
          chart.setScale("y", {min: yMin, max: yMax});
        }
      }
    });

    // Doppelklick reset
    chart.over.addEventListener("dblclick", () => {
      window.setPanOffset(0);
      chart.setScale("x", {auto: true});
      chart.setScale("y", {auto: true});
    });







}

export function getYRange() {
  return (u, seriesIdx) => {
    const baseRange = 2500;
    let { zoom, pan } = yRanges[0];
    let half = baseRange / zoom;
    return [pan - half, pan + half];
  };
}





// Aktualisiert das Dashboard mit den aktuellen Sensorwerten
export function updateDashboard() {
  if (!chart) return;
  let lastAccSample = accBuffer.getLast();
  let lastGyroSample = gyroBuffer.getLast();

  if (!lastAccSample || !lastGyroSample) return;

  // Zeitberechnung für Anzeige
  const totalSeconds = lastAccSample.time * 0.000001;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const formattedTime =
    (hours > 0 ? hours + ":" : "") +
    (hours > 0 ? String(minutes).padStart(2, '0') : minutes) + ":" +
    seconds.toFixed(2).padStart(5, '0');

  document.getElementById("timestamp").textContent = formattedTime;

  // Sensorwerte aktuell anzeigen
  document.getElementById("accX").textContent = lastAccSample.x.toFixed(1);
  document.getElementById("accY").textContent = lastAccSample.y.toFixed(1);
  document.getElementById("accZ").textContent = lastAccSample.z.toFixed(1);
  document.getElementById("gyroX").textContent = lastGyroSample.x.toFixed(1);
  document.getElementById("gyroY").textContent = lastGyroSample.y.toFixed(1);
  document.getElementById("gyroZ").textContent = lastGyroSample.z.toFixed(1);

  lastTimestamp = lastAccSample.time;

  // Daten für Plot holen (5 Sekunden Daten basierend auf Sample Rate schätzen)
  const sampleRate = 6600; // Beispielwert, falls du Samplerate dynamisch hast, ggf. anpassen
  const N = sampleRate * 5;currentTimeRange; 
  const times = accBuffer.getFieldTypedArray('time', N);
  const xs = accBuffer.getFieldTypedArray('x', N);
  const ys = accBuffer.getFieldTypedArray('y', N);
  const zs = accBuffer.getFieldTypedArray('z', N);


   if (paused==true){return};
//autoScroll = true;

let currenttimerange = 5; // Sekunden



      const xMinBefore = chart.scales.x.min;
      const xMaxBefore = chart.scales.x.max;
      const yMinBefore = chart.scales.y.min;
      const yMaxBefore = chart.scales.y.max;
      chart.setData([times, xs, ys, zs]);
       //chart.setData([timestamps.slice(), values1.slice(), values2.slice(), values3.slice()]);

      // Wenn Nutzer den Pan-Bereich manuell gesetzt hat, übernehmen wir den Offset
      // Sonst automatisch weiter scollen (xPanOffset wird intern im Overlay verwaltet)
      // Wir triggern ein Event für die X-Achse, damit Overlay das neu repositioniert
      window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: lastTimestamp} }));

      // Y-Skala behalten
      if(yMinBefore !== undefined && yMaxBefore !== undefined){
        chart.setScale("y", {min: yMinBefore, max: yMaxBefore});
      }






}


let chartUpdateRunning = false;
let lastChartUpdate = 0;
let updateIntervalMs = 40; // 25 FPS

export function startChartUpdates() {
  function updateLoop(now) {
    if (!chartUpdateRunning) return;

    if (now - lastChartUpdate >= updateIntervalMs) {
      updateDashboard();
      lastChartUpdate = now;
    }

    requestAnimationFrame(updateLoop);
  }

  chartUpdateRunning = true;
  lastChartUpdate = performance.now();
  requestAnimationFrame(updateLoop);
}

export function panandzoom(){






    // Live-Daten Simulation & Updates mit persistierendem Pan-Offset
    let lastTimestamp2 = timestamps[timestamps.length - 1];
    function addLiveDataPoint() {
      if (paused) return;

  lastTimestamp2 += 1;
  timestamps.push(lastTimestamp2);
  values1.push(Math.sin(lastTimestamp2/5) * 10 + 50 + (Math.random() - 0.5));
  values2.push(Math.cos(lastTimestamp2/7) * 7 + 40 + (Math.random() - 0.5));
  values3.push(Math.sin(lastTimestamp2/10) * 5 + 30 + (Math.random() - 0.5));

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
      // Wir triggern ein Event für die X-Achse, damit Overlay das neu repositioniert
      window.dispatchEvent(new CustomEvent("liveDataUpdate", { detail: { latestTimestamp: lastTimestamp2 } }));

      // Y-Skala behalten
      if(yMinBefore !== undefined && yMaxBefore !== undefined){
        chart.setScale("y", {min: yMinBefore, max: yMaxBefore});
      }
     if(xMinBefore !== undefined && xMaxBefore !== undefined){
        chart.setScale("x", {min: xMinBefore, max: xMaxBefore});
      }
      //window.setPanOffset(0);



    }
    }
// Hier z.B. noch Funktionen für Zoom und Pan (kannst du wie in deinem Ursprungsskript hinzufügen)
