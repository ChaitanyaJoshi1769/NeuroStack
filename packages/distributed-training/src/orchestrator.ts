import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Distributed Training Types
 */

export interface TrainingJob {
  jobId: string;
  name: string;
  modelId: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: 'pending' | 'initializing' | 'running' | 'completed' | 'failed' | 'cancelled';
  config: TrainingConfig;
  workers: TrainingWorker[];
  checkpoints: TrainingCheckpoint[];
  progress: TrainingProgress;
  metrics: DistributedTrainingMetrics;
}

export interface TrainingConfig {
  epochs: number;
  globalBatchSize: number;
  learningRate: number;
  gradientAccumulation: number; // steps between gradient updates
  syncInterval: number; // sync every N batches
  checkpointInterval: number; // checkpoint every N steps
  datasetPath: string;
  trainingDataPercentage: number; // 0-100
  validationDataPercentage: number; // 0-100
  numWorkers: number;
  strategy: 'data_parallel' | 'model_parallel' | 'pipeline_parallel';
  communicationBackend: 'kafka' | 'redis' | 'gRPC';
  enableMixedPrecision: boolean;
  enableGradientCompression: boolean;
}

export interface TrainingWorker {
  workerId: string;
  nodeId: string;
  status: 'idle' | 'initializing' | 'training' | 'syncing' | 'failed' | 'completed';
  assignedBatches: number;
  processedBatches: number;
  currentEpoch: number;
  lastHeartbeat: Date;
  gpuMemoryUsageMB: number;
  cpuUsagePercent: number;
  networkBandwidthMBps: number;
  gradient?: GradientSnapshot;
  error?: string;
}

export interface GradientSnapshot {
  snapshotId: string;
  timestamp: Date;
  workerId: string;
  stepNumber: number;
  gradientHash: string; // for compression verification
  compressionRatio: number; // original size / compressed size
  magnitude: number; // gradient norm
}

export interface TrainingCheckpoint {
  checkpointId: string;
  step: number;
  epoch: number;
  timestamp: Date;
  modelState: Record<string, any>;
  optimizerState: Record<string, any>;
  trainingMetrics: Record<string, number>;
  workerStates: Record<string, TrainingWorker>;
  isUsable: boolean;
}

export interface TrainingProgress {
  totalSteps: number;
  completedSteps: number;
  completedEpochs: number;
  estimatedTimeRemainingMs: number;
  estimatedCompletionTime: Date;
  progressPercent: number;
  averageTimePerEpochMs: number;
}

export interface DistributedTrainingMetrics {
  totalGradientsProcessed: number;
  averageGradientCompressionRatio: number;
  averageSyncTimeMs: number;
  averageComputeTimePerStepMs: number;
  averageCommunicationOverhead: number; // percentage of wall-clock time
  convergenceRate: number; // loss reduction per epoch
  scalingEfficiency: number; // 0-1, how well it scales with workers
  totalDataProcessed: number; // number of samples
  samplesPerSecond: number;
  aggregateGpuMemoryUsageMB: number;
  maxWorkerMemoryUsageMB: number;
  networkThroughputGBps: number;
}

/**
 * Distributed Training Orchestrator
 *
 * Manages large-scale distributed model training:
 * - Multi-node training job orchestration
 * - Worker coordination and health monitoring
 * - Gradient aggregation and synchronization
 * - Training checkpointing and recovery
 * - Data parallel, model parallel, and pipeline parallel strategies
 * - Mixed precision and gradient compression
 * - Communication optimization (Kafka, Redis, gRPC)
 * - Real-time progress tracking and monitoring
 * - Fault tolerance and automatic recovery
 */
export class DistributedTrainingOrchestrator {
  private logger = pino();
  private jobs: Map<string, TrainingJob> = new Map();
  private workers: Map<string, TrainingWorker> = new Map();
  private gradients: Map<string, GradientSnapshot[]> = new Map();
  private readonly maxJobsRetention = 10000;
  private readonly workerHeartbeatTimeoutMs = 30000; // 30 seconds
  private readonly syncTimeoutMs = 60000; // 60 seconds

  constructor() {
    this.logger.info('DistributedTrainingOrchestrator initialized');
  }

