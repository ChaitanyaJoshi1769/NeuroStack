import pino from 'pino';
import { generateId } from '@neurostack/shared';
import { MLAnomalyDetector } from '@neurostack/ml-anomaly-detector';
import { StreamingCore } from '@neurostack/streaming-core';
import { AnalyticsRealtimePipeline } from '@neurostack/analytics-realtime';
import { AlertIntelligence } from '@neurostack/alert-intelligence';
import { NotificationDelivery } from '@neurostack/notification-delivery';
import { RecommendationEngine } from '@neurostack/dashboard-recommendations';
import { AlertOptimization } from '@neurostack/alert-optimization';
import { ModelServingEngine } from '@neurostack/model-serving';
import { MetricsAggregation } from '@neurostack/metrics-aggregation';

/**
 * Integration Orchestrator Types
 */

export interface OrchestratorConfig {
  enableAnomalyDetection: boolean;
  enableStreaming: boolean;
  enableAlerts: boolean;
  enableNotifications: boolean;
  enableRecommendations: boolean;
  enableOptimization: boolean;
  enableMetrics: boolean;
  notificationConfig?: any;
}

export interface ServiceStatus {
  serviceName: string;
  initialized: boolean;
  lastError?: string;
  uptime: number; // milliseconds
  requestCount: number;
}

export interface OrchestrationPipeline {
  pipelineId: string;
  stages: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  results: Record<string, any>;
}

export interface SystemMetrics {
  timestamp: Date;
  services: Record<string, ServiceStatus>;
  totalRequests: number;
  errorCount: number;
  averageLatency: number;
  systemHealth: number; // 0-100
}

/**
 * Integration Orchestrator
 *
 * Master orchestrator that coordinates all Intelligence Layer services:
 * - Anomaly detection
 * - Real-time streaming
 * - Alert management
 * - Notification delivery
 * - Personalized recommendations
 * - Alert optimization
 * - Model serving
 * - Metrics aggregation
 */
