import { FeatureStore } from '@neurostack/feature-store';
import { InferenceServer } from '@neurostack/inference-server';
import { DistributedLogger } from '@neurostack/distributed-logging';
import { RedisCache } from '@neurostack/redis-cache';
import { Logger } from 'pino';

export type BatchJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type BatchProcessingStrategy = 'distributed' | 'streaming' | 'sequential';

export interface BatchJobConfig {
  jobId?: string;
  modelId: string;
  versionId: string;
  inputSource: 'csv' | 'parquet' | 'database' | 'kafka';
  inputPath: string;
  outputPath: string;
  batchSize?: number; // Records per batch
  parallelWorkers?: number;
  strategy?: BatchProcessingStrategy;
  requestTimeout?: number;
  retryAttempts?: number;
  features?: string[]; // Feature names to fetch
  includeFeatureImportance?: boolean;
  includeExplanations?: boolean;
}

export interface BatchJobStatus {
  jobId: string;
  modelId: string;
  versionId: string;
  status: BatchJobStatus;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
  progressPercentage: number;
  startTime: Date;
  endTime?: Date;
  estimatedTimeRemaining: number; // milliseconds
  throughput: number; // records per second
  averageLatency: number; // milliseconds
}

export interface BatchPredictionResult {
  recordId: string;
  prediction: number | string;
  confidence: number;
  latencyMs: number;
  features?: Record<string, any>;
  explanation?: Record<string, any>;
  timestamp: Date;
}

export interface BatchJobMetrics {
  jobId: string;
  totalTime: number;
  totalRecords: number;
  successCount: number;
  failureCount: number;
  skipCount: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  successRate: number;
  errorsByType: Map<string, number>;
}

export interface BatchWindowConfig {
  timeWindowMs: number;
  recordsPerWindow: number;
  overlapPercentage?: number; // For sliding windows
}

export class BatchInferenceEngine {
  private logger: Logger;
  private batchJobs: Map<string, BatchJobStatus>;
  private batchResults: Map<string, BatchPredictionResult[]>;
  private jobMetrics: Map<string, BatchJobMetrics>;
  private processingWorkers: Map<string, boolean>;
  private readonly maxJobsInMemory = 1000;
  private readonly maxResultsPerJob = 1000000;

