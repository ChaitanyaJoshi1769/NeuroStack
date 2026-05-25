import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Real-time Insights Types
 */
export interface RealtimeInsight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  metric: string;
  value: number;
  severity: SeverityLevel;
  confidence: number;
  threshold?: number;
  previousValue?: number;
  change?: number;
  changePercent?: number;
  detectedAt: Date;
}

export enum InsightType {
  ANOMALY = 'anomaly',
  TREND_ACCELERATION = 'trend_acceleration',
  THRESHOLD_BREACH = 'threshold_breach',
  CORRELATION_CHANGE = 'correlation_change',
  FORECASTED_ISSUE = 'forecasted_issue',
}

export enum SeverityLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export interface AlertRule {
  id: string;
  metric: string;
  type: AlertType;
  condition: AlertCondition;
  threshold: number;
  enabled: boolean;
  notificationChannels: NotificationChannel[];
  createdAt: Date;
  updatedAt: Date;
}

export enum AlertType {
  THRESHOLD = 'threshold',
  ANOMALY = 'anomaly',
  TREND = 'trend',
  FORECAST = 'forecast',
  CORRELATION = 'correlation',
}

export interface AlertCondition {
  operator: ComparisonOperator;
  value: number;
  window?: number; // periods to evaluate
}

export enum ComparisonOperator {
  GREATER_THAN = 'gt',
  LESS_THAN = 'lt',
  EQUALS = 'eq',
  NOT_EQUALS = 'neq',
  GREATER_OR_EQUAL = 'gte',
  LESS_OR_EQUAL = 'lte',
  PERCENT_CHANGE = 'pct_change',
}

export interface NotificationChannel {
  type: ChannelType;
  destination: string;
  enabled: boolean;
}

export enum ChannelType {
  EMAIL = 'email',
  SLACK = 'slack',
  WEBHOOK = 'webhook',
  SMS = 'sms',
  TEAMS = 'teams',
}

export interface Alert {
  id: string;
  ruleId: string;
  insight: RealtimeInsight;
  severity: SeverityLevel;
  status: AlertStatus;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

export enum AlertStatus {
  TRIGGERED = 'triggered',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

export interface SubscriptionFilter {
  types?: InsightType[];
  metrics?: string[];
  severities?: SeverityLevel[];
  tenantId: string;
}

export interface StreamEvent {
  type: 'insight' | 'alert' | 'update' | 'status';
  data: RealtimeInsight | Alert | Record<string, unknown>;
  timestamp: Date;
}

/**
 * Real-time Insights Streaming System
 */
export class RealtimeInsightsSystem {
  private logger = pino();
  private insights: Map<string, RealtimeInsight> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private subscribers: Map<string, SubscriptionFilter[]> = new Map();
  private detectionEngine: AnomalyDetectionEngine;
  private alertEngine: AlertEngine;

  constructor() {
    this.detectionEngine = new AnomalyDetectionEngine();
    this.alertEngine = new AlertEngine(this);
  }

  /**
   * Process new data point and detect insights
   */
  async processDataPoint(
    metric: string,
    value: number,
    previousValue?: number
  ): Promise<RealtimeInsight[]> {
    const insights: RealtimeInsight[] = [];

    // Detect anomalies
    const anomalies = await this.detectionEngine.detect(metric, value);
    insights.push(...anomalies);

    // Detect threshold breaches
    const breaches = this.detectThresholdBreaches(metric, value);
    insights.push(...breaches);

    // Detect trend acceleration
    const trends = this.detectTrendAcceleration(metric, value, previousValue);
    insights.push(...trends);

    // Store insights
    for (const insight of insights) {
      this.insights.set(insight.id, insight);

      // Evaluate alert rules
      const alerts = await this.alertEngine.evaluate(insight, this.rules);
      for (const alert of alerts) {
        this.alerts.set(alert.id, alert);
        await this.notifySubscribers(alert);
      }

      // Notify subscribers
      await this.notifySubscribers(insight);
    }

    this.logger.info(
      { metric, insightCount: insights.length },
      'Data point processed'
    );

    return insights;
  }

  /**
   * Register alert rule
   */
  registerRule(rule: AlertRule): AlertRule {
    this.rules.set(rule.id, rule);
    this.logger.info({ ruleId: rule.id, metric: rule.metric }, 'Alert rule registered');
    return rule;
  }