export class IntegrationOrchestrator {
  private logger = pino();
  private config: OrchestratorConfig;
  private anomalyDetector?: MLAnomalyDetector;
  private streamingCore?: StreamingCore;
  private analyticsPipeline?: AnalyticsRealtimePipeline;
  private alertIntelligence?: AlertIntelligence;
  private notificationDelivery?: NotificationDelivery;
  private recommendationEngine?: RecommendationEngine;
  private alertOptimization?: AlertOptimization;
  private modelServing?: ModelServingEngine;
  private metricsAggregation?: MetricsAggregation;
  private serviceStatus: Map<string, ServiceStatus> = new Map();
  private pipelines: Map<string, OrchestrationPipeline> = new Map();
  private readonly maxPipelines = 10000;
  private totalRequests = 0;
  private totalErrors = 0;
  private latencies: number[] = [];
  private startTime = Date.now();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.initializeServices();
  }

  /**
   * Initialize all enabled services
   */
  private initializeServices(): void {
    this.logger.info({ config: this.config }, 'Initializing orchestrator');

    if (this.config.enableAnomalyDetection) {
      this.anomalyDetector = new MLAnomalyDetector();
      this.registerService('anomaly-detection');
    }

    if (this.config.enableStreaming) {
      this.streamingCore = new StreamingCore();
      this.registerService('streaming-core');
    }

    if (this.config.enableAlerts) {
      this.alertIntelligence = new AlertIntelligence();
      this.registerService('alert-intelligence');
    }

    if (this.config.enableNotifications && this.config.notificationConfig) {
      this.notificationDelivery = new NotificationDelivery(this.config.notificationConfig);
      this.registerService('notification-delivery');
    }

    if (this.config.enableRecommendations) {
      this.recommendationEngine = new RecommendationEngine();
      this.registerService('recommendations');
    }

    if (this.config.enableOptimization) {
      this.alertOptimization = new AlertOptimization();
      this.registerService('alert-optimization');
    }

    this.modelServing = new ModelServingEngine();
    this.registerService('model-serving');

    if (this.config.enableMetrics) {
      this.metricsAggregation = new MetricsAggregation();
      this.registerService('metrics-aggregation');
    }

    this.logger.info('All configured services initialized');
  }

  /**
   * Execute full intelligence pipeline
   */
  async executeFullPipeline(data: any): Promise<OrchestrationPipeline> {
    const pipelineId = generateId();
    const startTime = Date.now();

    const pipeline: OrchestrationPipeline = {
      pipelineId,
      stages: [],
      status: 'running',
      startTime: new Date(),
      results: {},
    };

    try {
      // Stage 1: Anomaly Detection
      if (this.anomalyDetector) {
        pipeline.stages.push('anomaly-detection');
        const anomalies = this.anomalyDetector.detectAnomalies(data.dataPoints || []);
        pipeline.results.anomalies = anomalies;
        this.recordMetric('anomaly-detection-latency', Date.now() - startTime);
      }

      // Stage 2: Real-time Analytics
      if (this.analyticsPipeline) {
        pipeline.stages.push('analytics');
        // Process through analytics pipeline
        this.recordMetric('analytics-latency', Date.now() - startTime);
      }

      // Stage 3: Alert Management
      if (this.alertIntelligence && pipeline.results.anomalies) {
        pipeline.stages.push('alert-intelligence');
        // Create alerts from anomalies
        this.recordMetric('alert-latency', Date.now() - startTime);
      }

      // Stage 4: Alert Optimization
      if (this.alertOptimization && this.config.enableOptimization) {
        pipeline.stages.push('alert-optimization');
        const optimizations = this.alertOptimization.optimizeAllRules();
        pipeline.results.optimizations = optimizations;
        this.recordMetric('optimization-latency', Date.now() - startTime);
      }

      // Stage 5: Notifications
      if (this.notificationDelivery) {
        pipeline.stages.push('notification-delivery');
        // Send notifications
        this.recordMetric('notification-latency', Date.now() - startTime);
      }

      // Stage 6: Streaming
      if (this.streamingCore) {
        pipeline.stages.push('streaming');
        // Broadcast updates
        this.recordMetric('streaming-latency', Date.now() - startTime);
      }

      // Stage 7: Metrics Recording
      if (this.metricsAggregation) {
        pipeline.stages.push('metrics-aggregation');
        // Record all metrics
        this.recordMetric('pipeline-total-latency', Date.now() - startTime);
      }

      pipeline.status = 'completed';
      pipeline.duration = Date.now() - startTime.getTime();

      this.totalRequests++;
      this.latencies.push(pipeline.duration);
      if (this.latencies.length > 10000) this.latencies.shift();

      this.logger.info(
        {
          pipelineId,
          stages: pipeline.stages.length,
          duration: pipeline.duration,
        },
        'Pipeline completed'
      );
    } catch (error) {
      pipeline.status = 'failed';
      pipeline.duration = Date.now() - startTime.getTime();
      this.totalErrors++;

      this.logger.error(
        {
          error,
          pipelineId,
          stages: pipeline.stages,
        },
        'Pipeline failed'
      );
    }

    this.pipelines.set(pipelineId, pipeline);

    // Maintain size limit
    if (this.pipelines.size > this.maxPipelines) {
      const firstKey = this.pipelines.keys().next().value;
      this.pipelines.delete(firstKey);
    }

    return pipeline;
  }

  /**
   * Get system metrics and health
   */
  getSystemMetrics(): SystemMetrics {
    const services: Record<string, ServiceStatus> = {};

    for (const [serviceName, status] of this.serviceStatus) {
      services[serviceName] = status;
    }

    const avgLatency = this.latencies.length > 0 ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0;

    // Calculate system health based on error rate
    const errorRate = this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;
    const systemHealth = Math.max(0, 100 - errorRate * 10);

    return {
      timestamp: new Date(),
      services,
      totalRequests: this.totalRequests,
      errorCount: this.totalErrors,
      averageLatency: Math.round(avgLatency),
      systemHealth: Math.round(systemHealth),
    };
  }

  /**
   * Get service status
   */
  getServiceStatus(): ServiceStatus[] {
    return Array.from(this.serviceStatus.values());
  }

  /**
   * Get pipeline history
   */
  getPipelineHistory(limit: number = 100): OrchestrationPipeline[] {
    return Array.from(this.pipelines.values()).slice(-limit);
  }

  /**
   * Record operational metric
   */
  private recordMetric(name: string, value: number): void {
    if (this.metricsAggregation) {
      this.metricsAggregation.recordMetric(name, value, {
        component: 'orchestrator',
      });
    }
  }

  /**
   * Register service status tracking
   */
  private registerService(serviceName: string): void {
    const status: ServiceStatus = {
      serviceName,
      initialized: true,
      uptime: 0,
      requestCount: 0,
    };

    this.serviceStatus.set(serviceName, status);

    this.logger.info({ serviceName }, 'Service registered');
  }

  /**
   * Update service status
   */
  updateServiceStatus(serviceName: string, requestCount: number, error?: string): void {
    let status = this.serviceStatus.get(serviceName);

    if (!status) {
      status = {
        serviceName,
        initialized: false,
        uptime: 0,
        requestCount: 0,
      };
    }

    status.requestCount = requestCount;
    status.uptime = Date.now() - this.startTime;

    if (error) {
      status.lastError = error;
      this.totalErrors++;
    }

    this.serviceStatus.set(serviceName, status);
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down orchestrator');

    // Shutdown services in reverse order
    if (this.metricsAggregation) {
      this.metricsAggregation.clearOldMetrics();
    }

    if (this.streamingCore) {
      // Graceful shutdown of streaming
    }

    this.logger.info('Orchestrator shutdown complete');
  }

  /**
   * Get orchestrator stats
   */
  getStats(): {
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
    averageLatency: number;
    uptime: number;
    serviceCount: number;
  } {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;
    const avgLatency = this.latencies.length > 0 ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0;

    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRate: Math.round(errorRate * 100) / 100,
      averageLatency: Math.round(avgLatency),
      uptime,
      serviceCount: this.serviceStatus.size,
    };
  }
}

export default IntegrationOrchestrator;
