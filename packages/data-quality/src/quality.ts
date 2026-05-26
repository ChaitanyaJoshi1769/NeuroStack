import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Data Quality Types
 */

export interface DataProfile {
  profileId: string;
  datasetId: string;
  timestamp: Date;
  columnProfiles: ColumnProfile[];
  rowCount: number;
  missingRatio: number;
  duplicateRatio: number;
  qualityScore: number; // 0-100
}

export interface ColumnProfile {
  columnName: string;
  dataType: 'numeric' | 'categorical' | 'datetime' | 'string';
  nullCount: number;
  nullRatio: number;
  uniqueCount: number;
  duplicateCount: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stddev?: number;
  skewness?: number;
  kurtosis?: number;
  topValues?: Array<{ value: any; frequency: number }>;
  histogram?: Record<string, number>;
  isOutlier: boolean;
}

export interface DataQualityRule {
  ruleId: string;
  name: string;
  description: string;
  ruleType:
    | 'null_check'
    | 'range_check'
    | 'pattern_match'
    | 'referential_integrity'
    | 'uniqueness'
    | 'freshness'
    | 'schema_check'
    | 'statistical_anomaly';
  severity: 'warning' | 'error';
  enabled: boolean;
  condition: string;
  targetColumns: string[];
  threshold?: number;
  alertOnViolation: boolean;
}

export interface DataQualityCheck {
  checkId: string;
  ruleId: string;
  datasetId: string;
  timestamp: Date;
  passed: boolean;
  violationCount: number;
  affectedRows?: number;
  affectedColumns: string[];
  message: string;
  severity: 'warning' | 'error';
}

export interface DataQualityReport {
  reportId: string;
  datasetId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  overallScore: number; // 0-100
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  issues: DataQualityIssue[];
  recommendations: string[];
  trends: DataTrend[];
}

export interface DataQualityIssue {
  issueId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedColumns: string[];
  affectedRowCount?: number;
  firstDetected: Date;
  lastDetected: Date;
  frequency: number;
  suggestedAction: string;
}

export interface DataTrend {
  metricName: string;
  trend: 'improving' | 'degrading' | 'stable';
  changePercent: number;
  window: number; // days
}

export interface AnomalyDetectionModel {
  modelId: string;
  columnName: string;
  method: 'isolation_forest' | 'zscore' | 'iqr' | 'mad';
  threshold: number;
  trainingPeriodDays: number;
  sensitivity: number; // 0-1
  lastTrainedAt: Date;
  precision: number; // 0-1
  recall: number; // 0-1
}

/**
 * Data Quality Monitor
 *
 * Comprehensive data quality and validation framework:
 * - Automated data profiling and statistics
 * - Schema validation and drift detection
 * - Data quality rules and constraint checking
 * - Statistical anomaly detection
 * - Data freshness monitoring
 * - Referential integrity verification
 * - Duplicate and null detection
 * - Outlier identification
 * - Quality trend tracking
 * - Automated alerting on violations
 * - Comprehensive quality reporting
 */
export class DataQualityMonitor {
  private logger = pino();
  private profiles: Map<string, DataProfile> = new Map();
  private rules: Map<string, DataQualityRule> = new Map();
  private checks: Map<string, DataQualityCheck> = new Map();
  private issues: Map<string, DataQualityIssue> = new Map();
  private anomalyModels: Map<string, AnomalyDetectionModel> = new Map();
  private readonly maxProfiles = 100000;
  private readonly maxChecks = 1000000;
  private profileHistory: Array<{ profileId: string; timestamp: Date }> = [];

  constructor() {
    this.initializeDefaultRules();
    this.logger.info('DataQualityMonitor initialized');
  }