  /**
   * Subscribe to insights
   */
  subscribe(
    subscriberId: string,
    filter: SubscriptionFilter
  ): { subscriberId: string; subscriptionId: string } {
    if (!this.subscribers.has(subscriberId)) {
      this.subscribers.set(subscriberId, []);
    }
    this.subscribers.get(subscriberId)!.push(filter);

    const subscriptionId = generateId();
    this.logger.info({ subscriberId, filter }, 'Subscribed to insights');

    return { subscriberId, subscriptionId };
  }

  /**
   * Unsubscribe from insights
   */
  unsubscribe(subscriberId: string): boolean {
    const removed = this.subscribers.delete(subscriberId);
    this.logger.info({ subscriberId }, 'Unsubscribed from insights');
    return removed;
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): Alert | undefined {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.status = AlertStatus.ACKNOWLEDGED;
      alert.acknowledgedAt = new Date();
      this.logger.info({ alertId, acknowledgedBy }, 'Alert acknowledged');
    }
    return alert;
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): Alert | undefined {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.status = AlertStatus.RESOLVED;
      alert.resolvedAt = new Date();
      this.logger.info({ alertId }, 'Alert resolved');
    }
    return alert;
  }

  /**
   * Get recent insights
   */
  getRecentInsights(
    limit: number = 50,
    types?: InsightType[]
  ): RealtimeInsight[] {
    const insights = Array.from(this.insights.values());

    if (types) {
      return insights
        .filter((i) => types.includes(i.type))
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
        .slice(0, limit);
    }

    return insights
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(
      (a) => a.status !== AlertStatus.RESOLVED
    );
  }

  /**
   * Get statistics
   */
  getStatistics(): Record<string, unknown> {
    const insights = Array.from(this.insights.values());
    const alerts = Array.from(this.alerts.values());

    const insightsByType: Record<string, number> = {};
    const insightsBySeverity: Record<string, number> = {};

    for (const insight of insights) {
      insightsByType[insight.type] = (insightsByType[insight.type] || 0) + 1;
      insightsBySeverity[insight.severity] = (insightsBySeverity[insight.severity] || 0) + 1;
    }

    return {
      totalInsights: insights.length,
      totalAlerts: alerts.length,
      activeAlerts: this.getActiveAlerts().length,
      insightsByType,
      insightsBySeverity,
      subscriberCount: this.subscribers.size,
      ruleCount: this.rules.size,
    };
  }

  // Private helper methods

  private detectThresholdBreaches(metric: string, value: number): RealtimeInsight[] {
    const breaches: RealtimeInsight[] = [];

    for (const rule of this.rules.values()) {
      if (rule.metric !== metric || rule.type !== AlertType.THRESHOLD) continue;

      const condition = rule.condition;
      let breached = false;

      switch (condition.operator) {
        case ComparisonOperator.GREATER_THAN:
          breached = value > condition.value;
          break;
        case ComparisonOperator.LESS_THAN:
          breached = value < condition.value;
          break;
        case ComparisonOperator.EQUALS:
          breached = value === condition.value;
          break;
      }

      if (breached) {
        breaches.push({
          id: generateId(),
          type: InsightType.THRESHOLD_BREACH,
          title: `Threshold breached for ${metric}`,
          description: `${metric} value ${value} exceeded threshold ${condition.value}`,
          metric,
          value,
          severity: SeverityLevel.WARNING,
          confidence: 0.95,
          threshold: condition.value,
          detectedAt: new Date(),
        });
      }
    }

    return breaches;
  }

  private detectTrendAcceleration(
    metric: string,
    value: number,
    previousValue?: number
  ): RealtimeInsight[] {
    if (!previousValue) return [];

    const change = value - previousValue;
    const changePercent = (change / previousValue) * 100;

    if (Math.abs(changePercent) > 20) {
      return [
        {
          id: generateId(),
          type: InsightType.TREND_ACCELERATION,
          title: `Trend acceleration in ${metric}`,
          description: `${metric} changed ${changePercent > 0 ? 'increased' : 'decreased'} by ${Math.abs(changePercent).toFixed(2)}%`,
          metric,
          value,
          severity: changePercent > 50 ? SeverityLevel.CRITICAL : SeverityLevel.WARNING,
          confidence: 0.88,
          previousValue,
          change,
          changePercent,
          detectedAt: new Date(),
        },
      ];
    }

    return [];
  }

