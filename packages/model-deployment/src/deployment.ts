import { DistributedLogger } from '@neurostack/distributed-logging';
import { ModelRegistryService } from '@neurostack/model-registry';
import { InferenceServer } from '@neurostack/inference-server';
import { DataQualityMonitor } from '@neurostack/data-quality';
import { Logger } from 'pino';

export type DeploymentStrategy = 'blue_green' | 'canary' | 'rolling' | 'shadow';

export interface DeploymentConfig {
  modelId: string;
  versionId: string;
  strategy: DeploymentStrategy;
  targetReplicas: number;
  canaryTrafficPercentage?: number; // 0-100
  healthCheckIntervalMs?: number;
  rollbackThresholdErrorRate?: number; // 0-1
  rollbackThresholdLatencyMs?: number;
}

export interface DeploymentStatus {
  deploymentId: string;
  modelId: string;
  versionId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  startTime: Date;
  endTime?: Date;
  currentTrafficAllocation: Map<string, number>;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface CanaryMetrics {
  canaryVersionId: string;
  stableVersionId: string;
  canaryTrafficPercentage: number;
  canarySuccessRate: number;
  stableSuccessRate: number;
  canaryAvgLatency: number;
  stableAvgLatency: number;
  canaryErrorRate: number;
  stableErrorRate: number;
  readyToPromote: boolean;
}

export interface ABTestConfig {
  testId: string;
  controlVersionId: string;
  treatmentVersionId: string;
  testTrafficPercentage: number;
  metrics: string[]; // Metrics to track
  minDurationHours?: number;
  significanceLevel?: number; // 0-1
}

export interface ABTestResult {
  testId: string;
  controlVersionId: string;
  treatmentVersionId: string;
  sampleSize: number;
  controlMetrics: Map<string, number>;
  treatmentMetrics: Map<string, number>;
  winner?: string;
  significanceAchieved: boolean;
  confidenceLevel: number;
}

export interface DeploymentEvent {
  deploymentId: string;
  timestamp: Date;
  eventType: 'started' | 'traffic_shifted' | 'health_check_failed' | 'rollback_initiated' | 'completed';
  details: Record<string, any>;
}

export interface VersionRolloutConfig {
  previousVersionId: string;
  newVersionId: string;
  rolloutPercentages: number[]; // e.g., [10, 25, 50, 100]
  delayBetweenStagesMs?: number;
  metrics: string[];
}

export class ModelDeploymentOrchestrator {
  private logger: Logger;
  private deployments: Map<string, DeploymentStatus>;
  private abTests: Map<string, ABTestResult>;
  private deploymentEvents: DeploymentEvent[];
  private canaryMetricsBuffer: Map<string, CanaryMetrics[]>;
  private versionHealthScores: Map<string, number>;
  private readonly maxDeployments = 1000;
  private readonly maxABTests = 500;
  private readonly maxEvents = 50000;

  constructor(
    private registryService: ModelRegistryService,
    private inferenceServer: InferenceServer,
    private qualityMonitor: DataQualityMonitor,
    private distributedLogger: DistributedLogger,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ModelDeploymentOrchestrator' });
    this.deployments = new Map();
    this.abTests = new Map();
    this.deploymentEvents = [];
    this.canaryMetricsBuffer = new Map();
    this.versionHealthScores = new Map();
  }

