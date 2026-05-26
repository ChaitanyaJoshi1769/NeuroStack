import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';

export type TransformerType =
  | 'scaling'
  | 'encoding'
  | 'binning'
  | 'normalization'
  | 'polynomial'
  | 'interaction'
  | 'aggregation'
  | 'temporal'
  | 'text'
  | 'missing';

export interface TransformerConfig {
  transformerId: string;
  name: string;
  type: TransformerType;
  inputColumns: string[];
  outputColumns: string[];
  parameters?: Record<string, any>;
  enabled?: boolean;
}

export interface ScalingConfig extends TransformerConfig {
  method: 'standard' | 'minmax' | 'robust' | 'log';
  mean?: number;
  std?: number;
  min?: number;
  max?: number;
}

export interface EncodingConfig extends TransformerConfig {
  method: 'onehot' | 'label' | 'ordinal' | 'binary' | 'frequency';
  categories?: string[];
  handleUnknown?: 'error' | 'ignore' | 'use_encoded_value';
}

export interface BinningConfig extends TransformerConfig {
  method: 'equal_width' | 'equal_frequency' | 'kmeans' | 'custom';
  numBins?: number;
  edges?: number[];
}

export interface FeatureInteractionConfig extends TransformerConfig {
  interactionType: 'multiplication' | 'division' | 'addition' | 'subtraction';
  column1: string;
  column2: string;
}

export interface PolynomialConfig extends TransformerConfig {
  degree: number;
  includeInteractions?: boolean;
}

export interface TransformationStep {
  stepId: string;
  transformerId: string;
  config: TransformerConfig;
  order: number;
}

export interface FeatureEngineeringPipeline {
  pipelineId: string;
  name: string;
  description?: string;
  steps: TransformationStep[];
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  createdAt: Date;
  version: number;
}

export interface TransformationResult {
  data: Record<string, any>;
  appliedSteps: string[];
  errors: string[];
  metadata: Record<string, any>;
}

export interface FeatureStatistics {
  featureName: string;
  mean?: number;
  std?: number;
  min?: number;
  max?: number;
  median?: number;
  skewness?: number;
  kurtosis?: number;
  uniqueCount?: number;
  nullCount?: number;
  dataType: string;
}

export interface FeatureImportance {
  featureName: string;
  importance: number;
  method: string;
  correlationWithTarget: number;
}

export class FeatureEngineeringEngine {
  private logger: Logger;
  private pipelines: Map<string, FeatureEngineeringPipeline>;
  private transformers: Map<string, TransformerConfig>;
  private pipelineHistory: Array<{ pipelineId: string; version: number; timestamp: Date }>;
  private featureStatistics: Map<string, FeatureStatistics>;
  private readonly maxPipelinesInMemory = 1000;

  constructor(private distributedLogger: DistributedLogger, logger: Logger) {
    this.logger = logger.child({ component: 'FeatureEngineeringEngine' });
    this.pipelines = new Map();
    this.transformers = new Map();
    this.pipelineHistory = [];
    this.featureStatistics = new Map();
  }

  async createPipeline(pipeline: FeatureEngineeringPipeline): Promise<string> {
    try {
      this.pipelines.set(pipeline.pipelineId, pipeline);
      this.pipelineHistory.push({
        pipelineId: pipeline.pipelineId,
        version: pipeline.version,
        timestamp: new Date(),
      });

      await this.distributedLogger.log({
        level: 'info',
        message: `Feature engineering pipeline created: ${pipeline.pipelineId}`,
        metadata: {
          name: pipeline.name,
          steps: pipeline.steps.length,
          inputColumns: Object.keys(pipeline.inputSchema).length,
        },
      });

      return pipeline.pipelineId;
    } catch (error) {
      this.logger.error({ error, pipelineId: pipeline.pipelineId }, 'Failed to create pipeline');
      throw error;
    }
  }

