import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Metrics Aggregation Types
 */

export interface MetricPoint {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
  tags?: string[];
}

export interface MetricSeries {
  name: string;
  points: MetricPoint[];
  unit?: string;
  description?: string;
}

export interface AggregationResult {
  name: string;
  window: {
    start: Date;
    end: Date;
    duration: number; // milliseconds
  };
  statistics: {
    count: number;
    sum: number;
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  };
  rate?: number; // per second
  trend?: 'increasing' | 'stable' | 'decreasing';
}

export interface PercentileResult {
  percentile: number;
  value: number;
}

export interface MetricAlert {
  metricName: string;
  condition: 'exceeds' | 'below' | 'changes';
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  triggered: boolean;
  lastValue: number;
  lastTriggeredAt?: Date;
}

export interface MetricsSnapshot {
  timestamp: Date;
  metrics: Record<string, AggregationResult>;
  alerts: MetricAlert[];
  systemHealth: number; // 0-100 score
}

/**
 * Metrics Aggregation Engine
 *
 * Real-time metrics collection and analysis with:
 * - Time-windowed aggregation (1s, 1m, 5m, 1h)
 * - Percentile calculation (p50, p95, p99, p999)
 * - Trend detection
 * - Alert triggering
 * - Pattern discovery
 */
export class MetricsAggregation {
  private logger = pino();
  private metricsStore: Map<string, MetricPoint[]> = new Map();
  private aggregationCache: Map<string, AggregationResult> = new Map();
  private alerts: Map<string, MetricAlert> = new Map();
  private readonly maxPointsPerMetric = 100000;
  private readonly aggregationWindows = {
    '1s': 1000,
    '1m': 60000,
    '5m': 300000,
    '1h': 3600000,
  };

  constructor() {}

  /**
   * Record a metric point
   */
  recordMetric(name: string, value: number, labels?: Record<string, string>, tags?: string[]): void {
    const point: MetricPoint = {
      timestamp: new Date(),
      value,
      labels,
      tags,
    };

    let points = this.metricsStore.get(name);
    if (!points) {
      points = [];
      this.metricsStore.set(name, points);
    }

    points.push(point);

    // Maintain size limit
    if (points.length > this.maxPointsPerMetric) {
      points.shift();
    }

    // Invalidate aggregation cache
    this.invalidateCache(name);

    this.logger.debug(
      {
        metric: name,
        value,
        labels,
      },
      'Metric recorded'
    );
  }

