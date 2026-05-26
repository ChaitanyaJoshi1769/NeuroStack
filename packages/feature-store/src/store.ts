import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Feature Store Types
 */

export interface Feature {
  featureId: string;
  name: string;
  dataType: 'int' | 'float' | 'string' | 'bool' | 'array' | 'timestamp';
  description: string;
  ownerTeam: string;
  createdAt: Date;
  lastModifiedAt: Date;
  version: string;
  transformScript?: string;
  dependencies: string[]; // feature IDs this depends on
  statistics: FeatureStatistics;
  tags: string[];
  isActive: boolean;
}

export interface FeatureGroup {
  groupId: string;
  name: string;
  description: string;
  features: string[]; // feature IDs
  createdAt: Date;
  eventTimestampCol: string; // for point-in-time joins
  primaryKeyCol: string;
  ttlDays: number;
  partitionCols: string[];
}

export interface FeatureStatistics {
  min?: number;
  max?: number;
  mean?: number;
  stddev?: number;
  nullCount: number;
  distinctCount: number;
  lastUpdated: Date;
  histogram?: Record<string, number>;
}

export interface FeatureValue {
  valueId: string;
  featureId: string;
  entityId: string;
  value: any;
  timestamp: Date;
  version: number;
}

export interface FeatureRequest {
  requestId: string;
  entityIds: string[];
  features: string[];
  timestamp?: Date; // for point-in-time correctness
  includeHistorical: boolean;
}

export interface FeatureResponse {
  responseId: string;
  requestId: string;
  values: Map<string, Record<string, any>>;
  servedFromCache: boolean;
  latencyMs: number;
  freshness: 'fresh' | 'stale' | 'offline';
}

export interface FeaturePipeline {
  pipelineId: string;
  name: string;
  description: string;
  schedule: string; // cron expression
  featureGroupId: string;
  transformations: FeatureTransformation[];
  lastExecutionTime?: Date;
  lastExecutionStatus: 'pending' | 'running' | 'success' | 'failed';
  retryPolicy: RetryPolicy;
  enabled: boolean;
}

export interface FeatureTransformation {
  transformId: string;
  sourceFeatures: string[];
  targetFeature: string;
  transformCode: string;
  computeType: 'sql' | 'python' | 'spark';
  executionTimeMs?: number;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
}

export interface FeatureValidity {
  featureId: string;
  isValid: boolean;
  validityScore: number; // 0-100
  issues: string[];
  lastChecked: Date;
}

/**
 * Feature Store
 *
 * Distributed feature management for ML:
 * - Feature definition and schema management
 * - Online and offline feature serving
 * - Point-in-time correctness for historical data
 * - Feature versioning and evolution tracking
 * - Feature computation and transformation pipelines
 * - Feature statistics and quality monitoring
 * - Cache-backed online serving
 * - Feature dependency tracking
 * - Feature reuse across teams
 */
export class FeatureStore {
  private logger = pino();
  private features: Map<string, Feature> = new Map();
  private featureGroups: Map<string, FeatureGroup> = new Map();
  private featureValues: Map<string, FeatureValue[]> = new Map();
  private featurePipelines: Map<string, FeaturePipeline> = new Map();
  private featureCache: Map<string, FeatureResponse> = new Map();
  private readonly maxValuesPerFeature = 10000000;
  private readonly maxCacheSize = 100000;
  private readonly defaultTTLMs = 60000; // 1 minute

  constructor() {
    this.logger.info('FeatureStore initialized');
  }

  /**
   * Define a new feature
   */
  defineFeature(
    name: string,
    dataType: Feature['dataType'],
    ownerTeam: string,
    description: string,
    options?: {
      transformScript?: string;
      dependencies?: string[];
      tags?: string[];
    }
  ): Feature {
    const featureId = generateId();

    const feature: Feature = {
      featureId,
      name,
      dataType,
      description,
      ownerTeam,
      createdAt: new Date(),
      lastModifiedAt: new Date(),
      version: '1.0.0',
      transformScript: options?.transformScript,
      dependencies: options?.dependencies || [],
      statistics: {
        nullCount: 0,
        distinctCount: 0,
        lastUpdated: new Date(),
      },
      tags: options?.tags || [],
      isActive: true,
    };

    this.features.set(featureId, feature);

    this.logger.info(
      {
        featureId,
        name,
        dataType,
        ownerTeam,
      },
      'Feature defined'
    );

    return feature;
  }

