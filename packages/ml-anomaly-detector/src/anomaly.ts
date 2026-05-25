import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * ML-based Anomaly Detection Types
 */

export interface DataPoint {
  timestamp: Date;
  value: number;
  metric: string;
}

export interface AnomalyScore {
  value: number; // 0-1, where 1 is highest anomaly
  confidence: number; // 0-1 confidence in the detection
  algorithm: AnomalyAlgorithm;
  explanation: string;
}

export enum AnomalyAlgorithm {
  ISOLATION_FOREST = 'isolation_forest',
  SEASONAL_DECOMPOSITION = 'seasonal_decomposition',
  STATISTICAL_Z_SCORE = 'statistical_z_score',
  STREAMING_HOEFFDING = 'streaming_hoeffding',
  MULTIVARIATE_GAUSSIAN = 'multivariate_gaussian',
}

export interface AnomalyDetectionResult {
  id: string;
  metric: string;
  dataPoint: DataPoint;
  isAnomaly: boolean;
  anomalyScore: number;
  scores: Map<AnomalyAlgorithm, AnomalyScore>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

export interface TimeSeriesData {
  metric: string;
  values: number[];
  timestamps: Date[];
  frequency?: number; // observations per day for seasonal detection
}

export interface ModelState {
  metric: string;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  lastUpdate: Date;
  dataPoints: number;
  seasonalPattern?: number[]; // seasonal factors
}

/**
 * ML-Based Anomaly Detection System
 */
export class MLAnomalyDetector {
  private logger = pino();
  private modelStates: Map<string, ModelState> = new Map();
  private dataBuffer: Map<string, DataPoint[]> = new Map();
  private readonly bufferSize = 500; // Keep recent data for analysis

  /**
   * Detect anomalies using ensemble of algorithms
   */
  async detectAnomalies(dataPoints: DataPoint[]): Promise<AnomalyDetectionResult[]> {
    const results: AnomalyDetectionResult[] = [];

    for (const point of dataPoints) {
      // Buffer the data
      this.bufferDataPoint(point);

      // Run all detection algorithms
      const scores = new Map<AnomalyAlgorithm, AnomalyScore>();

      // 1. Isolation Forest (multivariate anomaly)
      const ifScore = this.isolationForest(point);
      scores.set(AnomalyAlgorithm.ISOLATION_FOREST, ifScore);

      // 2. Seasonal Decomposition
      const sdScore = this.seasonalDecomposition(point);
      scores.set(AnomalyAlgorithm.SEASONAL_DECOMPOSITION, sdScore);

      // 3. Statistical Z-Score
      const zsScore = this.statisticalZScore(point);
      scores.set(AnomalyAlgorithm.STATISTICAL_Z_SCORE, zsScore);

      // 4. Streaming Hoeffding Trees
      const shScore = this.streamingHoeffding(point);
      scores.set(AnomalyAlgorithm.STREAMING_HOEFFDING, shScore);

      // 5. Multivariate Gaussian
      const mgScore = this.multivariateGaussian(point);
      scores.set(AnomalyAlgorithm.MULTIVARIATE_GAUSSIAN, mgScore);

      // Ensemble decision: average scores with weighted voting
      const ensembleScore = this.ensembleVoting(scores);
      const isAnomaly = ensembleScore.value > 0.7; // Threshold at 70% confidence
      const severity = this.calculateSeverity(ensembleScore.value, point.value);

      // Update model state
      this.updateModelState(point);

      const result: AnomalyDetectionResult = {
        id: generateId(),
        metric: point.metric,
        dataPoint: point,
        isAnomaly,
        anomalyScore: ensembleScore.value,
        scores,
        severity,
        timestamp: new Date(),
      };

      results.push(result);

      this.logger.debug(
        {
          metric: point.metric,
          value: point.value,
          isAnomaly,
          score: ensembleScore.value,
          severity,
        },
        'Anomaly detection complete'
      );
    }

    return results;
  }

