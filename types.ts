
export interface DataPoint {
  wavelength: number;
  absorption: number;
}

export interface WaterSample {
  id: string;
  name: string;
  data: DataPoint[];
  color: string;
}

export type NormalizationMethod = 'none' | 'area' | 'minmax';

export interface SimilarityResult {
  sampleA: string;
  sampleB: string;
  pearson: number;
  rmse: number;
  euclidean: number;
  cosine: number;
  sid: number; // Spectral Information Divergence
}

export interface ComparisonReport {
  samples: WaterSample[];
  similarityMatrix: SimilarityResult[];
}
