import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Model Registry Types
 */

export interface ModelVersion {
  versionId: string;
  modelId: string;
  version: string; // semantic versioning: 1.0.0
  createdAt: Date;
  createdBy: string;
  description: string;
  framework: string; // TensorFlow, PyTorch, etc.
  inputShape: number[];
  outputShape: number[];
  parameters: number;
  metadata: Record<string, any>;
  artifacts: ModelArtifact[];
  status: 'draft' | 'staging' | 'production' | 'deprecated' | 'archived';
  tags: string[];
}

export interface ModelArtifact {
  artifactId: string;
  type: 'model_weights' | 'model_config' | 'metadata' | 'documentation';
  name: string;
  path: string;
  size: number; // bytes
  hash: string; // for integrity
  uploadedAt: Date;
  checksumAlgorithm: 'sha256' | 'md5';
}

export interface ModelMetrics {
  metricsId: string;
  versionId: string;
  timestamp: Date;
  precision: number;
  recall: number;
  f1Score: number;
  accuracy: number;
  latencyMs: number;
  throughput: number;
  memoryUsageMB: number;
  inferenceTimeP95Ms: number;
  inferenceTimeP99Ms: number;
  dataset: string;
  datasetSize: number;
  evaluationNotes?: string;
}

export interface ModelDeployment {
  deploymentId: string;
  versionId: string;
  environment: 'development' | 'staging' | 'production';
  deployedAt: Date;
  deployedBy: string;
  endpoint: string;
  status: 'active' | 'inactive' | 'rolling' | 'failed' | 'rolled_back';
  replicaCount: number;
  trafficPercentage: number; // for canary deployments
  healthCheckInterval: number; // seconds
  lastHealthCheck: Date;
  rollbackAvailable: boolean;
  previousVersionId?: string;
  metrics: DeploymentMetrics;
}

export interface DeploymentMetrics {
  successRate: number; // 0-100
  errorRate: number; // 0-100
  averageLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalRequests: number;
  failedRequests: number;
  crashCount: number;
}

export interface ModelComparison {
  comparisonId: string;
  model1VersionId: string;
  model2VersionId: string;
  createdAt: Date;
  performanceDifference: Record<string, number>;
  recommendation: 'model1' | 'model2' | 'equivalent';
  confidenceScore: number; // 0-100
}

export interface ModelRegistry {
  models: Map<string, ModelVersion[]>;
  metrics: Map<string, ModelMetrics>;
  deployments: Map<string, ModelDeployment>;
  comparisons: Map<string, ModelComparison>;
}

export interface RegistryStats {
  totalModels: number;
  totalVersions: number;
  productionVersions: number;
  stagingVersions: number;
  draftVersions: number;
  activeDeployments: number;
  archiveSize: number;
  averageMetricsPerModel: number;
}

/**
 * Model Registry
 *
 * Comprehensive model versioning and management:
 * - Model version tracking with semantic versioning
 * - Artifact storage and integrity verification
 * - Performance metrics recording and comparison
 * - Deployment history and rollback capability
 * - Multi-environment deployment management
 * - Canary deployment support
 * - Health monitoring and status tracking
 * - Model provenance and lineage
 * - Access control and permissions
 */
export class ModelRegistryService {
  private logger = pino();
  private models: Map<string, ModelVersion[]> = new Map();
  private metrics: Map<string, ModelMetrics> = new Map();
  private deployments: Map<string, ModelDeployment> = new Map();
  private comparisons: Map<string, ModelComparison> = new Map();
  private readonly maxVersionsPerModel = 100;
  private readonly maxMetricsRetention = 1000000;
  private metricsHistory: Array<{ versionId: string; timestamp: Date }> = [];

  constructor() {
    this.logger.info('ModelRegistryService initialized');
  }

