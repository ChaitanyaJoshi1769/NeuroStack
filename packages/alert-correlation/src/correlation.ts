import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Alert Correlation Types
 */

export interface CorrelationRule {
  ruleId: string;
  name: string;
  pattern: string;
  conditions: AlertCondition[];
  timeWindowMs: number;
  minAlerts: number;
  rootCause?: string;
  confidence: number; // 0-1
  enabled: boolean;
}

export interface AlertCondition {
  field: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'regex' | 'greaterThan' | 'lessThan';
  value: any;
}

export interface CorrelatedAlerts {
  correlationId: string;
  alertIds: string[];
  alerts: Alert[];
  rootCause: string | null;
  confidence: number; // 0-100
  timeRange: {
    start: Date;
    end: Date;
  };
  correlationRuleId?: string;
  patterns: AlertPattern[];
  suggestedActions: string[];
  createdAt: Date;
}

export interface AlertPattern {
  patternId: string;
  name: string;
  frequency: number;
  severity: number;
  lastOccurrence: Date;
  isAnomalous: boolean;
}

export interface Alert {
  alertId: string;
  type: string;
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface CorrelationStats {
  totalAlerts: number;
  correlatedAlerts: number;
  uncorrelatedAlerts: number;
  totalCorrelations: number;
  averageCorrelationSize: number;
  rootCauseIdentifiedCount: number;
  confidenceDistribution: Record<string, number>;
}

/**
 * Alert Correlation Engine
 *
 * Advanced alert correlation and pattern analysis:
 * - Multi-alert pattern matching and grouping
 * - Root cause identification through rule engine
 * - Temporal and causal relationships
 * - Pattern anomaly detection
 * - Confidence scoring
 * - Suggested remediation actions
 */
export class AlertCorrelationEngine {
  private logger = pino();
  private alerts: Map<string, Alert> = new Map();
  private correlations: Map<string, CorrelatedAlerts> = new Map();
  private rules: Map<string, CorrelationRule> = new Map();
  private patterns: Map<string, AlertPattern> = new Map();
  private readonly defaultTimeWindowMs = 5000; // 5 seconds
  private readonly maxAlertsBuffer = 50000;
  private readonly correlationRetentionMs = 86400000; // 24 hours
  private alertHistory: Array<{ alertId: string; timestamp: Date }> = [];

  constructor() {
    this.initializeDefaultRules();
    this.logger.info('AlertCorrelationEngine initialized');
  }

  /**
   * Submit an alert for correlation processing
   */
  submitAlert(alert: Alert): void {
    this.alerts.set(alert.alertId, alert);
    this.alertHistory.push({ alertId: alert.alertId, timestamp: alert.timestamp });

    // Maintain buffer size
    if (this.alerts.size > this.maxAlertsBuffer) {
      const oldestKey = this.alerts.keys().next().value;
      this.alerts.delete(oldestKey);
    }

    // Attempt correlation
    this.processAlert(alert);

    this.logger.debug(
      {
        alertId: alert.alertId,
        type: alert.type,
        severity: alert.severity,
      },
      'Alert submitted'
    );
  }

  /**
   * Batch submit alerts
   */
  submitBatchAlerts(alertList: Alert[]): void {
    for (const alert of alertList) {
      this.submitAlert(alert);
    }

    this.logger.info({ count: alertList.length }, 'Batch alerts submitted');
  }

  /**
   * Add correlation rule
   */
  addRule(rule: CorrelationRule): void {
    this.rules.set(rule.ruleId, rule);

    this.logger.info(
      {
        ruleId: rule.ruleId,
        name: rule.name,
        minAlerts: rule.minAlerts,
      },
      'Correlation rule added'
    );
  }

  /**
   * Remove correlation rule
   */
  removeRule(ruleId: string): boolean {
    const removed = this.rules.delete(ruleId);

    if (removed) {
      this.logger.info({ ruleId }, 'Correlation rule removed');
    }

    return removed;
  }