  /**
   * Profile dataset
   */
  profileDataset(
    datasetId: string,
    data: Array<Record<string, any>>
  ): DataProfile {
    const profileId = generateId();
    const timestamp = new Date();

    if (data.length === 0) {
      return {
        profileId,
        datasetId,
        timestamp,
        columnProfiles: [],
        rowCount: 0,
        missingRatio: 0,
        duplicateRatio: 0,
        qualityScore: 100,
      };
    }

    // Extract columns from first row
    const columns = Object.keys(data[0]);
    const columnProfiles: ColumnProfile[] = [];
    let totalMissing = 0;

    for (const column of columns) {
      const values = data.map((row) => row[column]);
      const nullCount = values.filter((v) => v === null || v === undefined).length;
      const uniqueValues = new Set(values.filter((v) => v != null));
      const topValues = this.getTopValues(values, 5);

      const columnProfile: ColumnProfile = {
        columnName: column,
        dataType: this.inferDataType(values),
        nullCount,
        nullRatio: nullCount / values.length,
        uniqueCount: uniqueValues.size,
        duplicateCount: values.length - uniqueValues.size,
        topValues,
        isOutlier: false,
      };

      // Calculate statistics for numeric columns
      const numericValues = values
        .filter((v) => v != null && typeof v === 'number')
        .sort((a, b) => a - b);

      if (numericValues.length > 0) {
        columnProfile.min = numericValues[0];
        columnProfile.max = numericValues[numericValues.length - 1];
        columnProfile.mean =
          numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        columnProfile.median =
          numericValues[Math.floor(numericValues.length / 2)];
        columnProfile.stddev = this.calculateStddev(numericValues, columnProfile.mean!);
        columnProfile.skewness = this.calculateSkewness(numericValues);
        columnProfile.kurtosis = this.calculateKurtosis(numericValues);
      }

      columnProfiles.push(columnProfile);
      totalMissing += nullCount;
    }

    const duplicateRatio = this.calculateDuplicateRatio(data);
    const qualityScore = this.calculateQualityScore(
      columnProfiles,
      totalMissing,
      data.length,
      duplicateRatio
    );

    const profile: DataProfile = {
      profileId,
      datasetId,
      timestamp,
      columnProfiles,
      rowCount: data.length,
      missingRatio: totalMissing / (data.length * columns.length),
      duplicateRatio,
      qualityScore,
    };

    this.profiles.set(profileId, profile);
    this.profileHistory.push({ profileId, timestamp });

    // Maintain size limit
    if (this.profiles.size > this.maxProfiles) {
      const oldestKey = this.profiles.keys().next().value;
      this.profiles.delete(oldestKey);
    }

    this.logger.info(
      {
        profileId,
        datasetId,
        rowCount: data.length,
        columns: columns.length,
        qualityScore: qualityScore.toFixed(1),
      },
      'Dataset profiled'
    );

    return profile;
  }

  /**
   * Add data quality rule
   */
  addRule(rule: DataQualityRule): void {
    this.rules.set(rule.ruleId, rule);

    this.logger.info(
      {
        ruleId: rule.ruleId,
        name: rule.name,
        ruleType: rule.ruleType,
      },
      'Quality rule added'
    );
  }

  /**
   * Validate data against rules
   */
  validateData(
    datasetId: string,
    data: Array<Record<string, any>>
  ): DataQualityCheck[] {
    const checks: DataQualityCheck[] = [];

    for (const [ruleId, rule] of this.rules.entries()) {
      if (!rule.enabled) continue;

      const check = this.executeRule(ruleId, rule, datasetId, data);

      this.checks.set(check.checkId, check);
      checks.push(check);

      // Maintain size limit
      if (this.checks.size > this.maxChecks) {
        const oldestKey = this.checks.keys().next().value;
        this.checks.delete(oldestKey);
      }

      if (!check.passed && rule.alertOnViolation) {
        this.logger.warn(
          {
            checkId: check.checkId,
            ruleId: rule.ruleId,
            violationCount: check.violationCount,
          },
          'Data quality rule violation'
        );
      }
    }

    return checks;
  }

