import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Anomaly Feedback Types
 */

export interface AnomalyFeedback {
  feedbackId: string;
  anomalyId: string;
  groundTruth: boolean; // true if actually anomaly, false if false positive
  userRating?: number; // 0-5 confidence
  timestamp: Date;
  notes?: string;
}

export interface FeedbackImpact {
  feedbackId: string;
  impactScore: number; // 0-100
  affectedMetrics: string[];
  suggestedAction: 'retrain' | 'adjust_threshold' | 'update_feature' | 'none';
  confidence: number;
}

export interface FeedbackLoop {
  loopId: string;
  totalFeedback: number;
  accuracyImprovement: number;
  precisionGain: number;
  recallGain: number;
  falsePositiveReduction: number;
  retrainingNeeded: boolean;
  lastUpdateTime: Date;
}

export interface DetectionMetrics {
  totalDetections: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  accuracy: number;
}

/**
 * Anomaly Feedback Loop
 *
 * Continuous improvement system for anomaly detection:
 * - Collect user feedback on detections
 * - Measure detection accuracy
 * - Identify model weaknesses
 * - Trigger retraining when needed
 * - Track metric improvements
 */
export class AnomalyFeedbackLoop {
  private logger = pino();
  private feedback: Map<string, AnomalyFeedback> = new Map();
  private impacts: Map<string, FeedbackImpact> = new Map();
  private metrics: DetectionMetrics;
  private feedbackLoop: FeedbackLoop;
  private readonly retrainingThreshold = 0.3; // 30% improvement potential
  private readonly feedbackBufferSize = 10000;

  constructor() {
    this.metrics = {
      totalDetections: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      accuracy: 0,
    };

    this.feedbackLoop = {
      loopId: generateId(),
      totalFeedback: 0,
      accuracyImprovement: 0,
      precisionGain: 0,
      recallGain: 0,
      falsePositiveReduction: 0,
      retrainingNeeded: false,
      lastUpdateTime: new Date(),
    };

    this.logger.info('AnomalyFeedbackLoop initialized');
  }

  /**
   * Submit feedback on anomaly detection
   */
  submitFeedback(feedback: AnomalyFeedback): void {
    this.feedback.set(feedback.feedbackId, feedback);
    this.feedbackLoop.totalFeedback++;

    // Maintain buffer size
    if (this.feedback.size > this.feedbackBufferSize) {
      const oldestKey = this.feedback.keys().next().value;
      this.feedback.delete(oldestKey);
    }

    // Update metrics based on feedback
    this.updateMetrics(feedback);

    // Calculate impact
    const impact = this.calculateFeedbackImpact(feedback);
    this.impacts.set(feedback.feedbackId, impact);

    // Check if retraining is needed
    if (impact.impactScore > this.retrainingThreshold * 100) {
      this.feedbackLoop.retrainingNeeded = true;
    }

    this.logger.debug(
      {
        feedbackId: feedback.feedbackId,
        groundTruth: feedback.groundTruth,
        impactScore: impact.impactScore,
      },
      'Feedback submitted'
    );
  }

  /**
   * Batch submit feedback
   */
  submitBatchFeedback(feedbackList: AnomalyFeedback[]): void {
    for (const fb of feedbackList) {
      this.submitFeedback(fb);
    }

    this.logger.info({ count: feedbackList.length }, 'Batch feedback submitted');
  }

  /**
   * Get current detection metrics
   */
  getMetrics(): DetectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get feedback loop status
   */
  getFeedbackLoopStatus(): FeedbackLoop {
    return { ...this.feedbackLoop };
  }

  /**
   * Get high-impact feedback
   */
  getHighImpactFeedback(threshold: number = 50): AnomalyFeedback[] {
    const highImpact: AnomalyFeedback[] = [];

    for (const impact of this.impacts.values()) {
      if (impact.impactScore >= threshold) {
        const feedback = this.feedback.get(impact.feedbackId);
        if (feedback) {
          highImpact.push(feedback);
        }
      }
    }

    return highImpact.sort((a, b) => {
      const impactA = this.impacts.get(a.feedbackId)?.impactScore || 0;
      const impactB = this.impacts.get(b.feedbackId)?.impactScore || 0;
      return impactB - impactA;
    });
  }

