importScripts('fili.min.js');

const iirCalculator = new Fili.CalcCascades();

let settings = { bypass: true };
let filterCoefficients = null;
let liveFilters = { x: null, y: null, z: null };

const designMapBilinear = {
  butterworth: 'butterworth',
  bessel: 'bessel',
};

const designMapMatchedZ = {
  bessel: 'bessel',
  butterworth: 'butterworth',
  allpass: 'allpass',
  tschebyscheff05: 'tschebyscheff05',
  tschebyscheff1: 'tschebyscheff1',
  tschebyscheff2: 'tschebyscheff2',
  tschebyscheff3: 'tschebyscheff3',
};

function createFilterCoefficients(settings) {
  if (settings.bypass) {
    return null; // kein Filter
  }

  const nyquist = settings.fs / 2;
  const Fc = settings.cutoff * nyquist;

  if (Fc <= 0 || Fc >= nyquist) {
    throw new Error(`Invalid cutoff frequency Fc=${Fc}, must be >0 and <Nyquist (${nyquist})`);
  }

  const transform = (settings.transform || 'bilinear').toLowerCase();
  let characteristic;

  if (transform === 'bilinear') {
    characteristic = designMapBilinear[settings.design.toLowerCase()];
  } else if (transform === 'matchedz') {
    characteristic = designMapMatchedZ[settings.design.toLowerCase()];
  } else {
    throw new Error(`Unknown transform type: ${transform}`);
  }

  if (!characteristic) {
    throw new Error(`Unknown filter design '${settings.design}' for transform '${transform}'`);
  }

  const params = {
    order: settings.order || 2,
    characteristic,
    Fs: settings.fs,
    Fc,
    preGain: settings.preGain || false,
    transform,
  };

  // Gain nur für gewisse Typen und nur bei bilinear
  if (transform === 'bilinear') {
    if (['peak', 'lowshelf', 'highshelf'].includes(settings.type.toLowerCase())) {
      params.gain = settings.gain || 0;
    }
    if (['bandpass', 'bandstop'].includes(settings.type.toLowerCase()) && settings.bandwidth !== undefined) {
      params.BW = settings.bandwidth;
    }
  }

  let coeffs;
  switch (settings.type.toLowerCase()) {
    case 'lowpass':
      coeffs = iirCalculator.lowpass(params);
      break;
    case 'highpass':
      coeffs = iirCalculator.highpass(params);
      break;
    case 'bandpass':
      coeffs = iirCalculator.bandpass(params);
      break;
    case 'bandstop':
      coeffs = iirCalculator.bandstop(params);
      break;
    case 'peak':
      coeffs = iirCalculator.peak(params);
      break;
    case 'lowshelf':
      coeffs = iirCalculator.lowshelf(params);
      break;
    case 'highshelf':
      coeffs = iirCalculator.highshelf(params);
      break;
    case 'aweighting':
      coeffs = iirCalculator.aweighting(params);
      break;
    case 'none':
      return null;
    default:
      throw new Error(`Unknown filter type: ${settings.type}`);
  }

  return coeffs;
}

function createFilterSet() {
  if (!filterCoefficients) {
    return { x: null, y: null, z: null };
  }

  return {
    x: new Fili.IirFilter(filterCoefficients),
    y: new Fili.IirFilter(filterCoefficients),
    z: new Fili.IirFilter(filterCoefficients),
  };
}

function initFilters(newSettings) {
  settings = newSettings;

  if (settings.bypass || settings.type === 'none') {
    filterCoefficients = null;
    liveFilters = { x: null, y: null, z: null };
    postMessage({ type: 'initDone', bypass: true });
    console.log('Filter bypass aktiviert — keine Filterinstanzen erstellt.');
    console.log('Gesendete Parameter:', JSON.stringify(settings, null, 2));
  } else {
    try {
      filterCoefficients = createFilterCoefficients(settings);
      liveFilters = createFilterSet();

      console.log(`Filter initialisiert:
        Typ: ${settings.type}
        Design: ${settings.design}
        Transform: ${settings.transform}
        Order: ${settings.order}
        Cutoff: ${settings.cutoff}
      `);
      console.log('Gesendete Parameter:', JSON.stringify(settings, null, 2));

      postMessage({ type: 'initDone', bypass: false });
    } catch (err) {
      postMessage({ type: 'error', message: err.message });
      console.error('Fehler bei Filterinitialisierung:', err.message);
      console.error('Gesendete Parameter:', JSON.stringify(settings, null, 2));
    }
  }
}

function filterStreamingBlock(xData, yData, zData, totalData) {
  if (settings.bypass || settings.type === 'none' || !liveFilters.x || !liveFilters.y || !liveFilters.z) {
    return { x: xData, y: yData, z: zData, total: totalData };
  }

  const filteredX = liveFilters.x.multiStep(xData);
  const filteredY = liveFilters.y.multiStep(yData);
  const filteredZ = liveFilters.z.multiStep(zData);
  const filteredTotal = new Float32Array(filteredX.length);

  for (let i = 0; i < filteredX.length; i++) {
    filteredTotal[i] = Math.hypot(filteredX[i], filteredY[i], filteredZ[i]);
  }

  return {
    x: filteredX,
    y: filteredY,
    z: filteredZ,
    total: filteredTotal,
  };
}

