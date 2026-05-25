import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Agentic BI Types
 */
export interface DashboardDefinition {
  id: string;
  name: string;
  description: string;
  tenantId: string;
  widgets: DashboardWidget[];
  layout: LayoutConfig;
  refreshInterval: number; // seconds
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  description?: string;
  config: WidgetConfig;
  dataSource: DataSourceConfig;
  position?: Position;
  size?: Size;
}

export enum WidgetType {
  METRIC_CARD = 'metric_card',
  LINE_CHART = 'line_chart',
  BAR_CHART = 'bar_chart',
  PIE_CHART = 'pie_chart',
  TABLE = 'table',
  HEATMAP = 'heatmap',
  GAUGE = 'gauge',
  TREND_INDICATOR = 'trend_indicator',
  INSIGHT_PANEL = 'insight_panel',
  FORECAST_CHART = 'forecast_chart',
}

export interface WidgetConfig {
  [key: string]: unknown;
  colorScheme?: string;
  showLegend?: boolean;
  animate?: boolean;
  interactivity?: InteractivityConfig;
}

export interface InteractivityConfig {
  drilldown?: boolean;
  filtering?: boolean;
  sorting?: boolean;
  export?: boolean;
}

export interface DataSourceConfig {
  type: DataSourceType;
  query: string;
  refreshInterval?: number;
  cacheTime?: number;
}

export enum DataSourceType {
  METRIC = 'metric',
  QUERY = 'query',
  INSIGHT = 'insight',
  FORECAST = 'forecast',
  AGGREGATE = 'aggregate',
}

export interface Position {
  row: number;
  column: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface LayoutConfig {
  columns: number;
  rowHeight: number;
  gap: number;
  responsive: boolean;
}

export interface ChartRecommendation {
  widgetType: WidgetType;
  metric: string;
  confidence: number;
  reasoning: string;
  exampleConfig: WidgetConfig;
}

export interface DashboardInsight {
  id: string;
  dashboardId: string;
  type: InsightType;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  recommendedAction?: string;
  timestamp: Date;
}

export enum InsightType {
  ANOMALY = 'anomaly',
  TREND_CHANGE = 'trend_change',
  FORECAST_WARNING = 'forecast_warning',
  CORRELATION = 'correlation',
  OPTIMIZATION_OPPORTUNITY = 'optimization_opportunity',
}

export interface DashboardRefreshEvent {
  dashboardId: string;
  timestamp: Date;
  widgetsRefreshed: number;
  totalWidgets: number;
  durationMs: number;
  errors?: string[];
}

/**
 * Agentic Business Intelligence System
 */
export class AgenticBI {
  private logger = pino();
  private dashboards: Map<string, DashboardDefinition> = new Map();
  private insights: Map<string, DashboardInsight> = new Map();
  private recommendations: ChartRecommendation[] = [];
  private chartRecommender: ChartRecommender;
  private dashboardOptimizer: DashboardOptimizer;

  constructor() {
    this.chartRecommender = new ChartRecommender();
    this.dashboardOptimizer = new DashboardOptimizer();
  }

  /**
   * Create a new dashboard
   */
  createDashboard(
    name: string,
    description: string,
    tenantId: string,
    layout: LayoutConfig = { columns: 12, rowHeight: 100, gap: 20, responsive: true }
  ): DashboardDefinition {
    const dashboard: DashboardDefinition = {
      id: generateId(),
      name,
      description,
      tenantId,
      widgets: [],
      layout,
      refreshInterval: 60,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dashboards.set(dashboard.id, dashboard);
    this.logger.info({ dashboardId: dashboard.id, name }, 'Dashboard created');
    return dashboard;
  }

  /**
   * Add widget to dashboard
   */
  addWidget(
    dashboardId: string,
    widget: DashboardWidget
  ): DashboardDefinition {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) {
      throw new Error(`Dashboard ${dashboardId} not found`);
    }

    dashboard.widgets.push(widget);
    dashboard.updatedAt = new Date();

    this.logger.info(
      { dashboardId, widgetId: widget.id, type: widget.type },
      'Widget added'
    );
    return dashboard;
  }

  /**
   * Get chart recommendations for metrics
   */
  recommendCharts(metrics: string[]): ChartRecommendation[] {
    const recommendations: ChartRecommendation[] = [];

    for (const metric of metrics) {
      const recs = this.chartRecommender.recommend(metric);
      recommendations.push(...recs);
    }

    return recommendations;
  }

