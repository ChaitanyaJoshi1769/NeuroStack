import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Analytics types
 */
export interface Dataset {
  id: string;
  name: string;
  rows: Record<string, unknown>[];
  schema: ColumnSchema[];
}

export interface ColumnSchema {
  name: string;
  type: 'number' | 'string' | 'date' | 'boolean';
  stats?: ColumnStats;
}

export interface ColumnStats {
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  nullCount?: number;
  uniqueCount?: number;
}

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  metric: string;
  value: number;
  previousValue?: number;
  change?: number;
  changePercent?: number;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  timestamp: Date;
  details: Record<string, unknown>;
}

export enum InsightType {
  ANOMALY = 'anomaly',
  TREND = 'trend',
  CORRELATION = 'correlation',
  PATTERN = 'pattern',
  OUTLIER = 'outlier',
  FORECAST = 'forecast',
}

export interface AnomalyScore {
  value: number;
  isAnomaly: boolean;
  zScore: number;
  threshold: number;
}

export interface Forecast {
  metric: string;
  nextValue: number;
  confidence: number;
  lower: number;
  upper: number;
}

/**
 * Autonomous Analytics Engine
 */
export class AnalyticsEngine {
  private logger = pino();
  private insights: Map<string, Insight> = new Map();
  private datasets: Map<string, Dataset> = new Map();

  /**
   * Register a dataset for analysis
   */
  registerDataset(
    name: string,
    rows: Record<string, unknown>[],
    schema: ColumnSchema[]
  ): Dataset {
    const dataset: Dataset = {
      id: generateId(),
      name,
      rows,
      schema,
    };

    // Compute statistics
    for (const column of dataset.schema) {
      if (column.type === 'number') {
        column.stats = this.computeStats(
          rows.map((r) => r[column.name] as number)
        );
      }
    }

    this.datasets.set(dataset.id, dataset);
    this.logger.info({ datasetId: dataset.id, name }, 'Dataset registered');
    return dataset;
  }

  /**
   * Generate insights from a dataset
   */
  async generateInsights(datasetId: string): Promise<Insight[]> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    const insights: Insight[] = [];

    // Generate different types of insights
    insights.push(...this.detectAnomalies(dataset));
    insights.push(...this.detectTrends(dataset));
    insights.push(...this.detectCorrelations(dataset));
    insights.push(...this.generateForecasts(dataset));

    // Store insights
    for (const insight of insights) {
      this.insights.set(insight.id, insight);
    }