  async addTransformationStep(
    pipelineId: string,
    step: TransformationStep,
    config: TransformerConfig
  ): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    this.transformers.set(config.transformerId, config);
    pipeline.steps.push(step);
    pipeline.steps.sort((a, b) => a.order - b.order);
    pipeline.version++;
  }

  async transformData(pipelineId: string, data: Record<string, any>): Promise<TransformationResult> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    let result = { ...data };
    const appliedSteps: string[] = [];
    const errors: string[] = [];

    try {
      for (const step of pipeline.steps) {
        const config = this.transformers.get(step.transformerId);
        if (!config || !config.enabled) continue;

        try {
          switch (config.type) {
            case 'scaling':
              result = await this.applyScaling(result, config as ScalingConfig);
              break;
            case 'encoding':
              result = await this.applyEncoding(result, config as EncodingConfig);
              break;
            case 'binning':
              result = await this.applyBinning(result, config as BinningConfig);
              break;
            case 'normalization':
              result = await this.applyNormalization(result, config);
              break;
            case 'polynomial':
              result = await this.applyPolynomial(result, config as PolynomialConfig);
              break;
            case 'interaction':
              result = await this.applyInteraction(result, config as FeatureInteractionConfig);
              break;
            case 'aggregation':
              result = await this.applyAggregation(result, config);
              break;
            case 'temporal':
              result = await this.applyTemporal(result, config);
              break;
            case 'text':
              result = await this.applyTextTransformation(result, config);
              break;
            case 'missing':
              result = await this.handleMissing(result, config);
              break;
          }
          appliedSteps.push(step.stepId);
        } catch (stepError) {
          errors.push(`Step ${step.stepId} failed: ${stepError}`);
        }
      }

      return {
        data: result,
        appliedSteps,
        errors,
        metadata: {
          pipelineId,
          timestamp: new Date().toISOString(),
          stepsApplied: appliedSteps.length,
          stepsWithErrors: errors.length,
        },
      };
    } catch (error) {
      this.logger.error({ error, pipelineId }, 'Data transformation failed');
      throw error;
    }
  }

  private async applyScaling(data: Record<string, any>, config: ScalingConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const value = result[col];
      if (value === null || value === undefined) continue;

      switch (config.method) {
        case 'standard':
          if (config.mean !== undefined && config.std !== undefined) {
            result[col] = (value - config.mean) / config.std;
          }
          break;
        case 'minmax':
          if (config.min !== undefined && config.max !== undefined) {
            result[col] = (value - config.min) / (config.max - config.min);
          }
          break;
        case 'robust':
          // Scaling using median and IQR
          result[col] = value; // Placeholder
          break;
        case 'log':
          result[col] = Math.log(value + 1);
          break;
      }
    }

    return result;
  }

  private async applyEncoding(data: Record<string, any>, config: EncodingConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const value = result[col];
      if (value === null || value === undefined) continue;

      switch (config.method) {
        case 'onehot':
          // Create binary columns for each category
          if (config.categories) {
            for (const category of config.categories) {
              result[`${col}_${category}`] = value === category ? 1 : 0;
            }
            delete result[col];
          }
          break;
        case 'label':
          // Convert categories to integers
          if (config.categories) {
            result[col] = config.categories.indexOf(value as string);
          }
          break;
        case 'ordinal':
          // Similar to label encoding
          result[col] = value;
          break;
        case 'binary':
          result[col] = value === true || value === 1 ? 1 : 0;
          break;
        case 'frequency':
          // Frequency-based encoding (would need data statistics)
          result[col] = value;
          break;
      }
    }

    return result;
  }

  private async applyBinning(data: Record<string, any>, config: BinningConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const value = result[col];
      if (value === null || value === undefined) continue;

      switch (config.method) {
        case 'equal_width':
          if (config.edges) {
            let binIndex = 0;
            for (let i = 0; i < config.edges.length; i++) {
              if (value < config.edges[i]) {
                binIndex = i;
                break;
              }
              binIndex = i + 1;
            }
            result[`${col}_binned`] = binIndex;
          }
          break;
        case 'equal_frequency':
          result[`${col}_binned`] = value; // Placeholder
          break;
        case 'kmeans':
          result[`${col}_cluster`] = 0; // Placeholder
          break;
        case 'custom':
          result[`${col}_binned`] = value; // Placeholder
          break;
      }
    }

    return result;
  }

  private async applyNormalization(data: Record<string, any>, config: TransformerConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const value = result[col];
      if (value === null || value === undefined) continue;

      // L2 normalization
      if (typeof value === 'number') {
        result[col] = value / Math.sqrt(Object.values(result).reduce((a, b) => a + (b as number) * (b as number), 0));
      }
    }

    return result;
  }

  private async applyPolynomial(data: Record<string, any>, config: PolynomialConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const value = result[col];
      if (value === null || value === undefined || typeof value !== 'number') continue;

      for (let d = 2; d <= config.degree; d++) {
        result[`${col}_pow${d}`] = Math.pow(value, d);
      }

      if (config.includeInteractions && config.inputColumns.length > 1) {
        // Interaction features
        for (let i = 0; i < config.inputColumns.length; i++) {
          for (let j = i + 1; j < config.inputColumns.length; j++) {
            const col1 = config.inputColumns[i];
            const col2 = config.inputColumns[j];
            const val2 = result[col2];
            if (typeof val2 === 'number') {
              result[`${col1}_x_${col2}`] = value * val2;
            }
          }
        }
      }
    }

    return result;
  }

  private async applyInteraction(data: Record<string, any>, config: FeatureInteractionConfig): Promise<Record<string, any>> {
    const result = { ...data };

    const val1 = result[config.column1];
    const val2 = result[config.column2];

    if (val1 === null || val2 === null || val1 === undefined || val2 === undefined) {
      return result;
    }

    switch (config.interactionType) {
      case 'multiplication':
        result[config.outputColumns[0]] = val1 * val2;
        break;
      case 'division':
        result[config.outputColumns[0]] = val1 / (val2 || 1);
        break;
      case 'addition':
        result[config.outputColumns[0]] = val1 + val2;
        break;
      case 'subtraction':
        result[config.outputColumns[0]] = val1 - val2;
        break;
    }

    return result;
  }

  private async applyAggregation(data: Record<string, any>, config: TransformerConfig): Promise<Record<string, any>> {
    const result = { ...data };
    const values = config.inputColumns.map(col => result[col]).filter(v => v !== null && v !== undefined);

    if (values.length === 0) return result;

    const aggMethod = config.parameters?.method || 'mean';
    let aggregated = 0;

    switch (aggMethod) {
      case 'mean':
        aggregated = values.reduce((a, b) => a + (b as number), 0) / values.length;
        break;
      case 'sum':
        aggregated = values.reduce((a, b) => a + (b as number), 0);
        break;
      case 'max':
        aggregated = Math.max(...(values as number[]));
        break;
      case 'min':
        aggregated = Math.min(...(values as number[]));
        break;
    }

    result[config.outputColumns[0]] = aggregated;
    return result;
  }

  private async applyTemporal(data: Record<string, any>, config: TransformerConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const date = new Date(result[col]);
      if (isNaN(date.getTime())) continue;

      result[`${col}_year`] = date.getFullYear();
      result[`${col}_month`] = date.getMonth() + 1;
      result[`${col}_day`] = date.getDate();
      result[`${col}_dayofweek`] = date.getDay();
      result[`${col}_hour`] = date.getHours();
      result[`${col}_dayofyear`] = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
    }

    return result;
  }

  private async applyTextTransformation(data: Record<string, any>, config: TransformerConfig): Promise<Record<string, any>> {
    const result = { ...data };

    for (const col of config.inputColumns) {
      const text = result[col];
      if (typeof text !== 'string') continue;

      const method = config.parameters?.method || 'length';
      switch (method) {
        case 'length':
          result[`${col}_length`] = text.length;
          break;
        case 'word_count':
          result[`${col}_word_count`] = text.split(/\s+/).length;
          break;
        case 'uppercase':
          result[`${col}_uppercase_count`] = (text.match(/[A-Z]/g) || []).length;
          break;
        case 'special_chars':
          result[`${col}_special_count`] = (text.match(/[^a-zA-Z0-9\s]/g) || []).length;
          break;
      }
    }

    return result;
  }

  private async handleMissing(data: Record<string, any>, config: TransformerConfig): Promise<Record<string, any>> {
    const result = { ...data };
    const strategy = config.parameters?.strategy || 'mean';

    for (const col of config.inputColumns) {
      if (result[col] === null || result[col] === undefined) {
        switch (strategy) {
          case 'mean':
            result[col] = 0; // Would use actual mean from statistics
            break;
          case 'median':
            result[col] = 0; // Would use actual median
            break;
          case 'mode':
            result[col] = 'unknown'; // Would use actual mode
            break;
          case 'drop':
            delete result[col];
            break;
          case 'forward_fill':
            result[col] = result[col]; // Placeholder
            break;
        }
      }
    }

    return result;
  }

  async calculateStatistics(featureName: string, values: any[]): Promise<FeatureStatistics> {
    const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v)) as number[];
    const nullCount = values.filter(v => v === null || v === undefined).length;

    numericValues.sort((a, b) => a - b);

    const stats: FeatureStatistics = {
      featureName,
      dataType: typeof values[0],
      nullCount,
      uniqueCount: new Set(values).size,
    };

    if (numericValues.length > 0) {
      const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      const variance = numericValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numericValues.length;

      stats.mean = mean;
      stats.std = Math.sqrt(variance);
      stats.min = numericValues[0];
      stats.max = numericValues[numericValues.length - 1];
      stats.median = numericValues[Math.floor(numericValues.length / 2)];

      // Skewness
      const cubed = numericValues.map(v => Math.pow(v - mean, 3)).reduce((a, b) => a + b, 0) / numericValues.length;
      stats.skewness = cubed / Math.pow(stats.std || 1, 3);

      // Kurtosis (simplified)
      const fourth = numericValues.map(v => Math.pow(v - mean, 4)).reduce((a, b) => a + b, 0) / numericValues.length;
      stats.kurtosis = fourth / Math.pow(stats.std || 1, 4) - 3;
    }

    this.featureStatistics.set(featureName, stats);
    return stats;
  }

  async getFeatureStatistics(featureName: string): Promise<FeatureStatistics | undefined> {
    return this.featureStatistics.get(featureName);
  }

  async getPipeline(pipelineId: string): Promise<FeatureEngineeringPipeline | undefined> {
    return this.pipelines.get(pipelineId);
  }

  async listPipelines(): Promise<FeatureEngineeringPipeline[]> {
    return Array.from(this.pipelines.values());
  }

  async getPipelineHistory(pipelineId: string): Promise<Array<{ version: number; timestamp: Date }>> {
    return this.pipelineHistory
      .filter(h => h.pipelineId === pipelineId)
      .map(h => ({ version: h.version, timestamp: h.timestamp }));
  }
}