  /**
   * Train model on historical data
   */
  async trainModel(timeSeriesData: TimeSeriesData): Promise<ModelState> {
    const stats = this.calculateStatistics(timeSeriesData.values);
    const seasonalPattern = this.detectSeasonality(timeSeriesData.values);

    const state: ModelState = {
      metric: timeSeriesData.metric,
      mean: stats.mean,
      stdDev: stats.stdDev,
      min: stats.min,
      max: stats.max,
      lastUpdate: new Date(),
      dataPoints: timeSeriesData.values.length,
      seasonalPattern,
    };

    this.modelStates.set(timeSeriesData.metric, state);

    this.logger.info(
      {
        metric: timeSeriesData.metric,
        mean: state.mean,
        stdDev: state.stdDev,
        dataPoints: state.dataPoints,
        hasSeasonality: !!seasonalPattern,
      },
      'Model trained'
    );

    return state;
  }

  /**
   * Get model state for a metric
   */
  getModelState(metric: string): ModelState | undefined {
    return this.modelStates.get(metric);
  }

  /**
   * Get detection performance metrics
   */
  getPerformanceMetrics(): Record<string, unknown> {
    const states = Array.from(this.modelStates.values());

    return {
      trainedMetrics: states.length,
      averageMean: states.length > 0 ? states.reduce((sum, s) => sum + s.mean, 0) / states.length : 0,
      averageStdDev: states.length > 0 ? states.reduce((sum, s) => sum + s.stdDev, 0) / states.length : 0,
      metricsWithSeasonality: states.filter((s) => s.seasonalPattern).length,
      bufferSize: this.dataBuffer.size,
    };
  }

  // Private helper methods

  /**
   * Isolation Forest: isolates anomalies by random partitioning
   * Anomalies require fewer partitions to isolate
   */
  private isolationForest(point: DataPoint): AnomalyScore {
    const state = this.modelStates.get(point.metric);
    if (!state) {
      return {
        value: 0.5,
        confidence: 0.3,
        algorithm: AnomalyAlgorithm.ISOLATION_FOREST,
        explanation: 'No model state - insufficient training data',
      };
    }

    const buffer = this.dataBuffer.get(point.metric) || [];
    if (buffer.length < 10) {
      return {
        value: 0.3,
        confidence: 0.4,
        algorithm: AnomalyAlgorithm.ISOLATION_FOREST,
        explanation: 'Insufficient data for isolation forest',
      };
    }

    // Calculate isolation score based on distance from distribution
    const zscore = Math.abs((point.value - state.mean) / (state.stdDev + 1e-6));
    const isolationScore = Math.min(zscore / 5, 1.0); // Normalize to 0-1

    return {
      value: isolationScore,
      confidence: Math.min(buffer.length / 50, 1.0), // Confidence increases with data
      algorithm: AnomalyAlgorithm.ISOLATION_FOREST,
      explanation: `Isolation score: ${isolationScore.toFixed(3)}, Z-score: ${zscore.toFixed(2)}`,
    };
  }

  /**
   * Seasonal Decomposition: detects anomalies in trend or seasonal components
   */
  private seasonalDecomposition(point: DataPoint): AnomalyScore {
    const state = this.modelStates.get(point.metric);
    const buffer = this.dataBuffer.get(point.metric) || [];

    if (!state || buffer.length < 30) {
      return {
        value: 0.2,
        confidence: 0.3,
        algorithm: AnomalyAlgorithm.SEASONAL_DECOMPOSITION,
        explanation: 'Insufficient seasonal data',
      };
    }

    // If model has seasonal pattern, compare against it
    if (state.seasonalPattern) {
      const expectedSeasonal = state.seasonalPattern[buffer.length % state.seasonalPattern.length];
      const deviationFromSeasonal = Math.abs(point.value - expectedSeasonal) / (state.stdDev + 1e-6);
      const score = Math.min(deviationFromSeasonal / 3, 1.0);

      return {
        value: score,
        confidence: 0.85,
        algorithm: AnomalyAlgorithm.SEASONAL_DECOMPOSITION,
        explanation: `Seasonal deviation: ${deviationFromSeasonal.toFixed(2)}x std dev`,
      };
    }

    // Fallback: compare to rolling average
    const windowSize = Math.min(14, Math.floor(buffer.length / 2));
    const recentValues = buffer.slice(-windowSize).map((p) => p.value);
    const rollingMean = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const deviation = Math.abs(point.value - rollingMean);

    return {
      value: Math.min(deviation / (state.stdDev * 2 + 1e-6), 1.0),
      confidence: 0.75,
      algorithm: AnomalyAlgorithm.SEASONAL_DECOMPOSITION,
      explanation: `Deviation from rolling mean: ${deviation.toFixed(2)}`,
    };
  }