function filterBlock(xData, yData, zData, totalData) {
  const filters = createFilterSet();

  if (settings.bypass || settings.type === 'none' || !filters.x || !filters.y || !filters.z) {
    return { x: xData, y: yData, z: zData, total: totalData };
  }

  const filteredX = filters.x.multiStep(xData);
  const filteredY = filters.y.multiStep(yData);
  const filteredZ = filters.z.multiStep(zData);
  const filteredTotal = new Float32Array(filteredX.length);

  for (let i = 0; i < filteredX.length; i++) {
    filteredTotal[i] = Math.hypot(filteredX[i], filteredY[i], filteredZ[i]);
  }

  return {
    x: filteredX,
    y: filteredY,
    z: filteredZ,
    total: filteredTotal,
  };
}

function findFirstIndexAtOrAfter(times, minTime) {
  let low = 0;
  let high = times.length;

  while (low < high) {
    const mid = low + ((high - low) >> 1);
    if (times[mid] < minTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function findFirstIndexAfter(times, maxTime) {
  let low = 0;
  let high = times.length;

  while (low < high) {
    const mid = low + ((high - low) >> 1);
    if (times[mid] <= maxTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function cropFilteredBlock(times, filtered, minTime, maxTime) {
  if (!times || times.length === 0) {
    return {
      times: new Float64Array(0),
      x: new Float32Array(0),
      y: new Float32Array(0),
      z: new Float32Array(0),
      total: filtered.total ? new Float32Array(0) : null,
    };
  }

  const startIndex = findFirstIndexAtOrAfter(times, minTime);
  const endIndex = findFirstIndexAfter(times, maxTime);

  return {
    times: times.slice(startIndex, endIndex),
    x: filtered.x.slice(startIndex, endIndex),
    y: filtered.y.slice(startIndex, endIndex),
    z: filtered.z.slice(startIndex, endIndex),
    total: filtered.total ? filtered.total.slice(startIndex, endIndex) : null,
  };
}

function downsampleBlock(block, maxPoints) {
  if (!block?.times || block.times.length === 0 || !Number.isFinite(maxPoints) || maxPoints <= 0 || block.times.length <= maxPoints) {
    return block;
  }

  const step = Math.max(1, Math.ceil(block.times.length / maxPoints));
  const resultLength = Math.ceil(block.times.length / step);
  const sampled = {
    times: new Float64Array(resultLength),
    x: new Float32Array(resultLength),
    y: new Float32Array(resultLength),
    z: new Float32Array(resultLength),
  };

  if (block.total) {
    sampled.total = new Float32Array(resultLength);
  }

  let targetIndex = 0;
  for (let sourceIndex = 0; sourceIndex < block.times.length; sourceIndex += step) {
    sampled.times[targetIndex] = block.times[sourceIndex];
    sampled.x[targetIndex] = block.x[sourceIndex];
    sampled.y[targetIndex] = block.y[sourceIndex];
    sampled.z[targetIndex] = block.z[sourceIndex];
    if (sampled.total) {
      sampled.total[targetIndex] = block.total[sourceIndex];
    }
    targetIndex++;
  }

  return sampled;
}

onmessage = (e) => {
  const { type, data } = e.data;
  if (type === 'initFilter') {
    initFilters(data);
  } else if (type === 'filterSamples') {
    try {
      const filtered = filterStreamingBlock(data.rawDataBlock.x, data.rawDataBlock.y, data.rawDataBlock.z, data.rawDataBlock.total);
      const transferables = [data.rawDataBlock.times.buffer, filtered.x.buffer, filtered.y.buffer, filtered.z.buffer];
      if (filtered.total) {
        transferables.push(filtered.total.buffer);
      }

      postMessage({
        type: 'filteredSamples',
        data: {
          times: data.rawDataBlock.times,
          ...filtered,
        }
      }, transferables);
    } catch (err) {
      postMessage({ type: 'error', message: err.message });
    }
  } else if (type === 'filterRequest') {
    try {
      const filtered = filterBlock(data.rawDataBlock.x, data.rawDataBlock.y, data.rawDataBlock.z, data.rawDataBlock.total);
      const cropped = cropFilteredBlock(
        data.rawDataBlock.times,
        filtered,
        data.rawDataBlock.rangeMinTime,
        data.rawDataBlock.rangeMaxTime,
      );
      const sampled = downsampleBlock(cropped, data.rawDataBlock.maxPoints);
      const transferables = [sampled.times.buffer, sampled.x.buffer, sampled.y.buffer, sampled.z.buffer];
      if (sampled.total) {
        transferables.push(sampled.total.buffer);
      }

      postMessage({
        type: 'filteredBlock',
        data: {
          ...sampled,
          rangeMinTime: data.rawDataBlock.rangeMinTime,
          rangeMaxTime: data.rawDataBlock.rangeMaxTime,
        }
      }, transferables);
    } catch (err) {
      postMessage({ type: 'error', message: err.message });
    }
  }
};
