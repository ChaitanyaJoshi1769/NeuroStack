import pino from 'pino';
import { generateId } from '@neurostack/shared';
import { DataPoint } from '@neurostack/ml-anomaly-detector';

/**
 * Advanced ML Models Types
 */

export interface TimeSeriesDataPoint {
  timestamp: Date;
  value: number;
  seasonalFactor?: number;
  trendComponent?: number;
}

export interface ForecastResult {
  timestamp: Date;
  forecast: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  confidence: number;
}

export interface TimeSeriesDecomposition {
  trend: number[];
  seasonal: number[];
  residual: number[];
  seasonalPeriod: number;
}

export interface AnomalyScoreAdvanced {
  value: number; // 0-1
  type: 'historical' | 'seasonal' | 'trend' | 'residual';
  explanation: string;
  confidence: number;
}

/**
 * Prophet-like Time Series Forecasting Model
 *
 * Implements seasonal decomposition with trend analysis
 */
export class ProphetModel {
  private logger = pino();
  private trend: number[] = [];
  private seasonal: number[] = [];
  private residual: number[] = [];
  private seasonalPeriod: number = 7; // Default weekly
  private trained: boolean = false;

  constructor(private historicalData: TimeSeriesDataPoint[] = []) {}

  /**
   * Train the model
   */
  fit(): void {
    if (this.historicalData.length < 14) {
      this.logger.warn('Insufficient data for Prophet model training');
      return;
    }

    // Step 1: Detect seasonal period
    this.seasonalPeriod = this.detectSeasonalPeriod();

    // Step 2: Extract trend component
    this.trend = this.extractTrend();

    // Step 3: Extract seasonal component
    this.seasonal = this.extractSeasonal();

    // Step 4: Calculate residuals
    this.residual = this.calculateResiduals();

    this.trained = true;

    this.logger.info(
      {
        dataPoints: this.historicalData.length,
        seasonalPeriod: this.seasonalPeriod,
        trendVariance: this.calculateVariance(this.trend),
      },
      'Prophet model trained'
    );
  }

  /**
   * Forecast future values
   */
  forecast(periods: number = 7): ForecastResult[] {
    if (!this.trained) {
      this.fit();
    }

    const results: ForecastResult[] = [];
    const lastDate = this.historicalData[this.historicalData.length - 1]?.timestamp || new Date();

    for (let i = 1; i <= periods; i++) {
      const forecastDate = new Date(lastDate.getTime() + i * 24 * 60 * 60 * 1000);

      // Trend component: extrapolate linear trend
      const trendValue = this.forecastTrend(i);

      // Seasonal component: repeat pattern
      const seasonalIndex = (this.historicalData.length + i) % this.seasonalPeriod;
      const seasonalValue = this.seasonal[seasonalIndex] || 0;

      // Combined forecast
      const forecast = trendValue + seasonalValue;

      // Confidence interval based on residual variance
      const residualStd = this.calculateStdDev(this.residual);
      const confidenceInterval = {
        lower: forecast - 1.96 * residualStd,
        upper: forecast + 1.96 * residualStd,
      };

      results.push({
        timestamp: forecastDate,
        forecast,
        confidenceInterval,
        confidence: Math.min(0.95, 0.7 + (this.historicalData.length / 1000) * 0.25),
      });
    }

    return results;
  }

  /**
   * Get model decomposition
   */
  getDecomposition(): TimeSeriesDecomposition {
    return {
      trend: this.trend,
      seasonal: this.seasonal,
      residual: this.residual,
      seasonalPeriod: this.seasonalPeriod,
    };
  }

  // Private methods

  private detectSeasonalPeriod(): number {
    if (this.historicalData.length < 28) return 7; // Default to weekly

    // Try to find dominant period using autocorrelation
    const values = this.historicalData.map((d) => d.value);
    const periods = [7, 14, 30, 365]; // Common periods

    let bestPeriod = 7;
    let bestCorrelation = -1;

    for (const period of periods) {
      if (period > values.length / 2) continue;

      const correlation = this.calculateAutocorrelation(values, period);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }

    return bestPeriod;
  }

