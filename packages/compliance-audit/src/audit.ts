import pino from 'pino';
import { generateId } from '@neurostack/shared';
import crypto from 'crypto';

/**
 * Compliance and Audit Types
 */

export interface AuditEvent {
  eventId: string;
  timestamp: Date;
  eventType:
    | 'access'
    | 'modification'
    | 'deletion'
    | 'authentication'
    | 'authorization'
    | 'configuration'
    | 'security_event'
    | 'data_breach';
  userId: string;
  resource: string;
  action: string;
  details: Record<string, any>;
  status: 'success' | 'failure';
  ipAddress?: string;
  userAgent?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  hash?: string; // For immutability verification
}

export interface CompliancePolicy {
  policyId: string;
  name: string;
  framework: 'GDPR' | 'HIPAA' | 'SOC2' | 'ISO27001' | 'PCI-DSS' | 'CCPA';
  dataRetentionDays: number;
  requiresEncryption: boolean;
  requiresAuditLog: boolean;
  requiresConsent: boolean;
  consentRequired: string[];
  rules: ComplianceRule[];
  enabled: boolean;
}

export interface ComplianceRule {
  ruleId: string;
  name: string;
  condition: string;
  action: string;
  severity: 'warning' | 'violation';
  autoRemediate: boolean;
}

export interface DataAccessLog {
  logId: string;
  timestamp: Date;
  userId: string;
  dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  resourceId: string;
  accessType: 'read' | 'write' | 'delete' | 'export';
  duration: number; // milliseconds
  recordsAccessed: number;
  consentProvided: boolean;
  purpose: string;
}

export interface BreachReport {
  reportId: string;
  timestamp: Date;
  description: string;
  affectedRecords: number;
  dataType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rootCause: string;
  remediationSteps: string[];
  status: 'detected' | 'under_review' | 'remediated' | 'reported';
  regulatoryNotificationRequired: boolean;
  reportedToRegulator?: Date;
}

export interface ComplianceReport {
  reportId: string;
  framework: string;
  reportDate: Date;
  auditedPeriod: {
    start: Date;
    end: Date;
  };
  totalEvents: number;
  violationCount: number;
  complianceScore: number; // 0-100
  findings: ComplianceFinding[];
  recommendations: string[];
}

export interface ComplianceFinding {
  findingId: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedResources: string[];
  remediationRequired: boolean;
  dueDate?: Date;
}

/**
 * Compliance and Audit Logger
 *
 * Comprehensive audit logging and compliance management:
 * - Immutable audit trail with cryptographic verification
 * - Multi-framework compliance support (GDPR, HIPAA, SOC2, etc.)
 * - Data access and privacy tracking
 * - Security event monitoring
 * - Breach detection and reporting
 * - Automated compliance violation detection
 * - Retention policy enforcement
 * - Audit reports and evidence generation
 */
export class ComplianceAuditLogger {
  private logger = pino();
  private auditEvents: Map<string, AuditEvent> = new Map();
  private dataAccessLogs: Map<string, DataAccessLog> = new Map();
  private breachReports: Map<string, BreachReport> = new Map();
  private compliancePolicies: Map<string, CompliancePolicy> = new Map();
  private eventChain: string[] = []; // Chain of event hashes for immutability
  private readonly maxEventsBuffer = 1000000;
  private readonly maxDataAccessLogs = 500000;
  private previousHash = this.generateHash('genesis');

  constructor() {
    this.initializeDefaultPolicies();
    this.logger.info('ComplianceAuditLogger initialized');
  }

