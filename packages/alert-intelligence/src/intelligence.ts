import pino from 'pino';
import { generateId } from '@neurostack/shared';
import { Alert, AlertStatus, RealtimeInsight } from '@neurostack/realtime-insights';

/**
 * Alert Intelligence Types
 */

export interface AlertGroup {
  id: string;
  alerts: Alert[];
  correlatedMetrics: string[];
  rootCause?: RootCauseAnalysis;
  suggestedActions: SuggestedAction[];
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'investigating' | 'resolved';
}

export interface AlertDuplicate {
  original: Alert;
  duplicates: Alert[];
  deduplicatedCount: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
}

export interface RootCauseAnalysis {
  primaryCause: string;
  affectedSystems: string[];
  impactChain: string[];
  confidence: number; // 0-1
  reasoning: string;
}

export interface SuggestedAction {
  priority: 'immediate' | 'high' | 'medium' | 'low';
  action: string;
  description: string;
  impact: string;
  estimatedResolutionTime?: number; // minutes
}

export interface AlertRoute {
  alertGroup: AlertGroup;
  priority: 'critical' | 'high' | 'medium' | 'low';
  team: string;
  sla?: number; // minutes to resolve
  escalationPolicy?: string;
}

export interface AlertFatigueMetrics {
  alertsPerHour: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  fatigueScore: number; // 0-100
  recommendations: string[];
}

/**
 * Alert Intelligence System
 *
 * Reduces alert fatigue through:
 * - Intelligent alert grouping and correlation
 * - Duplicate detection and suppression
 * - Root cause analysis
 * - Suggested actions
 * - Smart routing and escalation
 */
export class AlertIntelligence {
  private logger = pino();
  private alertGroups: Map<string, AlertGroup> = new Map();
  private deduplicationCache: Map<string, AlertDuplicate> = new Map();
  private alertHistory: Alert[] = [];
  private readonly maxHistorySize = 10000;
  private readonly deduplicationWindow = 300000; // 5 minutes
  private readonly correlationWindow = 600000; // 10 minutes

  /**
   * Process incoming alert with intelligent deduplication and grouping
   */
  async processAlert(alert: Alert): Promise<{
    groupId: string;
    isDuplicate: boolean;
    group: AlertGroup;
  }> {
    // Check for duplicates
    const isDuplicate = this.checkDuplicate(alert);
    if (isDuplicate) {
      const dupEntry = this.deduplicationCache.get(this.getAlertFingerprint(alert));
      if (dupEntry) {
        dupEntry.duplicates.push(alert);
        dupEntry.lastOccurrence = new Date();
        dupEntry.deduplicatedCount++;
        this.logger.debug({ alertId: alert.id }, 'Duplicate alert suppressed');

        // Find the group containing the original
        for (const group of this.alertGroups.values()) {
          if (group.alerts.some((a) => a.id === dupEntry.original.id)) {
            return { groupId: group.id, isDuplicate: true, group };
          }
        }
      }
    }

    // Find or create alert group based on correlation
    let groupId = this.findCorrelatedGroup(alert);
    if (!groupId) {
      groupId = generateId();
      this.alertGroups.set(groupId, {
        id: groupId,
        alerts: [],
        correlatedMetrics: [alert.insight.metric],
        suggestedActions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active',
      });
    }

    const group = this.alertGroups.get(groupId)!;
    group.alerts.push(alert);
    group.updatedAt = new Date();

    // Add to history
    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.shift();
    }

    // Analyze group for root cause and actions
    await this.analyzeGroup(group);

    this.logger.info(
      { alertId: alert.id, groupId, groupSize: group.alerts.length },
      'Alert processed and grouped'
    );

