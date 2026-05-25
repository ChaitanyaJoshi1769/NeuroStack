import pino from 'pino';
import LRU from 'lru-cache';
import { generateId } from '@neurostack/shared';
import { ProphetModel, LSTMModel, TimeSeriesDataPoint } from '@neurostack/advanced-ml';

/**
 * Model Serving Types
 */

export interface InferenceRequest {
  requestId: string;
  modelType: 'prophet' | 'lstm' | 'anomaly';
  modelId: string;
  data: TimeSeriesDataPoint[];
  parameters?: Record<string, any>;
  timestamp: Date;
  priority: 'low' | 'normal' | 'high';
}

export interface InferenceResult {
  requestId: string;
  modelType: string;
  modelId: string;
  predictions: any;
  confidence: number;
  latency: number; // milliseconds
  cached: boolean;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ModelStats {
  modelId: string;
  modelType: string;
  totalInferences: number;
  totalLatency: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  errorCount: number;
  lastInferenceTime: Date;
}

export interface BatchInferenceRequest {
  batchId: string;
  requests: InferenceRequest[];
  timeout: number;
}

export interface BatchInferenceResult {
  batchId: string;
  results: InferenceResult[];
  totalLatency: number;
  processingTime: number;
  successCount: number;
  errorCount: number;
}

export interface ModelRegistry {
  modelId: string;
  modelType: string;
  version: string;
  trainingDate: Date;
  metrics: {
    precision?: number;
    recall?: number;
    f1Score?: number;
    mape?: number;
  };
  status: 'active' | 'inactive' | 'archived';
}

/**
 * Model Serving Engine
 *
 * Production-grade model serving with:
 * - Request batching and pipelining
 * - Result caching with LRU eviction
 * - Model versioning and registry
 * - Performance monitoring
 * - Latency tracking and optimization
 */
export class ModelServingEngine {
  private logger = pino();
  private cache: LRU<string, InferenceResult>;
  private modelRegistry: Map<string, ModelRegistry> = new Map();
  private modelStats: Map<string, ModelStats> = new Map();
  private requestQueue: InferenceRequest[] = [];
  private activeModels: Map<string, ProphetModel | LSTMModel> = new Map();
  private readonly maxBatchSize = 32;
  private readonly batchTimeoutMs = 100;
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly cacheMaxSize = 10000;
  private readonly cacheTTL = 3600000; // 1 hour

  constructor() {
    this.cache = new LRU<string, InferenceResult>({
      max: this.cacheMaxSize,
      ttl: this.cacheTTL,
    });
  }

  /**
   * Register a trained model
   */
  registerModel(
    modelId: string,
    modelType: 'prophet' | 'lstm',
    model: ProphetModel | LSTMModel,
    version: string = '1.0.0',
    metrics?: any
  ): void {
    this.activeModels.set(modelId, model);

    const registry: ModelRegistry = {
      modelId,
      modelType,
      version,
      trainingDate: new Date(),
      metrics: metrics || {},
      status: 'active',
    };

    this.modelRegistry.set(modelId, registry);

    this.modelStats.set(modelId, {
      modelId,
      modelType,
      totalInferences: 0,
      totalLatency: 0,
      avgLatency: 0,
      minLatency: Number.MAX_VALUE,
      maxLatency: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      errorCount: 0,
      lastInferenceTime: new Date(),
    });

    this.logger.info({ modelId, modelType, version }, 'Model registered');
  }

  /**
   * Run single inference request
   */
  async inference(request: InferenceRequest): Promise<InferenceResult> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(request);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.updateStats(request.modelId, startTime, true, false);
      return { ...cached, requestId: request.requestId, cached: true };
    }

