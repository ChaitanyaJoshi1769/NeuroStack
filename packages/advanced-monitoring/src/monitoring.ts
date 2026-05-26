import { DistributedLogger } from '@neurostack/distributed-logging';
import { RedisCache } from '@neurostack/redis-cache';
import { Logger } from 'pino';

export type ServiceHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type MetricType = 'gauge' | 'counter' | 'histogram' | 'summary';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface ServiceHealthMetrics {
  serviceId: string;
  status: ServiceHealthStatus;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  diskUsagePercent: number;
  networkLatencyMs: number;
  requestRate: number;
  errorRate: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  uptime: number; // milliseconds
  lastHealthCheck: Date;
}

export interface MetricPoint {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
}

export interface MetricSeries {
  metricName: string;
  metricType: MetricType;
  points: MetricPoint[];
  unit?: string;
  description?: string;
}

export interface AlertRule {
  ruleId: string;
  name: string;
  description?: string;
  metricName: string;
  condition: 'threshold' | 'change' | 'anomaly' | 'composite';
  threshold?: number;
  operator?: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  duration?: number; // milliseconds
  enabled: boolean;
  severity: AlertSeverity;
  actions: AlertAction[];
}

export interface AlertAction {
  type: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'log';
  target: string;
  template?: string;
}

export interface Alert {
  alertId: string;
  ruleId: string;
  metricName: string;
  severity: AlertSeverity;
  message: string;
  triggeredAt: Date;
  resolvedAt?: Date;
  value: number;
  threshold?: number;
  labels?: Record<string, string>;
}

export interface PerformanceBaseline {
  metricName: string;
  baselineValue: number;
  stdDeviation: number;
  p50: number;
  p95: number;
  p99: number;
  minValue: number;
  maxValue: number;
  sampleCount: number;
  lastUpdated: Date;
}

export interface SLAConfig {
  slaId: string;
  serviceId: string;
  metric: string;
  targetValue: number;
  operator: 'gte' | 'lte';
  lookbackWindowHours: number;
}

export interface SLAStatus {
  slaId: string;
  currentValue: number;
  targetValue: number;
  achievedPercent: number;
  status: 'on_track' | 'at_risk' | 'breached';
  lastUpdated: Date;
}

export interface DashboardWidget {
  widgetId: string;
  metricName: string;
  chartType: 'line' | 'bar' | 'gauge' | 'heatmap' | 'table';
  timeRange: number; // milliseconds
  aggregation?: 'sum' | 'avg' | 'min' | 'max';
}

export interface Dashboard {
  dashboardId: string;
  name: string;
  description?: string;
  widgets: DashboardWidget[];
  refreshIntervalMs?: number;
  lastModified: Date;
}