  constructor(
    private featureStore: FeatureStore,
    private inferenceServer: InferenceServer,
    private distributedLogger: DistributedLogger,
    private redisCache: RedisCache,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'BatchInferenceEngine' });
    this.batchJobs = new Map();
    this.batchResults = new Map();
    this.jobMetrics = new Map();
    this.processingWorkers = new Map();
  }

  async createBatchJob(config: BatchJobConfig): Promise<string> {
    const jobId = config.jobId || `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Validate model exists
      const modelExists = await this.inferenceServer.validateModel(config.modelId, config.versionId);
      if (!modelExists) {
        throw new Error(`Model ${config.modelId}:${config.versionId} not found`);
      }

      // Initialize job
      const jobStatus: BatchJobStatus = {
        jobId,
        modelId: config.modelId,
        versionId: config.versionId,
        status: 'pending',
        totalRecords: 0,
        processedRecords: 0,
        failedRecords: 0,
        skippedRecords: 0,
        progressPercentage: 0,
        startTime: new Date(),
        estimatedTimeRemaining: 0,
        throughput: 0,
        averageLatency: 0,
      };

      this.batchJobs.set(jobId, jobStatus);
      this.batchResults.set(jobId, []);

      // Initialize metrics
      const metrics: BatchJobMetrics = {
        jobId,
        totalTime: 0,
        totalRecords: 0,
        successCount: 0,
        failureCount: 0,
        skipCount: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        throughput: 0,
        successRate: 0,
        errorsByType: new Map(),
      };

      this.jobMetrics.set(jobId, metrics);

      // Log job creation
      await this.distributedLogger.log({
        level: 'info',
        message: `Batch job created: ${jobId}`,
        metadata: {
          modelId: config.modelId,
          versionId: config.versionId,
          inputSource: config.inputSource,
          strategy: config.strategy || 'distributed',
        },
      });

      return jobId;
    } catch (error) {
      this.logger.error({ error, jobId }, 'Failed to create batch job');
      throw error;
    }
  }

  async processBatchJob(jobId: string, config: BatchJobConfig): Promise<void> {
    const job = this.batchJobs.get(jobId);
    if (!job) {
      throw new Error(`Batch job ${jobId} not found`);
    }

    job.status = 'in_progress';
    const metrics = this.jobMetrics.get(jobId)!;
    const batchSize = config.batchSize || 32;
    const parallelWorkers = config.parallelWorkers || 4;
    const strategy = config.strategy || 'distributed';
    const retryAttempts = config.retryAttempts || 3;

    try {
      // Load input data
      const inputRecords = await this.loadInputData(config.inputSource, config.inputPath);
      job.totalRecords = inputRecords.length;
      metrics.totalRecords = inputRecords.length;

      // Process records in batches
      const batches = this.createBatches(inputRecords, batchSize);
      const startTime = Date.now();

      if (strategy === 'distributed') {
        await this.processDistributed(jobId, config, batches, parallelWorkers, retryAttempts);
      } else if (strategy === 'streaming') {
        await this.processStreaming(jobId, config, inputRecords, retryAttempts);
      } else {
        await this.processSequential(jobId, config, batches, retryAttempts);
      }

      // Finalize job
      job.status = 'completed';
      job.endTime = new Date();
      const totalTime = job.endTime.getTime() - job.startTime.getTime();
      metrics.totalTime = totalTime;

      // Calculate metrics
      const latencies: number[] = [];
      const results = this.batchResults.get(jobId) || [];
      for (const result of results) {
        latencies.push(result.latencyMs);
      }

      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        metrics.avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        metrics.p50Latency = latencies[Math.floor(latencies.length * 0.5)];
        metrics.p95Latency = latencies[Math.floor(latencies.length * 0.95)];
        metrics.p99Latency = latencies[Math.floor(latencies.length * 0.99)];
      }

      metrics.successRate = job.totalRecords > 0 ? job.processedRecords / job.totalRecords : 0;
      metrics.throughput = job.totalRecords > 0 ? (job.totalRecords / totalTime) * 1000 : 0;

      // Save results
      await this.saveResults(jobId, config.outputPath, results);

      // Log completion
      await this.distributedLogger.log({
        level: 'info',
        message: `Batch job completed: ${jobId}`,
        metadata: metrics,
      });
    } catch (error) {
      this.logger.error({ error, jobId }, 'Batch job failed');
      job.status = 'failed';
      job.endTime = new Date();
      throw error;
    }
  }

  private async processDistributed(
    jobId: string,
    config: BatchJobConfig,
    batches: any[][],
    parallelWorkers: number,
    retryAttempts: number
  ): Promise<void> {
    const job = this.batchJobs.get(jobId)!;
    const results = this.batchResults.get(jobId) || [];
    const metrics = this.jobMetrics.get(jobId)!;

    // Process batches in parallel with worker pool
    const queue = [...batches];
    const activeWorkers = new Map<number, Promise<void>>();

    for (let workerId = 0; workerId < parallelWorkers; workerId++) {
      activeWorkers.set(
        workerId,
        this.workerProcess(workerId, jobId, config, queue, results, metrics, retryAttempts)
      );
    }

    // Wait for all workers to complete
    await Promise.all(activeWorkers.values());
  }

  private async workerProcess(
    workerId: number,
    jobId: string,
    config: BatchJobConfig,
    queue: any[][],
    results: BatchPredictionResult[],
    metrics: BatchJobMetrics,
    retryAttempts: number
  ): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.shift();
      if (!batch) break;

      for (const record of batch) {
        let attempts = 0;
        let success = false;

        while (attempts < retryAttempts && !success) {
          try {
            const prediction = await this.predictRecord(record, config);
            results.push(prediction);
            metrics.successCount++;
            success = true;

            const job = this.batchJobs.get(jobId)!;
            job.processedRecords++;
            job.progressPercentage = (job.processedRecords / job.totalRecords) * 100;
          } catch (error) {
            attempts++;
            if (attempts >= retryAttempts) {
              metrics.failureCount++;
              const errorType = error instanceof Error ? error.name : 'unknown';
              metrics.errorsByType.set(errorType, (metrics.errorsByType.get(errorType) || 0) + 1);

              const job = this.batchJobs.get(jobId)!;
              job.failedRecords++;
            }
          }
        }
      }
    }
  }

  private async processStreaming(
    jobId: string,
    config: BatchJobConfig,
    records: any[],
    retryAttempts: number
  ): Promise<void> {
    const job = this.batchJobs.get(jobId)!;
    const results = this.batchResults.get(jobId) || [];
    const metrics = this.jobMetrics.get(jobId)!;

    for (const record of records) {
      let attempts = 0;
      let success = false;

      while (attempts < retryAttempts && !success) {
        try {
          const prediction = await this.predictRecord(record, config);
          results.push(prediction);
          metrics.successCount++;
          job.processedRecords++;
          job.progressPercentage = (job.processedRecords / job.totalRecords) * 100;
          success = true;
        } catch (error) {
          attempts++;
          if (attempts >= retryAttempts) {
            metrics.failureCount++;
            job.failedRecords++;
          }
        }
      }
    }
  }

  private async processSequential(
    jobId: string,
    config: BatchJobConfig,
    batches: any[][],
    retryAttempts: number
  ): Promise<void> {
    const job = this.batchJobs.get(jobId)!;
    const results = this.batchResults.get(jobId) || [];
    const metrics = this.jobMetrics.get(jobId)!;

    for (const batch of batches) {
      for (const record of batch) {
        let attempts = 0;
        let success = false;

        while (attempts < retryAttempts && !success) {
          try {
            const prediction = await this.predictRecord(record, config);
            results.push(prediction);
            metrics.successCount++;
            job.processedRecords++;
            job.progressPercentage = (job.processedRecords / job.totalRecords) * 100;
            success = true;
          } catch (error) {
            attempts++;
            if (attempts >= retryAttempts) {
              metrics.failureCount++;
              job.failedRecords++;
            }
          }
        }
      }
    }
  }

  private async predictRecord(record: any, config: BatchJobConfig): Promise<BatchPredictionResult> {
    const recordStartTime = Date.now();
    const recordId = record.id || `record_${Math.random()}`;

    try {
      // Fetch features if specified
      let features: Record<string, any> = {};
      if (config.features && config.features.length > 0) {
        features = await this.featureStore.getFeatureValues(recordId, config.features);
      }

      // Create prediction input
      const input = { ...record, ...features };

      // Make prediction
      const result = await this.inferenceServer.predict(config.modelId, input, {
        timeout: config.requestTimeout || 5000,
        includeExplanations: config.includeExplanations,
      });

      const latency = Date.now() - recordStartTime;

      const prediction: BatchPredictionResult = {
        recordId,
        prediction: result.prediction,
        confidence: result.confidence || 0,
        latencyMs: latency,
        features: config.features ? features : undefined,
        explanation: config.includeExplanations ? result.explanation : undefined,
        timestamp: new Date(),
      };

      return prediction;
    } catch (error) {
      this.logger.error({ error, recordId }, 'Prediction failed');
      throw error;
    }
  }

  private createBatches(records: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }
    return batches;
  }

  private async loadInputData(source: string, path: string): Promise<any[]> {
    // Simulate loading data from different sources
    // In production, this would handle actual CSV/Parquet/DB/Kafka reading
    return [];
  }

  private async saveResults(jobId: string, outputPath: string, results: BatchPredictionResult[]): Promise<void> {
    // Simulate saving results
    // In production, this would write to CSV/Parquet/DB
    this.logger.info({ jobId, outputPath, count: results.length }, 'Results saved');
  }

  async pauseBatchJob(jobId: string): Promise<void> {
    const job = this.batchJobs.get(jobId);
    if (!job) {
      throw new Error(`Batch job ${jobId} not found`);
    }
    job.status = 'paused';
  }

  async resumeBatchJob(jobId: string, config: BatchJobConfig): Promise<void> {
    const job = this.batchJobs.get(jobId);
    if (!job) {
      throw new Error(`Batch job ${jobId} not found`);
    }
    job.status = 'in_progress';
    await this.processBatchJob(jobId, config);
  }

  async cancelBatchJob(jobId: string): Promise<void> {
    const job = this.batchJobs.get(jobId);
    if (!job) {
      throw new Error(`Batch job ${jobId} not found`);
    }
    job.status = 'cancelled';
    job.endTime = new Date();
  }

  async getBatchJobStatus(jobId: string): Promise<BatchJobStatus | undefined> {
    return this.batchJobs.get(jobId);
  }

  async getBatchJobMetrics(jobId: string): Promise<BatchJobMetrics | undefined> {
    return this.jobMetrics.get(jobId);
  }

  async getBatchResults(jobId: string, limit?: number): Promise<BatchPredictionResult[]> {
    const results = this.batchResults.get(jobId) || [];
    return limit ? results.slice(0, limit) : results;
  }

  async getFailedRecords(jobId: string): Promise<any[]> {
    const results = this.batchResults.get(jobId) || [];
    // This would require tracking failed records separately
    return [];
  }

  async createSlidingWindowBatch(
    jobId: string,
    config: BatchJobConfig,
    windowConfig: BatchWindowConfig
  ): Promise<string> {
    const slidingWindowJobId = `${jobId}_sliding_${Date.now()}`;
    await this.createBatchJob({ ...config, jobId: slidingWindowJobId });
    return slidingWindowJobId;
  }

  async getActiveBatchJobs(): Promise<BatchJobStatus[]> {
    return Array.from(this.batchJobs.values()).filter(job => job.status === 'in_progress' || job.status === 'pending');
  }

  async listBatchJobs(limit: number = 100): Promise<BatchJobStatus[]> {
    const jobs = Array.from(this.batchJobs.values());
    return jobs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()).slice(0, limit);
  }

  async cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [jobId, job] of this.batchJobs.entries()) {
      if (job.endTime && job.endTime.getTime() < cutoffTime) {
        this.batchJobs.delete(jobId);
        this.batchResults.delete(jobId);
        this.jobMetrics.delete(jobId);
        removed++;
      }
    }

    return removed;
  }
}