    try {
      const result = await this.executeInference(request);
      result.cached = false;

      // Cache result
      this.cache.set(cacheKey, result);

      const latency = Date.now() - startTime;
      this.updateStats(request.modelId, startTime, false, false);

      this.logger.debug(
        {
          requestId: request.requestId,
          modelId: request.modelId,
          latency,
        },
        'Inference completed'
      );

      return result;
    } catch (error) {
      this.updateStats(request.modelId, startTime, false, true);
      throw error;
    }
  }

  /**
   * Batch inference for multiple requests
   */
  async batchInference(batchRequest: BatchInferenceRequest): Promise<BatchInferenceResult> {
    const startTime = Date.now();
    const results: InferenceResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Process requests in parallel (respecting max batch size)
    const chunks = this.chunkArray(batchRequest.requests, this.maxBatchSize);

    for (const chunk of chunks) {
      const promises = chunk.map((req) =>
        this.inference(req).catch((error) => {
          errorCount++;
          this.logger.error({ error, requestId: req.requestId }, 'Batch request failed');
          return null;
        })
      );

      const chunkResults = await Promise.all(promises);
      for (const result of chunkResults) {
        if (result) {
          results.push(result);
          successCount++;
        }
      }
    }

    const processingTime = Date.now() - startTime;

    const batchResult: BatchInferenceResult = {
      batchId: batchRequest.batchId,
      results,
      totalLatency: results.reduce((sum, r) => sum + r.latency, 0),
      processingTime,
      successCount,
      errorCount,
    };

    this.logger.info(
      {
        batchId: batchRequest.batchId,
        requestCount: batchRequest.requests.length,
        successCount,
        errorCount,
        processingTime,
      },
      'Batch inference completed'
    );

    return batchResult;
  }

  /**
   * Get model statistics
   */
  getModelStats(modelId: string): ModelStats | undefined {
    return this.modelStats.get(modelId);
  }

  /**
   * Get all model statistics
   */
  getAllModelStats(): ModelStats[] {
    return Array.from(this.modelStats.values());
  }

  /**
   * Get model registry entry
   */
  getModelRegistry(modelId: string): ModelRegistry | undefined {
    return this.modelRegistry.get(modelId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    const totalRequests = Array.from(this.modelStats.values()).reduce(
      (sum, s) => sum + s.cacheHits + s.cacheMisses,
      0
    );
    const totalHits = Array.from(this.modelStats.values()).reduce((sum, s) => sum + s.cacheHits, 0);

    return {
      size: this.cache.size,
      maxSize: this.cacheMaxSize,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
    };
  }

  /**
   * Clear cache for specific model
   */
  clearModelCache(modelId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${modelId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    this.logger.info({ modelId, clearedCount: keysToDelete.length }, 'Model cache cleared');
  }

  /**
   * List active models
   */
  listActiveModels(): ModelRegistry[] {
    return Array.from(this.modelRegistry.values()).filter((m) => m.status === 'active');
  }

  // Private methods

  private async executeInference(request: InferenceRequest): Promise<InferenceResult> {
    const model = this.activeModels.get(request.modelId);
    if (!model) {
      throw new Error(`Model not found: ${request.modelId}`);
    }

    const startTime = Date.now();
    let predictions: any;

    if (request.modelType === 'prophet' && model instanceof ProphetModel) {
      const periods = request.parameters?.periods || 7;
      predictions = model.forecast(periods);
    } else if (request.modelType === 'lstm' && model instanceof LSTMModel) {
      const steps = request.parameters?.steps || 7;
      predictions = model.predict(steps);
    } else {
      throw new Error(`Unsupported model type: ${request.modelType}`);
    }

    const latency = Date.now() - startTime;

    return {
      requestId: request.requestId,
      modelType: request.modelType,
      modelId: request.modelId,
      predictions,
      confidence: this.calculateConfidence(predictions),
      latency,
      cached: false,
      timestamp: new Date(),
      metadata: {
        dataPoints: request.data.length,
        parameters: request.parameters,
      },
    };
  }

  private calculateConfidence(predictions: any): number {
    if (Array.isArray(predictions) && predictions.length > 0) {
      // Average confidence from individual predictions
      const confidences = predictions.map((p: any) => p.confidence || 0.8);
      return confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
    }
    return 0.8;
  }

  private generateCacheKey(request: InferenceRequest): string {
    // Create deterministic cache key
    const dataHash = this.simpleHash(JSON.stringify(request.data));
    const paramHash = this.simpleHash(JSON.stringify(request.parameters || {}));

    return `${request.modelId}:${request.modelType}:${dataHash}:${paramHash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private updateStats(
    modelId: string,
    startTime: number,
    cacheHit: boolean,
    isError: boolean
  ): void {
    let stats = this.modelStats.get(modelId);
    if (!stats) return;

    const latency = Date.now() - startTime;

    stats.totalInferences++;
    stats.totalLatency += latency;
    stats.avgLatency = stats.totalLatency / stats.totalInferences;
    stats.minLatency = Math.min(stats.minLatency, latency);
    stats.maxLatency = Math.max(stats.maxLatency, latency);

    if (cacheHit) {
      stats.cacheHits++;
    } else {
      stats.cacheMisses++;
    }

    stats.cacheHitRate = stats.cacheHits / (stats.cacheHits + stats.cacheMisses);

    if (isError) {
      stats.errorCount++;
    }

    stats.lastInferenceTime = new Date();

    this.modelStats.set(modelId, stats);
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

export default ModelServingEngine;
