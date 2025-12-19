
import { DataPoint, NormalizationMethod } from '../types';

/**
 * Applies a simple moving average filter to an array of numbers.
 * @param values The input numerical array.
 * @param window The window size (must be >= 1).
 */
export const applyMovingAverage = (values: number[], window: number): number[] => {
  if (window <= 1 || values.length === 0) return values;
  
  const result = new Array(values.length);
  const half = Math.floor(window / 2);

  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count++;
      }
    }
    result[i] = sum / count;
  }
  return result;
};

/**
 * Aligns two datasets using linear interpolation for high precision.
 */
export const getOverlapData = (dataA: DataPoint[], dataB: DataPoint[]) => {
  if (dataA.length === 0 || dataB.length === 0) return [];

  const minW = Math.max(dataA[0].wavelength, dataB[0].wavelength);
  const maxW = Math.min(dataA[dataA.length - 1].wavelength, dataB[dataB.length - 1].wavelength);

  const step = 0.5;
  const common: { x: number; yA: number; yB: number }[] = [];

  const interpolate = (data: DataPoint[], targetW: number) => {
    const idx = data.findIndex(p => p.wavelength >= targetW);
    if (idx <= 0) return data[0].absorption;
    if (idx >= data.length) return data[data.length - 1].absorption;

    const p1 = data[idx - 1];
    const p2 = data[idx];
    const t = (targetW - p1.wavelength) / (p2.wavelength - p1.wavelength);
    return p1.absorption + t * (p2.absorption - p1.absorption);
  };

  for (let w = minW; w <= maxW; w += step) {
    common.push({
      x: w,
      yA: interpolate(dataA, w),
      yB: interpolate(dataB, w)
    });
  }

  return common;
};

/**
 * Normalizes an array of values based on the selected method.
 */
export const normalizeValues = (values: number[], method: NormalizationMethod): number[] => {
  if (method === 'none' || values.length === 0) return values;

  if (method === 'area') {
    const sum = values.reduce((a, b) => a + Math.abs(b), 0);
    return sum === 0 ? values : values.map(v => v / sum);
  }

  if (method === 'minmax') {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    return range === 0 ? values.map(() => 0) : values.map(v => (v - min) / range);
  }

  return values;
};

export const calculatePearson = (common: { yA: number; yB: number }[]): number => {
  const n = common.length;
  if (n < 2) return 0;

  const sumA = common.reduce((s, p) => s + p.yA, 0);
  const sumB = common.reduce((s, p) => s + p.yB, 0);
  const sumASq = common.reduce((s, p) => s + p.yA * p.yA, 0);
  const sumBSq = common.reduce((s, p) => s + p.yB * p.yB, 0);
  const sumProd = common.reduce((s, p) => s + p.yA * p.yB, 0);

  const num = n * sumProd - sumA * sumB;
  const den = Math.sqrt((n * sumASq - sumA * sumA) * (n * sumBSq - sumB * sumB));

  return den === 0 ? 0 : num / den;
};

export const calculateRMSE = (common: { yA: number; yB: number }[], method: NormalizationMethod): number => {
  const n = common.length;
  if (n === 0) return 0;
  
  const normA = normalizeValues(common.map(p => p.yA), method);
  const normB = normalizeValues(common.map(p => p.yB), method);
  
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += Math.pow(normA[i] - normB[i], 2);
  }
  return Math.sqrt(sumSq / n);
};

export const calculateEuclidean = (common: { yA: number; yB: number }[], method: NormalizationMethod): number => {
  if (common.length === 0) return 0;
  const normA = normalizeValues(common.map(p => p.yA), method);
  const normB = normalizeValues(common.map(p => p.yB), method);
  const sumSqDiff = normA.reduce((s, val, i) => s + Math.pow(val - normB[i], 2), 0);
  return Math.sqrt(sumSqDiff);
};

export const calculateCosineSimilarity = (common: { yA: number; yB: number }[]): number => {
  const dotProduct = common.reduce((s, p) => s + p.yA * p.yB, 0);
  const magA = Math.sqrt(common.reduce((s, p) => s + p.yA * p.yA, 0));
  const magB = Math.sqrt(common.reduce((s, p) => s + p.yB * p.yB, 0));
  return (magA === 0 || magB === 0) ? 0 : dotProduct / (magA * magB);
};

export const calculateSID = (common: { yA: number; yB: number }[]): number => {
  // SID always requires a probability distribution (area normalization)
  const p = normalizeValues(common.map(cp => Math.max(1e-10, cp.yA)), 'area');
  const q = normalizeValues(common.map(cp => Math.max(1e-10, cp.yB)), 'area');
  
  let sid = 0;
  for (let i = 0; i < p.length; i++) {
    sid += (p[i] - q[i]) * (Math.log(p[i]) - Math.log(q[i]));
  }
  return sid;
};
