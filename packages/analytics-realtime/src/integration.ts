import pino from 'pino';
import { generateId } from '@neurostack/shared';
import { MLAnomalyDetector, DataPoint as MLDataPoint, AnomalyDetectionResult } from '@neurostack/ml-anomaly-detector';
import { StreamingCore, StreamMessage } from '@neurostack/streaming-core';
import { RealtimeInsightsSystem, RealtimeInsight, Alert } from '@neurostack/realtime-insights';

/**
 * Integration Pipeline Types
 */

export interface PipelineMetric {
  name: string;
  unit: string;
  type: 'counter' | 'gauge' | 'histogram';
  thresholds?: {
    warning?: number;
    critical?: number;
  };
}

export interface PipelineEvent {
  id: string;
  metric: string;
  value: number;
  timestamp: Date;
  tenantId: string;
  tags?: Record<string, string>;
}

export interface PipelineStage {
  name: string;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'processing' | 'complete' | 'error';
  duration?: number;
  error?: string;
}

export interface PipelineResult {
  eventId: string;
  metric: string;
  stages: PipelineStage[];
  anomalyDetection?: AnomalyDetectionResult;
  insights?: RealtimeInsight[];
  alerts?: Alert[];
  streamMessages?: StreamMessage[];
  totalLatencyMs?: number;
}

export interface PipelineStats {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  averageLatencyMs: number;
  anomaliesDetected: number;
  insightsGenerated: number;
  alertsTriggered: number;
  messagesStreamed: number;
}

/**
 * Analytics-Realtime Integration Pipeline
 *
 * Data Flow:
 * Event Input
 *   ↓
 * ML Anomaly Detection
 *   ↓
 * Realtime Insights Generation
 *   ↓
 * Alert Evaluation
 *   ↓
 * Stream Distribution
 *   ↓
 * Client Delivery
 */
export class AnalyticsRealtimePipeline {
  private logger = pino();
  private mlDetector: MLAnomalyDetector;
  private streaming: StreamingCore;
  private insights: RealtimeInsightsSystem;
  private metrics: Map<string, PipelineMetric> = new Map();
  private lastValues: Map<string, number> = new Map();

  // Statistics
  private stats: PipelineStats = {
    totalEvents: 0,
    successfulEvents: 0,
    failedEvents: 0,
    averageLatencyMs: 0,
    anomaliesDetected: 0,
    insightsGenerated: 0,
    alertsTriggered: 0,
    messagesStreamed: 0,
  };

  private processingTimes: number[] = [];
  private readonly maxTimingSamples = 1000;

  constructor() {
    this.mlDetector = new MLAnomalyDetector();
    this.streaming = new StreamingCore();
    this.insights = new RealtimeInsightsSystem();

    this.setupListeners();
  }

  /**
   * Register metric in pipeline
   */
  registerMetric(metric: PipelineMetric): void {
    this.metrics.set(metric.name, metric);
    this.logger.info({ metric: metric.name }, 'Metric registered');
  }

