// filter-worker.js
importScripts('fili.min.js');

const iirCalculator = new Fili.CalcCascades();

let filters = { x: null, y: null, z: null };
let filteredBuffers = { x: [], y: [], z: [] };
let currentSettings = { bypass: true };

const MAX_BUFFER_SIZE = 50;

// Anhängen mit maximaler Puffergröße
function appendData(buffer, newData) {
  buffer.push(...newData);
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }
}

function createFilter(settings) {
  let coeffs;
  switch (settings.type) {
    case 'lowpass':
      coeffs = iirCalculator.lowpass({
        order: settings.order,
        characteristic: settings.design,
        Fs: settings.fs,
        Fc: settings.cutoff * (settings.fs / 2),
        preGain: false,
      });
      break;
    case 'highpass':
      coeffs = iirCalculator.highpass({
        order: settings.order,
        characteristic: settings.design,
        Fs: settings.fs,
        Fc: settings.cutoff * (settings.fs / 2),
        preGain: false,
      });
      break;
    case 'bandpass':
      coeffs = iirCalculator.bandpass({
        order: settings.order,
        characteristic: settings.design,
        Fs: settings.fs,
        Fc: settings.cutoff * (settings.fs / 2),
        preGain: false,
      });
      break;
    case 'notch':
      coeffs = iirCalculator.notch({
        order: settings.order,
        characteristic: settings.design,
        Fs: settings.fs,
        Fc: settings.cutoff * (settings.fs / 2),
        preGain: false,
      });
      break;
    default:
      throw new Error('Unbekannter Filtertyp: ' + settings.type);
  }
  return new Fili.IirFilter(coeffs);
}

function initFilters(settings) {
  currentSettings = settings;
  filteredBuffers = { x: [], y: [], z: [] };
  if (settings.bypass) {
    filters = { x: null, y: null, z: null };
  } else {
    filters.x = createFilter(settings);
    filters.y = createFilter(settings);
    filters.z = createFilter(settings);
  }
}

onmessage = (event) => {
  const { type, data } = event.data;

   // console.log('Worker empfangen Nachricht:', type + data.x,data.y,data.z);


  if (type === 'initFilter') {
    try {
      initFilters(data);
      postMessage({ type: 'initDone' });
    } catch (err) {
      postMessage({ type: 'error', message: 'Filter Init fehlgeschlagen: ' + err.message });
    }
  }
  if (type === 'filterData') {

    //console.log('Worker empfangen Nachricht:', type + data.x,data.y,data.z);
    if (currentSettings.bypass) {
     
      //console.log("Bypass aktiv, Daten werden nicht gefiltert");
      appendData(filteredBuffers.x, data.x);
      appendData(filteredBuffers.y, data.y);
      appendData(filteredBuffers.z, data.z);
    } else {
      
      
      appendData(filteredBuffers.x, filters.x.multiStep(data.x));
      appendData(filteredBuffers.y, filters.y.multiStep(data.y));
      appendData(filteredBuffers.z, filters.z.multiStep(data.z));
    }

    postMessage({
      type: 'filteredData',
      data: {
        x: filteredBuffers.x,
        y: filteredBuffers.y,
        z: filteredBuffers.z,
      },
    });

    //console.log('Worker sendet gefilterte Daten', filteredBuffers);

  } else if (type === 'getFilteredData') {
    const count = data.count || 1000;
    //console.log('Worker sendet gefilterte Daten', filteredData);
    postMessage({
      type: 'filteredData',
      data: {
        x: filteredBuffers.x.slice(-count),
        y: filteredBuffers.y.slice(-count),
        z: filteredBuffers.z.slice(-count),
      },
    });
  } else {
    postMessage({ type: 'error', message: 'Unbekannter Nachrichtentyp: ' + type });
  }
};