  async deployModel(config: DeploymentConfig): Promise<string> {
    const deploymentId = `deployment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Validate model and version exist
      const model = await this.registryService.getModel(config.modelId);
      const version = await this.registryService.getModelVersion(config.modelId, config.versionId);

      if (!model || !version) {
        throw new Error(`Model ${config.modelId}:${config.versionId} not found`);
      }

      // Create deployment status
      const deploymentStatus: DeploymentStatus = {
        deploymentId,
        modelId: config.modelId,
        versionId: config.versionId,
        status: 'pending',
        startTime: new Date(),
        currentTrafficAllocation: new Map(),
        successCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        errorRate: 0,
      };

      this.deployments.set(deploymentId, deploymentStatus);

      // Log deployment initiation
      await this.distributedLogger.log({
        level: 'info',
        message: `Deployment initiated: ${deploymentId}`,
        metadata: {
          modelId: config.modelId,
          versionId: config.versionId,
          strategy: config.strategy,
          targetReplicas: config.targetReplicas,
        },
      });

      // Execute deployment based on strategy
      switch (config.strategy) {
        case 'blue_green':
          await this.executeBlueGreenDeployment(deploymentId, config);
          break;
        case 'canary':
          await this.executeCanaryDeployment(deploymentId, config);
          break;
        case 'rolling':
          await this.executeRollingDeployment(deploymentId, config);
          break;
        case 'shadow':
          await this.executeShadowDeployment(deploymentId, config);
          break;
      }

      // Record deployment event
      this.recordDeploymentEvent({
        deploymentId,
        timestamp: new Date(),
        eventType: 'started',
        details: config,
      });

      return deploymentId;
    } catch (error) {
      this.logger.error({ error, deploymentId }, 'Deployment failed');
      const deployment = this.deployments.get(deploymentId);
      if (deployment) {
        deployment.status = 'failed';
        deployment.endTime = new Date();
      }
      throw error;
    }
  }

  private async executeBlueGreenDeployment(deploymentId: string, config: DeploymentConfig): Promise<void> {
    const deployment = this.deployments.get(deploymentId)!;
    deployment.status = 'in_progress';

    try {
      // Deploy new version (green) to all replicas
      const replicas = [];
      for (let i = 0; i < config.targetReplicas; i++) {
        const replicaId = `${config.modelId}_green_${i}`;
        replicas.push(replicaId);
        deployment.currentTrafficAllocation.set(replicaId, 0); // No traffic yet
      }

      // Register replicas with inference server
      for (const replicaId of replicas) {
        await this.inferenceServer.registerReplica(config.modelId, config.versionId, replicaId);
      }

      // Monitor green environment
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for warmup

      // Health check on green replicas
      const greenHealthy = await this.healthCheckReplicas(replicas);
      if (!greenHealthy) {
        throw new Error('Green environment health check failed');
      }

      // Switch all traffic to green (atomic switch)
      for (const replicaId of replicas) {
        deployment.currentTrafficAllocation.set(replicaId, 100 / config.targetReplicas);
      }

      // Deregister blue replicas
      const previousVersions = await this.registryService.getModelVersionHistory(config.modelId, 1);
      if (previousVersions.length > 0) {
        for (let i = 0; i < config.targetReplicas; i++) {
          const blueReplicaId = `${config.modelId}_blue_${i}`;
          await this.inferenceServer.removeReplica(config.modelId, blueReplicaId);
        }
      }

      deployment.status = 'completed';
      deployment.endTime = new Date();

      this.recordDeploymentEvent({
        deploymentId,
        timestamp: new Date(),
        eventType: 'traffic_shifted',
        details: { trafficAllocation: Array.from(deployment.currentTrafficAllocation.entries()) },
      });
    } catch (error) {
      this.logger.error({ error, deploymentId }, 'Blue-green deployment failed');
      throw error;
    }
  }

  private async executeCanaryDeployment(deploymentId: string, config: DeploymentConfig): Promise<void> {
    const deployment = this.deployments.get(deploymentId)!;
    deployment.status = 'in_progress';
    const canaryPercentage = config.canaryTrafficPercentage || 10;

    try {
      // Deploy canary replica
      const canaryReplicaId = `${config.modelId}_canary_0`;
      await this.inferenceServer.registerReplica(config.modelId, config.versionId, canaryReplicaId);

      // Maintain stable replicas
      const stableReplicas = [];
      for (let i = 0; i < config.targetReplicas - 1; i++) {
        const replicaId = `${config.modelId}_stable_${i}`;
        stableReplicas.push(replicaId);
        if (!deployment.currentTrafficAllocation.has(replicaId)) {
          deployment.currentTrafficAllocation.set(replicaId, (100 - canaryPercentage) / (config.targetReplicas - 1));
        }
      }

      deployment.currentTrafficAllocation.set(canaryReplicaId, canaryPercentage);

      // Monitor canary metrics
      const stages = [10, 25, 50, 100]; // Traffic percentage progression
      for (const targetPercentage of stages) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Monitor for 10 seconds

        // Collect canary metrics
        const canaryMetrics = await this.collectCanaryMetrics(config.modelId, config.versionId);
        const metricsArray = this.canaryMetricsBuffer.get(config.modelId) || [];
        metricsArray.push(canaryMetrics);
        this.canaryMetricsBuffer.set(config.modelId, metricsArray);

        // Check for rollback conditions
        if (canaryMetrics.canaryErrorRate > (config.rollbackThresholdErrorRate || 0.05)) {
          throw new Error(`Canary error rate exceeded threshold: ${canaryMetrics.canaryErrorRate}`);
        }

        if (canaryMetrics.canaryAvgLatency > (config.rollbackThresholdLatencyMs || 1000)) {
          throw new Error(`Canary latency exceeded threshold: ${canaryMetrics.canaryAvgLatency}ms`);
        }

        // Shift traffic to canary
        const newCanaryTraffic = targetPercentage;
        const newStableTraffic = 100 - targetPercentage;
        deployment.currentTrafficAllocation.set(canaryReplicaId, newCanaryTraffic);
        for (const replicaId of stableReplicas) {
          deployment.currentTrafficAllocation.set(replicaId, newStableTraffic / stableReplicas.length);
        }

        this.recordDeploymentEvent({
          deploymentId,
          timestamp: new Date(),
          eventType: 'traffic_shifted',
          details: { canaryTrafficPercentage: newCanaryTraffic, stableTrafficPercentage: newStableTraffic },
        });
      }

      // Canary complete, promote to stable
      deployment.status = 'completed';
      deployment.endTime = new Date();

      // Remove stable replicas
      for (const replicaId of stableReplicas) {
        await this.inferenceServer.removeReplica(config.modelId, replicaId);
      }
    } catch (error) {
      this.logger.error({ error, deploymentId }, 'Canary deployment failed, initiating rollback');
      await this.rollbackDeployment(deploymentId);
      throw error;
    }
  }

  private async executeRollingDeployment(deploymentId: string, config: DeploymentConfig): Promise<void> {
    const deployment = this.deployments.get(deploymentId)!;
    deployment.status = 'in_progress';

    try {
      // Replace replicas one at a time
      for (let i = 0; i < config.targetReplicas; i++) {
        // Create new replica with new version
        const newReplicaId = `${config.modelId}_new_${i}`;
        await this.inferenceServer.registerReplica(config.modelId, config.versionId, newReplicaId);

        // Health check new replica
        const isHealthy = await this.healthCheckReplicas([newReplicaId]);
        if (!isHealthy) {
          throw new Error(`New replica ${newReplicaId} health check failed`);
        }

        // Remove old replica
        const oldReplicaId = `${config.modelId}_old_${i}`;
        await this.inferenceServer.removeReplica(config.modelId, oldReplicaId);

        // Update traffic allocation
        deployment.currentTrafficAllocation.set(newReplicaId, 100 / config.targetReplicas);

        this.recordDeploymentEvent({
          deploymentId,
          timestamp: new Date(),
          eventType: 'traffic_shifted',
          details: { replicaIndex: i, totalReplicas: config.targetReplicas },
        });

        // Wait between replica updates
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      deployment.status = 'completed';
      deployment.endTime = new Date();
    } catch (error) {
      this.logger.error({ error, deploymentId }, 'Rolling deployment failed');
      throw error;
    }
  }

  private async executeShadowDeployment(deploymentId: string, config: DeploymentConfig): Promise<void> {
    const deployment = this.deployments.get(deploymentId)!;
    deployment.status = 'in_progress';

    try {
      // Deploy shadow replica (receives no production traffic)
      const shadowReplicaId = `${config.modelId}_shadow_0`;
      await this.inferenceServer.registerReplica(config.modelId, config.versionId, shadowReplicaId);
      deployment.currentTrafficAllocation.set(shadowReplicaId, 0);

      // Mirror requests to shadow for analysis
      await new Promise(resolve => setTimeout(resolve, 30000)); // Collect shadow data for 30 seconds

      // Collect shadow metrics
      const shadowMetrics = await this.collectCanaryMetrics(config.modelId, config.versionId);

      // Validate shadow performance
      if (shadowMetrics.canaryErrorRate > (config.rollbackThresholdErrorRate || 0.01)) {
        throw new Error(`Shadow error rate exceeded threshold: ${shadowMetrics.canaryErrorRate}`);
      }

      // Log shadow results
      await this.distributedLogger.log({
        level: 'info',
        message: `Shadow deployment metrics: ${deploymentId}`,
        metadata: shadowMetrics,
      });

      deployment.status = 'completed';
      deployment.endTime = new Date();
    } catch (error) {
      this.logger.error({ error, deploymentId }, 'Shadow deployment failed');
      throw error;
    }
  }

  private async healthCheckReplicas(replicaIds: string[]): Promise<boolean> {
    try {
      for (const replicaId of replicaIds) {
        const health = await this.inferenceServer.getReplicaHealth(replicaId);
        if (!health.healthy) {
          this.logger.warn({ replicaId }, 'Replica health check failed');
          return false;
        }
      }
      return true;
    } catch (error) {
      this.logger.error({ error }, 'Health check error');
      return false;
    }
  }

  private async collectCanaryMetrics(modelId: string, versionId: string): Promise<CanaryMetrics> {
    const metrics = await this.inferenceServer.getEndpointMetrics(modelId);

    return {
      canaryVersionId: versionId,
      stableVersionId: await this.getStableVersionId(modelId),
      canaryTrafficPercentage: metrics.canaryTraffic || 0,
      canarySuccessRate: metrics.canarySuccessRate || 0,
      stableSuccessRate: metrics.stableSuccessRate || 0,
      canaryAvgLatency: metrics.canaryAvgLatency || 0,
      stableAvgLatency: metrics.stableAvgLatency || 0,
      canaryErrorRate: metrics.canaryErrorRate || 0,
      stableErrorRate: metrics.stableErrorRate || 0,
      readyToPromote: (metrics.canarySuccessRate || 0) >= (metrics.stableSuccessRate || 0) * 0.95,
    };
  }

  private async getStableVersionId(modelId: string): Promise<string> {
    const versions = await this.registryService.getModelVersionHistory(modelId, 2);
    return versions.length > 1 ? versions[1].versionId : '';
  }

  async startABTest(config: ABTestConfig): Promise<string> {
    const testId = config.testId || `ab_test_${Date.now()}`;

    try {
      // Validate versions exist
      const controlVersion = await this.registryService.getModelVersion(
        await this.registryService.getModelIdByVersion(config.controlVersionId),
        config.controlVersionId
      );
      const treatmentVersion = await this.registryService.getModelVersion(
        await this.registryService.getModelIdByVersion(config.treatmentVersionId),
        config.treatmentVersionId
      );

      if (!controlVersion || !treatmentVersion) {
        throw new Error('Control or treatment version not found');
      }

      // Initialize test
      const abTest: ABTestResult = {
        testId,
        controlVersionId: config.controlVersionId,
        treatmentVersionId: config.treatmentVersionId,
        sampleSize: 0,
        controlMetrics: new Map(),
        treatmentMetrics: new Map(),
        significanceAchieved: false,
        confidenceLevel: 0,
      };

      this.abTests.set(testId, abTest);

      await this.distributedLogger.log({
        level: 'info',
        message: `A/B test started: ${testId}`,
        metadata: config,
      });

      return testId;
    } catch (error) {
      this.logger.error({ error, testId }, 'A/B test initialization failed');
      throw error;
    }
  }

  async getABTestResults(testId: string): Promise<ABTestResult | undefined> {
    return this.abTests.get(testId);
  }

  async rollbackDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    try {
      this.logger.warn({ deploymentId }, 'Initiating rollback');

      deployment.status = 'rolled_back';
      deployment.endTime = new Date();

      // Get previous version
      const previousVersions = await this.registryService.getModelVersionHistory(deployment.modelId, 2);
      if (previousVersions.length < 2) {
        throw new Error('No previous version to rollback to');
      }

      const previousVersionId = previousVersions[1].versionId;

      // Restore previous version replicas
      const config: DeploymentConfig = {
        modelId: deployment.modelId,
        versionId: previousVersionId,
        strategy: 'blue_green',
        targetReplicas: Math.ceil(deployment.currentTrafficAllocation.size),
      };

      const rollbackDeploymentId = `${deploymentId}_rollback`;
      this.deployments.set(rollbackDeploymentId, {
        ...deployment,
        deploymentId: rollbackDeploymentId,
        versionId: previousVersionId,
        status: 'in_progress',
        startTime: new Date(),
      });

      await this.executeBlueGreenDeployment(rollbackDeploymentId, config);

      this.recordDeploymentEvent({
        deploymentId,
        timestamp: new Date(),
        eventType: 'rollback_initiated',
        details: { rollbackDeploymentId, previousVersionId },
      });
    } catch (error) {
      this.logger.error({ error, deploymentId }, 'Rollback failed');
      throw error;
    }
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus | undefined> {
    return this.deployments.get(deploymentId);
  }

  async getDeploymentEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    return this.deploymentEvents.filter(event => event.deploymentId === deploymentId);
  }

  private recordDeploymentEvent(event: DeploymentEvent): void {
    this.deploymentEvents.push(event);
    if (this.deploymentEvents.length > this.maxEvents) {
      this.deploymentEvents = this.deploymentEvents.slice(-this.maxEvents);
    }
  }

  async updateVersionHealthScore(versionId: string, score: number): Promise<void> {
    this.versionHealthScores.set(versionId, Math.max(0, Math.min(100, score)));
  }

  async getVersionHealthScore(versionId: string): Promise<number> {
    return this.versionHealthScores.get(versionId) || 50;
  }

  async getDeploymentMetrics(deploymentId: string): Promise<Record<string, any>> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    return {
      deploymentId,
      modelId: deployment.modelId,
      versionId: deployment.versionId,
      status: deployment.status,
      duration: deployment.endTime
        ? deployment.endTime.getTime() - deployment.startTime.getTime()
        : Date.now() - deployment.startTime.getTime(),
      successCount: deployment.successCount,
      errorCount: deployment.errorCount,
      errorRate: deployment.errorRate,
      avgLatencyMs: deployment.avgLatencyMs,
      trafficAllocation: Array.from(deployment.currentTrafficAllocation.entries()),
    };
  }

  async listDeployments(limit: number = 100): Promise<DeploymentStatus[]> {
    const deployments = Array.from(this.deployments.values());
    return deployments.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()).slice(0, limit);
  }

  async listActiveDeployments(): Promise<DeploymentStatus[]> {
    return Array.from(this.deployments.values()).filter(
      d => d.status === 'in_progress' || d.status === 'pending'
    );
  }

  async cleanupOldDeployments(olderThanDays: number = 30): Promise<number> {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [deploymentId, deployment] of this.deployments.entries()) {
      if (deployment.endTime && deployment.endTime.getTime() < cutoffTime) {
        this.deployments.delete(deploymentId);
        removed++;
      }
    }

    return removed;
  }
}