export class AdvancedMonitoringPlatform {
  private logger: Logger;
  private serviceMetrics: Map<string, ServiceHealthMetrics>;
  private metricSeries: Map<string, MetricSeries>;
  private alertRules: Map<string, AlertRule>;
  private activeAlerts: Map<string, Alert>;
  private alertHistory: Alert[];
  private performanceBaselines: Map<string, PerformanceBaseline>;
  private slaConfigs: Map<string, SLAConfig>;
  private slaStatus: Map<string, SLAStatus>;
  private dashboards: Map<string, Dashboard>;
  private readonly maxMetricsInMemory = 100000;
  private readonly maxAlertsInMemory = 10000;
  private readonly baselineWindow = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private distributedLogger: DistributedLogger,
    private redisCache: RedisCache,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'AdvancedMonitoringPlatform' });
    this.serviceMetrics = new Map();
    this.metricSeries = new Map();
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.performanceBaselines = new Map();
    this.slaConfigs = new Map();
    this.slaStatus = new Map();
    this.dashboards = new Map();
  }

  async recordMetric(
    metricName: string,
    value: number,
    labels?: Record<string, string>,
    metricType: MetricType = 'gauge'
  ): Promise<void> {
    try {
      const point: MetricPoint = {
        timestamp: new Date(),
        value,
        labels,
      };

      let series = this.metricSeries.get(metricName);
      if (!series) {
        series = {
          metricName,
          metricType,
          points: [],
        };
        this.metricSeries.set(metricName, series);
      }

      series.points.push(point);

      // Keep recent points only
      if (series.points.length > this.maxMetricsInMemory) {
        series.points = series.points.slice(-this.maxMetricsInMemory);
      }

      // Evaluate alert rules for this metric
      await this.evaluateAlertRules(metricName, value);
    } catch (error) {
      this.logger.error({ error, metricName }, 'Failed to record metric');
    }
  }

  async recordServiceHealth(metrics: ServiceHealthMetrics): Promise<void> {
    try {
      this.serviceMetrics.set(metrics.serviceId, metrics);

      // Record individual metrics
      await this.recordMetric(`${metrics.serviceId}.cpu`, metrics.cpuUsagePercent);
      await this.recordMetric(`${metrics.serviceId}.memory`, metrics.memoryUsagePercent);
      await this.recordMetric(`${metrics.serviceId}.disk`, metrics.diskUsagePercent);
      await this.recordMetric(`${metrics.serviceId}.latency`, metrics.p95LatencyMs);
      await this.recordMetric(`${metrics.serviceId}.error_rate`, metrics.errorRate);
      await this.recordMetric(`${metrics.serviceId}.request_rate`, metrics.requestRate);

      // Update health status
      const baseline = this.performanceBaselines.get(metrics.serviceId);
      if (baseline && this.isAnomaly(metrics.p95LatencyMs, baseline)) {
        this.logger.warn({ serviceId: metrics.serviceId }, 'Service latency anomaly detected');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to record service health');
    }
  }

  async defineAlertRule(rule: AlertRule): Promise<string> {
    try {
      this.alertRules.set(rule.ruleId, rule);

      await this.distributedLogger.log({
        level: 'info',
        message: `Alert rule created: ${rule.ruleId}`,
        metadata: { rule },
      });

      return rule.ruleId;
    } catch (error) {
      this.logger.error({ error }, 'Failed to define alert rule');
      throw error;
    }
  }

  private async evaluateAlertRules(metricName: string, value: number): Promise<void> {
    for (const [ruleId, rule] of this.alertRules.entries()) {
      if (!rule.enabled || rule.metricName !== metricName) {
        continue;
      }

      let shouldAlert = false;

      if (rule.condition === 'threshold' && rule.threshold !== undefined && rule.operator) {
        shouldAlert = this.evaluateThreshold(value, rule.threshold, rule.operator);
      } else if (rule.condition === 'anomaly') {
        const baseline = this.performanceBaselines.get(metricName);
        if (baseline) {
          shouldAlert = this.isAnomaly(value, baseline);
        }
      }

      if (shouldAlert) {
        await this.triggerAlert(rule, value, metricName);
      }
    }
  }

  private evaluateThreshold(value: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      default:
        return false;
    }
  }

  private isAnomaly(value: number, baseline: PerformanceBaseline): boolean {
    const zScore = Math.abs((value - baseline.baselineValue) / baseline.stdDeviation);
    return zScore > 3; // 3 standard deviations
  }

  private async triggerAlert(rule: AlertRule, value: number, metricName: string): Promise<void> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const alert: Alert = {
      alertId,
      ruleId: rule.ruleId,
      metricName,
      severity: rule.severity,
      message: `${rule.name}: ${metricName} = ${value.toFixed(2)}`,
      triggeredAt: new Date(),
      value,
      threshold: rule.threshold,
    };

    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push(alert);

    if (this.alertHistory.length > this.maxAlertsInMemory) {
      this.alertHistory = this.alertHistory.slice(-this.maxAlertsInMemory);
    }

    // Execute alert actions
    for (const action of rule.actions) {
      await this.executeAlertAction(action, alert);
    }

    await this.distributedLogger.log({
      level: 'warn',
      message: alert.message,
      metadata: {
        alertId,
        ruleId: rule.ruleId,
        severity: rule.severity,
      },
    });
  }

  private async executeAlertAction(action: AlertAction, alert: Alert): Promise<void> {
    try {
      switch (action.type) {
        case 'email':
          this.logger.info({ target: action.target }, 'Would send email alert');
          break;
        case 'slack':
          this.logger.info({ target: action.target }, 'Would send Slack alert');
          break;
        case 'webhook':
          this.logger.info({ target: action.target }, 'Would call webhook');
          break;
        case 'pagerduty':
          this.logger.info({ target: action.target }, 'Would create PagerDuty incident');
          break;
        case 'log':
          await this.distributedLogger.log({
            level: 'error',
            message: `Alert: ${alert.message}`,
            metadata: alert,
          });
          break;
      }
    } catch (error) {
      this.logger.error({ error, action }, 'Failed to execute alert action');
    }
  }

  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      this.activeAlerts.delete(alertId);
    }
  }

  async updatePerformanceBaseline(metricName: string): Promise<void> {
    try {
      const series = this.metricSeries.get(metricName);
      if (!series || series.points.length === 0) {
        return;
      }

      // Calculate statistics from recent points
      const now = Date.now();
      const recentPoints = series.points.filter(p => now - p.timestamp.getTime() < this.baselineWindow);

      if (recentPoints.length === 0) {
        return;
      }

      const values = recentPoints.map(p => p.value);
      values.sort((a, b) => a - b);

      const baseline: PerformanceBaseline = {
        metricName,
        baselineValue: values.reduce((a, b) => a + b, 0) / values.length,
        stdDeviation: this.calculateStdDeviation(values),
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.floor(values.length * 0.95)],
        p99: values[Math.floor(values.length * 0.99)],
        minValue: values[0],
        maxValue: values[values.length - 1],
        sampleCount: values.length,
        lastUpdated: new Date(),
      };

      this.performanceBaselines.set(metricName, baseline);
    } catch (error) {
      this.logger.error({ error, metricName }, 'Failed to update baseline');
    }
  }

  private calculateStdDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  async defineSLA(config: SLAConfig): Promise<string> {
    this.slaConfigs.set(config.slaId, config);
    return config.slaId;
  }

  async updateSLAStatus(slaId: string, currentValue: number): Promise<void> {
    const config = this.slaConfigs.get(slaId);
    if (!config) {
      return;
    }

    const achievedPercent = config.operator === 'gte' ? (currentValue / config.targetValue) * 100 : (config.targetValue / currentValue) * 100;
    const status: SLAStatus = {
      slaId,
      currentValue,
      targetValue: config.targetValue,
      achievedPercent: Math.min(100, achievedPercent),
      status: achievedPercent >= 100 ? 'on_track' : achievedPercent >= 95 ? 'at_risk' : 'breached',
      lastUpdated: new Date(),
    };

    this.slaStatus.set(slaId, status);
  }

  async getSLAStatus(slaId: string): Promise<SLAStatus | undefined> {
    return this.slaStatus.get(slaId);
  }

  async getActiveAlerts(severity?: AlertSeverity): Promise<Alert[]> {
    const alerts = Array.from(this.activeAlerts.values());
    return severity ? alerts.filter(a => a.severity === severity) : alerts;
  }

  async getAlertHistory(limit: number = 1000): Promise<Alert[]> {
    return this.alertHistory.slice(-limit);
  }

  async getMetricSeries(metricName: string, hoursBack?: number): Promise<MetricSeries | undefined> {
    let series = this.metricSeries.get(metricName);
    if (!series) {
      return undefined;
    }

    if (hoursBack) {
      const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;
      const filteredPoints = series.points.filter(p => p.timestamp.getTime() >= cutoffTime);
      return { ...series, points: filteredPoints };
    }

    return series;
  }

  async createDashboard(dashboard: Dashboard): Promise<string> {
    this.dashboards.set(dashboard.dashboardId, dashboard);
    return dashboard.dashboardId;
  }

  async getDashboard(dashboardId: string): Promise<Dashboard | undefined> {
    return this.dashboards.get(dashboardId);
  }

  async getServiceHealth(serviceId: string): Promise<ServiceHealthMetrics | undefined> {
    return this.serviceMetrics.get(serviceId);
  }

  async getAllServiceHealth(): Promise<ServiceHealthMetrics[]> {
    return Array.from(this.serviceMetrics.values());
  }

  async getSystemHealthSummary(): Promise<Record<string, any>> {
    const allMetrics = Array.from(this.serviceMetrics.values());
    const healthyCount = allMetrics.filter(m => m.status === 'healthy').length;
    const degradedCount = allMetrics.filter(m => m.status === 'degraded').length;
    const unhealthyCount = allMetrics.filter(m => m.status === 'unhealthy').length;

    const avgCpuUsage = allMetrics.length > 0 ? allMetrics.reduce((a, b) => a + b.cpuUsagePercent, 0) / allMetrics.length : 0;
    const avgMemoryUsage = allMetrics.length > 0 ? allMetrics.reduce((a, b) => a + b.memoryUsagePercent, 0) / allMetrics.length : 0;

    return {
      totalServices: allMetrics.length,
      healthyServices: healthyCount,
      degradedServices: degradedCount,
      unhealthyServices: unhealthyCount,
      avgCpuUsage,
      avgMemoryUsage,
      totalActiveAlerts: this.activeAlerts.size,
      criticalAlerts: Array.from(this.activeAlerts.values()).filter(a => a.severity === 'critical').length,
    };
  }

  async cleanupOldMetrics(olderThanHours: number = 168): Promise<number> {
    const cutoffTime = Date.now() - olderThanHours * 60 * 60 * 1000;
    let removed = 0;

    for (const series of this.metricSeries.values()) {
      const originalLength = series.points.length;
      series.points = series.points.filter(p => p.timestamp.getTime() >= cutoffTime);
      removed += originalLength - series.points.length;
    }

    return removed;
  }
}