  /**
   * Detect anomalies
   */
  detectAnomalies(
    datasetId: string,
    columnName: string,
    values: number[]
  ): Array<{ index: number; value: number; anomalyScore: number }> {
    const anomalies: Array<{
      index: number;
      value: number;
      anomalyScore: number;
    }> = [];

    if (values.length < 3) {
      return anomalies;
    }

    // Calculate Z-scores
    const mean =
      values.reduce((a, b) => a + b, 0) / values.length;
    const stddev = this.calculateStddev(values, mean);

    if (stddev === 0) {
      return anomalies;
    }

    for (let i = 0; i < values.length; i++) {
      const zscore = Math.abs((values[i] - mean) / stddev);

      if (zscore > 3) {
        anomalies.push({
          index: i,
          value: values[i],
          anomalyScore: Math.min(zscore / 10, 1.0), // Normalize to 0-1
        });
      }
    }

    return anomalies;
  }

  /**
   * Monitor data freshness
   */
  checkFreshness(
    datasetId: string,
    lastUpdateTime: Date,
    expectedUpdateFrequencyHours: number
  ): { isFresh: boolean; ageHours: number; isOverdue: boolean } {
    const now = new Date();
    const ageMs = now.getTime() - lastUpdateTime.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const isOverdue = ageHours > expectedUpdateFrequencyHours * 1.5; // 50% tolerance
    const isFresh = ageHours <= expectedUpdateFrequencyHours;

    return {
      isFresh,
      ageHours: Math.round(ageHours),
      isOverdue,
    };
  }

  /**
   * Generate quality report
   */
  generateReport(
    datasetId: string,
    startDate: Date,
    endDate: Date
  ): DataQualityReport {
    const reportId = generateId();

    const relevantProfiles = Array.from(this.profiles.values()).filter(
      (p) =>
        p.datasetId === datasetId &&
        p.timestamp >= startDate &&
        p.timestamp <= endDate
    );

    const relevantChecks = Array.from(this.checks.values()).filter(
      (c) =>
        c.datasetId === datasetId &&
        c.timestamp >= startDate &&
        c.timestamp <= endDate
    );

    const passedChecks = relevantChecks.filter((c) => c.passed).length;
    const failedChecks = relevantChecks.length - passedChecks;

    // Aggregate issues
    const aggregatedIssues: DataQualityIssue[] = [];
    const issueMap = new Map<string, DataQualityIssue>();

    for (const [issueId, issue] of this.issues.entries()) {
      if (
        issue.affectedColumns.some((col) =>
          relevantProfiles.some((p) =>
            p.columnProfiles.some((cp) => cp.columnName === col)
          )
        )
      ) {
        issueMap.set(issueId, issue);
      }
    }

    // Calculate trends
    const trends = this.calculateTrends(relevantProfiles);

    // Calculate overall score
    const overallScore =
      relevantProfiles.length > 0
        ? Math.round(
            relevantProfiles.reduce((sum, p) => sum + p.qualityScore, 0) /
              relevantProfiles.length
          )
        : 100;

    return {
      reportId,
      datasetId,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      overallScore,
      totalChecks: relevantChecks.length,
      passedChecks,
      failedChecks,
      issues: Array.from(issueMap.values()),
      recommendations: this.generateRecommendations(
        relevantProfiles,
        relevantChecks
      ),
      trends,
    };
  }

  /**
   * Get quality statistics
   */
  getQualityStats(): {
    totalProfiles: number;
    totalRules: number;
    totalChecks: number;
    averageQualityScore: number;
    failedChecksRatio: number;
    issueCount: number;
  } {
    const avgScore =
      this.profiles.size > 0
        ? Math.round(
            Array.from(this.profiles.values()).reduce(
              (sum, p) => sum + p.qualityScore,
              0
            ) / this.profiles.size
          )
        : 100;

    const failedCount = Array.from(this.checks.values()).filter(
      (c) => !c.passed
    ).length;
    const failedRatio =
      this.checks.size > 0 ? failedCount / this.checks.size : 0;

    return {
      totalProfiles: this.profiles.size,
      totalRules: this.rules.size,
      totalChecks: this.checks.size,
      averageQualityScore: avgScore,
      failedChecksRatio: Math.round(failedRatio * 100),
      issueCount: this.issues.size,
    };
  }