  /**
   * Process event through entire pipeline
   */
  async processEvent(event: PipelineEvent): Promise<PipelineResult> {
    const startTime = Date.now();
    const stages: PipelineStage[] = [];
    const result: PipelineResult = {
      eventId: event.id,
      metric: event.metric,
      stages,
    };

    try {
      // Stage 1: Input validation
      stages.push({
        name: 'input_validation',
        startTime: new Date(),
        status: 'processing',
      });

      const isValid = this.validateEvent(event);
      if (!isValid) {
        throw new Error(`Invalid event: ${event.metric}`);
      }

      stages[0].status = 'complete';
      stages[0].endTime = new Date();

      // Stage 2: ML Anomaly Detection
      stages.push({
        name: 'ml_anomaly_detection',
        startTime: new Date(),
        status: 'processing',
      });

      const mlDataPoint: MLDataPoint = {
        timestamp: event.timestamp,
        value: event.value,
        metric: event.metric,
      };

      const anomalyResults = await this.mlDetector.detectAnomalies([mlDataPoint]);
      const anomalyDetectionResult = anomalyResults[0];
      result.anomalyDetection = anomalyDetectionResult;

      stages[1].status = 'complete';
      stages[1].endTime = new Date();

      if (anomalyDetectionResult.isAnomaly) {
        this.stats.anomaliesDetected++;
      }

      // Stage 3: Realtime Insights
      stages.push({
        name: 'realtime_insights',
        startTime: new Date(),
        status: 'processing',
      });

      const insights = await this.insights.processDataPoint(
        event.metric,
        event.value,
        this.lastValues.get(event.metric)
      );
      result.insights = insights;

      stages[2].status = 'complete';
      stages[2].endTime = new Date();

      this.stats.insightsGenerated += insights.length;

      // Stage 4: Alert Evaluation
      stages.push({
        name: 'alert_evaluation',
        startTime: new Date(),
        status: 'processing',
      });

      const activeAlerts = this.insights.getActiveAlerts();
      result.alerts = activeAlerts;

      stages[3].status = 'complete';
      stages[3].endTime = new Date();

      this.stats.alertsTriggered += activeAlerts.length;

      // Stage 5: Stream Distribution
      stages.push({
        name: 'stream_distribution',
        startTime: new Date(),
        status: 'processing',
      });

      const streamMessages: StreamMessage[] = [];

      // Stream anomaly detection result
      if (anomalyDetectionResult.isAnomaly) {
        const anomalyMsg = await this.streaming.publish(
          `anomalies:${event.metric}`,
          {
            type: 'anomaly_detected',
            detection: anomalyDetectionResult,
            event,
          },
          event.tenantId
        );
        streamMessages.push(anomalyMsg);
      }

      // Stream insights
      for (const insight of insights) {
        const insightMsg = await this.streaming.publish(
          `insights:${event.metric}`,
          {
            type: 'insight_generated',
            insight,
            event,
          },
          event.tenantId
        );
        streamMessages.push(insightMsg);
      }

      // Stream alerts
      for (const alert of activeAlerts) {
        const alertMsg = await this.streaming.publish(
          `alerts:${event.metric}`,
          {
            type: 'alert_triggered',
            alert,
            event,
          },
          event.tenantId
        );
        streamMessages.push(alertMsg);
      }

      result.streamMessages = streamMessages;

      stages[4].status = 'complete';
      stages[4].endTime = new Date();

      this.stats.messagesStreamed += streamMessages.length;

      // Update last value
      this.lastValues.set(event.metric, event.value);

      // Calculate total latency
      const totalLatency = Date.now() - startTime;
      result.totalLatencyMs = totalLatency;

      // Update stats
      this.stats.totalEvents++;
      this.stats.successfulEvents++;
      this.recordLatency(totalLatency);

      this.logger.info(
        {
          eventId: event.id,
          metric: event.metric,
          latencyMs: totalLatency,
          insightCount: insights.length,
          alertCount: activeAlerts.length,
        },
        'Event processed successfully'
      );

      return result;
    } catch (error) {
      this.stats.totalEvents++;
      this.stats.failedEvents++;

      const stage = stages[stages.length - 1];
      if (stage) {
        stage.status = 'error';
        stage.error = error instanceof Error ? error.message : 'Unknown error';
        stage.endTime = new Date();
      }

      this.logger.error(
        { error, eventId: event.id, metric: event.metric },
        'Event processing failed'
      );

      return result;
    }
  }

  /**
   * Process batch of events
   */
  async processBatch(events: PipelineEvent[]): Promise<PipelineResult[]> {
    const results = await Promise.all(events.map((e) => this.processEvent(e)));
    return results;
  }

  /**
   * Train ML model on historical data
   */
  async trainMetricModel(metricName: string, historicalValues: number[]): Promise<void> {
    await this.mlDetector.trainModel({
      metric: metricName,
      values: historicalValues,
      timestamps: historicalValues.map((_, i) => new Date(Date.now() - (historicalValues.length - i) * 60000)),
    });

    this.logger.info({ metric: metricName }, 'ML model trained');
  }

  /**
   * Get pipeline statistics
   */
  getStats(): PipelineStats {
    return {
      ...this.stats,
      averageLatencyMs: this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0,
    };
  }

  /**
   * Get streaming statistics
   */
  getStreamingStats() {
    return this.streaming.getStats();
  }

  /**
   * Get ML model state
   */
  getModelState(metric: string) {
    return this.mlDetector.getModelState(metric);
  }

  /**
   * Get insights system statistics
   */
  getInsightsStats() {
    return this.insights.getStatistics();
  }

  /**
   * Shutdown pipeline
   */
  shutdown(): void {
    this.streaming.shutdown();
    this.logger.info('Pipeline shutdown');
  }

  // Private helpers

  private validateEvent(event: PipelineEvent): boolean {
    if (!event.metric || typeof event.value !== 'number' || !event.timestamp) {
      return false;
    }

    // Check if metric is registered
    if (!this.metrics.has(event.metric)) {
      // Auto-register with defaults
      this.registerMetric({
        name: event.metric,
        unit: 'unknown',
        type: 'gauge',
      });
    }

    return true;
  }

  private recordLatency(latencyMs: number): void {
    this.processingTimes.push(latencyMs);
    if (this.processingTimes.length > this.maxTimingSamples) {
      this.processingTimes.shift();
    }
  }

  private setupListeners(): void {
    // Listen for anomalies
    this.streaming.on('message:published', ({ message, recipients }) => {
      if (message.channel.startsWith('anomalies:')) {
        this.logger.debug(
          { channel: message.channel, recipients: recipients.length },
          'Anomaly message distributed'
        );
      }
    });
  }
}

export default AnalyticsRealtimePipeline;
