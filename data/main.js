import { setupDropdowns, setupSideSettingsDropdowns, setupButtons } from "./ui/ui-setup.js";
import { setupWSWorker, connectWebSocket, wsWorker } from "./workers/ws-setup.js";
import { setupDecodeWorker, decodeWorker } from "./workers/decode-setup.js";
import { initChart, updateDashboard} from "./charts/liveChart.js";
//import { initFFTChart } from "./charts/fftChart.js";
import { setupFFTWorker, startFFTUpdates } from "./workers/fft-setup.js";





document.addEventListener("DOMContentLoaded", () => {
  // UI initialisieren
  setupDropdowns();
  setupSideSettingsDropdowns();
  setupButtons();

  // Worker Setup
  setupDecodeWorker();
  setupWSWorker(decodeWorker);
  setupFFTWorker();

  // Charts initialisieren BEVOR Nodes gesucht werden
  if (typeof initChart === "function") initChart();
  if (typeof initFFTChart === "function") initFFTChart();

  // Multi-Channel Discovery anstoßen und Refresh-Button binden
  if (typeof window.discoverNodes === "function") {
      window.discoverNodes();
      document.getElementById('btnDiscoverNodes')?.addEventListener('click', window.discoverNodes);
  } else {
      console.warn("Multi-Node Discovery Logik nicht gefunden! Fallback auf Single-Node.");
      connectWebSocket();
  }

  // Startet Dashboard Update Loop
  const updateLoop = () => {
    // Rufe bevorzugt die Multi-Channel Version aus script2.js auf,
    // andernfalls den Fallback aus liveChart.js (Single-Node)
    if (typeof window.updateDashboard === "function") {
        window.updateDashboard();
    } else if (typeof updateDashboard === "function") {
        updateDashboard();
    }
    requestAnimationFrame(updateLoop);
  };
  updateLoop();

  // Startet FFT Updates
  startFFTUpdates();
});
        