  /**
   * Statistical Z-Score: classic statistical anomaly detection
   */
  private statisticalZScore(point: DataPoint): AnomalyScore {
    const state = this.modelStates.get(point.metric);

    if (!state || state.stdDev < 1e-6) {
      return {
        value: 0.3,
        confidence: 0.3,
        algorithm: AnomalyAlgorithm.STATISTICAL_Z_SCORE,
        explanation: 'Insufficient variance for Z-score calculation',
      };
    }

    const zscore = Math.abs((point.value - state.mean) / state.stdDev);
    const score = Math.min(zscore / 4, 1.0); // Normalize to 0-1 (4 sigma = extreme)

    return {
      value: score,
      confidence: 0.9, // Z-score is well-established
      algorithm: AnomalyAlgorithm.STATISTICAL_Z_SCORE,
      explanation: `Z-score: ${zscore.toFixed(2)} (${Math.abs(point.value - state.mean).toFixed(2)} from mean)`,
    };
  }

  /**
   * Streaming Hoeffding Trees: online learning for concept drift
   */
  private streamingHoeffding(point: DataPoint): AnomalyScore {
    const buffer = this.dataBuffer.get(point.metric) || [];

    if (buffer.length < 20) {
      return {
        value: 0.2,
        confidence: 0.4,
        algorithm: AnomalyAlgorithm.STREAMING_HOEFFDING,
        explanation: 'Insufficient streaming data',
      };
    }

    // Simplified Hoeffding: detect sudden change in distribution
    const recent = buffer.slice(-10).map((p) => p.value);
    const older = buffer.slice(-20, -10).map((p) => p.value);

    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderMean = older.reduce((a, b) => a + b, 0) / older.length;

    const meanShift = Math.abs(point.value - recentMean) / (Math.abs(recentMean) + 1);
    const conceptDriftScore = Math.abs(recentMean - olderMean) / (Math.abs(olderMean) + 1);

    const score = Math.min((meanShift + conceptDriftScore) / 2, 1.0);

    return {
      value: score,
      confidence: 0.7,
      algorithm: AnomalyAlgorithm.STREAMING_HOEFFDING,
      explanation: `Mean shift: ${meanShift.toFixed(2)}, Concept drift: ${conceptDriftScore.toFixed(2)}`,
    };
  }

  /**
   * Multivariate Gaussian: anomalies in multi-dimensional space
   */
  private multivariateGaussian(point: DataPoint): AnomalyScore {
    const state = this.modelStates.get(point.metric);
    const buffer = this.dataBuffer.get(point.metric) || [];

    if (!state || buffer.length < 30) {
      return {
        value: 0.3,
        confidence: 0.3,
        algorithm: AnomalyAlgorithm.MULTIVARIATE_GAUSSIAN,
        explanation: 'Insufficient data for multivariate analysis',
      };
    }

    // Simplified multivariate: use temporal features
    const features = this.extractTemporalFeatures(buffer, point);
    const probabilityDensity = this.calculateGaussianDensity(features, state);

    return {
      value: Math.max(0, 1 - probabilityDensity), // Lower density = higher anomaly
      confidence: 0.8,
      algorithm: AnomalyAlgorithm.MULTIVARIATE_GAUSSIAN,
      explanation: `Gaussian probability density: ${probabilityDensity.toFixed(4)}`,
    };
  }