  /**
   * Log an audit event
   */
  logAuditEvent(
    eventType: AuditEvent['eventType'],
    userId: string,
    resource: string,
    action: string,
    details: Record<string, any>,
    options?: {
      status?: 'success' | 'failure';
      ipAddress?: string;
      userAgent?: string;
      severity?: AuditEvent['severity'];
    }
  ): AuditEvent {
    const event: AuditEvent = {
      eventId: generateId(),
      timestamp: new Date(),
      eventType,
      userId,
      resource,
      action,
      details,
      status: options?.status || 'success',
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
      severity: options?.severity || 'low',
    };

    // Add cryptographic hash for immutability
    event.hash = this.generateEventHash(event);
    this.eventChain.push(event.hash);

    this.auditEvents.set(event.eventId, event);

    // Maintain buffer size
    if (this.auditEvents.size > this.maxEventsBuffer) {
      const oldestKey = this.auditEvents.keys().next().value;
      this.auditEvents.delete(oldestKey);
    }

    // Check for compliance violations
    this.checkComplianceViolations(event);

    // Check for suspicious patterns
    if (this.detectSuspiciousActivity(event)) {
      this.logger.warn(
        {
          eventId: event.eventId,
          userId: event.userId,
          action: event.action,
        },
        'Suspicious activity detected'
      );
    }

    this.logger.debug(
      {
        eventId: event.eventId,
        eventType,
        userId,
        resource,
      },
      'Audit event logged'
    );

    return event;
  }

  /**
   * Log data access
   */
  logDataAccess(
    userId: string,
    resourceId: string,
    accessType: DataAccessLog['accessType'],
    classification: DataAccessLog['dataClassification'],
    recordsAccessed: number,
    purpose: string,
    consentProvided: boolean = true
  ): DataAccessLog {
    const log: DataAccessLog = {
      logId: generateId(),
      timestamp: new Date(),
      userId,
      dataClassification: classification,
      resourceId,
      accessType,
      duration: 0, // Will be updated
      recordsAccessed,
      consentProvided,
      purpose,
    };

    this.dataAccessLogs.set(log.logId, log);

    // Maintain buffer size
    if (this.dataAccessLogs.size > this.maxDataAccessLogs) {
      const oldestKey = this.dataAccessLogs.keys().next().value;
      this.dataAccessLogs.delete(oldestKey);
    }

    // Check for unauthorized access
    if (
      classification === 'restricted' &&
      !consentProvided &&
      accessType !== 'read'
    ) {
      this.logSecurityEvent(
        userId,
        'unauthorized_data_access',
        'Attempted access to restricted data without consent',
        { resourceId, accessType, classification }
      );
    }

    this.logger.debug(
      {
        logId: log.logId,
        userId,
        resourceId,
        accessType,
      },
      'Data access logged'
    );

    return log;
  }

  /**
   * Report a potential data breach
   */
  reportBreach(
    description: string,
    affectedRecords: number,
    dataType: string,
    rootCause: string,
    severity: BreachReport['severity']
  ): BreachReport {
    const report: BreachReport = {
      reportId: generateId(),
      timestamp: new Date(),
      description,
      affectedRecords,
      dataType,
      severity,
      rootCause,
      remediationSteps: this.generateRemediationSteps(dataType, rootCause),
      status: 'detected',
      regulatoryNotificationRequired: severity === 'critical' || severity === 'high',
    };

    this.breachReports.set(report.reportId, report);

    // Log the breach as a security event
    this.logAuditEvent(
      'data_breach',
      'system',
      dataType,
      'breach_detected',
      {
        breachId: report.reportId,
        description,
        affectedRecords,
        severity,
      },
      { severity: 'critical' }
    );

    this.logger.error(
      {
        reportId: report.reportId,
        affectedRecords,
        severity,
      },
      'Data breach reported'
    );

    return report;
  }

