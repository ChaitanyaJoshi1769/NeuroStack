import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Dashboard Recommendations Types
 */

export interface WidgetInteraction {
  widgetId: string;
  widgetType: string;
  userId: string;
  action: 'view' | 'interact' | 'configure' | 'remove' | 'resize';
  timestamp: Date;
  duration?: number; // Time spent (milliseconds)
  scrollDepth?: number; // 0-100 percentage
  configChanges?: Record<string, any>;
}

export interface UserBehaviorProfile {
  userId: string;
  interactions: WidgetInteraction[];
  preferences: {
    favoriteWidgets: string[];
    viewPatterns: Record<string, number>; // Widget type -> view count
    peakHours: number[]; // 0-23 hours when user is most active
    avgSessionDuration: number;
    lastActive: Date;
  };
  demographics?: {
    role?: string;
    department?: string;
    industry?: string;
  };
}

export interface WidgetRecommendation {
  widgetId: string;
  widgetType: string;
  title: string;
  score: number; // 0-100
  reasons: string[];
  estimatedValue: string; // Low, Medium, High
  similarUsers: number; // Count of similar users with this widget
  confidenceLevel: 'low' | 'medium' | 'high';
}

export interface RecommendationResult {
  userId: string;
  recommendations: WidgetRecommendation[];
  generatedAt: Date;
  baselineScore: number; // Dashboard diversity score 0-100
  improvementPotential: number; // Expected improvement 0-100
}

export interface WidgetPopularity {
  widgetType: string;
  usageCount: number;
  avgDuration: number;
  adoptionRate: number; // 0-100
  trendDirection: 'increasing' | 'stable' | 'decreasing';
  peakHours: number[];
}

/**
 * Dashboard Recommendation Engine
 *
 * Provides intelligent, personalized widget recommendations based on:
 * - User behavior analysis and interaction patterns
 * - Collaborative filtering with similar users
 * - Contextual recommendations from current data
 * - Temporal patterns and peak usage analysis
 */
export class RecommendationEngine {
  private logger = pino();
  private userProfiles: Map<string, UserBehaviorProfile> = new Map();
  private allInteractions: WidgetInteraction[] = [];
  private widgetPopularity: Map<string, WidgetPopularity> = new Map();
  private readonly maxRecommendations = 5;
  private readonly minSimilarityScore = 0.6;

  constructor() {}

  /**
   * Record user interaction with widget
   */
  recordInteraction(interaction: WidgetInteraction): void {
    this.allInteractions.push(interaction);

    const profile = this.userProfiles.get(interaction.userId) || this.createProfile(interaction.userId);
    profile.interactions.push(interaction);

    // Update preferences
    this.updateUserPreferences(profile);
    this.updateWidgetPopularity(interaction);

    this.userProfiles.set(interaction.userId, profile);

    this.logger.debug(
      {
        userId: interaction.userId,
        widgetId: interaction.widgetId,
        action: interaction.action,
      },
      'User interaction recorded'
    );
  }

  /**
   * Generate personalized widget recommendations
   */
  generateRecommendations(userId: string): RecommendationResult {
    const userProfile = this.userProfiles.get(userId);
    if (!userProfile) {
      return {
        userId,
        recommendations: [],
        generatedAt: new Date(),
        baselineScore: 0,
        improvementPotential: 0,
      };
    }

    const recommendations: WidgetRecommendation[] = [];

    // Strategy 1: Collaborative filtering - find similar users
    const similarUsers = this.findSimilarUsers(userId);
    const collaborativeRecs = this.getCollaborativeRecommendations(userId, similarUsers);
    recommendations.push(...collaborativeRecs);

    // Strategy 2: Content-based - widgets similar to user's favorites
    const contentBasedRecs = this.getContentBasedRecommendations(userId);
    recommendations.push(...contentBasedRecs);

    // Strategy 3: Contextual - trending widgets and popular patterns
    const contextualRecs = this.getContextualRecommendations(userId);
    recommendations.push(...contextualRecs);

    // Strategy 4: Temporal - based on user's peak hours
    const temporalRecs = this.getTemporalRecommendations(userId);
    recommendations.push(...temporalRecs);

    // Deduplicate and score
    const deduplicated = this.deduplicateRecommendations(recommendations);
    const scored = this.scoreRecommendations(deduplicated, userProfile);
    const ranked = scored.sort((a, b) => b.score - a.score);
    const topRecommendations = ranked.slice(0, this.maxRecommendations);

    const baselineScore = this.calculateDiversityScore(userProfile);
    const improvementPotential = this.estimateImprovement(topRecommendations, userProfile);

    const result: RecommendationResult = {
      userId,
      recommendations: topRecommendations,
      generatedAt: new Date(),
      baselineScore,
      improvementPotential,
    };

    this.logger.info(
      {
        userId,
        recommendationCount: topRecommendations.length,
        baselineScore: Math.round(baselineScore),
        improvementPotential: Math.round(improvementPotential),
      },
      'Recommendations generated'
    );

    return result;
  }