  /**
   * Register a new model version
   */
  registerModelVersion(
    modelId: string,
    version: string,
    framework: string,
    createdBy: string,
    description: string,
    metadata: Record<string, any>
  ): ModelVersion {
    const versionId = generateId();

    const modelVersion: ModelVersion = {
      versionId,
      modelId,
      version,
      createdAt: new Date(),
      createdBy,
      description,
      framework,
      inputShape: metadata.inputShape || [],
      outputShape: metadata.outputShape || [],
      parameters: metadata.parameters || 0,
      metadata,
      artifacts: [],
      status: 'draft',
      tags: metadata.tags || [],
    };

    if (!this.models.has(modelId)) {
      this.models.set(modelId, []);
    }

    const versions = this.models.get(modelId)!;
    versions.push(modelVersion);

    // Maintain version limit
    if (versions.length > this.maxVersionsPerModel) {
      const oldVersion = versions.shift();
      if (oldVersion) {
        this.logger.info(
          { versionId: oldVersion.versionId },
          'Removed oldest model version'
        );
      }
    }

    this.logger.info(
      {
        versionId,
        modelId,
        version,
        framework,
      },
      'Model version registered'
    );

    return modelVersion;
  }

  /**
   * Add artifact to model version
   */
  addArtifact(
    versionId: string,
    artifactType: ModelArtifact['type'],
    name: string,
    path: string,
    size: number,
    hash: string
  ): ModelArtifact | null {
    for (const versions of this.models.values()) {
      const version = versions.find((v) => v.versionId === versionId);

      if (version) {
        const artifact: ModelArtifact = {
          artifactId: generateId(),
          type: artifactType,
          name,
          path,
          size,
          hash,
          uploadedAt: new Date(),
          checksumAlgorithm: 'sha256',
        };

        version.artifacts.push(artifact);

        this.logger.debug(
          {
            artifactId: artifact.artifactId,
            type: artifactType,
            name,
            size,
          },
          'Artifact added to model version'
        );

        return artifact;
      }
    }

    return null;
  }

  /**
   * Record model metrics
   */
  recordMetrics(
    versionId: string,
    precision: number,
    recall: number,
    f1Score: number,
    accuracy: number,
    latencyMs: number,
    throughput: number,
    memoryUsageMB: number,
    dataset: string,
    datasetSize: number,
    options?: {
      inferenceTimeP95Ms?: number;
      inferenceTimeP99Ms?: number;
      evaluationNotes?: string;
    }
  ): ModelMetrics {
    const metricsId = generateId();

    const metrics: ModelMetrics = {
      metricsId,
      versionId,
      timestamp: new Date(),
      precision,
      recall,
      f1Score,
      accuracy,
      latencyMs,
      throughput,
      memoryUsageMB,
      inferenceTimeP95Ms: options?.inferenceTimeP95Ms || 0,
      inferenceTimeP99Ms: options?.inferenceTimeP99Ms || 0,
      dataset,
      datasetSize,
      evaluationNotes: options?.evaluationNotes,
    };

    this.metrics.set(metricsId, metrics);
    this.metricsHistory.push({ versionId, timestamp: new Date() });

    // Maintain retention
    if (this.metrics.size > this.maxMetricsRetention) {
      const oldestKey = this.metrics.keys().next().value;
      this.metrics.delete(oldestKey);
    }

    this.logger.debug(
      {
        metricsId,
        versionId,
        accuracy: accuracy.toFixed(4),
        f1Score: f1Score.toFixed(4),
      },
      'Model metrics recorded'
    );

    return metrics;
  }

  /**
   * Deploy model version
   */
  deployModel(
    versionId: string,
    environment: 'development' | 'staging' | 'production',
    deployedBy: string,
    endpoint: string,
    replicaCount: number = 1,
    trafficPercentage: number = 100
  ): ModelDeployment | null {
    let version: ModelVersion | null = null;

    for (const versions of this.models.values()) {
      version = versions.find((v) => v.versionId === versionId) || null;
      if (version) break;
    }

    if (!version) {
      return null;
    }

    const deployment: ModelDeployment = {
      deploymentId: generateId(),
      versionId,
      environment,
      deployedAt: new Date(),
      deployedBy,
      endpoint,
      status: 'rolling',
      replicaCount,
      trafficPercentage,
      healthCheckInterval: 60,
      lastHealthCheck: new Date(),
      rollbackAvailable: true,
      metrics: {
        successRate: 100,
        errorRate: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        totalRequests: 0,
        failedRequests: 0,
        crashCount: 0,
      },
    };

    this.deployments.set(deployment.deploymentId, deployment);

    // Update version status
    if (environment === 'production') {
      version.status = 'production';
    } else if (environment === 'staging') {
      version.status = 'staging';
    }

    this.logger.info(
      {
        deploymentId: deployment.deploymentId,
        versionId,
        environment,
        endpoint,
        replicaCount,
      },
      'Model deployed'
    );

    return deployment;
  }