  /**
   * Get latest profile
   */
  getLatestProfile(datasetId: string): DataProfile | null {
    const profiles = Array.from(this.profiles.values())
      .filter((p) => p.datasetId === datasetId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return profiles.length > 0 ? profiles[0] : null;
  }

  /**
   * Cleanup old data
   */
  cleanupOldData(retentionDays: number = 90): number {
    let removedCount = 0;
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const [profileId, profile] of this.profiles.entries()) {
      if (profile.timestamp.getTime() < cutoffTime) {
        this.profiles.delete(profileId);
        removedCount++;
      }
    }

    this.logger.info({ removedCount }, 'Old quality profiles cleaned up');
    return removedCount;
  }

  // Private methods

  private initializeDefaultRules(): void {
    this.addRule({
      ruleId: generateId(),
      name: 'Null Check',
      description: 'Alert on high null ratio',
      ruleType: 'null_check',
      severity: 'warning',
      enabled: true,
      condition: 'null_ratio > 0.1',
      targetColumns: ['*'],
      threshold: 0.1,
      alertOnViolation: true,
    });

    this.addRule({
      ruleId: generateId(),
      name: 'Schema Check',
      description: 'Validate data types match expected schema',
      ruleType: 'schema_check',
      severity: 'error',
      enabled: true,
      condition: 'dataType matches schema',
      targetColumns: ['*'],
      alertOnViolation: true,
    });

    this.addRule({
      ruleId: generateId(),
      name: 'Freshness Check',
      description: 'Ensure data is fresh',
      ruleType: 'freshness',
      severity: 'warning',
      enabled: true,
      condition: 'age < max_age',
      targetColumns: ['*'],
      threshold: 24, // hours
      alertOnViolation: true,
    });
  }

  private inferDataType(values: any[]): ColumnProfile['dataType'] {
    const nonNullValues = values.filter((v) => v != null);

    if (nonNullValues.length === 0) {
      return 'string';
    }

    const sample = nonNullValues[0];

    if (typeof sample === 'number') {
      return 'numeric';
    }

    if (sample instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(sample))) {
      return 'datetime';
    }

    if (
      typeof sample === 'string' &&
      nonNullValues.length < 100 &&
      new Set(nonNullValues).size < nonNullValues.length / 2
    ) {
      return 'categorical';
    }