  /**
   * Get widget popularity metrics
   */
  getWidgetPopularity(): Map<string, WidgetPopularity> {
    return this.widgetPopularity;
  }

  /**
   * Get user behavior profile
   */
  getUserProfile(userId: string): UserBehaviorProfile | undefined {
    return this.userProfiles.get(userId);
  }

  /**
   * Get all user profiles (for analytics)
   */
  getAllProfiles(): UserBehaviorProfile[] {
    return Array.from(this.userProfiles.values());
  }

  // Private methods

  private createProfile(userId: string): UserBehaviorProfile {
    return {
      userId,
      interactions: [],
      preferences: {
        favoriteWidgets: [],
        viewPatterns: {},
        peakHours: [],
        avgSessionDuration: 0,
        lastActive: new Date(),
      },
    };
  }

  private updateUserPreferences(profile: UserBehaviorProfile): void {
    // Update view patterns
    const recentInteractions = profile.interactions.slice(-1000);
    const viewCounts: Record<string, number> = {};

    for (const interaction of recentInteractions) {
      if (interaction.action === 'view') {
        viewCounts[interaction.widgetType] = (viewCounts[interaction.widgetType] || 0) + 1;
      }
    }

    profile.preferences.viewPatterns = viewCounts;

    // Update favorite widgets (most viewed)
    const sortedWidgets = Object.entries(viewCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type]) => type);
    profile.preferences.favoriteWidgets = sortedWidgets;

    // Update peak hours
    const hourCounts = new Array(24).fill(0);
    for (const interaction of recentInteractions) {
      const hour = interaction.timestamp.getHours();
      hourCounts[hour]++;
    }

    const avgViewsPerHour = hourCounts.reduce((a, b) => a + b) / 24;
    profile.preferences.peakHours = hourCounts
      .map((count, hour) => (count > avgViewsPerHour * 1.5 ? hour : -1))
      .filter((h) => h >= 0);

    // Update average session duration
    const withDuration = recentInteractions.filter((i) => i.duration);
    profile.preferences.avgSessionDuration =
      withDuration.length > 0 ? withDuration.reduce((sum, i) => sum + (i.duration || 0), 0) / withDuration.length : 0;

    profile.preferences.lastActive = new Date();
  }

  private updateWidgetPopularity(interaction: WidgetInteraction): void {
    const popularity = this.widgetPopularity.get(interaction.widgetType) || {
      widgetType: interaction.widgetType,
      usageCount: 0,
      avgDuration: 0,
      adoptionRate: 0,
      trendDirection: 'stable',
      peakHours: [],
    };

    if (interaction.action === 'view') {
      popularity.usageCount++;
      const prevAvg = popularity.avgDuration;
      popularity.avgDuration =
        (prevAvg * (popularity.usageCount - 1) + (interaction.duration || 0)) / popularity.usageCount;
    }

    this.widgetPopularity.set(interaction.widgetType, popularity);
  }

  private findSimilarUsers(userId: string): string[] {
    const userProfile = this.userProfiles.get(userId);
    if (!userProfile || userProfile.preferences.favoriteWidgets.length === 0) {
      return [];
    }

    const userWidgetSet = new Set(userProfile.preferences.favoriteWidgets);
    const similarities: Array<[string, number]> = [];

    for (const [otherId, otherProfile] of this.userProfiles) {
      if (otherId === userId) continue;

      const otherWidgetSet = new Set(otherProfile.preferences.favoriteWidgets);
      const intersection = new Set([...userWidgetSet].filter((w) => otherWidgetSet.has(w)));
      const union = new Set([...userWidgetSet, ...otherWidgetSet]);

      const similarity = union.size > 0 ? intersection.size / union.size : 0;

      if (similarity >= this.minSimilarityScore) {
        similarities.push([otherId, similarity]);
      }
    }

    return similarities.sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  }

  private getCollaborativeRecommendations(userId: string, similarUsers: string[]): WidgetRecommendation[] {
    const recommendations: WidgetRecommendation[] = [];
    const userProfile = this.userProfiles.get(userId);
    const userWidgets = new Set(userProfile?.preferences.favoriteWidgets || []);

    const widgetCounts: Record<string, number> = {};

    for (const similarUserId of similarUsers) {
      const similarProfile = this.userProfiles.get(similarUserId);
      if (!similarProfile) continue;

      for (const widget of similarProfile.preferences.favoriteWidgets) {
        if (!userWidgets.has(widget)) {
          widgetCounts[widget] = (widgetCounts[widget] || 0) + 1;
        }
      }
    }

    for (const [widgetType, count] of Object.entries(widgetCounts).sort((a, b) => b[1] - a[1])) {
      recommendations.push({
        widgetId: generateId(),
        widgetType,
        title: this.getWidgetTitle(widgetType),
        score: 0, // Will be updated by scoring function
        reasons: [`${count} similar users use this widget`],
        estimatedValue: count > 3 ? 'High' : 'Medium',
        similarUsers: count,
        confidenceLevel: count > 5 ? 'high' : 'medium',
      });
    }

    return recommendations;
  }

  private getContentBasedRecommendations(userId: string): WidgetRecommendation[] {
    const userProfile = this.userProfiles.get(userId);
    if (!userProfile) return [];

    const recommendations: WidgetRecommendation[] = [];
    const userWidgets = new Set(userProfile.preferences.favoriteWidgets);

    // Recommend related widget types
    const relatedWidgets = this.getRelatedWidgets(Array.from(userWidgets));

    for (const widgetType of relatedWidgets) {
      if (!userWidgets.has(widgetType)) {
        recommendations.push({
          widgetId: generateId(),
          widgetType,
          title: this.getWidgetTitle(widgetType),
          score: 0,
          reasons: [`Complements your existing widgets`],
          estimatedValue: 'Medium',
          similarUsers: 0,
          confidenceLevel: 'medium',
        });
      }
    }

    return recommendations;
  }

  private getContextualRecommendations(userId: string): WidgetRecommendation[] {
    const recommendations: WidgetRecommendation[] = [];

    // Get trending widgets (high adoption rate and increasing)
    const trendingWidgets = Array.from(this.widgetPopularity.values())
      .filter((w) => w.trendDirection === 'increasing' && w.adoptionRate > 30)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);

    for (const widget of trendingWidgets) {
      recommendations.push({
        widgetId: generateId(),
        widgetType: widget.widgetType,
        title: this.getWidgetTitle(widget.widgetType),
        score: 0,
        reasons: [`Trending widget with ${widget.usageCount} active users`],
        estimatedValue: widget.adoptionRate > 60 ? 'High' : 'Medium',
        similarUsers: 0,
        confidenceLevel: 'medium',
      });
    }

    return recommendations;
  }

  private getTemporalRecommendations(userId: string): WidgetRecommendation[] {
    const userProfile = this.userProfiles.get(userId);
    if (!userProfile || userProfile.preferences.peakHours.length === 0) {
      return [];
    }

    const recommendations: WidgetRecommendation[] = [];
    const userWidgets = new Set(userProfile.preferences.favoriteWidgets);

    // Find widgets that are popular during user's peak hours
    const peakHourSet = new Set(userProfile.preferences.peakHours);
    const peakWidgets: Record<string, number> = {};

    for (const interaction of this.allInteractions.slice(-10000)) {
      const hour = interaction.timestamp.getHours();
      if (peakHourSet.has(hour) && !userWidgets.has(interaction.widgetType)) {
        peakWidgets[interaction.widgetType] = (peakWidgets[interaction.widgetType] || 0) + 1;
      }
    }

    for (const [widgetType, count] of Object.entries(peakWidgets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)) {
      recommendations.push({
        widgetId: generateId(),
        widgetType,
        title: this.getWidgetTitle(widgetType),
        score: 0,
        reasons: [`Popular during your peak hours (${userProfile.preferences.peakHours.join(', ')}h)`],
        estimatedValue: 'Medium',
        similarUsers: 0,
        confidenceLevel: 'medium',
      });
    }

    return recommendations;
  }

  private deduplicateRecommendations(recommendations: WidgetRecommendation[]): WidgetRecommendation[] {
    const seen = new Set<string>();
    return recommendations.filter((rec) => {
      if (seen.has(rec.widgetType)) return false;
      seen.add(rec.widgetType);
      return true;
    });
  }

  private scoreRecommendations(
    recommendations: WidgetRecommendation[],
    userProfile: UserBehaviorProfile
  ): WidgetRecommendation[] {
    return recommendations.map((rec) => {
      let score = 50; // Base score

      // Boost for similar users
      score += Math.min(rec.similarUsers * 5, 25);

      // Boost for confidence level
      if (rec.confidenceLevel === 'high') score += 15;
      else if (rec.confidenceLevel === 'medium') score += 10;

      // Boost for trending/popular
      const popularity = this.widgetPopularity.get(rec.widgetType);
      if (popularity && popularity.trendDirection === 'increasing') score += 10;

      // Cap at 100
      rec.score = Math.min(score, 100);
      return rec;
    });
  }

  private calculateDiversityScore(profile: UserBehaviorProfile): number {
    // Score based on variety of widgets used (0-100)
    const widgetTypes = new Set(profile.preferences.favoriteWidgets);
    const diversity = (widgetTypes.size / 10) * 100; // Assuming 10 is max diverse

    // Also consider engagement
    const engagement = Math.min((profile.interactions.length / 100) * 100, 100);

    return (diversity + engagement) / 2;
  }

  private estimateImprovement(
    recommendations: WidgetRecommendation[],
    userProfile: UserBehaviorProfile
  ): number {
    // Estimate potential improvement if user adopts recommendations
    let improvement = 0;

    for (const rec of recommendations) {
      improvement += rec.score * 0.1; // Each recommendation contributes up to 10%
    }

    return Math.min(improvement, 100);
  }

  private getRelatedWidgets(userWidgets: string[]): string[] {
    // Simple relationship mapping between widget types
    const relationships: Record<string, string[]> = {
      'LineChart': ['BarChart', 'TrendIndicator', 'ForecastChart'],
      'BarChart': ['LineChart', 'PieChart', 'Heatmap'],
      'PieChart': ['BarChart', 'Table'],
      'MetricCard': ['Gauge', 'TrendIndicator'],
      'Table': ['BarChart', 'PieChart', 'Heatmap'],
      'Gauge': ['MetricCard', 'TrendIndicator'],
      'Heatmap': ['BarChart', 'Table'],
      'TrendIndicator': ['LineChart', 'MetricCard', 'Gauge'],
      'InsightPanel': ['LineChart', 'BarChart', 'MetricCard'],
      'ForecastChart': ['LineChart', 'TrendIndicator'],
    };

    const relatedSet = new Set<string>();
    for (const widget of userWidgets) {
      const related = relationships[widget] || [];
      related.forEach((w) => relatedSet.add(w));
    }

    return Array.from(relatedSet);
  }

  private getWidgetTitle(widgetType: string): string {
    const titles: Record<string, string> = {
      'MetricCard': 'Metric Card',
      'LineChart': 'Line Chart',
      'BarChart': 'Bar Chart',
      'PieChart': 'Pie Chart',
      'Table': 'Data Table',
      'Heatmap': 'Heat Map',
      'Gauge': 'Gauge',
      'TrendIndicator': 'Trend Indicator',
      'InsightPanel': 'Insight Panel',
      'ForecastChart': 'Forecast Chart',
    };

    return titles[widgetType] || widgetType;
  }
}

export default RecommendationEngine;