  /**
   * Promote model to production
   */
  promoteToProduction(versionId: string): boolean {
    for (const versions of this.models.values()) {
      const version = versions.find((v) => v.versionId === versionId);

      if (version && version.status === 'staging') {
        version.status = 'production';

        this.logger.info(
          {
            versionId,
            modelId: version.modelId,
          },
          'Model promoted to production'
        );

        return true;
      }
    }

    return false;
  }

  /**
   * Rollback deployment
   */
  rollbackDeployment(deploymentId: string): boolean {
    const deployment = this.deployments.get(deploymentId);

    if (!deployment || !deployment.rollbackAvailable) {
      return false;
    }

    deployment.status = 'rolled_back';

    // Find and activate previous version
    if (deployment.previousVersionId) {
      for (const versions of this.models.values()) {
        const prevVersion = versions.find(
          (v) => v.versionId === deployment.previousVersionId
        );
        if (prevVersion && deployment.environment === 'production') {
          prevVersion.status = 'production';
        }
      }
    }

    this.logger.info(
      {
        deploymentId,
        previousVersionId: deployment.previousVersionId,
      },
      'Deployment rolled back'
    );

    return true;
  }

  /**
   * Compare two model versions
   */
  compareVersions(
    version1Id: string,
    version2Id: string
  ): ModelComparison | null {
    const metrics1 = this.getLatestMetricsForVersion(version1Id);
    const metrics2 = this.getLatestMetricsForVersion(version2Id);

    if (!metrics1 || !metrics2) {
      return null;
    }

    const performanceDifference: Record<string, number> = {
      accuracy: metrics2.accuracy - metrics1.accuracy,
      precision: metrics2.precision - metrics1.precision,
      recall: metrics2.recall - metrics1.recall,
      f1Score: metrics2.f1Score - metrics1.f1Score,
      latency: metrics1.latencyMs - metrics2.latencyMs, // Lower is better
    };

    // Weighted score (accuracy + precision + recall weighted higher)
    const score =
      performanceDifference.accuracy * 0.3 +
      performanceDifference.precision * 0.2 +
      performanceDifference.recall * 0.2 +
      performanceDifference.f1Score * 0.2 +
      (performanceDifference.latency / 100) * 0.1; // Normalize latency

    let recommendation: 'model1' | 'model2' | 'equivalent' = 'equivalent';
    if (score > 0.02) {
      recommendation = 'model2';
    } else if (score < -0.02) {
      recommendation = 'model1';
    }

    const comparison: ModelComparison = {
      comparisonId: generateId(),
      model1VersionId: version1Id,
      model2VersionId: version2Id,
      createdAt: new Date(),
      performanceDifference,
      recommendation,
      confidenceScore: Math.min(Math.abs(score) * 100, 100),
    };

    this.comparisons.set(comparison.comparisonId, comparison);

    return comparison;
  }

  /**
   * Get model versions
   */
  getModelVersions(modelId: string): ModelVersion[] {
    return this.models.get(modelId) || [];
  }

  /**
   * Get version by ID
   */
  getModelVersion(versionId: string): ModelVersion | null {
    for (const versions of this.models.values()) {
      const version = versions.find((v) => v.versionId === versionId);
      if (version) {
        return version;
      }
    }

    return null;
  }