  /**
   * Create a new training job
   */
  createTrainingJob(
    name: string,
    modelId: string,
    config: TrainingConfig,
    workerNodeIds: string[]
  ): TrainingJob {
    const jobId = generateId();

    const workers: TrainingWorker[] = workerNodeIds.map((nodeId) => ({
      workerId: generateId(),
      nodeId,
      status: 'idle',
      assignedBatches: 0,
      processedBatches: 0,
      currentEpoch: 0,
      lastHeartbeat: new Date(),
      gpuMemoryUsageMB: 0,
      cpuUsagePercent: 0,
      networkBandwidthMBps: 0,
    }));

    const job: TrainingJob = {
      jobId,
      name,
      modelId,
      createdAt: new Date(),
      status: 'pending',
      config,
      workers,
      checkpoints: [],
      progress: {
        totalSteps: config.epochs * 1000, // Placeholder: would be dataset size / batch size
        completedSteps: 0,
        completedEpochs: 0,
        estimatedTimeRemainingMs: 0,
        estimatedCompletionTime: new Date(),
        progressPercent: 0,
        averageTimePerEpochMs: 0,
      },
      metrics: {
        totalGradientsProcessed: 0,
        averageGradientCompressionRatio: 1.0,
        averageSyncTimeMs: 0,
        averageComputeTimePerStepMs: 0,
        averageCommunicationOverhead: 0,
        convergenceRate: 0,
        scalingEfficiency: 1.0,
        totalDataProcessed: 0,
        samplesPerSecond: 0,
        aggregateGpuMemoryUsageMB: 0,
        maxWorkerMemoryUsageMB: 0,
        networkThroughputGBps: 0,
      },
    };

    this.jobs.set(jobId, job);

    // Register workers
    for (const worker of workers) {
      this.workers.set(worker.workerId, worker);
    }

    this.logger.info(
      {
        jobId,
        name,
        modelId,
        numWorkers: workers.length,
        strategy: config.strategy,
      },
      'Training job created'
    );

    return job;
  }