  /**
   * Create a feature group
   */
  createFeatureGroup(
    name: string,
    featureIds: string[],
    primaryKeyCol: string,
    eventTimestampCol: string,
    options?: {
      description?: string;
      ttlDays?: number;
      partitionCols?: string[];
    }
  ): FeatureGroup | null {
    // Validate all features exist
    for (const featureId of featureIds) {
      if (!this.features.has(featureId)) {
        return null;
      }
    }

    const groupId = generateId();

    const featureGroup: FeatureGroup = {
      groupId,
      name,
      description: options?.description || '',
      features: featureIds,
      createdAt: new Date(),
      eventTimestampCol,
      primaryKeyCol,
      ttlDays: options?.ttlDays || 90,
      partitionCols: options?.partitionCols || [],
    };

    this.featureGroups.set(groupId, featureGroup);

    this.logger.info(
      {
        groupId,
        name,
        featureCount: featureIds.length,
      },
      'Feature group created'
    );

    return featureGroup;
  }

  /**
   * Store feature value
   */
  storeFeatureValue(
    featureId: string,
    entityId: string,
    value: any,
    timestamp: Date = new Date()
  ): FeatureValue | null {
    const feature = this.features.get(featureId);

    if (!feature) {
      return null;
    }

    const featureValue: FeatureValue = {
      valueId: generateId(),
      featureId,
      entityId,
      value,
      timestamp,
      version: 1,
    };

    const key = `${featureId}:${entityId}`;

    if (!this.featureValues.has(key)) {
      this.featureValues.set(key, []);
    }

    const values = this.featureValues.get(key)!;
    values.push(featureValue);

    // Maintain size limit
    if (values.length > this.maxValuesPerFeature) {
      // Remove oldest value
      values.shift();
    }

    // Update statistics
    this.updateFeatureStatistics(featureId, value);

    // Invalidate cache
    this.invalidateCacheForFeature(featureId);

    return featureValue;
  }

  /**
   * Batch store feature values
   */
  storeBatchFeatureValues(
    featureId: string,
    values: Array<{ entityId: string; value: any; timestamp?: Date }>
  ): number {
    let count = 0;

    for (const { entityId, value, timestamp } of values) {
      const result = this.storeFeatureValue(
        featureId,
        entityId,
        value,
        timestamp
      );

      if (result) {
        count++;
      }
    }

    this.logger.debug(
      {
        featureId,
        storedCount: count,
      },
      'Batch feature values stored'
    );

    return count;
  }