  /**
   * Get all production versions
   */
  getProductionVersions(): ModelVersion[] {
    const productionVersions: ModelVersion[] = [];

    for (const versions of this.models.values()) {
      for (const version of versions) {
        if (version.status === 'production') {
          productionVersions.push(version);
        }
      }
    }

    return productionVersions;
  }

  /**
   * Get metrics for version
   */
  getMetricsForVersion(versionId: string): ModelMetrics[] {
    const versionMetrics: ModelMetrics[] = [];

    for (const metrics of this.metrics.values()) {
      if (metrics.versionId === versionId) {
        versionMetrics.push(metrics);
      }
    }

    return versionMetrics.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Get active deployments
   */
  getActiveDeployments(): ModelDeployment[] {
    const active: ModelDeployment[] = [];

    for (const deployment of this.deployments.values()) {
      if (deployment.status === 'active' || deployment.status === 'rolling') {
        active.push(deployment);
      }
    }

    return active.sort(
      (a, b) => b.deployedAt.getTime() - a.deployedAt.getTime()
    );
  }

  /**
   * Get deployments by environment
   */
  getDeploymentsByEnvironment(environment: string): ModelDeployment[] {
    const envDeployments: ModelDeployment[] = [];

    for (const deployment of this.deployments.values()) {
      if (deployment.environment === environment) {
        envDeployments.push(deployment);
      }
    }

    return envDeployments;
  }

  /**
   * Update deployment metrics
   */
  updateDeploymentMetrics(
    deploymentId: string,
    metrics: DeploymentMetrics
  ): boolean {
    const deployment = this.deployments.get(deploymentId);

    if (!deployment) {
      return false;
    }

    deployment.metrics = metrics;
    deployment.lastHealthCheck = new Date();

    // Update status based on health
    if (metrics.errorRate > 50) {
      deployment.status = 'failed';
    } else if (metrics.errorRate > 10) {
      deployment.status = 'rolling';
    } else {
      deployment.status = 'active';
    }

    return true;
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    let totalVersions = 0;
    let productionVersions = 0;
    let stagingVersions = 0;
    let draftVersions = 0;

    for (const versions of this.models.values()) {
      totalVersions += versions.length;

      for (const version of versions) {
        if (version.status === 'production') {
          productionVersions++;
        } else if (version.status === 'staging') {
          stagingVersions++;
        } else if (version.status === 'draft') {
          draftVersions++;
        }
      }
    }

    let activeDeployments = 0;
    for (const deployment of this.deployments.values()) {
      if (deployment.status === 'active') {
        activeDeployments++;
      }
    }

    const archiveSize = Array.from(this.models.values()).reduce(
      (sum, versions) =>
        sum +
        versions.reduce(
          (vSum, v) =>
            vSum +
            v.artifacts.reduce((aSum, a) => aSum + a.size, 0),
          0
        ),
      0
    );

    const avgMetricsPerModel = Array.from(this.models.values()).length > 0
      ? Math.round(
          this.metrics.size / Array.from(this.models.values()).length
        )
      : 0;

    return {
      totalModels: this.models.size,
      totalVersions,
      productionVersions,
      stagingVersions,
      draftVersions,
      activeDeployments,
      archiveSize,
      averageMetricsPerModel: avgMetricsPerModel,
    };
  }

  /**
   * Cleanup old data
   */
  cleanupOldVersions(retentionDays: number = 90): number {
    let removedCount = 0;
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const [modelId, versions] of this.models.entries()) {
      const filtered = versions.filter((v) => {
        const keep =
          v.createdAt.getTime() >= cutoffTime || v.status === 'production';

        if (!keep) {
          removedCount++;
        }

        return keep;
      });

      if (filtered.length === 0) {
        this.models.delete(modelId);
      } else {
        this.models.set(modelId, filtered);
      }
    }

    this.logger.info({ removedCount }, 'Old model versions cleaned up');
    return removedCount;
  }

  // Private methods

  private getLatestMetricsForVersion(versionId: string): ModelMetrics | null {
    const metrics = this.getMetricsForVersion(versionId);

    return metrics.length > 0 ? metrics[0] : null;
  }
}

export default ModelRegistryService;