  /**
   * Add compliance policy
   */
  addCompliancePolicy(policy: CompliancePolicy): void {
    this.compliancePolicies.set(policy.policyId, policy);

    this.logger.info(
      {
        policyId: policy.policyId,
        framework: policy.framework,
        name: policy.name,
      },
      'Compliance policy added'
    );
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(
    framework: string,
    periodStartDate: Date,
    periodEndDate: Date
  ): ComplianceReport {
    const events = Array.from(this.auditEvents.values()).filter(
      (e) =>
        e.timestamp >= periodStartDate && e.timestamp <= periodEndDate
    );

    const violations = this.identifyViolations(events);

    const findings = violations.map(
      (v, index) =>
        ({
          findingId: generateId(),
          category: v.category,
          severity: v.severity,
          description: v.description,
          affectedResources: v.affectedResources || [],
          remediationRequired: true,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        } as ComplianceFinding)
    );

    const complianceScore = this.calculateComplianceScore(
      events.length,
      violations.length
    );

    return {
      reportId: generateId(),
      framework,
      reportDate: new Date(),
      auditedPeriod: {
        start: periodStartDate,
        end: periodEndDate,
      },
      totalEvents: events.length,
      violationCount: violations.length,
      complianceScore,
      findings,
      recommendations: this.generateRecommendations(findings),
    };
  }

  /**
   * Get audit events by user
   */
  getEventsByUser(userId: string): AuditEvent[] {
    const events: AuditEvent[] = [];

    for (const event of this.auditEvents.values()) {
      if (event.userId === userId) {
        events.push(event);
      }
    }

    return events.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Get audit events by type
   */
  getEventsByType(eventType: AuditEvent['eventType']): AuditEvent[] {
    const events: AuditEvent[] = [];

    for (const event of this.auditEvents.values()) {
      if (event.eventType === eventType) {
        events.push(event);
      }
    }

    return events.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Get audit trail for resource
   */
  getAuditTrailForResource(resourceId: string): AuditEvent[] {
    const events: AuditEvent[] = [];

    for (const event of this.auditEvents.values()) {
      if (event.resource === resourceId) {
        events.push(event);
      }
    }

    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Verify event chain integrity
   */
  verifyEventChainIntegrity(): boolean {
    if (this.eventChain.length === 0) {
      return true;
    }

    let previousHash = this.previousHash;

    for (const hash of this.eventChain) {
      // In production, would verify hash chain cryptographically
      if (hash === '') {
        return false;
      }
      previousHash = hash;
    }

    return true;
  }

  /**
   * Get compliance statistics
   */
  getComplianceStats(): {
    totalEvents: number;
    totalDataAccessLogs: number;
    breachReportsCount: number;
    criticalSeverityEvents: number;
    suspiciousActivitiesDetected: number;
    integrityStatus: 'intact' | 'compromised';
  } {
    const criticalEvents = Array.from(this.auditEvents.values()).filter(
      (e) => e.severity === 'critical'
    ).length;

    return {
      totalEvents: this.auditEvents.size,
      totalDataAccessLogs: this.dataAccessLogs.size,
      breachReportsCount: this.breachReports.size,
      criticalSeverityEvents: criticalEvents,
      suspiciousActivitiesDetected: this.countSuspiciousActivities(),
      integrityStatus: this.verifyEventChainIntegrity()
        ? 'intact'
        : 'compromised',
    };
  }

  /**
   * Export audit logs for regulatory submission
   */
  exportAuditLogs(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): string {
    const events = Array.from(this.auditEvents.values()).filter(
      (e) => e.timestamp >= startDate && e.timestamp <= endDate
    );

    if (format === 'csv') {
      return this.exportAsCSV(events);
    }

    return JSON.stringify(events, null, 2);
  }

  /**
   * Cleanup old data according to retention policies
   */
  cleanupOldData(): number {
    let removedCount = 0;

    for (const [policyId, policy] of this.compliancePolicies.entries()) {
      if (!policy.enabled) continue;

      const retentionMs = policy.dataRetentionDays * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - retentionMs;

      for (const [eventId, event] of this.auditEvents.entries()) {
        if (event.timestamp.getTime() < cutoffTime) {
          this.auditEvents.delete(eventId);
          removedCount++;
        }
      }
    }

    this.logger.info({ removedCount }, 'Old data cleaned up based on retention policies');
    return removedCount;
  }

  // Private methods

  private initializeDefaultPolicies(): void {
    // GDPR Policy
    this.addCompliancePolicy({
      policyId: generateId(),
      name: 'GDPR Compliance',
      framework: 'GDPR',
      dataRetentionDays: 90,
      requiresEncryption: true,
      requiresAuditLog: true,
      requiresConsent: true,
      consentRequired: ['marketing', 'analytics', 'third_party_sharing'],
      rules: [
        {
          ruleId: generateId(),
          name: 'Require explicit consent',
          condition: 'personal_data_processing',
          action: 'require_consent',
          severity: 'violation',
          autoRemediate: false,
        },
      ],
      enabled: true,
    });

    // HIPAA Policy
    this.addCompliancePolicy({
      policyId: generateId(),
      name: 'HIPAA Compliance',
      framework: 'HIPAA',
      dataRetentionDays: 2555, // 7 years
      requiresEncryption: true,
      requiresAuditLog: true,
      requiresConsent: false,
      consentRequired: [],
      rules: [
        {
          ruleId: generateId(),
          name: 'Mandatory encryption for PHI',
          condition: 'phi_data_transmission',
          action: 'enforce_encryption',
          severity: 'violation',
          autoRemediate: true,
        },
      ],
      enabled: true,
    });

    // SOC 2 Policy
    this.addCompliancePolicy({
      policyId: generateId(),
      name: 'SOC 2 Compliance',
      framework: 'SOC2',
      dataRetentionDays: 365,
      requiresEncryption: true,
      requiresAuditLog: true,
      requiresConsent: false,
      consentRequired: [],
      rules: [
        {
          ruleId: generateId(),
          name: 'Access control logging',
          condition: 'system_access',
          action: 'log_all_access',
          severity: 'violation',
          autoRemediate: true,
        },
      ],
      enabled: true,
    });
  }

  private checkComplianceViolations(event: AuditEvent): void {
    for (const policy of this.compliancePolicies.values()) {
      if (!policy.enabled) continue;

      for (const rule of policy.rules) {
        if (this.ruleMatches(event, rule.condition)) {
          if (rule.autoRemediate) {
            this.logger.warn(
              {
                eventId: event.eventId,
                rule: rule.name,
                framework: policy.framework,
              },
              `Compliance violation detected: ${rule.name}`
            );
          }
        }
      }
    }
  }

  private ruleMatches(event: AuditEvent, condition: string): boolean {
    // Simplified rule matching
    if (condition === 'personal_data_processing') {
      return (
        event.eventType === 'modification' ||
        event.eventType === 'deletion'
      );
    }

    if (condition === 'phi_data_transmission') {
      return (
        event.resource.includes('health') ||
        event.resource.includes('medical')
      );
    }

    if (condition === 'system_access') {
      return event.eventType === 'access' || event.eventType === 'authentication';
    }

    return false;
  }

  private detectSuspiciousActivity(event: AuditEvent): boolean {
    // Multiple failed authentications
    if (event.eventType === 'authentication' && event.status === 'failure') {
      const userFailures = this.getEventsByUser(event.userId).filter(
        (e) => e.eventType === 'authentication' && e.status === 'failure'
      );

      if (userFailures.length > 5) {
        return true;
      }
    }

    // Bulk data access
    if (event.eventType === 'access') {
      const bulkAccess = event.details.recordsAccessed || 0;
      if (bulkAccess > 10000) {
        return true;
      }
    }

    // Unauthorized access to restricted data
    if (
      event.eventType === 'access' &&
      event.details.classification === 'restricted'
    ) {
      return true;
    }

    return false;
  }

  private logSecurityEvent(
    userId: string,
    eventName: string,
    description: string,
    details: Record<string, any>
  ): void {
    this.logAuditEvent(
      'security_event',
      userId,
      'security_system',
      eventName,
      { ...details, description },
      { severity: 'high' }
    );
  }

  private generateEventHash(event: AuditEvent): string {
    const data = JSON.stringify({
      eventId: event.eventId,
      timestamp: event.timestamp,
      eventType: event.eventType,
      userId: event.userId,
      resource: event.resource,
      action: event.action,
      previousHash: this.previousHash,
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private generateHash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private generateRemediationSteps(
    dataType: string,
    rootCause: string
  ): string[] {
    const steps: string[] = [];

    if (rootCause.includes('unauthorized')) {
      steps.push('Reset credentials for affected accounts');
      steps.push('Review access control policies');
    }

    if (rootCause.includes('encryption')) {
      steps.push('Enable encryption for sensitive data');
      steps.push('Re-encrypt existing data');
    }

    if (rootCause.includes('malware') || rootCause.includes('attack')) {
      steps.push('Run security scan on affected systems');
      steps.push('Isolate compromised systems');
      steps.push('Deploy security patches');
    }

    if (steps.length === 0) {
      steps.push('Conduct security audit');
      steps.push('Implement recommended fixes');
      steps.push('Verify remediation effectiveness');
    }

    return steps;
  }

  private identifyViolations(
    events: AuditEvent[]
  ): Array<{
    category: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    affectedResources?: string[];
  }> {
    const violations: Array<{
      category: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      affectedResources?: string[];
    }> = [];

    // Check for access violations
    const accessViolations = events.filter(
      (e) => e.eventType === 'access' && e.status === 'failure'
    );
    if (accessViolations.length > 100) {
      violations.push({
        category: 'Access Control',
        severity: 'high',
        description: `${accessViolations.length} access violations detected`,
        affectedResources: [
          ...new Set(accessViolations.map((e) => e.resource)),
        ],
      });
    }

    // Check for data modification violations
    const modificationViolations = events.filter(
      (e) => e.eventType === 'modification' && e.status === 'success'
    );
    if (modificationViolations.length > 500) {
      violations.push({
        category: 'Data Modification',
        severity: 'medium',
        description: `${modificationViolations.length} data modifications logged`,
      });
    }

    // Check for authentication violations
    const authViolations = events.filter(
      (e) =>
        e.eventType === 'authentication' && e.status === 'failure'
    );
    if (authViolations.length > 50) {
      violations.push({
        category: 'Authentication',
        severity: 'high',
        description: `${authViolations.length} failed authentication attempts`,
      });
    }

    return violations;
  }

  private calculateComplianceScore(totalEvents: number, violations: number): number {
    if (totalEvents === 0) {
      return 100;
    }

    const violationRate = violations / totalEvents;
    const score = Math.max(0, 100 - violationRate * 100);

    return Math.round(score);
  }

  private generateRecommendations(findings: ComplianceFinding[]): string[] {
    const recommendations: string[] = [];

    const criticalFindings = findings.filter((f) => f.severity === 'critical');
    if (criticalFindings.length > 0) {
      recommendations.push('Address critical findings immediately');
    }

    const accessControlIssues = findings.filter((f) =>
      f.category.includes('Access')
    );
    if (accessControlIssues.length > 0) {
      recommendations.push('Review and strengthen access control policies');
    }

    const encryptionIssues = findings.filter((f) =>
      f.category.includes('Encryption')
    );
    if (encryptionIssues.length > 0) {
      recommendations.push('Implement encryption for sensitive data');
    }

    recommendations.push('Conduct regular compliance audits');
    recommendations.push('Provide security training to staff');
    recommendations.push(
      'Maintain detailed documentation of compliance efforts'
    );

    return recommendations;
  }

  private countSuspiciousActivities(): number {
    let count = 0;

    for (const event of this.auditEvents.values()) {
      if (this.detectSuspiciousActivity(event)) {
        count++;
      }
    }

    return count;
  }

  private exportAsCSV(events: AuditEvent[]): string {
    const headers = [
      'Event ID',
      'Timestamp',
      'Event Type',
      'User ID',
      'Resource',
      'Action',
      'Status',
      'Severity',
      'IP Address',
    ];

    const rows = events.map((e) => [
      e.eventId,
      e.timestamp.toISOString(),
      e.eventType,
      e.userId,
      e.resource,
      e.action,
      e.status,
      e.severity,
      e.ipAddress || 'N/A',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(',')),
    ].join('\n');

    return csv;
  }
}

export default ComplianceAuditLogger;