  private async notifySubscribers(
    data: RealtimeInsight | Alert
  ): Promise<void> {
    for (const [subscriberId, filters] of this.subscribers) {
      for (const filter of filters) {
        if (this.matchesFilter(data, filter)) {
          this.logger.debug(
            { subscriberId, dataId: 'id' in data ? data.id : '' },
            'Notifying subscriber'
          );
        }
      }
    }
  }

  private matchesFilter(
    data: RealtimeInsight | Alert,
    filter: SubscriptionFilter
  ): boolean {
    if ('ruleId' in data) {
      // It's an Alert
      data = data.insight;
    }

    const insight = data as RealtimeInsight;

    if (filter.types && !filter.types.includes(insight.type)) return false;
    if (filter.metrics && !filter.metrics.includes(insight.metric)) return false;
    if (filter.severities && !filter.severities.includes(insight.severity)) return false;

    return true;
  }
}

/**
 * Anomaly Detection Engine
 */
class AnomalyDetectionEngine {
  async detect(metric: string, value: number): Promise<RealtimeInsight[]> {
    // Simplified anomaly detection - in production would use ML models
    const anomalies: RealtimeInsight[] = [];

    // Check if value is statistical outlier (simplified)
    const zScore = Math.random() * 4; // Mock calculation

    if (zScore > 2.5) {
      anomalies.push({
        id: generateId(),
        type: InsightType.ANOMALY,
        title: `Anomaly detected in ${metric}`,
        description: `Statistical anomaly detected with Z-score of ${zScore.toFixed(2)}`,
        metric,
        value,
        severity: SeverityLevel.WARNING,
        confidence: 0.82,
        detectedAt: new Date(),
      });
    }

    return anomalies;
  }
}

/**
 * Alert Engine
 */
class AlertEngine {
  private system: RealtimeInsightsSystem;

  constructor(system: RealtimeInsightsSystem) {
    this.system = system;
  }

  async evaluate(
    insight: RealtimeInsight,
    rules: Map<string, AlertRule>
  ): Promise<Alert[]> {
    const alerts: Alert[] = [];

    for (const rule of rules.values()) {
      if (!rule.enabled || rule.metric !== insight.metric) continue;

      // Check if rule matches insight
      if (this.matchesRule(insight, rule)) {
        const alert: Alert = {
          id: generateId(),
          ruleId: rule.id,
          insight,
          severity: this.determineSeverity(insight, rule),
          status: AlertStatus.TRIGGERED,
          createdAt: new Date(),
        };

        alerts.push(alert);

        // Send notifications
        await this.sendNotifications(alert, rule);
      }
    }

    return alerts;
  }

  private matchesRule(insight: RealtimeInsight, rule: AlertRule): boolean {
    // Match insight type to rule type
    const typeMatches: Record<AlertType, InsightType[]> = {
      [AlertType.THRESHOLD]: [InsightType.THRESHOLD_BREACH],
      [AlertType.ANOMALY]: [InsightType.ANOMALY],
      [AlertType.TREND]: [InsightType.TREND_ACCELERATION],
      [AlertType.FORECAST]: [InsightType.FORECASTED_ISSUE],
      [AlertType.CORRELATION]: [InsightType.CORRELATION_CHANGE],
    };

    return typeMatches[rule.type]?.includes(insight.type) || false;
  }

  private determineSeverity(insight: RealtimeInsight, rule: AlertRule): SeverityLevel {
    // Higher severity if insight is critical
    if (insight.severity === SeverityLevel.CRITICAL) {
      return SeverityLevel.CRITICAL;
    }

    return insight.severity || SeverityLevel.WARNING;
  }

  private async sendNotifications(alert: Alert, rule: AlertRule): Promise<void> {
    for (const channel of rule.notificationChannels) {
      if (!channel.enabled) continue;

      // Mock notification sending
      switch (channel.type) {
        case ChannelType.EMAIL:
          // await sendEmail(channel.destination, alert);
          break;
        case ChannelType.SLACK:
          // await sendSlackMessage(channel.destination, alert);
          break;
        case ChannelType.WEBHOOK:
          // await callWebhook(channel.destination, alert);
          break;
      }
    }
  }
}

export { RealtimeInsightsSystem as default };
