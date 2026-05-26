import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';

export type MetricType = 'gauge' | 'counter' | 'histogram' | 'summary';
export type AggregationFunction = 'sum' | 'avg' | 'min' | 'max' | 'p50' | 'p95' | 'p99';
export type TimeWindow = '1m' | '5m' | '15m' | '1h' | '6h' | '24h';

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  timestamp: Date;
  labels?: Record<string, string>;
  unit?: string;
}

export interface TimeSeries {
  name: string;
  dataPoints: DataPoint[];
  labels?: Record<string, string>;
}

export interface DataPoint {
  timestamp: Date;
  value: number;
}

export interface DashboardWidget {
  id: string;
  title: string;
  type: 'timeseries' | 'gauge' | 'stat' | 'heatmap' | 'histogram';
  metrics: string[];
  timeWindow: TimeWindow;
  refreshInterval: number; // seconds
  thresholds?: Record<string, number>;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  widgets: DashboardWidget[];
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
}

export interface TrendAnalysis {
  metric: string;
  period: TimeWindow;
  trend: 'increasing' | 'decreasing' | 'stable';
  changePercentage: number;
  forecast?: number;
  confidence: number;
  analysisTime: Date;
}

export interface PerformanceAlert {
  id: string;
  metric: string;
  condition: 'above' | 'below' | 'anomaly';
  threshold?: number;
  actualValue: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  triggeredAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface AnomalyDetection {
  metric: string;
  timestamp: Date;
  expectedValue: number;
  actualValue: number;
  deviation: number; // percentage
  severity: 'low' | 'medium' | 'high';
  anomalyType: 'spike' | 'dip' | 'shift';
}

export class EnhancedObservabilityManager {
  private logger: Logger;
  private metrics: Map<string, Metric[]>;
  private timeSeries: Map<string, TimeSeries>;
  private dashboards: Map<string, Dashboard>;
  private alerts: PerformanceAlert[];
  private anomalies: AnomalyDetection[];
  private trendAnalyses: TrendAnalysis[];
  private readonly maxMetricsPerSeries = 10000;
  private readonly maxAlertSize = 5000;

  constructor(
    private distributedLogger: DistributedLogger,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'EnhancedObservabilityManager' });
    this.metrics = new Map();
    this.timeSeries = new Map();
    this.dashboards = new Map();
    this.alerts = [];
    this.anomalies = [];
    this.trendAnalyses = [];