    this.logger.info({ datasetId, insightCount: insights.length }, 'Insights generated');
    return insights;
  }

  /**
   * Detect anomalies in numeric columns
   */
  private detectAnomalies(dataset: Dataset): Insight[] {
    const insights: Insight[] = [];

    for (const column of dataset.schema) {
      if (column.type !== 'number' || !column.stats) continue;

      const values = dataset.rows.map((r) => r[column.name] as number);
      const recentValues = values.slice(-10);
      const recentMean = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
      const recentStdDev = this.calculateStdDev(
        recentValues,
        recentMean
      );

      if (column.stats.stdDev && recentStdDev > column.stats.stdDev * 1.5) {
        const insight: Insight = {
          id: generateId(),
          type: InsightType.ANOMALY,
          title: `Unusual Variance in ${column.name}`,
          description: `Standard deviation increased significantly in recent data`,
          metric: column.name,
          value: recentStdDev,
          previousValue: column.stats.stdDev,
          change: recentStdDev - column.stats.stdDev,
          changePercent: ((recentStdDev - column.stats.stdDev) / column.stats.stdDev) * 100,
          severity: 'medium',
          confidence: 0.85,
          timestamp: new Date(),
          details: {
            recentMean,
            historicalMean: column.stats.mean,
            threshold: column.stats.stdDev * 1.5,
          },
        };
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Detect trends in numeric columns
   */
  private detectTrends(dataset: Dataset): Insight[] {
    const insights: Insight[] = [];

    for (const column of dataset.schema) {
      if (column.type !== 'number') continue;

      const values = dataset.rows.map((r) => r[column.name] as number);
      if (values.length < 3) continue;

      // Simple trend: compare recent vs historical
      const recent = values.slice(-5);
      const historical = values.slice(0, Math.max(5, values.length - 5));

      const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const historicalMean = historical.reduce((a, b) => a + b, 0) / historical.length;

      const changePercent = ((recentMean - historicalMean) / historicalMean) * 100;

      if (Math.abs(changePercent) > 10) {
        const insight: Insight = {
          id: generateId(),
          type: InsightType.TREND,
          title: `${changePercent > 0 ? 'Increasing' : 'Decreasing'} Trend in ${column.name}`,
          description: `${column.name} has ${changePercent > 0 ? 'increased' : 'decreased'} ${Math.abs(changePercent).toFixed(2)}% recently`,
          metric: column.name,
          value: recentMean,
          previousValue: historicalMean,
          change: recentMean - historicalMean,
          changePercent,
          severity: Math.abs(changePercent) > 25 ? 'high' : 'medium',
          confidence: 0.9,
          timestamp: new Date(),
          details: {
            recentMean,
            historicalMean,
            direction: changePercent > 0 ? 'increasing' : 'decreasing',
          },
        };
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Detect correlations between columns
   */
  private detectCorrelations(dataset: Dataset): Insight[] {
    const insights: Insight[] = [];
    const numericColumns = dataset.schema.filter((c) => c.type === 'number');

    if (numericColumns.length < 2) return insights;

    // Simple correlation detection
    for (let i = 0; i < numericColumns.length; i++) {
      for (let j = i + 1; j < numericColumns.length; j++) {
        const col1 = numericColumns[i];
        const col2 = numericColumns[j];

        const values1 = dataset.rows.map((r) => r[col1.name] as number);
        const values2 = dataset.rows.map((r) => r[col2.name] as number);

        const correlation = this.calculateCorrelation(values1, values2);

        if (Math.abs(correlation) > 0.7) {
          const insight: Insight = {
            id: generateId(),
            type: InsightType.CORRELATION,
            title: `Strong Correlation Between ${col1.name} and ${col2.name}`,
            description: `${col1.name} and ${col2.name} show strong ${correlation > 0 ? 'positive' : 'negative'} correlation (${correlation.toFixed(2)})`,
            metric: `${col1.name}_vs_${col2.name}`,
            value: correlation,
            severity: 'low',
            confidence: 0.88,
            timestamp: new Date(),
            details: {
              column1: col1.name,
              column2: col2.name,
              correlation,
              direction: correlation > 0 ? 'positive' : 'negative',
            },
          };
          insights.push(insight);
        }
      }
    }

    return insights;
  }

  /**
   * Generate forecasts for numeric columns
   */
  private generateForecasts(dataset: Dataset): Insight[] {
    const insights: Insight[] = [];

    for (const column of dataset.schema) {
      if (column.type !== 'number') continue;

      const values = dataset.rows.map((r) => r[column.name] as number);
      if (values.length < 3) continue;

      // Simple linear forecast
      const recent = values.slice(-5);
      const trend = recent[recent.length - 1] - recent[0];
      const forecastValue = recent[recent.length - 1] + trend / 4;

      const insight: Insight = {
        id: generateId(),
        type: InsightType.FORECAST,
        title: `Forecast for ${column.name}`,
        description: `Expected value for ${column.name} in next period: ${forecastValue.toFixed(2)}`,
        metric: column.name,
        value: forecastValue,
        previousValue: recent[recent.length - 1],
        severity: 'low',
        confidence: 0.75,
        timestamp: new Date(),
        details: {
          currentValue: recent[recent.length - 1],
          forecastValue,
          lowerBound: forecastValue * 0.9,
          upperBound: forecastValue * 1.1,
        },
      };
      insights.push(insight);
    }

    return insights;
  }

  /**
   * Get insights by dataset
   */
  getInsights(
    datasetId?: string,
    type?: InsightType
  ): Insight[] {
    let results = Array.from(this.insights.values());

    if (type) {
      results = results.filter((i) => i.type === type);
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Generate analytical report
   */
  generateReport(datasetId: string): Record<string, unknown> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    const insights = this.getInsights(datasetId);

    const reportId = generateId();

    return {
      reportId,
      datasetName: dataset.name,
      generatedAt: new Date().toISOString(),
      rowCount: dataset.rows.length,
      columnCount: dataset.schema.length,
      summary: {
        totalInsights: insights.length,
        anomalies: insights.filter((i) => i.type === InsightType.ANOMALY).length,
        trends: insights.filter((i) => i.type === InsightType.TREND).length,
        correlations: insights.filter((i) => i.type === InsightType.CORRELATION).length,
        forecasts: insights.filter((i) => i.type === InsightType.FORECAST).length,
      },
      insights: insights.slice(0, 10),
      schema: dataset.schema,
    };
  }

  // Private helper methods

  private computeStats(values: number[]): ColumnStats {
    if (values.length === 0) {
      return {};
    }

    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const stdDev = this.calculateStdDev(values, mean);
    const nullCount = values.filter((v) => v === null || v === undefined).length;
    const uniqueCount = new Set(values).size;

    return { min, max, mean, median, stdDev, nullCount, uniqueCount };
  }

  private calculateStdDev(values: number[], mean: number): number {
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let sumX2 = 0;
    let sumY2 = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      sumX2 += dx * dx;
      sumY2 += dy * dy;
    }

    const denominator = Math.sqrt(sumX2 * sumY2);
    return denominator === 0 ? 0 : numerator / denominator;
  }
}

export { AnalyticsEngine as default };