    return { groupId, isDuplicate: false, group };
  }

  /**
   * Analyze alert group for root causes and suggested actions
   */
  private async analyzeGroup(group: AlertGroup): Promise<void> {
    // Find correlated metrics
    const metrics = new Map<string, number>();
    for (const alert of group.alerts) {
      const metric = alert.insight.metric;
      metrics.set(metric, (metrics.get(metric) || 0) + 1);
    }
    group.correlatedMetrics = Array.from(metrics.keys());

    // Perform root cause analysis
    if (group.alerts.length >= 2) {
      group.rootCause = await this.analyzeRootCause(group);
      group.suggestedActions = this.generateSuggestedActions(group);
    }

    // Detect alert fatigue
    const fatigueMetrics = this.calculateAlertFatigue();
    if (fatigueMetrics.fatigueScore > 70) {
      this.logger.warn(
        { score: fatigueMetrics.fatigueScore, recommendations: fatigueMetrics.recommendations },
        'High alert fatigue detected'
      );
    }
  }

  /**
   * Analyze root cause of alert group
   */
  private async analyzeRootCause(group: AlertGroup): Promise<RootCauseAnalysis> {
    // Sort alerts by time
    const sortedAlerts = [...group.alerts].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    const firstAlert = sortedAlerts[0];
    const severity = Math.max(...group.alerts.map((a) => {
      if (a.severity === 'critical') return 3;
      if (a.severity === 'warning') return 2;
      return 1;
    }));

    // Determine affected systems based on metrics
    const affectedSystems = this.determineAffectedSystems(group.correlatedMetrics);

    // Build impact chain
    const impactChain = this.buildImpactChain(group);

    // Calculate confidence based on group size and temporal proximity
    const timeSpan = Math.max(...group.alerts.map((a) => a.createdAt.getTime())) -
                     Math.min(...group.alerts.map((a) => a.createdAt.getTime()));
    const confidence = Math.min(
      0.95,
      0.5 + (group.alerts.length / 10) * 0.3 + (300000 - Math.min(timeSpan, 300000)) / 300000 * 0.15
    );

    return {
      primaryCause: this.diagnosePrimaryCause(group),
      affectedSystems,
      impactChain,
      confidence,
      reasoning: `Analyzed ${group.alerts.length} correlated alerts across ${affectedSystems.length} systems`,
    };
  }

  /**
   * Generate suggested actions for alert group
   */
  private generateSuggestedActions(group: AlertGroup): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    if (!group.rootCause) return actions;

    // Immediate actions for critical severity
    const maxSeverity = Math.max(...group.alerts.map((a) => {
      if (a.severity === 'critical') return 3;
      if (a.severity === 'warning') return 2;
      return 1;
    }));

    if (maxSeverity === 3) {
      actions.push({
        priority: 'immediate',
        action: 'Isolate affected systems',
        description: `Isolate ${group.rootCause.affectedSystems.join(', ')} to prevent further impact`,
        impact: 'Prevents cascade failures and limits customer impact',
        estimatedResolutionTime: 5,
      });

      actions.push({
        priority: 'immediate',
        action: 'Escalate to on-call engineer',
        description: `Alert on-call engineer about ${group.rootCause.primaryCause}`,
        impact: 'Expert analysis and faster resolution',
        estimatedResolutionTime: 10,
      });
    }

    // High priority actions
    if (maxSeverity >= 2) {
      actions.push({
        priority: 'high',
        action: 'Review logs for root cause',
        description: `Check system logs for errors related to ${group.correlatedMetrics.join(', ')}`,
        impact: 'Identifies the underlying issue for faster fix',
        estimatedResolutionTime: 15,
      });

      actions.push({
        priority: 'high',
        action: 'Monitor related metrics',
        description: `Watch ${group.rootCause.affectedSystems.join(', ')} metrics for changes`,
        impact: 'Early detection of problem resolution or escalation',
        estimatedResolutionTime: 0,
      });
    }

    // Medium priority actions
    actions.push({
      priority: 'medium',
      action: 'Document incident',
      description: 'Create incident record for post-mortem analysis',
      impact: 'Enables learning and process improvements',
      estimatedResolutionTime: 20,
    });

    return actions;
  }

  /**
   * Route alert group to appropriate team
   */
  routeAlert(group: AlertGroup): AlertRoute {
    // Determine priority
    const maxSeverity = Math.max(...group.alerts.map((a) => {
      if (a.severity === 'critical') return 3;
      if (a.severity === 'warning') return 2;
      return 1;
    }));

    const priority =
      maxSeverity === 3 ? 'critical' : maxSeverity === 2 ? 'high' : maxSeverity === 1 ? 'medium' : 'low';

    // Determine team based on affected systems
    const affectedSystems = group.rootCause?.affectedSystems || [];
    const team = this.selectTeam(affectedSystems);

    // Set SLA based on priority
    const slaMap: Record<string, number> = {
      critical: 15,
      high: 30,
      medium: 60,
      low: 480,
    };

    return {
      alertGroup: group,
      priority: priority as 'critical' | 'high' | 'medium' | 'low',
      team,
      sla: slaMap[priority],
      escalationPolicy: priority === 'critical' ? 'escalate-immediately' : undefined,
    };
  }

  /**
   * Get alert group
   */
  getAlertGroup(groupId: string): AlertGroup | undefined {
    return this.alertGroups.get(groupId);
  }

  /**
   * Get all active alert groups
   */
  getActiveGroups(): AlertGroup[] {
    return Array.from(this.alertGroups.values()).filter((g) => g.status === 'active');
  }

  /**
   * Resolve alert group
   */
  resolveGroup(groupId: string): AlertGroup | undefined {
    const group = this.alertGroups.get(groupId);
    if (group) {
      group.status = 'resolved';
      for (const alert of group.alerts) {
        alert.status = AlertStatus.RESOLVED;
        alert.resolvedAt = new Date();
      }
    }
    return group;
  }

  /**
   * Get deduplication statistics
   */
  getDeduplicationStats(): Record<string, unknown> {
    const totalDuplicates = Array.from(this.deduplicationCache.values()).reduce(
      (sum, d) => sum + d.deduplicatedCount,
      0
    );

    return {
      uniqueAlerts: this.alertGroups.size,
      totalAlerts: this.alertHistory.length,
      deduplicatedAlerts: totalDuplicates,
      deduplicationRatio: totalDuplicates / Math.max(this.alertHistory.length, 1),
      cacheSize: this.deduplicationCache.size,
    };
  }

  /**
   * Get alert fatigue metrics
   */
  calculateAlertFatigue(): AlertFatigueMetrics {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    const recentAlerts = this.alertHistory.filter((a) => a.createdAt.getTime() > oneHourAgo);
    const alertsPerHour = recentAlerts.length;

    // Calculate trend
    const twoHoursAgo = now - 7200000;
    const previousHourAlerts = this.alertHistory.filter(
      (a) => a.createdAt.getTime() > twoHoursAgo && a.createdAt.getTime() <= oneHourAgo
    );

    const trend =
      alertsPerHour > previousHourAlerts.length
        ? ('increasing' as const)
        : alertsPerHour < previousHourAlerts.length
        ? ('decreasing' as const)
        : ('stable' as const);

    // Fatigue score: 0-100 scale
    // 0-20: normal
    // 20-50: elevated
    // 50-70: high
    // 70-100: critical
    const fatigueScore = Math.min(100, (alertsPerHour / 5) * 100);

    const recommendations: string[] = [];
    if (fatigueScore > 70) {
      recommendations.push('Consider adjusting alert thresholds');
      recommendations.push('Review and consolidate similar alert rules');
      recommendations.push('Implement alert deduplication');
    }
    if (trend === 'increasing') {
      recommendations.push('Investigate root cause of alert spike');
      recommendations.push('Scale monitoring infrastructure');
    }

    return {
      alertsPerHour,
      trend,
      fatigueScore,
      recommendations,
    };
  }

  // Private helper methods

  private getAlertFingerprint(alert: Alert): string {
    return `${alert.insight.metric}:${alert.ruleId}:${alert.severity}`;
  }

  private checkDuplicate(alert: Alert): boolean {
    const fingerprint = this.getAlertFingerprint(alert);
    const dup = this.deduplicationCache.get(fingerprint);

    if (!dup) {
      this.deduplicationCache.set(fingerprint, {
        original: alert,
        duplicates: [],
        deduplicatedCount: 0,
        firstOccurrence: alert.createdAt,
        lastOccurrence: alert.createdAt,
      });
      return false;
    }

    // Check if within deduplication window
    return alert.createdAt.getTime() - dup.lastOccurrence.getTime() < this.deduplicationWindow;
  }

  private findCorrelatedGroup(alert: Alert): string | null {
    const now = Date.now();

    for (const [groupId, group] of this.alertGroups) {
      if (group.status === 'resolved') continue;

      // Check temporal proximity
      const groupTime = Math.max(...group.alerts.map((a) => a.createdAt.getTime()));
      if (now - groupTime > this.correlationWindow) continue;

      // Check for metric overlap
      const metricsOverlap = group.correlatedMetrics.includes(alert.insight.metric);
      if (metricsOverlap) return groupId;

      // Check for related metrics (would use knowledge graph in production)
      // For now, just metric direct match
    }

    return null;
  }

  private diagnosePrimaryCause(group: AlertGroup): string {
    const metrics = group.correlatedMetrics.join(', ');
    const severities = group.alerts.map((a) => a.severity);
    const hasCritical = severities.includes('critical');

    if (hasCritical) {
      return `Critical anomaly in ${metrics}`;
    }

    return `Multiple alerts in ${metrics} - possible system issue`;
  }

  private determineAffectedSystems(metrics: string[]): string[] {
    // In production, would use knowledge graph to trace impact
    // For now, extract system name from metric naming convention
    const systems = new Set<string>();

    for (const metric of metrics) {
      const parts = metric.split('_');
      if (parts.length > 1) {
        systems.add(parts[0]);
      }
    }

    return Array.from(systems);
  }

  private buildImpactChain(group: AlertGroup): string[] {
    // Trace which systems/metrics are affected
    // In production, would use knowledge graph for full chain

    const chain: string[] = [];
    const uniqueMetrics = new Set(group.alerts.map((a) => a.insight.metric));

    for (const metric of uniqueMetrics) {
      chain.push(`${metric} alert detected`);
    }

    return chain;
  }

  private selectTeam(affectedSystems: string[]): string {
    // In production, would map systems to teams from organization data
    // Simplified version
    if (affectedSystems.includes('database')) return 'database-team';
    if (affectedSystems.includes('api')) return 'api-team';
    if (affectedSystems.includes('frontend')) return 'frontend-team';
    return 'platform-team';
  }
}

export default AlertIntelligence;