  /**
   * Get retraining recommendation
   */
  getRetrainingRecommendation(): {
    needed: boolean;
    priority: 'low' | 'medium' | 'high' | 'critical';
    suggestedAreas: string[];
    estimatedImprovement: number;
  } {
    const falsePositiveRate = this.metrics.totalDetections > 0
      ? (this.metrics.falsePositives / this.metrics.totalDetections) * 100
      : 0;

    const falseNegativeRate = (this.metrics.truePositives + this.metrics.falseNegatives) > 0
      ? (this.metrics.falseNegatives / (this.metrics.truePositives + this.metrics.falseNegatives)) * 100
      : 0;

    let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (falsePositiveRate > 30 || falseNegativeRate > 20) {
      priority = 'critical';
    } else if (falsePositiveRate > 20 || falseNegativeRate > 10) {
      priority = 'high';
    } else if (falsePositiveRate > 10 || falseNegativeRate > 5) {
      priority = 'medium';
    }

    const suggestedAreas: string[] = [];
    if (falsePositiveRate > 15) suggestedAreas.push('reduce false positives');
    if (falseNegativeRate > 10) suggestedAreas.push('improve recall');
    if (this.metrics.f1Score < 0.8) suggestedAreas.push('overall model performance');

    const estimatedImprovement = Math.min(
      (falsePositiveRate + falseNegativeRate) / 2,
      50
    );

    return {
      needed: this.feedbackLoop.retrainingNeeded || priority !== 'low',
      priority,
      suggestedAreas,
      estimatedImprovement: Math.round(estimatedImprovement),
    };
  }

  /**
   * Get model weaknesses
   */
  getModelWeaknesses(): {
    weakArea: string;
    frequency: number;
    severity: number;
  }[] {
    const weaknesses: Record<string, { count: number; severity: number }> = {};

    for (const impact of this.impacts.values()) {
      for (const metric of impact.affectedMetrics) {
        if (!weaknesses[metric]) {
          weaknesses[metric] = { count: 0, severity: 0 };
        }
        weaknesses[metric].count++;
        weaknesses[metric].severity = Math.max(weaknesses[metric].severity, impact.impactScore);
      }
    }

    return Object.entries(weaknesses)
      .map(([area, data]) => ({
        weakArea: area,
        frequency: data.count,
        severity: Math.round(data.severity),
      }))
      .sort((a, b) => b.severity - a.severity);
  }

  /**
   * Reset feedback loop
   */
  resetFeedbackLoop(): void {
    this.feedback.clear();
    this.impacts.clear();
    this.feedbackLoop = {
      loopId: generateId(),
      totalFeedback: 0,
      accuracyImprovement: 0,
      precisionGain: 0,
      recallGain: 0,
      falsePositiveReduction: 0,
      retrainingNeeded: false,
      lastUpdateTime: new Date(),
    };

    this.logger.info('Feedback loop reset');
  }

  // Private methods

  private updateMetrics(feedback: AnomalyFeedback): void {
    this.metrics.totalDetections++;

    if (feedback.groundTruth) {
      this.metrics.truePositives++;
    } else {
      this.metrics.falsePositives++;
    }

    // Recalculate derived metrics
    const total = this.metrics.totalDetections;
    this.metrics.precision =
      this.metrics.truePositives + this.metrics.falsePositives > 0
        ? this.metrics.truePositives / (this.metrics.truePositives + this.metrics.falsePositives)
        : 0;

    this.metrics.recall =
      this.metrics.truePositives + this.metrics.falseNegatives > 0
        ? this.metrics.truePositives / (this.metrics.truePositives + this.metrics.falseNegatives)
        : 0;

    this.metrics.f1Score =
      this.metrics.precision + this.metrics.recall > 0
        ? (2 * this.metrics.precision * this.metrics.recall) /
          (this.metrics.precision + this.metrics.recall)
        : 0;

    this.metrics.accuracy =
      (this.metrics.truePositives + (total - this.metrics.falsePositives)) / total;

    this.feedbackLoop.lastUpdateTime = new Date();
  }

  private calculateFeedbackImpact(feedback: AnomalyFeedback): FeedbackImpact {
    const confidence = feedback.userRating ? feedback.userRating / 5 : 0.7;
    const affectedMetrics: string[] = [];
    let suggestedAction: 'retrain' | 'adjust_threshold' | 'update_feature' | 'none' = 'none';

    // Determine affected metrics
    if (!feedback.groundTruth && this.metrics.precision < 0.85) {
      affectedMetrics.push('precision');
      suggestedAction = 'adjust_threshold';
    }

    if (feedback.groundTruth && this.metrics.recall < 0.85) {
      affectedMetrics.push('recall');
      suggestedAction = 'update_feature';
    }

    const impactScore = Math.min(
      confidence * 100 * (1 + affectedMetrics.length * 0.1),
      100
    );

    return {
      feedbackId: feedback.feedbackId,
      impactScore: Math.round(impactScore),
      affectedMetrics,
      suggestedAction: affectedMetrics.length > 0 ? suggestedAction : 'none',
      confidence,
    };
  }
}

export default AnomalyFeedbackLoop;