  /**
   * Get feature values (online serving)
   */
  getFeatureValues(
    entityIds: string[],
    featureIds: string[],
    timestamp?: Date
  ): FeatureResponse {
    const responseId = generateId();
    const startTime = Date.now();
    const requestTimestamp = timestamp || new Date();

    const values = new Map<string, Record<string, any>>();

    let servedFromCache = false;

    for (const entityId of entityIds) {
      const entityFeatures: Record<string, any> = {};

      for (const featureId of featureIds) {
        // Try cache first
        const cacheKey = `${featureId}:${entityId}:${requestTimestamp.getTime()}`;
        const cached = this.featureCache.get(cacheKey);

        if (cached) {
          servedFromCache = true;
          entityFeatures[featureId] = cached.values.get(entityId)?.[featureId];
          continue;
        }

        // Get from storage
        const key = `${featureId}:${entityId}`;
        const featureValues = this.featureValues.get(key) || [];

        // Point-in-time correctness: get value as of the requested timestamp
        let value = null;
        for (let i = featureValues.length - 1; i >= 0; i--) {
          if (featureValues[i].timestamp <= requestTimestamp) {
            value = featureValues[i].value;
            break;
          }
        }

        entityFeatures[featureId] = value;
      }

      if (Object.keys(entityFeatures).length > 0) {
        values.set(entityId, entityFeatures);
      }
    }

    const latencyMs = Date.now() - startTime;

    const response: FeatureResponse = {
      responseId,
      requestId: responseId,
      values,
      servedFromCache,
      latencyMs,
      freshness: servedFromCache ? 'stale' : 'fresh',
    };

    // Cache the response
    if (this.featureCache.size < this.maxCacheSize) {
      const cacheKey = `response:${responseId}`;
      this.featureCache.set(cacheKey, response);

      // Set TTL
      setTimeout(() => {
        this.featureCache.delete(cacheKey);
      }, this.defaultTTLMs);
    }

    this.logger.debug(
      {
        responseId,
        entities: entityIds.length,
        features: featureIds.length,
        latencyMs,
        servedFromCache,
      },
      'Feature values retrieved'
    );

    return response;
  }

  /**
   * Create feature pipeline
   */
  createFeaturePipeline(
    name: string,
    featureGroupId: string,
    schedule: string,
    transformations: FeatureTransformation[]
  ): FeaturePipeline {
    const pipelineId = generateId();

    const pipeline: FeaturePipeline = {
      pipelineId,
      name,
      description: '',
      schedule,
      featureGroupId,
      transformations,
      lastExecutionStatus: 'pending',
      retryPolicy: {
        maxRetries: 3,
        retryDelayMs: 5000,
        backoffMultiplier: 2,
      },
      enabled: true,
    };

    this.featurePipelines.set(pipelineId, pipeline);

    this.logger.info(
      {
        pipelineId,
        name,
        schedule,
        transformations: transformations.length,
      },
      'Feature pipeline created'
    );

    return pipeline;
  }