  /**
   * Auto-generate dashboard for metrics
   */
  generateDashboard(
    name: string,
    metrics: string[],
    tenantId: string
  ): DashboardDefinition {
    const dashboard = this.createDashboard(
      name,
      `Auto-generated dashboard for ${metrics.join(', ')}`,
      tenantId
    );

    // Get recommendations for each metric
    const allRecommendations = this.recommendCharts(metrics);

    // Create widgets from recommendations
    let row = 0;
    let column = 0;
    for (const rec of allRecommendations) {
      const widget: DashboardWidget = {
        id: generateId(),
        type: rec.widgetType,
        title: rec.metric,
        config: rec.exampleConfig,
        dataSource: {
          type: DataSourceType.METRIC,
          query: rec.metric,
          refreshInterval: 60,
        },
        position: { row, column },
        size: { width: 4, height: 2 },
      };

      dashboard.widgets.push(widget);

      column += 4;
      if (column >= dashboard.layout.columns) {
        column = 0;
        row++;
      }
    }

    this.dashboards.set(dashboard.id, dashboard);

    this.logger.info(
      { dashboardId: dashboard.id, widgetCount: dashboard.widgets.length },
      'Dashboard auto-generated'
    );

    return dashboard;
  }

  /**
   * Get dashboard insights
   */
  getDashboardInsights(dashboardId: string): DashboardInsight[] {
    return Array.from(this.insights.values())
      .filter((i) => i.dashboardId === dashboardId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Add insight to dashboard
   */
  addInsight(
    dashboardId: string,
    insight: Omit<DashboardInsight, 'id' | 'dashboardId' | 'timestamp'>
  ): DashboardInsight {
    const dashboardInsight: DashboardInsight = {
      id: generateId(),
      dashboardId,
      ...insight,
      timestamp: new Date(),
    };

    this.insights.set(dashboardInsight.id, dashboardInsight);

    this.logger.info(
      { dashboardId, insightId: dashboardInsight.id, type: insight.type },
      'Insight added to dashboard'
    );

    return dashboardInsight;
  }

  /**
   * Optimize dashboard layout
   */
  optimizeLayout(dashboardId: string): DashboardDefinition {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) {
      throw new Error(`Dashboard ${dashboardId} not found`);
    }

    // Apply optimization
    const optimized = this.dashboardOptimizer.optimize(dashboard);
    this.dashboards.set(dashboardId, optimized);

    this.logger.info({ dashboardId }, 'Dashboard layout optimized');
    return optimized;
  }

  /**
   * Get dashboard
   */
  getDashboard(dashboardId: string): DashboardDefinition | undefined {
    return this.dashboards.get(dashboardId);
  }

  /**
   * List dashboards for tenant
   */
  listDashboards(tenantId: string): DashboardDefinition[] {
    return Array.from(this.dashboards.values())
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /**
   * Delete dashboard
   */
  deleteDashboard(dashboardId: string): boolean {
    return this.dashboards.delete(dashboardId);
  }

  /**
   * Simulate dashboard refresh
   */
  refreshDashboard(dashboardId: string): DashboardRefreshEvent {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) {
      throw new Error(`Dashboard ${dashboardId} not found`);
    }

    const startTime = Date.now();
    const errors: string[] = [];

    // Simulate widget refresh
    for (const widget of dashboard.widgets) {
      try {
        // Mock refresh logic
      } catch (error) {
        errors.push(`Widget ${widget.id} failed: ${(error as Error).message}`);
      }
    }

    const event: DashboardRefreshEvent = {
      dashboardId,
      timestamp: new Date(),
      widgetsRefreshed: dashboard.widgets.length - errors.length,
      totalWidgets: dashboard.widgets.length,
      durationMs: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined,
    };

    return event;
  }

  /**
   * Get statistics
   */
  getStatistics(tenantId: string): Record<string, unknown> {
    const dashboards = this.listDashboards(tenantId);
    const totalWidgets = dashboards.reduce((sum, d) => sum + d.widgets.length, 0);
    const widgetsByType: Record<string, number> = {};

    for (const dashboard of dashboards) {
      for (const widget of dashboard.widgets) {
        widgetsByType[widget.type] = (widgetsByType[widget.type] || 0) + 1;
      }
    }

    return {
      dashboardCount: dashboards.length,
      totalWidgets,
      widgetsByType,
      insightCount: Array.from(this.insights.values()).filter(
        (i) => i.dashboardId && dashboards.some((d) => d.id === i.dashboardId)
      ).length,
    };
  }
}

/**
 * Chart Recommendation Engine
 */
class ChartRecommender {
  private patterns: Map<string, WidgetType[]> = new Map([
    ['revenue', [WidgetType.LINE_CHART, WidgetType.METRIC_CARD, WidgetType.TREND_INDICATOR]],
    ['users', [WidgetType.METRIC_CARD, WidgetType.BAR_CHART, WidgetType.TREND_INDICATOR]],
    ['conversion', [WidgetType.GAUGE, WidgetType.METRIC_CARD, WidgetType.LINE_CHART]],
    ['growth', [WidgetType.LINE_CHART, WidgetType.TREND_INDICATOR, WidgetType.FORECAST_CHART]],
    ['distribution', [WidgetType.PIE_CHART, WidgetType.BAR_CHART, WidgetType.HEATMAP]],
    ['correlation', [WidgetType.HEATMAP, WidgetType.TABLE, WidgetType.INSIGHT_PANEL]],
  ]);