  private extractTrend(): number[] {
    const values = this.historicalData.map((d) => d.value);

    // Use moving average to extract trend
    const windowSize = Math.max(3, Math.floor(this.seasonalPeriod / 2));
    const trend: number[] = [];

    for (let i = 0; i < values.length; i++) {
      let sum = 0;
      let count = 0;

      for (let j = i - windowSize; j <= i + windowSize; j++) {
        if (j >= 0 && j < values.length) {
          sum += values[j];
          count++;
        }
      }

      trend.push(sum / count);
    }

    return trend;
  }

  private extractSeasonal(): number[] {
    const values = this.historicalData.map((d) => d.value);
    const seasonal: number[] = new Array(this.seasonalPeriod).fill(0);
    const counts: number[] = new Array(this.seasonalPeriod).fill(0);

    // Calculate average seasonal pattern
    for (let i = 0; i < values.length; i++) {
      const detrended = values[i] - this.trend[i];
      const seasonalIndex = i % this.seasonalPeriod;
      seasonal[seasonalIndex] += detrended;
      counts[seasonalIndex]++;
    }

    // Average and center
    for (let i = 0; i < seasonal.length; i++) {
      seasonal[i] = counts[i] > 0 ? seasonal[i] / counts[i] : 0;
    }

    // Center seasonal components around zero
    const mean = seasonal.reduce((a, b) => a + b, 0) / seasonal.length;
    return seasonal.map((s) => s - mean);
  }

  private calculateResiduals(): number[] {
    const values = this.historicalData.map((d) => d.value);
    return values.map((v, i) => v - this.trend[i] - this.seasonal[i % this.seasonalPeriod]);
  }

  private forecastTrend(steps: number): number {
    if (this.trend.length < 2) return this.trend[0] || 0;

    // Linear extrapolation of trend
    const lastTrend = this.trend[this.trend.length - 1];
    const prevTrend = this.trend[this.trend.length - 2];
    const slope = lastTrend - prevTrend;

    return lastTrend + slope * steps;
  }

  private calculateAutocorrelation(values: number[], lag: number): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < values.length - lag; i++) {
      numerator += (values[i] - mean) * (values[i + lag] - mean);
      denominator += Math.pow(values[i] - mean, 2);
    }

    return denominator !== 0 ? numerator / denominator : 0;
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }

  private calculateStdDev(values: number[]): number {
    return Math.sqrt(this.calculateVariance(values));
  }
}

/**
 * LSTM-like Neural Network for Time Series Prediction
 *
 * Simplified LSTM-inspired model for sequence learning
 */
export class LSTMModel {
  private logger = pino();
  private weights: number[][] = [];
  private bias: number[] = [];
  private sequenceLength: number = 10;
  private trained: boolean = false;

  constructor(private historicalData: TimeSeriesDataPoint[] = [], sequenceLength: number = 10) {
    this.sequenceLength = sequenceLength;
  }

  /**
   * Train the model
   */
  fit(): void {
    if (this.historicalData.length < this.sequenceLength * 2) {
      this.logger.warn('Insufficient data for LSTM model training');
      return;
    }

    // Initialize weights
    this.weights = this.initializeWeights();
    this.bias = this.initializeBias();

    // Training loop (simplified)
    const learningRate = 0.01;
    const epochs = 10;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const sequences = this.createSequences();

      for (const seq of sequences) {
        this.trainOnSequence(seq, learningRate);
      }
    }

    this.trained = true;