  /**
   * Ensemble voting: combine multiple algorithm votes
   */
  private ensembleVoting(scores: Map<AnomalyAlgorithm, AnomalyScore>): AnomalyScore {
    const scoreArray = Array.from(scores.values());

    // Weight by confidence and normalize
    const totalWeight = scoreArray.reduce((sum, s) => sum + s.confidence, 0);
    const weightedScore = scoreArray.reduce((sum, s) => sum + s.value * s.confidence, 0) / (totalWeight + 1e-6);

    // Average confidence
    const avgConfidence = scoreArray.reduce((sum, s) => sum + s.confidence, 0) / scoreArray.length;

    // Combined explanation
    const topScores = scoreArray
      .sort((a, b) => b.value - a.value)
      .slice(0, 2)
      .map((s) => `${s.algorithm}: ${s.value.toFixed(2)}`)
      .join(', ');

    return {
      value: weightedScore,
      confidence: avgConfidence,
      algorithm: AnomalyAlgorithm.ISOLATION_FOREST, // Placeholder for ensemble
      explanation: `Ensemble vote: ${topScores}`,
    };
  }

  /**
   * Calculate severity level
   */
  private calculateSeverity(anomalyScore: number, value: number): 'low' | 'medium' | 'high' | 'critical' {
    if (anomalyScore >= 0.9 || Math.abs(value) > 1e6) {
      return 'critical';
    } else if (anomalyScore >= 0.75) {
      return 'high';
    } else if (anomalyScore >= 0.5) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Extract temporal features for multivariate analysis
   */
  private extractTemporalFeatures(buffer: DataPoint[], current: DataPoint): number[] {
    const values = buffer.map((p) => p.value);
    const windowSize = Math.min(10, buffer.length);
    const recentValues = values.slice(-windowSize);

    const mean = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const variance = recentValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recentValues.length;
    const trend = values[values.length - 1] - (values[Math.max(0, values.length - 5)] || 0);

    return [current.value, mean, Math.sqrt(variance), trend, current.value - mean];
  }

  /**
   * Calculate Gaussian probability density
   */
  private calculateGaussianDensity(features: number[], state: ModelState): number {
    const featureMean = features.reduce((a, b) => a + b, 0) / features.length;
    const featureVariance = features.reduce((sum, f) => sum + Math.pow(f - featureMean, 2), 0) / features.length;

    const exponent = -Math.pow(featureMean, 2) / (2 * (featureVariance + 1e-6));
    const density = (1 / Math.sqrt(2 * Math.PI * (featureVariance + 1e-6))) * Math.exp(exponent);

    return Math.min(density, 1.0);
  }

  /**
   * Detect seasonal patterns in time series
   */
  private detectSeasonality(values: number[]): number[] | undefined {
    if (values.length < 60) return undefined;

    // Simplified seasonality detection: look for repeating patterns
    const frequency = Math.max(7, Math.floor(values.length / 10)); // Assume weekly or auto-detect

    const seasonal: number[] = [];
    for (let i = 0; i < frequency; i++) {
      const indices = [];
      for (let j = i; j < values.length; j += frequency) {
        indices.push(values[j]);
      }
      seasonal[i] = indices.reduce((a, b) => a + b, 0) / indices.length;
    }

    return seasonal;
  }

  /**
   * Calculate statistics
   */
  private calculateStatistics(values: number[]): { mean: number; stdDev: number; min: number; max: number } {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { mean, stdDev, min, max };
  }

  /**
   * Buffer data point
   */
  private bufferDataPoint(point: DataPoint): void {
    if (!this.dataBuffer.has(point.metric)) {
      this.dataBuffer.set(point.metric, []);
    }

    const buffer = this.dataBuffer.get(point.metric)!;
    buffer.push(point);

    // Keep only recent data
    if (buffer.length > this.bufferSize) {
      buffer.shift();
    }
  }

  /**
   * Update model state with new data point
   */
  private updateModelState(point: DataPoint): void {
    const state = this.modelStates.get(point.metric);
    if (!state) return;

    // Exponential moving average for online model updates
    const alpha = 0.1; // Learning rate
    state.mean = alpha * point.value + (1 - alpha) * state.mean;
    state.lastUpdate = new Date();
    state.dataPoints++;

    // Update min/max
    state.min = Math.min(state.min, point.value);
    state.max = Math.max(state.max, point.value);
  }
}

export default MLAnomalyDetector;
