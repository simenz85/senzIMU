import { setupDropdowns, setupSideSettingsDropdowns } from "./ui/ui-setup.js";
import { setupWSWorker, connectWebSocket, wsWorker } from "./workers/ws-setup.js";
import { setupDecodeWorker, decodeWorker } from "./workers/decode-setup.js";
import { initChart, updateDashboard} from "./charts/liveChart.js";
//import { initFFTChart } from "./charts/fftChart.js";
import { setupFFTWorker, startFFTUpdates } from "./workers/fft-setup.js";





document.addEventListener("DOMContentLoaded", () => {
  // UI initialisieren
  setupDropdowns();
  setupSideSettingsDropdowns();

  // Worker Setup
  setupDecodeWorker();
  setupWSWorker(decodeWorker);
  setupFFTWorker();

  // WebSocket verbinden
  connectWebSocket();

  // Charts initialisieren
  initChart();

  
  initFFTChart();
  setupFFTWorker(); 


  // Startet Dashboard Update Loop
  const updateLoop = () => {
    updateDashboard();
    requestAnimationFrame(updateLoop);
  };
  updateLoop();

  // Startet FFT Updates (s. Ganzen Code in workers/fft-setup.js)
  startFFTUpdates();
});
        