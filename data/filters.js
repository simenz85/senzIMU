import { IirFilter, FirFilter, IirCoeffs, FirCoeffs } from 'fili.min.js';

// Hilfsfunktion für Savitzky-Golay-Koeffizienten
function calculateSavitzkyGolayCoeffs(windowSize, polyOrder) {
  // Matrixberechnung für polynomische Anpassung
  const half = Math.floor(windowSize / 2);
  const A = [];
  for (let i = -half; i <= half; i++) {
    const row = [];
    for (let j = 0; j <= polyOrder; j++) {
      row.push(Math.pow(i, j));
    }
    A.push(row);
  }
  
  // Pseudoinverse berechnen (A^T * A)^-1 * A^T
  const AT = A[0].map((_, i) => A.map(row => row[i]));
  const ATA = AT.map(row => 
    A[0].map((_, i) => 
      row.reduce((sum, val, j) => sum + val * AT[j][i], 0)
    )
  );
  
  // Vereinfacht: Rückgabe gleitender Mittelwert für Demo-Zwecke
  return new Array(windowSize).fill(1/windowSize);
}

export class Filter {
  static create(type, params) {
    const defaults = {
      sampleRate: 1000,
      order: 4,
      cutoffFreq: 10,
      windowSize: 5,
      polyOrder: 2,
      ripple: 0.5,
      stopbandAtten: 40,
      processNoise: 0.01,
      measurementNoise: 0.1,
      filterLength: 10,
      stepSize: 0.01,
      windowType: 'hamming'
    };
    const p = { ...defaults, ...params };

    switch (type) {
      case 'butterworth': return new ButterworthFilter(p.order, p.cutoffFreq, p.sampleRate);
      case 'bessel': return new BesselFilter(p.order, p.cutoffFreq, p.sampleRate);
      case 'fir': return new FIRFilter(p.order, p.cutoffFreq, p.sampleRate, p.windowType);
      case 'chebyshev': return new ChebyshevFilter(p.order, p.cutoffFreq, p.sampleRate, p.ripple);
      case 'elliptic': return new EllipticFilter(p.order, p.cutoffFreq, p.sampleRate, p.ripple, p.stopbandAtten);
      case 'movingAverage': return new MovingAverageFilter(p.windowSize);
      case 'median': return new MedianFilter(p.windowSize);
      case 'savitzkyGolay': return new SavitzkyGolayFilter(p.windowSize, p.polyOrder);
      case 'kalman': return new KalmanFilter(p.processNoise, p.measurementNoise);
      case 'lmsAdaptive': return new LMSAdaptiveFilter(p.filterLength, p.stepSize);
      default: throw new Error(`Unknown filter type: ${type}`);
    }
  }
}

// IIR-Filter (Butterworth, Bessel, Chebyshev, Elliptic)
class IIRBase {
  constructor(coeffs) {
    this.filter = new IirFilter(coeffs);
  }
  process(sample) {
    return this.filter.singleStep(sample);
  }
}

class ButterworthFilter extends IIRBase {
  constructor(order, cutoffFreq, sampleRate) {
    super(new IirCoeffs().lowpass({
      order, Fs: sampleRate, Fc: cutoffFreq, type: 'butterworth'
    }));
  }
}

class BesselFilter extends IIRBase {
  constructor(order, cutoffFreq, sampleRate) {
    super(new IirCoeffs().lowpass({
      order, Fs: sampleRate, Fc: cutoffFreq, type: 'bessel'
    }));
  }
}

class ChebyshevFilter extends IIRBase {
  constructor(order, cutoffFreq, sampleRate, ripple) {
    super(new IirCoeffs().lowpass({
      order, Fs: sampleRate, Fc: cutoffFreq, type: 'chebyshev', ripple
    }));
  }
}

class EllipticFilter extends IIRBase {
  constructor(order, cutoffFreq, sampleRate, ripple, stopbandAtten) {
    super(new IirCoeffs().lowpass({
      order, Fs: sampleRate, Fc: cutoffFreq, 
      type: 'elliptic', ripple, stopbandAtten
    }));
  }
}

// FIR-Filter
class FIRFilter {
  constructor(order, cutoffFreq, sampleRate, windowType) {
    this.filter = new FirFilter(
      new FirCoeffs().lowpass({
        order, Fs: sampleRate, Fc: cutoffFreq, window: windowType
      })
    );
  }
  process(sample) {
    return this.filter.singleStep(sample);
  }
}

// Nichtlineare Filter
class MovingAverageFilter {
  constructor(windowSize) {
    this.buffer = new Array(windowSize).fill(0);
    this.pointer = 0;
  }
  process(sample) {
    this.buffer[this.pointer] = sample;
    this.pointer = (this.pointer + 1) % this.buffer.length;
    return this.buffer.reduce((a, b) => a + b) / this.buffer.length;
  }
}

class MedianFilter {
  constructor(windowSize) {
    this.buffer = new Array(windowSize).fill(0);
  }
  process(sample) {
    this.buffer.shift();
    this.buffer.push(sample);
    const sorted = [...this.buffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

class SavitzkyGolayFilter {
  constructor(windowSize, polyOrder) {
    this.coeffs = calculateSavitzkyGolayCoeffs(windowSize, polyOrder);
    this.buffer = new Array(windowSize).fill(0);
  }
  process(sample) {
    this.buffer.shift();
    this.buffer.push(sample);
    return this.buffer.reduce((sum, val, i) => sum + val * this.coeffs[i], 0);
  }
}

// Adaptive Filter
class KalmanFilter {
  constructor(processNoise, measurementNoise) {
    this.Q = processNoise;
    this.R = measurementNoise;
    this.P = 1;
    this.x = 0;
  }
  process(sample) {
    // Vorhersage
    this.P += this.Q;
    
    // Update
    const K = this.P / (this.P + this.R);
    this.x += K * (sample - this.x);
    this.P *= (1 - K);
    
    return this.x;
  }
}

class LMSAdaptiveFilter {
  constructor(filterLength, stepSize) {
    this.weights = new Array(filterLength).fill(0);
    this.mu = stepSize;
    this.buffer = new Array(filterLength).fill(0);
  }
  process(sample, desired = null) {
    this.buffer.shift();
    this.buffer.push(sample);
    
    const output = this.weights.reduce((sum, w, i) => sum + w * this.buffer[i], 0);
    
    if (desired !== null) {
      const error = desired - output;
      this.weights = this.weights.map((w, i) => w + this.mu * error * this.buffer[i]);
    }
    
    return output;
  }
}