  /**
   * Execute feature pipeline
   */
  async executeFeaturePipeline(pipelineId: string): Promise<{
    success: boolean;
    executionTimeMs: number;
    errorMessage?: string;
  }> {
    const pipeline = this.featurePipelines.get(pipelineId);

    if (!pipeline || !pipeline.enabled) {
      return {
        success: false,
        executionTimeMs: 0,
        errorMessage: 'Pipeline not found or disabled',
      };
    }

    const startTime = Date.now();
    pipeline.lastExecutionStatus = 'running';

    try {
      // Execute transformations in order
      for (const transformation of pipeline.transformations) {
        const transformStartTime = Date.now();

        // In production, would execute actual transformation
        // For now, simulate execution
        await this.simulateTransformation(transformation);

        transformation.executionTimeMs = Date.now() - transformStartTime;
      }

      const executionTimeMs = Date.now() - startTime;

      pipeline.lastExecutionStatus = 'success';
      pipeline.lastExecutionTime = new Date();

      this.logger.info(
        {
          pipelineId,
          executionTimeMs,
        },
        'Feature pipeline executed successfully'
      );

      return {
        success: true,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      pipeline.lastExecutionStatus = 'failed';

      this.logger.error(
        {
          pipelineId,
          error: String(error),
          executionTimeMs,
        },
        'Feature pipeline execution failed'
      );

      return {
        success: false,
        executionTimeMs,
        errorMessage: String(error),
      };
    }
  }

  /**
   * Get feature statistics
   */
  getFeatureStatistics(featureId: string): FeatureStatistics | null {
    const feature = this.features.get(featureId);

    if (!feature) {
      return null;
    }

    return { ...feature.statistics };
  }

  /**
   * Monitor feature data quality
   */
  monitorFeatureQuality(): Array<FeatureValidity> {
    const validityResults: FeatureValidity[] = [];

    for (const [featureId, feature] of this.features.entries()) {
      const stats = feature.statistics;

      // Calculate validity score
      let score = 100;

      // Penalize for null values
      const nullRate = stats.nullCount /
        Math.max(stats.distinctCount + stats.nullCount, 1);
      score -= nullRate * 20;

      // Check for anomalies
      if (stats.stddev !== undefined && stats.mean !== undefined) {
        // Penalize for high variance (potential anomalies)
        const cv = stats.stddev / Math.abs(stats.mean || 1);
        if (cv > 2) {
          score -= 10;
        }
      }

      const issues: string[] = [];

      if (nullRate > 0.5) {
        issues.push('High null rate (>50%)');
      }

      if (stats.distinctCount === 1) {
        issues.push('All values are the same');
      }

      const validity: FeatureValidity = {
        featureId,
        isValid: score >= 70,
        validityScore: Math.max(0, Math.round(score)),
        issues,
        lastChecked: new Date(),
      };

      validityResults.push(validity);
    }

    return validityResults;
  }

  /**
   * Get features by tag
   */
  getFeaturesByTag(tag: string): Feature[] {
    const matching: Feature[] = [];

    for (const feature of this.features.values()) {
      if (feature.tags.includes(tag)) {
        matching.push(feature);
      }
    }

    return matching;
  }

  /**
   * Get features by team
   */
  getFeaturesByTeam(team: string): Feature[] {
    const matching: Feature[] = [];

    for (const feature of this.features.values()) {
      if (feature.ownerTeam === team) {
        matching.push(feature);
      }
    }

    return matching;
  }

  /**
   * Get feature registry statistics
   */
  getRegistryStats(): {
    totalFeatures: number;
    totalFeatureGroups: number;
    totalPipelines: number;
    activeFeatures: number;
    cacheSize: number;
    totalStoredValues: number;
  } {
    let totalStoredValues = 0;
    for (const values of this.featureValues.values()) {
      totalStoredValues += values.length;
    }

    const activeFeatures = Array.from(this.features.values()).filter(
      (f) => f.isActive
    ).length;

    return {
      totalFeatures: this.features.size,
      totalFeatureGroups: this.featureGroups.size,
      totalPipelines: this.featurePipelines.size,
      activeFeatures,
      cacheSize: this.featureCache.size,
      totalStoredValues,
    };
  }

  /**
   * Cleanup old feature values
   */
  cleanupOldValues(retentionDays: number = 90): number {
    let removedCount = 0;
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const [key, values] of this.featureValues.entries()) {
      const filtered = values.filter((v) => v.timestamp.getTime() >= cutoffTime);

      if (filtered.length === 0) {
        this.featureValues.delete(key);
        removedCount += values.length;
      } else if (filtered.length < values.length) {
        this.featureValues.set(key, filtered);
        removedCount += values.length - filtered.length;
      }
    }

    this.logger.info({ removedCount }, 'Old feature values cleaned up');
    return removedCount;
  }

  // Private methods

  private updateFeatureStatistics(featureId: string, value: any): void {
    const feature = this.features.get(featureId);

    if (!feature || typeof value !== 'number') {
      return;
    }

    const stats = feature.statistics;

    if (stats.min === undefined || value < stats.min) {
      stats.min = value;
    }

    if (stats.max === undefined || value > stats.max) {
      stats.max = value;
    }

    stats.distinctCount++;
    stats.lastUpdated = new Date();
  }

  private invalidateCacheForFeature(featureId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.featureCache.keys()) {
      if (key.includes(featureId)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.featureCache.delete(key);
    }
  }

  private async simulateTransformation(
    transformation: FeatureTransformation
  ): Promise<void> {
    // Simulate transformation execution
    return new Promise((resolve) => {
      setTimeout(() => {
        this.logger.debug(
          {
            transformId: transformation.transformId,
            sourceFeatures: transformation.sourceFeatures.length,
            targetFeature: transformation.targetFeature,
          },
          'Transformation executed'
        );

        resolve();
      }, Math.random() * 100);
    });
  }
}

export default FeatureStore;