    this.initializeDefaultDashboards();
    this.logger.info('EnhancedObservabilityManager initialized');
  }

  private initializeDefaultDashboards(): void {
    // System Overview Dashboard
    this.createDashboard({
      id: 'system-overview',
      name: 'System Overview',
      description: 'Real-time system performance metrics',
      widgets: [
        {
          id: 'cpu-usage',
          title: 'CPU Usage',
          type: 'gauge',
          metrics: ['system.cpu.usage'],
          timeWindow: '5m',
          refreshInterval: 10,
          thresholds: { warning: 70, critical: 90 },
        },
        {
          id: 'memory-usage',
          title: 'Memory Usage',
          type: 'gauge',
          metrics: ['system.memory.usage'],
          timeWindow: '5m',
          refreshInterval: 10,
          thresholds: { warning: 80, critical: 95 },
        },
        {
          id: 'response-time',
          title: 'Response Time Trend',
          type: 'timeseries',
          metrics: ['api.response.time'],
          timeWindow: '1h',
          refreshInterval: 30,
        },
        {
          id: 'error-rate',
          title: 'Error Rate',
          type: 'timeseries',
          metrics: ['api.error.rate'],
          timeWindow: '1h',
          refreshInterval: 30,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // ML Pipeline Dashboard
    this.createDashboard({
      id: 'ml-pipeline',
      name: 'ML Pipeline Metrics',
      description: 'Model training and inference metrics',
      widgets: [
        {
          id: 'model-accuracy',
          title: 'Model Accuracy',
          type: 'timeseries',
          metrics: ['model.accuracy', 'model.f1_score'],
          timeWindow: '24h',
          refreshInterval: 300,
        },
        {
          id: 'inference-latency',
          title: 'Inference Latency P95',
          type: 'gauge',
          metrics: ['inference.latency.p95'],
          timeWindow: '1h',
          refreshInterval: 60,
          thresholds: { warning: 100, critical: 500 },
        },
        {
          id: 'training-progress',
          title: 'Training Loss',
          type: 'timeseries',
          metrics: ['training.loss'],
          timeWindow: '6h',
          refreshInterval: 60,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  recordMetric(metric: Omit<Metric, 'timestamp'>): void {
    const entry: Metric = {
      ...metric,
      timestamp: new Date(),
    };

    if (!this.metrics.has(metric.name)) {
      this.metrics.set(metric.name, []);
    }

    const series = this.metrics.get(metric.name)!;
    series.push(entry);

    if (series.length > this.maxMetricsPerSeries) {
      series.shift();
    }

    // Update time series
    this.updateTimeSeries(metric.name, entry);

    // Check for anomalies
    this.checkAnomaly(metric.name, entry);

    // Check alert thresholds
    this.checkAlertThresholds(metric.name, entry);

    this.logger.debug({ metric: metric.name, value: metric.value }, 'Metric recorded');
  }

  private updateTimeSeries(metricName: string, metric: Metric): void {
    if (!this.timeSeries.has(metricName)) {
      this.timeSeries.set(metricName, {
        name: metricName,
        dataPoints: [],
        labels: metric.labels,
      });
    }

    const series = this.timeSeries.get(metricName)!;
    series.dataPoints.push({
      timestamp: metric.timestamp,
      value: metric.value,
    });

    // Keep only last 1000 data points
    if (series.dataPoints.length > 1000) {
      series.dataPoints.shift();
    }
  }

  private checkAnomaly(metricName: string, metric: Metric): void {
    const series = this.metrics.get(metricName) || [];
    if (series.length < 10) return; // Need baseline

    const recentValues = series.slice(-20).map(m => m.value);
    const mean = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const stdDev = Math.sqrt(recentValues.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / recentValues.length);

    const zScore = Math.abs((metric.value - mean) / (stdDev || 1));

    if (zScore > 3) {
      // 3 sigma rule for anomalies
      const deviation = ((metric.value - mean) / mean) * 100;
      const anomalyType = metric.value > mean ? 'spike' : 'dip';
      const severity = Math.abs(deviation) > 50 ? 'high' : 'medium';

      const anomaly: AnomalyDetection = {
        metric: metricName,
        timestamp: metric.timestamp,
        expectedValue: mean,
        actualValue: metric.value,
        deviation: deviation,
        severity: severity as any,
        anomalyType: anomalyType as any,
      };

      this.anomalies.push(anomaly);

      // Keep anomalies list manageable
      if (this.anomalies.length > 1000) {
        this.anomalies.shift();
      }

      this.logger.warn(
        { metric: metricName, expectedValue: mean, actualValue: metric.value, deviation },
        'Anomaly detected'
      );
    }
  }

  private checkAlertThresholds(metricName: string, metric: Metric): void {
    for (const dashboard of this.dashboards.values()) {
      for (const widget of dashboard.widgets) {
        if (!widget.metrics.includes(metricName) || !widget.thresholds) continue;

        const { warning, critical } = widget.thresholds;

        if (critical && metric.value >= critical) {
          this.createAlert(metricName, 'above', critical, metric.value, 'critical', `Critical: ${metricName} is above threshold`);
        } else if (warning && metric.value >= warning) {
          this.createAlert(metricName, 'above', warning, metric.value, 'warning', `Warning: ${metricName} is above threshold`);
        }
      }
    }
  }

  private createAlert(
    metric: string,
    condition: 'above' | 'below',
    threshold: number,
    actualValue: number,
    severity: 'info' | 'warning' | 'critical',
    message: string
  ): void {
    // Check if alert already exists
    const existing = this.alerts.find(
      a => a.metric === metric && a.condition === condition && !a.resolved && a.severity === severity
    );

    if (existing) return; // Already alerted

    const alert: PerformanceAlert = {
      id: `alert-${metric}-${Date.now()}`,
      metric,
      condition,
      threshold,
      actualValue,
      severity,
      message,
      triggeredAt: new Date(),
      resolved: false,
    };

    this.alerts.push(alert);

    if (this.alerts.length > this.maxAlertSize) {
      this.alerts = this.alerts.slice(-this.maxAlertSize);
    }

    this.logger.warn({ alert }, `Alert triggered: ${message}`);
  }

  createDashboard(dashboard: Omit<Dashboard, 'createdAt' | 'updatedAt'>): Dashboard {
    const newDashboard: Dashboard = {
      ...dashboard,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dashboards.set(dashboard.id, newDashboard);
    this.logger.info({ dashboardId: dashboard.id }, 'Dashboard created');

    return newDashboard;
  }

  getDashboard(dashboardId: string): Dashboard | undefined {
    return this.dashboards.get(dashboardId);
  }

  getAllDashboards(): Dashboard[] {
    return Array.from(this.dashboards.values());
  }

  updateDashboard(dashboardId: string, updates: Partial<Dashboard>): Dashboard | undefined {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) return undefined;

    const updated = {
      ...dashboard,
      ...updates,
      id: dashboard.id, // Preserve ID
      createdAt: dashboard.createdAt, // Preserve creation date
      updatedAt: new Date(),
    };

    this.dashboards.set(dashboardId, updated);
    this.logger.info({ dashboardId }, 'Dashboard updated');

    return updated;
  }

  getMetrics(name: string, limit: number = 100): Metric[] {
    const series = this.metrics.get(name) || [];
    return series.slice(-limit);
  }

  getTimeSeries(name: string): TimeSeries | undefined {
    return this.timeSeries.get(name);
  }

  aggregateMetrics(name: string, func: AggregationFunction, timeWindow: TimeWindow): number | null {
    const metrics = this.metrics.get(name) || [];
    if (metrics.length === 0) return null;

    const windowMs = this.parseTimeWindow(timeWindow);
    const now = Date.now();
    const filtered = metrics.filter(m => now - m.timestamp.getTime() <= windowMs);

    if (filtered.length === 0) return null;

    const values = filtered.map(m => m.value);

    switch (func) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'p50':
        return this.percentile(values, 50);
      case 'p95':
        return this.percentile(values, 95);
      case 'p99':
        return this.percentile(values, 99);
      default:
        return null;
    }
  }

  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private parseTimeWindow(window: TimeWindow): number {
    const map: Record<TimeWindow, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    return map[window];
  }

  analyzeTrends(metricName: string, window: TimeWindow = '1h'): TrendAnalysis {
    const metrics = this.metrics.get(metricName) || [];
    const windowMs = this.parseTimeWindow(window);
    const now = Date.now();

    const recentMetrics = metrics.filter(m => now - m.timestamp.getTime() <= windowMs);

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let changePercentage = 0;
    let forecast: number | undefined;
    let confidence = 0.5;

    if (recentMetrics.length > 1) {
      const values = recentMetrics.map(m => m.value);
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));

      const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      changePercentage = ((avg2 - avg1) / avg1) * 100;

      if (Math.abs(changePercentage) < 5) {
        trend = 'stable';
        confidence = 0.9;
      } else if (changePercentage > 0) {
        trend = 'increasing';
        forecast = avg2 * (1 + changePercentage / 100);
        confidence = 0.7;
      } else {
        trend = 'decreasing';
        forecast = avg2 * (1 + changePercentage / 100);
        confidence = 0.7;
      }
    }

    const analysis: TrendAnalysis = {
      metric: metricName,
      period: window,
      trend,
      changePercentage,
      forecast,
      confidence,
      analysisTime: new Date(),
    };

    this.trendAnalyses.push(analysis);

    // Keep last 1000 analyses
    if (this.trendAnalyses.length > 1000) {
      this.trendAnalyses.shift();
    }

    return analysis;
  }

  getAlerts(resolved?: boolean, limit: number = 100): PerformanceAlert[] {
    let alerts = [...this.alerts];

    if (resolved !== undefined) {
      alerts = alerts.filter(a => a.resolved === resolved);
    }

    return alerts.slice(-limit);
  }

  resolveAlert(alertId: string, reason?: string): PerformanceAlert | undefined {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      this.logger.info({ alertId, reason }, 'Alert resolved');
    }
    return alert;
  }

  getAnomalies(severity?: string, limit: number = 100): AnomalyDetection[] {
    let anomalies = [...this.anomalies];

    if (severity) {
      anomalies = anomalies.filter(a => a.severity === severity);
    }

    return anomalies.slice(-limit);
  }

  getMetrics(): Record<string, any> {
    const activeMetrics = Array.from(this.metrics.keys());
    const unreadyAlerts = this.alerts.filter(a => !a.resolved);
    const recentAnomalies = this.anomalies.slice(-100);

    return {
      metricsTracked: activeMetrics.length,
      dashboards: this.dashboards.size,
      activeAlerts: unreadyAlerts.length,
      criticalAlerts: unreadyAlerts.filter(a => a.severity === 'critical').length,
      totalAlerts: this.alerts.length,
      anomaliesDetected: this.anomalies.length,
      recentAnomalies: recentAnomalies.length,
      trendsAnalyzed: this.trendAnalyses.length,
    };
  }
}