  /**
   * Get correlated alerts by time window
   */
  getCorrelatedAlerts(timeWindowMs?: number): CorrelatedAlerts[] {
    const window = timeWindowMs || this.defaultTimeWindowMs;
    const correlatedList: CorrelatedAlerts[] = [];

    for (const correlation of this.correlations.values()) {
      const timeRange = correlation.timeRange.getTime
        ? correlation.timeRange.getTime()
        : 0;
      const now = Date.now();
      if (now - timeRange <= window) {
        correlatedList.push(correlation);
      }
    }

    return correlatedList.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get alerts by type
   */
  getAlertsByType(type: string): Alert[] {
    const alerts: Alert[] = [];

    for (const alert of this.alerts.values()) {
      if (alert.type === type) {
        alerts.push(alert);
      }
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: string): Alert[] {
    const alerts: Alert[] = [];

    for (const alert of this.alerts.values()) {
      if (alert.severity === severity) {
        alerts.push(alert);
      }
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Find root cause for alert
   */
  findRootCause(alertId: string): { rootCause: string | null; confidence: number } {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return { rootCause: null, confidence: 0 };
    }

    // Check correlations involving this alert
    for (const correlation of this.correlations.values()) {
      if (correlation.alertIds.includes(alertId)) {
        return {
          rootCause: correlation.rootCause,
          confidence: correlation.confidence,
        };
      }
    }

    return { rootCause: null, confidence: 0 };
  }

  /**
   * Get correlation statistics
   */
  getStats(): CorrelationStats {
    const correlatedAlertIds = new Set<string>();

    for (const correlation of this.correlations.values()) {
      for (const alertId of correlation.alertIds) {
        correlatedAlertIds.add(alertId);
      }
    }

    const confidenceDistribution: Record<string, number> = {
      veryHigh: 0, // 80-100
      high: 0, // 60-79
      medium: 0, // 40-59
      low: 0, // 0-39
    };

    for (const correlation of this.correlations.values()) {
      if (correlation.confidence >= 80) {
        confidenceDistribution.veryHigh++;
      } else if (correlation.confidence >= 60) {
        confidenceDistribution.high++;
      } else if (correlation.confidence >= 40) {
        confidenceDistribution.medium++;
      } else {
        confidenceDistribution.low++;
      }
    }

    let rootCauseCount = 0;
    for (const correlation of this.correlations.values()) {
      if (correlation.rootCause) {
        rootCauseCount++;
      }
    }

    const totalCorrelations = this.correlations.size;
    const totalAlerts = this.alerts.size;
    const correlatedAlerts = correlatedAlertIds.size;

    return {
      totalAlerts,
      correlatedAlerts,
      uncorrelatedAlerts: totalAlerts - correlatedAlerts,
      totalCorrelations,
      averageCorrelationSize:
        totalCorrelations > 0
          ? Math.round(
              Array.from(this.correlations.values()).reduce(
                (sum, c) => sum + c.alertIds.length,
                0
              ) / totalCorrelations
            )
          : 0,
      rootCauseIdentifiedCount: rootCauseCount,
      confidenceDistribution,
    };
  }

  /**
   * Get pattern analysis
   */
  getPatterns(): AlertPattern[] {
    return Array.from(this.patterns.values()).sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Detect anomalous patterns
   */
  detectAnomalousPatterns(): AlertPattern[] {
    const patterns = Array.from(this.patterns.values());
    const avgFrequency =
      patterns.reduce((sum, p) => sum + p.frequency, 0) / Math.max(patterns.length, 1);
    const stdDev = Math.sqrt(
      patterns.reduce((sum, p) => sum + Math.pow(p.frequency - avgFrequency, 2), 0) /
        Math.max(patterns.length, 1)
    );

    return patterns.filter((p) => {
      p.isAnomalous = p.frequency > avgFrequency + 2 * stdDev;
      return p.isAnomalous;
    });
  }

  /**
   * Clear old correlations
   */
  cleanupOldData(): number {
    const cutoffTime = Date.now() - this.correlationRetentionMs;
    let removedCount = 0;

    for (const [correlationId, correlation] of this.correlations.entries()) {
      if (correlation.createdAt.getTime() < cutoffTime) {
        this.correlations.delete(correlationId);
        removedCount++;
      }
    }

    // Also cleanup old alerts
    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.timestamp.getTime() < cutoffTime) {
        this.alerts.delete(alertId);
      }
    }

    this.logger.info({ removedCount }, 'Old correlations cleaned up');
    return removedCount;
  }

  // Private methods

  private initializeDefaultRules(): void {
    // High severity cascade rule
    this.addRule({
      ruleId: generateId(),
      name: 'High Severity Cascade',
      pattern: 'high.*critical',
      conditions: [
        { field: 'severity', operator: 'equals', value: 'high' },
        { field: 'severity', operator: 'equals', value: 'critical' },
      ],
      timeWindowMs: 5000,
      minAlerts: 2,
      rootCause: 'System overload or cascading failure',
      confidence: 0.85,
      enabled: true,
    });

    // Memory pressure pattern
    this.addRule({
      ruleId: generateId(),
      name: 'Memory Pressure Pattern',
      pattern: 'memory.*allocation.*failure',
      conditions: [
        { field: 'type', operator: 'contains', value: 'memory' },
        { field: 'message', operator: 'contains', value: 'allocation' },
      ],
      timeWindowMs: 10000,
      minAlerts: 3,
      rootCause: 'Memory exhaustion or leak',
      confidence: 0.8,
      enabled: true,
    });

    // Network connectivity pattern
    this.addRule({
      ruleId: generateId(),
      name: 'Network Connectivity Issues',
      pattern: 'network.*timeout.*unreachable',
      conditions: [
        { field: 'type', operator: 'contains', value: 'network' },
        { field: 'message', operator: 'contains', value: 'timeout' },
      ],
      timeWindowMs: 8000,
      minAlerts: 2,
      rootCause: 'Network partition or service unavailability',
      confidence: 0.75,
      enabled: true,
    });
  }

  private processAlert(alert: Alert): void {
    // Update pattern tracking
    const patternKey = `${alert.type}:${alert.severity}`;
    if (this.patterns.has(patternKey)) {
      const pattern = this.patterns.get(patternKey)!;
      pattern.frequency++;
      pattern.lastOccurrence = alert.timestamp;
    } else {
      this.patterns.set(patternKey, {
        patternId: generateId(),
        name: patternKey,
        frequency: 1,
        severity:
          alert.severity === 'critical' ? 4 : alert.severity === 'high' ? 3 : 1,
        lastOccurrence: alert.timestamp,
        isAnomalous: false,
      });
    }

    // Try to correlate with existing alerts
    const correlatedAlerts = this.findRelatedAlerts(alert);

    if (correlatedAlerts.length > 0) {
      // Create or update correlation
      const correlation = this.createCorrelation(alert, correlatedAlerts);
      this.correlations.set(correlation.correlationId, correlation);
    }
  }

  private findRelatedAlerts(alert: Alert): Alert[] {
    const related: Alert[] = [];
    const timeWindow = this.defaultTimeWindowMs;
    const alertTime = alert.timestamp.getTime();

    for (const existingAlert of this.alerts.values()) {
      if (existingAlert.alertId === alert.alertId) continue;

      const timeDiff = Math.abs(alertTime - existingAlert.timestamp.getTime());

      // Check if within time window
      if (timeDiff > timeWindow) continue;

      // Check for type/source similarity
      if (
        existingAlert.type === alert.type ||
        existingAlert.source === alert.source ||
        this.isSimilarSeverity(existingAlert.severity, alert.severity)
      ) {
        related.push(existingAlert);
      }
    }

    return related;
  }

  private isSimilarSeverity(severity1: string, severity2: string): boolean {
    const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    const s1 = severityOrder[severity1 as keyof typeof severityOrder] || 0;
    const s2 = severityOrder[severity2 as keyof typeof severityOrder] || 0;
    return Math.abs(s1 - s2) <= 1;
  }

  private createCorrelation(alert: Alert, relatedAlerts: Alert[]): CorrelatedAlerts {
    const allAlerts = [alert, ...relatedAlerts];
    const sortedAlerts = allAlerts.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    // Calculate confidence
    const confidence = this.calculateCorrelationConfidence(sortedAlerts);

    // Find root cause
    let rootCause: string | null = null;
    let ruleId: string | undefined;

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      if (this.matchesRule(sortedAlerts, rule)) {
        rootCause = rule.rootCause || null;
        ruleId = rule.ruleId;
        break;
      }
    }

    // Generate suggested actions
    const suggestedActions = this.generateSuggestedActions(
      sortedAlerts,
      rootCause
    );

    return {
      correlationId: generateId(),
      alertIds: sortedAlerts.map((a) => a.alertId),
      alerts: sortedAlerts,
      rootCause,
      confidence: Math.round(confidence * 100),
      timeRange: {
        start: sortedAlerts[0].timestamp,
        end: sortedAlerts[sortedAlerts.length - 1].timestamp,
      },
      correlationRuleId: ruleId,
      patterns: this.extractPatterns(sortedAlerts),
      suggestedActions,
      createdAt: new Date(),
    };
  }

  private calculateCorrelationConfidence(alerts: Alert[]): number {
    let confidence = 0.5; // Base confidence

    // More alerts = higher confidence
    confidence += Math.min(alerts.length * 0.05, 0.2);

    // Similar severity = higher confidence
    const severities = alerts.map((a) => a.severity);
    const uniqueSeverities = new Set(severities).size;
    if (uniqueSeverities === 1) {
      confidence += 0.15;
    }

    // Similar type = higher confidence
    const types = alerts.map((a) => a.type);
    const uniqueTypes = new Set(types).size;
    if (uniqueTypes === 1) {
      confidence += 0.2;
    }

    // Close time window = higher confidence
    const timeSpan =
      alerts[alerts.length - 1].timestamp.getTime() -
      alerts[0].timestamp.getTime();
    if (timeSpan < 1000) {
      confidence += 0.15;
    } else if (timeSpan < 5000) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private matchesRule(alerts: Alert[], rule: CorrelationRule): boolean {
    if (alerts.length < rule.minAlerts) {
      return false;
    }

    // Check time window
    const timeSpan =
      alerts[alerts.length - 1].timestamp.getTime() -
      alerts[0].timestamp.getTime();
    if (timeSpan > rule.timeWindowMs) {
      return false;
    }

    // Check conditions (simplified)
    let matchedConditions = 0;
    for (const condition of rule.conditions) {
      for (const alert of alerts) {
        if (this.matchesCondition(alert, condition)) {
          matchedConditions++;
        }
      }
    }

    return matchedConditions >= Math.ceil(rule.conditions.length / 2);
  }

  private matchesCondition(alert: Alert, condition: AlertCondition): boolean {
    const alertValue = (alert as any)[condition.field];

    switch (condition.operator) {
      case 'equals':
        return alertValue === condition.value;
      case 'contains':
        return String(alertValue).includes(condition.value);
      case 'startsWith':
        return String(alertValue).startsWith(condition.value);
      case 'regex':
        return new RegExp(condition.value).test(String(alertValue));
      case 'greaterThan':
        return Number(alertValue) > condition.value;
      case 'lessThan':
        return Number(alertValue) < condition.value;
      default:
        return false;
    }
  }

  private extractPatterns(alerts: Alert[]): AlertPattern[] {
    const patterns: AlertPattern[] = [];
    const patternMap = new Map<string, number>();

    for (const alert of alerts) {
      const key = `${alert.type}:${alert.severity}`;
      patternMap.set(key, (patternMap.get(key) || 0) + 1);
    }

    for (const [key, frequency] of patternMap.entries()) {
      const [type, severity] = key.split(':');
      patterns.push({
        patternId: generateId(),
        name: key,
        frequency,
        severity: severity === 'critical' ? 4 : severity === 'high' ? 3 : 1,
        lastOccurrence: new Date(),
        isAnomalous: false,
      });
    }

    return patterns;
  }

  private generateSuggestedActions(
    alerts: Alert[],
    rootCause: string | null
  ): string[] {
    const actions: string[] = [];

    // High severity suggests immediate investigation
    if (alerts.some((a) => a.severity === 'critical')) {
      actions.push('Initiate incident response protocol');
      actions.push('Page on-call engineer');
    }

    // Memory issues suggest resource cleanup
    if (alerts.some((a) => a.type.includes('memory'))) {
      actions.push('Increase memory allocation');
      actions.push('Review for memory leaks');
    }

    // Network issues suggest diagnostics
    if (alerts.some((a) => a.type.includes('network'))) {
      actions.push('Run network diagnostics');
      actions.push('Check service health across regions');
    }

    // Generic action based on root cause
    if (rootCause) {
      if (rootCause.includes('overload')) {
        actions.push('Enable rate limiting');
        actions.push('Scale up resources');
      } else if (rootCause.includes('failure')) {
        actions.push('Check system logs');
        actions.push('Verify service dependencies');
      }
    }

    return actions.length > 0
      ? actions
      : ['Monitor situation', 'Collect additional data'];
  }
}

export default AlertCorrelationEngine;