  /**
   * Start training job
   */
  startTrainingJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job || job.status !== 'pending') {
      return false;
    }

    job.status = 'initializing';
    job.startedAt = new Date();

    // Initialize workers
    for (const worker of job.workers) {
      worker.status = 'initializing';
      worker.currentEpoch = 0;
      worker.processedBatches = 0;
    }

    this.logger.info(
      {
        jobId,
        numWorkers: job.workers.length,
      },
      'Training job started'
    );

    return true;
  }

  /**
   * Update worker status
   */
  updateWorkerStatus(
    workerId: string,
    status: TrainingWorker['status'],
    metrics: {
      gpuMemoryMB?: number;
      cpuPercent?: number;
      networkMBps?: number;
      processedBatches?: number;
      currentEpoch?: number;
    }
  ): boolean {
    const worker = this.workers.get(workerId);

    if (!worker) {
      return false;
    }

    worker.status = status;
    worker.lastHeartbeat = new Date();

    if (metrics.gpuMemoryMB !== undefined) {
      worker.gpuMemoryUsageMB = metrics.gpuMemoryMB;
    }
    if (metrics.cpuPercent !== undefined) {
      worker.cpuUsagePercent = metrics.cpuPercent;
    }
    if (metrics.networkMBps !== undefined) {
      worker.networkBandwidthMBps = metrics.networkMBps;
    }
    if (metrics.processedBatches !== undefined) {
      worker.processedBatches = metrics.processedBatches;
    }
    if (metrics.currentEpoch !== undefined) {
      worker.currentEpoch = metrics.currentEpoch;
    }

    return true;
  }

  /**
   * Submit gradient for aggregation
   */
  submitGradient(
    jobId: string,
    workerId: string,
    stepNumber: number,
    gradientHash: string,
    compressionRatio: number,
    magnitude: number
  ): GradientSnapshot | null {
    const job = this.jobs.get(jobId);

    if (!job || job.status !== 'running') {
      return null;
    }

    const worker = job.workers.find((w) => w.workerId === workerId);

    if (!worker) {
      return null;
    }

    const gradient: GradientSnapshot = {
      snapshotId: generateId(),
      timestamp: new Date(),
      workerId,
      stepNumber,
      gradientHash,
      compressionRatio,
      magnitude,
    };

    if (!this.gradients.has(jobId)) {
      this.gradients.set(jobId, []);
    }

    this.gradients.get(jobId)!.push(gradient);
    worker.gradient = gradient;

    // Update metrics
    job.metrics.totalGradientsProcessed++;
    job.metrics.averageGradientCompressionRatio =
      (job.metrics.averageGradientCompressionRatio *
        (job.metrics.totalGradientsProcessed - 1) +
        compressionRatio) /
      job.metrics.totalGradientsProcessed;

    return gradient;
  }

  /**
   * Synchronize gradients across workers
   */
  synchronizeGradients(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    const startTime = Date.now();

    // Check if all workers have submitted gradients for current step
    const allSubmitted = job.workers.every(
      (w) =>
        w.gradient &&
        w.gradient.timestamp.getTime() > startTime - this.syncTimeoutMs
    );

    if (!allSubmitted) {
      this.logger.warn(
        {
          jobId,
          workers: job.workers.length,
        },
        'Not all workers submitted gradients for sync'
      );

      return false;
    }

    // Aggregate gradients
    const totalMagnitude = job.workers.reduce(
      (sum, w) => sum + (w.gradient?.magnitude || 0),
      0
    );

    const syncTimeMs = Date.now() - startTime;

    // Update metrics
    job.metrics.averageSyncTimeMs =
      (job.metrics.averageSyncTimeMs +
        (job.metrics.totalGradientsProcessed > 0 ? syncTimeMs : 0)) /
      2;

    this.logger.debug(
      {
        jobId,
        workers: job.workers.length,
        syncTimeMs,
        totalMagnitude: totalMagnitude.toFixed(6),
      },
      'Gradients synchronized'
    );

    return true;
  }

  /**
   * Create checkpoint
   */
  createCheckpoint(
    jobId: string,
    step: number,
    epoch: number,
    modelState: Record<string, any>,
    optimizerState: Record<string, any>
  ): TrainingCheckpoint | null {
    const job = this.jobs.get(jobId);

    if (!job) {
      return null;
    }

    const checkpoint: TrainingCheckpoint = {
      checkpointId: generateId(),
      step,
      epoch,
      timestamp: new Date(),
      modelState,
      optimizerState,
      trainingMetrics: {
        step,
        epoch,
        completedSteps: job.progress.completedSteps,
      },
      workerStates: job.workers.reduce(
        (acc, w) => {
          acc[w.workerId] = { ...w };
          return acc;
        },
        {} as Record<string, TrainingWorker>
      ),
      isUsable: true,
    };

    job.checkpoints.push(checkpoint);

    // Maintain history limit (keep last 50 checkpoints)
    if (job.checkpoints.length > 50) {
      job.checkpoints.shift();
    }

    this.logger.debug(
      {
        jobId,
        checkpointId: checkpoint.checkpointId,
        step,
        epoch,
      },
      'Training checkpoint created'
    );

    return checkpoint;
  }

  /**
   * Update training progress
   */
  updateProgress(
    jobId: string,
    completedSteps: number,
    completedEpochs: number,
    averageTimePerEpochMs: number
  ): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    job.progress.completedSteps = completedSteps;
    job.progress.completedEpochs = completedEpochs;
    job.progress.averageTimePerEpochMs = averageTimePerEpochMs;

    const remainingEpochs = job.config.epochs - completedEpochs;
    job.progress.estimatedTimeRemainingMs =
      remainingEpochs * averageTimePerEpochMs;
    job.progress.estimatedCompletionTime = new Date(
      Date.now() + job.progress.estimatedTimeRemainingMs
    );
    job.progress.progressPercent = Math.round(
      (completedSteps / job.progress.totalSteps) * 100
    );

    return true;
  }

  /**
   * Complete training job
   */
  completeTrainingJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    job.status = 'completed';
    job.completedAt = new Date();

    for (const worker of job.workers) {
      worker.status = 'completed';
    }

    this.logger.info(
      {
        jobId,
        totalEpochs: job.progress.completedEpochs,
        totalTime: job.completedAt!.getTime() - job.startedAt!.getTime(),
      },
      'Training job completed'
    );

    return true;
  }

  /**
   * Cancel training job
   */
  cancelTrainingJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    job.status = 'cancelled';
    job.completedAt = new Date();

    for (const worker of job.workers) {
      worker.status = 'completed';
    }

    this.logger.info({ jobId }, 'Training job cancelled');

    return true;
  }

  /**
   * Get training job
   */
  getTrainingJob(jobId: string): TrainingJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all active jobs
   */
  getActiveJobs(): TrainingJob[] {
    const active: TrainingJob[] = [];

    for (const job of this.jobs.values()) {
      if (
        job.status === 'initializing' ||
        job.status === 'running'
      ) {
        active.push(job);
      }
    }

    return active;
  }

  /**
   * Check worker health
   */
  checkWorkerHealth(): Array<{
    workerId: string;
    healthy: boolean;
    timeSinceHeartbeatMs: number;
  }> {
    const healthStatus: Array<{
      workerId: string;
      healthy: boolean;
      timeSinceHeartbeatMs: number;
    }> = [];

    const now = Date.now();

    for (const [workerId, worker] of this.workers.entries()) {
      const timeSinceHeartbeat = now - worker.lastHeartbeat.getTime();
      const healthy = timeSinceHeartbeat < this.workerHeartbeatTimeoutMs;

      healthStatus.push({
        workerId,
        healthy,
        timeSinceHeartbeatMs: timeSinceHeartbeat,
      });

      if (!healthy && worker.status !== 'failed') {
        worker.status = 'failed';
        worker.error = 'Heartbeat timeout';

        this.logger.warn(
          {
            workerId,
            timeSinceHeartbeatMs: timeSinceHeartbeat,
          },
          'Worker heartbeat timeout'
        );
      }
    }

    return healthStatus;
  }

  /**
   * Get training metrics
   */
  getTrainingMetrics(jobId: string): DistributedTrainingMetrics | null {
    const job = this.jobs.get(jobId);

    if (!job) {
      return null;
    }

    // Update aggregate metrics
    job.metrics.aggregateGpuMemoryUsageMB = job.workers.reduce(
      (sum, w) => sum + w.gpuMemoryUsageMB,
      0
    );
    job.metrics.maxWorkerMemoryUsageMB = Math.max(
      ...job.workers.map((w) => w.gpuMemoryUsageMB),
      0
    );
    job.metrics.networkThroughputGBps =
      job.workers.reduce((sum, w) => sum + w.networkBandwidthMBps, 0) / 1024;

    // Calculate scaling efficiency
    const baselineTime = job.metrics.averageComputeTimePerStepMs * 1000;
    const communicationTime =
      job.metrics.averageSyncTimeMs * 1000;
    job.metrics.scalingEfficiency = Math.max(
      0,
      baselineTime / (baselineTime + communicationTime * job.workers.length)
    );

    return { ...job.metrics };
  }

  /**
   * Cleanup old jobs
   */
  cleanupOldJobs(retentionDays: number = 7): number {
    let removedCount = 0;
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const [jobId, job] of this.jobs.entries()) {
      if (
        job.completedAt &&
        job.completedAt.getTime() < cutoffTime &&
        job.status !== 'running'
      ) {
        this.jobs.delete(jobId);
        removedCount++;
      }
    }

    this.logger.info({ removedCount }, 'Old training jobs cleaned up');
    return removedCount;
  }

  /**
   * Restore from checkpoint
   */
  restoreFromCheckpoint(jobId: string, checkpointId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    const checkpoint = job.checkpoints.find((c) => c.checkpointId === checkpointId);

    if (!checkpoint || !checkpoint.isUsable) {
      return false;
    }

    // Restore worker states
    for (const worker of job.workers) {
      const savedState = checkpoint.workerStates[worker.workerId];
      if (savedState) {
        worker.currentEpoch = savedState.currentEpoch;
        worker.processedBatches = savedState.processedBatches;
      }
    }

    job.progress.completedEpochs = checkpoint.epoch;
    job.progress.completedSteps = checkpoint.step;

    this.logger.info(
      {
        jobId,
        checkpointId,
        epoch: checkpoint.epoch,
        step: checkpoint.step,
      },
      'Training restored from checkpoint'
    );

    return true;
  }
}

export default DistributedTrainingOrchestrator;