  /**
   * Get aggregated metrics for time window
   */
  aggregate(name: string, windowMs: number = 60000): AggregationResult | null {
    const points = this.metricsStore.get(name);
    if (!points || points.length === 0) {
      return null;
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    // Filter points within window
    const windowPoints = points.filter((p) => p.timestamp.getTime() >= windowStart);

    if (windowPoints.length === 0) {
      return null;
    }

    // Calculate statistics
    const values = windowPoints.map((p) => p.value);
    const stats = this.calculateStatistics(values);

    // Detect trend
    const trend = this.detectTrend(windowPoints);

    // Calculate rate (points per second)
    const rate = (windowPoints.length * 1000) / windowMs;

    const result: AggregationResult = {
      name,
      window: {
        start: new Date(windowStart),
        end: new Date(now),
        duration: windowMs,
      },
      statistics: stats,
      rate,
      trend,
    };

    return result;
  }

  /**
   * Get aggregated metrics across multiple windows
   */
  aggregateMultiWindow(name: string): Record<string, AggregationResult> {
    const results: Record<string, AggregationResult> = {};

    for (const [windowName, windowMs] of Object.entries(this.aggregationWindows)) {
      const result = this.aggregate(name, windowMs);
      if (result) {
        results[windowName] = result;
      }
    }

    return results;
  }

  /**
   * Get percentile for metric
   */
  getPercentile(name: string, percentile: number, windowMs: number = 60000): PercentileResult | null {
    const points = this.metricsStore.get(name);
    if (!points || points.length === 0) {
      return null;
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    const windowPoints = points
      .filter((p) => p.timestamp.getTime() >= windowStart)
      .map((p) => p.value)
      .sort((a, b) => a - b);

    if (windowPoints.length === 0) {
      return null;
    }

    const index = Math.ceil((percentile / 100) * windowPoints.length) - 1;
    const value = windowPoints[Math.max(0, index)];

    return { percentile, value };
  }

  /**
   * Set metric alert
   */
  setAlert(
    metricName: string,
    condition: 'exceeds' | 'below' | 'changes',
    threshold: number,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): void {
    const alert: MetricAlert = {
      metricName,
      condition,
      threshold,
      severity,
      triggered: false,
      lastValue: 0,
    };

    this.alerts.set(`${metricName}:${condition}:${threshold}`, alert);

    this.logger.info(
      {
        metricName,
        condition,
        threshold,
        severity,
      },
      'Metric alert configured'
    );
  }

  /**
   * Check alerts and return triggered ones
   */
  checkAlerts(windowMs: number = 60000): MetricAlert[] {
    const triggered: MetricAlert[] = [];

    for (const alert of this.alerts.values()) {
      const result = this.aggregate(alert.metricName, windowMs);
      if (!result) continue;

      const lastPoint = this.getLastPoint(alert.metricName);
      if (!lastPoint) continue;

      alert.lastValue = lastPoint.value;

      let shouldTrigger = false;

      switch (alert.condition) {
        case 'exceeds':
          shouldTrigger = result.statistics.mean > alert.threshold;
          break;
        case 'below':
          shouldTrigger = result.statistics.mean < alert.threshold;
          break;
        case 'changes':
          // Trigger if standard deviation exceeds threshold
          shouldTrigger = result.statistics.stdDev > alert.threshold;
          break;
      }

      alert.triggered = shouldTrigger;
      if (shouldTrigger) {
        alert.lastTriggeredAt = new Date();
        triggered.push(alert);
      }
    }

    return triggered;
  }

  /**
   * Get system health score
   */
  getSystemHealth(): number {
    const allAlerts = Array.from(this.alerts.values());
    const triggeredAlerts = allAlerts.filter((a) => a.triggered);

    if (allAlerts.length === 0) return 100;

    // Calculate health based on triggered alerts
    const criticalCount = triggeredAlerts.filter((a) => a.severity === 'critical').length;
    const highCount = triggeredAlerts.filter((a) => a.severity === 'high').length;
    const mediumCount = triggeredAlerts.filter((a) => a.severity === 'medium').length;

    let healthScore = 100;
    healthScore -= criticalCount * 20;
    healthScore -= highCount * 10;
    healthScore -= mediumCount * 3;

    return Math.max(0, healthScore);
  }

  /**
   * Get comprehensive metrics snapshot
   */
  getSnapshot(windowMs: number = 60000): MetricsSnapshot {
    const metrics: Record<string, AggregationResult> = {};

    for (const name of this.metricsStore.keys()) {
      const result = this.aggregate(name, windowMs);
      if (result) {
        metrics[name] = result;
      }
    }

    const triggeredAlerts = this.checkAlerts(windowMs);

    return {
      timestamp: new Date(),
      metrics,
      alerts: triggeredAlerts,
      systemHealth: this.getSystemHealth(),
    };
  }

  /**
   * Get metric history
   */
  getMetricHistory(name: string, limit: number = 1000): MetricPoint[] {
    const points = this.metricsStore.get(name) || [];
    return points.slice(-limit);
  }

  /**
   * Clear metrics older than specified time
   */
  clearOldMetrics(olderThanMs: number = 86400000): number {
    let clearedCount = 0;
    const cutoffTime = Date.now() - olderThanMs;

    for (const [name, points] of this.metricsStore) {
      const beforeLength = points.length;
      const filtered = points.filter((p) => p.timestamp.getTime() >= cutoffTime);

      if (filtered.length < beforeLength) {
        this.metricsStore.set(name, filtered);
        clearedCount += beforeLength - filtered.length;
      }
    }

    this.logger.info({ clearedCount }, 'Old metrics cleared');
    return clearedCount;
  }

  /**
   * List all metrics
   */
  listMetrics(): string[] {
    return Array.from(this.metricsStore.keys());
  }

  // Private methods

  private calculateStatistics(values: number[]): {
    count: number;
    sum: number;
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  } {
    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / count;

    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    const getPercentile = (p: number) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      count,
      sum,
      mean,
      median,
      min,
      max,
      stdDev,
      p50: getPercentile(50),
      p95: getPercentile(95),
      p99: getPercentile(99),
      p999: getPercentile(99.9),
    };
  }

  private detectTrend(points: MetricPoint[]): 'increasing' | 'stable' | 'decreasing' {
    if (points.length < 2) return 'stable';

    // Simple trend detection: compare first and last quarter
    const quarterSize = Math.max(1, Math.floor(points.length / 4));
    const firstQuarter = points.slice(0, quarterSize).map((p) => p.value);
    const lastQuarter = points.slice(-quarterSize).map((p) => p.value);

    const firstMean = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
    const lastMean = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;

    const percentChange = ((lastMean - firstMean) / firstMean) * 100;

    if (Math.abs(percentChange) < 2) return 'stable';
    return percentChange > 0 ? 'increasing' : 'decreasing';
  }

  private getLastPoint(name: string): MetricPoint | undefined {
    const points = this.metricsStore.get(name);
    return points && points.length > 0 ? points[points.length - 1] : undefined;
  }

  private invalidateCache(name: string): void {
    // Invalidate cache entries for this metric
    for (const key of this.aggregationCache.keys()) {
      if (key.startsWith(`${name}:`)) {
        this.aggregationCache.delete(key);
      }
    }
  }
}

export default MetricsAggregation;