    this.logger.info(
      {
        dataPoints: this.historicalData.length,
        sequenceLength: this.sequenceLength,
        weights: this.weights.length,
      },
      'LSTM model trained'
    );
  }

  /**
   * Predict future values
   */
  predict(steps: number = 7): ForecastResult[] {
    if (!this.trained) {
      this.fit();
    }

    const results: ForecastResult[] = [];
    const lastDate = this.historicalData[this.historicalData.length - 1]?.timestamp || new Date();

    // Start with last sequence
    let currentSequence = this.historicalData
      .slice(-this.sequenceLength)
      .map((d) => d.value);

    for (let i = 1; i <= steps; i++) {
      const prediction = this.forwardPass(currentSequence);
      const forecastDate = new Date(lastDate.getTime() + i * 24 * 60 * 60 * 1000);

      // Confidence decreases with prediction distance
      const confidence = Math.max(0.5, 1 - i / (steps * 2));

      results.push({
        timestamp: forecastDate,
        forecast: prediction,
        confidenceInterval: {
          lower: prediction * 0.95,
          upper: prediction * 1.05,
        },
        confidence,
      });

      // Update sequence for next prediction
      currentSequence = [...currentSequence.slice(1), prediction];
    }

    return results;
  }

  /**
   * Detect anomalies using prediction error
   */
  detectAnomalies(testData: TimeSeriesDataPoint[]): AnomalyScoreAdvanced[] {
    const results: AnomalyScoreAdvanced[] = [];

    if (!this.trained) {
      this.fit();
    }

    for (const point of testData) {
      // Get sequence leading up to this point
      const sequence = this.historicalData
        .slice(-this.sequenceLength)
        .map((d) => d.value);

      const prediction = this.forwardPass(sequence);
      const error = Math.abs(point.value - prediction);
      const stdDev = this.calculateStdDev(this.historicalData.map((d) => d.value));

      const zScore = error / (stdDev + 1e-6);
      const anomalyScore = Math.min(zScore / 3, 1.0); // Normalize to 0-1

      results.push({
        value: anomalyScore,
        type: 'residual',
        explanation: `Prediction error: ${error.toFixed(2)} (Z-score: ${zScore.toFixed(2)})`,
        confidence: Math.min(0.95, 0.5 + (zScore / 4) * 0.5),
      });
    }

    return results;
  }

  // Private methods

  private initializeWeights(): number[][] {
    // Initialize with small random values
    const layers = 3;
    const weights: number[][] = [];

    for (let i = 0; i < layers; i++) {
      const layerWeights: number[] = [];
      for (let j = 0; j < this.sequenceLength; j++) {
        layerWeights.push((Math.random() - 0.5) * 0.1);
      }
      weights.push(layerWeights);
    }

    return weights;
  }

  private initializeBias(): number[] {
    return [0, 0, 0];
  }

  private createSequences(): number[][] {
    const sequences: number[][] = [];
    const values = this.historicalData.map((d) => d.value);

    for (let i = 0; i < values.length - this.sequenceLength; i++) {
      sequences.push(values.slice(i, i + this.sequenceLength + 1));
    }

    return sequences;
  }

  private trainOnSequence(sequence: number[], learningRate: number): void {
    // Simplified backpropagation
    const input = sequence.slice(0, -1);
    const target = sequence[sequence.length - 1];

    const prediction = this.forwardPass(input);
    const error = target - prediction;

    // Update weights based on error
    for (let i = 0; i < this.weights.length; i++) {
      for (let j = 0; j < this.weights[i].length; j++) {
        this.weights[i][j] += learningRate * error * input[j];
      }
      this.bias[i] += learningRate * error;
    }
  }

  private forwardPass(input: number[]): number {
    let output = 0;

    for (let i = 0; i < this.weights.length; i++) {
      let layerOutput = 0;

      for (let j = 0; j < Math.min(input.length, this.weights[i].length); j++) {
        layerOutput += input[j] * this.weights[i][j];
      }

      layerOutput += this.bias[i];
      output += this.tanh(layerOutput); // Activation function
    }

    return output;
  }

  private tanh(x: number): number {
    return (Math.exp(x) - Math.exp(-x)) / (Math.exp(x) + Math.exp(-x));
  }

  private calculateStdDev(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
}

export default {
  ProphetModel,
  LSTMModel,
};