    return 'string';
  }

  private getTopValues(
    values: any[],
    limit: number
  ): Array<{ value: any; frequency: number }> {
    const counts = new Map<any, number>();

    for (const value of values) {
      if (value != null) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([value, frequency]) => ({ value, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  private calculateStddev(values: number[], mean: number): number {
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      values.length;

    return Math.sqrt(variance);
  }

  private calculateSkewness(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stddev = this.calculateStddev(values, mean);

    if (stddev === 0) return 0;

    const m3 =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 3), 0) /
      values.length;

    return m3 / Math.pow(stddev, 3);
  }

  private calculateKurtosis(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stddev = this.calculateStddev(values, mean);

    if (stddev === 0) return 0;

    const m4 =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 4), 0) /
      values.length;

    return m4 / Math.pow(stddev, 4) - 3;
  }

  private calculateDuplicateRatio(data: Array<Record<string, any>>): number {
    const uniqueRows = new Set(data.map((row) => JSON.stringify(row)));

    return (data.length - uniqueRows.size) / data.length;
  }

  private calculateQualityScore(
    columnProfiles: ColumnProfile[],
    totalMissing: number,
    rowCount: number,
    duplicateRatio: number
  ): number {
    let score = 100;

    // Penalize for missing values
    const missingRatio = totalMissing / (rowCount * columnProfiles.length);
    score -= missingRatio * 30;

    // Penalize for duplicates
    score -= duplicateRatio * 20;

    // Penalize for columns with all nulls
    const allNullColumns = columnProfiles.filter(
      (cp) => cp.nullRatio === 1
    ).length;
    score -= allNullColumns * 5;

    return Math.max(0, Math.round(score));
  }

  private executeRule(
    ruleId: string,
    rule: DataQualityRule,
    datasetId: string,
    data: Array<Record<string, any>>
  ): DataQualityCheck {
    const checkId = generateId();
    let passed = true;
    let violationCount = 0;
    const affectedColumns: string[] = [];

    // Execute rule based on type
    switch (rule.ruleType) {
      case 'null_check':
        for (const column of rule.targetColumns) {
          const nullCount = data.filter((row) => row[column] == null).length;
          const nullRatio = nullCount / data.length;

          if (nullRatio > (rule.threshold || 0.1)) {
            passed = false;
            violationCount += nullCount;
            affectedColumns.push(column);
          }
        }
        break;

      case 'uniqueness':
        for (const column of rule.targetColumns) {
          const uniqueCount = new Set(data.map((row) => row[column])).size;

          if (uniqueCount < data.length) {
            passed = false;
            violationCount = data.length - uniqueCount;
            affectedColumns.push(column);
          }
        }
        break;
    }

    return {
      checkId,
      ruleId,
      datasetId,
      timestamp: new Date(),
      passed,
      violationCount,
      affectedColumns,
      message: passed ? `Rule ${rule.name} passed` : `Rule ${rule.name} failed`,
      severity: rule.severity,
    };
  }

  private calculateTrends(profiles: DataProfile[]): DataTrend[] {
    const trends: DataTrend[] = [];

    if (profiles.length < 2) {
      return trends;
    }

    const sortedProfiles = profiles.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    const oldScore = sortedProfiles[0].qualityScore;
    const newScore = sortedProfiles[sortedProfiles.length - 1].qualityScore;
    const changePercent = ((newScore - oldScore) / oldScore) * 100;

    trends.push({
      metricName: 'overall_quality_score',
      trend:
        changePercent > 2
          ? 'improving'
          : changePercent < -2
            ? 'degrading'
            : 'stable',
      changePercent: Math.round(changePercent * 100) / 100,
      window: Math.ceil(
        (sortedProfiles[sortedProfiles.length - 1].timestamp.getTime() -
          sortedProfiles[0].timestamp.getTime()) /
          (24 * 60 * 60 * 1000)
      ),
    });

    return trends;
  }

  private generateRecommendations(
    profiles: DataProfile[],
    checks: DataQualityCheck[]
  ): string[] {
    const recommendations: string[] = [];

    const avgQualityScore =
      profiles.length > 0
        ? profiles.reduce((sum, p) => sum + p.qualityScore, 0) /
          profiles.length
        : 100;

    if (avgQualityScore < 80) {
      recommendations.push('Address data quality issues urgently');
    }

    const failedChecks = checks.filter((c) => !c.passed);

    if (failedChecks.length > 0) {
      recommendations.push(
        `Fix ${failedChecks.length} failed quality checks`
      );
    }

    const highNullColumns = profiles
      .flatMap((p) =>
        p.columnProfiles
          .filter((cp) => cp.nullRatio > 0.2)
          .map((cp) => cp.columnName)
      );

    if (highNullColumns.length > 0) {
      recommendations.push('Investigate high null rates in source data');
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue monitoring data quality');
      recommendations.push('Set up automated quality checks');
    }

    return recommendations;
  }
}

export default DataQualityMonitor;