  recommend(metric: string): ChartRecommendation[] {
    const recommendations: ChartRecommendation[] = [];
    const lowerMetric = metric.toLowerCase();

    // Find matching pattern
    let widgetTypes = this.patterns.get(lowerMetric);

    // Default recommendations if no pattern match
    if (!widgetTypes) {
      widgetTypes = [WidgetType.METRIC_CARD, WidgetType.LINE_CHART, WidgetType.TREND_INDICATOR];
    }

    for (let i = 0; i < widgetTypes.length; i++) {
      recommendations.push({
        widgetType: widgetTypes[i],
        metric,
        confidence: 1 - i * 0.15,
        reasoning: this.getReasoningForType(widgetTypes[i], metric),
        exampleConfig: this.getExampleConfig(widgetTypes[i]),
      });
    }

    return recommendations;
  }

  private getReasoningForType(type: WidgetType, metric: string): string {
    const reasons: Record<WidgetType, string> = {
      [WidgetType.METRIC_CARD]: `Shows ${metric} as a single metric with comparison`,
      [WidgetType.LINE_CHART]: `Displays ${metric} trends over time`,
      [WidgetType.BAR_CHART]: `Compares ${metric} across categories`,
      [WidgetType.PIE_CHART]: `Shows ${metric} distribution`,
      [WidgetType.TABLE]: `Lists ${metric} details in tabular format`,
      [WidgetType.HEATMAP]: `Visualizes ${metric} correlation patterns`,
      [WidgetType.GAUGE]: `Displays ${metric} progress toward target`,
      [WidgetType.TREND_INDICATOR]: `Highlights ${metric} trend direction`,
      [WidgetType.INSIGHT_PANEL]: `Shows insights about ${metric}`,
      [WidgetType.FORECAST_CHART]: `Predicts future ${metric} values`,
    };
    return reasons[type];
  }

  private getExampleConfig(type: WidgetType): WidgetConfig {
    return {
      colorScheme: 'default',
      showLegend: true,
      animate: true,
      interactivity: {
        drilldown: true,
        filtering: true,
        sorting: true,
        export: true,
      },
    };
  }
}

/**
 * Dashboard Optimization Engine
 */
class DashboardOptimizer {
  optimize(dashboard: DashboardDefinition): DashboardDefinition {
    // Sort widgets by importance
    const widgets = [...dashboard.widgets];
    widgets.sort((a, b) => {
      const importanceA = this.getWidgetImportance(a);
      const importanceB = this.getWidgetImportance(b);
      return importanceB - importanceA;
    });

    // Reposition widgets
    let row = 0;
    let column = 0;
    const optimizedWidgets = widgets.map((widget) => {
      const size = this.getOptimalSize(widget.type);
      const optimized = {
        ...widget,
        position: { row, column },
        size,
      };

      column += size.width;
      if (column >= dashboard.layout.columns) {
        column = 0;
        row++;
      }

      return optimized;
    });

    return {
      ...dashboard,
      widgets: optimizedWidgets,
      updatedAt: new Date(),
    };
  }

  private getWidgetImportance(widget: DashboardWidget): number {
    const importanceMap: Record<WidgetType, number> = {
      [WidgetType.METRIC_CARD]: 10,
      [WidgetType.LINE_CHART]: 9,
      [WidgetType.BAR_CHART]: 8,
      [WidgetType.PIE_CHART]: 7,
      [WidgetType.TABLE]: 6,
      [WidgetType.HEATMAP]: 5,
      [WidgetType.GAUGE]: 8,
      [WidgetType.TREND_INDICATOR]: 9,
      [WidgetType.INSIGHT_PANEL]: 10,
      [WidgetType.FORECAST_CHART]: 9,
    };
    return importanceMap[widget.type] || 5;
  }

  private getOptimalSize(type: WidgetType): Size {
    const sizeMap: Record<WidgetType, Size> = {
      [WidgetType.METRIC_CARD]: { width: 3, height: 2 },
      [WidgetType.LINE_CHART]: { width: 6, height: 3 },
      [WidgetType.BAR_CHART]: { width: 6, height: 3 },
      [WidgetType.PIE_CHART]: { width: 4, height: 3 },
      [WidgetType.TABLE]: { width: 12, height: 4 },
      [WidgetType.HEATMAP]: { width: 6, height: 3 },
      [WidgetType.GAUGE]: { width: 3, height: 2 },
      [WidgetType.TREND_INDICATOR]: { width: 3, height: 2 },
      [WidgetType.INSIGHT_PANEL]: { width: 6, height: 2 },
      [WidgetType.FORECAST_CHART]: { width: 6, height: 3 },
    };
    return sizeMap[type] || { width: 4, height: 2 };
  }
}

export { AgenticBI as default };
