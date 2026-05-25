import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';

/**
 * Dashboard UI Widget Types and Components
 */

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

export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any;
}

export interface WidgetPosition {
  row: number;
  col: number;
}

export interface WidgetSize {
  width: number; // columns
  height: number; // rows
}

export interface BaseWidgetProps {
  id: string;
  title: string;
  type: WidgetType;
  position?: WidgetPosition;
  size?: WidgetSize;
  isLoading?: boolean;
  error?: string;
  refreshInterval?: number; // milliseconds
  onRefresh?: () => Promise<void>;
  className?: string;
  style?: React.CSSProperties;
}

// ============================================================================
// 1. Metric Card: Single metric with comparison
// ============================================================================

export interface MetricCardProps extends BaseWidgetProps {
  value: number;
  unit?: string;
  format?: 'number' | 'currency' | 'percentage';
  comparison?: {
    value: number;
    change: number;
    changePercent: number;
    direction: 'up' | 'down' | 'stable';
  };
  trend?: 'improving' | 'declining' | 'stable';
  color?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  id,
  title,
  value,
  unit = '',
  format = 'number',
  comparison,
  trend,
  color = '#3b82f6',
  isLoading = false,
  error,
  className,
  style,
  refreshInterval,
  onRefresh,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!refreshInterval || !onRefresh) return;

    const interval = setInterval(async () => {
      setIsRefreshing(true);
      await onRefresh();
      setIsRefreshing(false);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, onRefresh]);

  const formattedValue = format === 'currency'
    ? `$${value.toFixed(2)}`
    : format === 'percentage'
    ? `${value.toFixed(1)}%`
    : value.toFixed(2);

  return (
    <div
      className={classNames('metric-card', {
        'is-loading': isLoading,
        'has-error': error,
        [className]: className,
      })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: `1px solid #e5e7eb`,
        ...style,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 500 }}>{title}</h3>

      {error ? (
        <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span
              style={{
                fontSize: '32px',
                fontWeight: 700,
                color: trend === 'declining' ? '#ef4444' : trend === 'improving' ? '#10b981' : color,
              }}
            >
              {formattedValue}
            </span>
            {unit && <span style={{ fontSize: '14px', color: '#6b7280' }}>{unit}</span>}
          </div>

          {comparison && (
            <div style={{ marginTop: '12px', fontSize: '12px' }}>
              <span
                style={{
                  color: comparison.direction === 'up' ? '#10b981' : comparison.direction === 'down' ? '#ef4444' : '#6b7280',
                }}
              >
                {comparison.direction === 'up' ? '↑' : comparison.direction === 'down' ? '↓' : '→'}
                {' '}
                {comparison.changePercent.toFixed(1)}%
              </span>
              <span style={{ color: '#9ca3af' }}> from previous period</span>
            </div>
          )}
        </>
      )}

      {isRefreshing && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>Refreshing...</div>
      )}
    </div>
  );
};

// ============================================================================
// 2. Line Chart: Time-series trends
// ============================================================================

export interface LineChartProps extends BaseWidgetProps {
  data: ChartDataPoint[];
  xKey: string;
  yKey: string;
  color?: string;
  showGrid?: boolean;
  showLegend?: boolean;
}

export const LineChart: React.FC<LineChartProps> = ({
  id,
  title,
  data,
  xKey,
  yKey,
  color = '#3b82f6',
  showGrid = true,
  showLegend = true,
  isLoading = false,
  error,
  className,
  style,
}) => {
  return (
    <div
      className={classNames('line-chart', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 500 }}>{title}</h3>

      {error ? (
        <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>
      ) : isLoading ? (
        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#9ca3af' }}>Loading chart...</div>
        </div>
      ) : (
        <div
          style={{
            height: '300px',
            position: 'relative',
            backgroundColor: '#ffffff',
            borderRadius: '4px',
            padding: '12px',
            border: '1px solid #e5e7eb',
          }}
        >
          {/* Simplified chart representation - in production would use Recharts */}
          <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
            {showGrid && (
              <>
                {[0, 0.25, 0.5, 0.75, 1].map((y) => (
                  <line
                    key={`grid-${y}`}
                    x1="0"
                    y1={`${y * 100}%`}
                    x2="100%"
                    y2={`${y * 100}%`}
                    stroke="#e5e7eb"
                    strokeDasharray="4"
                  />
                ))}
              </>
            )}
            {/* Plot line */}
            <polyline
              points={data
                .map((d, i) => {
                  const x = (i / Math.max(data.length - 1, 1)) * 100;
                  const y = 100 - ((d[yKey] || 0) as number) / Math.max(...data.map((d) => d[yKey] as number), 1) * 100;
                  return `${x}%,${y}%`;
                })
                .join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="2"
            />
          </svg>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#9ca3af' }}>
            {data.length} data points
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 3. Bar Chart: Category comparison
// ============================================================================

export interface BarChartProps extends BaseWidgetProps {
  data: ChartDataPoint[];
  xKey: string;
  yKey: string;
  color?: string;
  orientation?: 'vertical' | 'horizontal';
}

export const BarChart: React.FC<BarChartProps> = ({
  id,
  title,
  data,
  xKey,
  yKey,
  color = '#8b5cf6',
  orientation = 'vertical',
  isLoading = false,
  error,
  className,
  style,
}) => {
  const maxValue = Math.max(...data.map((d) => (d[yKey] as number) || 0));

  return (
    <div
      className={classNames('bar-chart', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 500 }}>{title}</h3>

      {error ? (
        <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>
      ) : isLoading ? (
        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#9ca3af' }}>Loading chart...</div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '300px' }}>
          {data.map((d) => (
            <div
              key={d[xKey] as string}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: `${((d[yKey] as number) / maxValue) * 250}px`,
                  backgroundColor: color,
                  borderRadius: '4px 4px 0 0',
                  opacity: 0.8,
                }}
              />
              <span style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', wordBreak: 'break-word' }}>
                {String(d[xKey]).slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 4. Pie Chart: Distribution visualization
// ============================================================================

export interface PieChartProps extends BaseWidgetProps {
  data: ChartDataPoint[];
  nameKey: string;
  valueKey: string;
  colors?: string[];
}

export const PieChart: React.FC<PieChartProps> = ({
  id,
  title,
  data,
  nameKey,
  valueKey,
  colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'],
  isLoading = false,
  error,
  className,
  style,
}) => {
  const total = data.reduce((sum, d) => sum + (d[valueKey] as number), 0);

  return (
    <div
      className={classNames('pie-chart', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 500 }}>{title}</h3>

      {error ? (
        <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>
      ) : isLoading ? (
        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#9ca3af' }}>Loading chart...</div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="200" height="200" viewBox="0 0 200 200">
              {data.map((d, i) => {
                const value = (d[valueKey] as number) / total;
                const startAngle = data.slice(0, i).reduce((sum, x) => sum + (x[valueKey] as number) / total, 0) * 360;
                const endAngle = startAngle + value * 360;

                const startRad = (startAngle * Math.PI) / 180;
                const endRad = (endAngle * Math.PI) / 180;
                const x1 = 100 + 80 * Math.cos(startRad);
                const y1 = 100 + 80 * Math.sin(startRad);
                const x2 = 100 + 80 * Math.cos(endRad);
                const y2 = 100 + 80 * Math.sin(endRad);
                const largeArc = value > 0.5 ? 1 : 0;

                return (
                  <path
                    key={`slice-${i}`}
                    d={`M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArc} 1 ${x2} ${y2} Z`}
                    fill={colors[i % colors.length]}
                    opacity={0.8}
                    stroke="white"
                    strokeWidth="2"
                  />
                );
              })}
            </svg>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
            {data.map((d, i) => (
              <div key={`legend-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    backgroundColor: colors[i % colors.length],
                    borderRadius: '2px',
                  }}
                />
                <span style={{ flex: 1 }}>{d[nameKey]}</span>
                <span style={{ color: '#9ca3af' }}>
                  {(((d[valueKey] as number) / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 5. Table: Tabular data display
// ============================================================================

export interface TableColumn {
  key: string;
  label: string;
  width?: string;
  format?: (value: any) => string;
}

export interface TableProps extends BaseWidgetProps {
  data: Record<string, any>[];
  columns: TableColumn[];
  sortable?: boolean;
  filterable?: boolean;
  pagination?: boolean;
  pageSize?: number;
}

export const Table: React.FC<TableProps> = ({
  id,
  title,
  data,
  columns,
  sortable = true,
  filterable = true,
  pagination = true,
  pageSize = 10,
  isLoading = false,
  error,
  className,
  style,
}) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [page, setPage] = useState(0);

  const sortedData = sortKey
    ? [...data].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDesc ? -cmp : cmp;
      })
    : data;

  const paginatedData = pagination ? sortedData.slice(page * pageSize, (page + 1) * pageSize) : sortedData;

  return (
    <div
      className={classNames('table', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 500 }}>{title}</h3>

      {error ? (
        <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>
      ) : isLoading ? (
        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#9ca3af' }}>Loading data...</div>
        </div>
      ) : (
        <>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
              backgroundColor: 'white',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => {
                      if (sortable) {
                        setSortKey(sortKey === col.key ? null : col.key);
                        if (sortKey === col.key) setSortDesc(!sortDesc);
                      }
                    }}
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      fontWeight: 500,
                      color: '#374151',
                      width: col.width,
                      cursor: sortable ? 'pointer' : 'default',
                      userSelect: 'none',
                    }}
                  >
                    {col.label}
                    {sortable && sortKey === col.key && (
                      <span style={{ marginLeft: '4px' }}>
                        {sortDesc ? '↓' : '↑'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: '12px', color: '#111827' }}>
                      {col.format ? col.format(row[col.key]) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {pagination && (
            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, sortedData.length)} of{' '}
                {sortedData.length}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                    backgroundColor: page === 0 ? '#f3f4f6' : '#ffffff',
                    cursor: page === 0 ? 'default' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={(page + 1) * pageSize >= sortedData.length}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                    backgroundColor: (page + 1) * pageSize >= sortedData.length ? '#f3f4f6' : '#ffffff',
                    cursor: (page + 1) * pageSize >= sortedData.length ? 'default' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ============================================================================
// 6-10. Simplified components for remaining widget types
// ============================================================================

export interface HeatmapProps extends BaseWidgetProps {
  data: number[][];
  labels?: { x: string[]; y: string[] };
  colorScale?: string[];
}

export const Heatmap: React.FC<HeatmapProps> = ({
  title,
  data,
  labels,
  isLoading,
  error,
  className,
  style,
}) => (
  <div className={classNames('heatmap', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
    style={{
      padding: '20px',
      borderRadius: '8px',
      backgroundColor: '#f9fafb',
      border: '1px solid #e5e7eb',
      ...style,
    }}>
    <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
    {error ? <div style={{ color: '#ef4444' }}>{error}</div> : (
      <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#9ca3af' }}>Heatmap visualization ({data.length}x{data[0]?.length || 0})</div>
      </div>
    )}
  </div>
);

export interface GaugeProps extends BaseWidgetProps {
  value: number;
  min?: number;
  max?: number;
  unit?: string;
}

export const Gauge: React.FC<GaugeProps> = ({
  title,
  value,
  min = 0,
  max = 100,
  unit = '',
  isLoading,
  error,
  className,
  style,
}) => {
  const percentage = ((value - (min || 0)) / ((max || 100) - (min || 0))) * 100;

  return (
    <div className={classNames('gauge', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}>
      <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
      {error ? <div style={{ color: '#ef4444' }}>{error}</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <svg width="150" height="150" viewBox="0 0 150 150">
            <path d="M 30 120 A 60 60 0 0 1 120 120" stroke="#e5e7eb" strokeWidth="8" fill="none" />
            <path d="M 30 120 A 60 60 0 0 1 120 120" stroke="#3b82f6" strokeWidth="8" fill="none"
              strokeDasharray={`${(180 * percentage) / 100} 565`} />
            <text x="75" y="110" textAnchor="middle" fontSize="18" fontWeight="bold">{value}{unit}</text>
          </svg>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#6b7280' }}>
            {percentage.toFixed(0)}% of {max}{unit}
          </div>
        </div>
      )}
    </div>
  );
};

export interface TrendIndicatorProps extends BaseWidgetProps {
  value: number;
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  metric: string;
}

export const TrendIndicator: React.FC<TrendIndicatorProps> = ({
  title,
  value,
  direction,
  changePercent,
  metric,
  isLoading,
  error,
  className,
  style,
}) => {
  const arrow = direction === 'up' ? '↗️' : direction === 'down' ? '↘️' : '→';
  const color = direction === 'up' ? '#10b981' : direction === 'down' ? '#ef4444' : '#6b7280';

  return (
    <div className={classNames('trend', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}>
      <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
      {error ? <div style={{ color: '#ef4444' }}>{error}</div> : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '24px' }}>{arrow}</div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{value}</div>
            <div style={{ fontSize: '12px', color }}>
              {changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}% {metric}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export interface InsightPanelProps extends BaseWidgetProps {
  insights: Array<{
    type: string;
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

export const InsightPanel: React.FC<InsightPanelProps> = ({
  title,
  insights,
  isLoading,
  error,
  className,
  style,
}) => {
  const severityColor = (severity: string) => {
    switch (severity) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      default: return '#3b82f6';
    }
  };

  return (
    <div className={classNames('insight-panel', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}>
      <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
      {error ? <div style={{ color: '#ef4444' }}>{error}</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {insights.map((insight, i) => (
            <div key={i} style={{
              padding: '12px',
              backgroundColor: 'white',
              borderLeft: `4px solid ${severityColor(insight.severity)}`,
              borderRadius: '4px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: severityColor(insight.severity) }}>
                {insight.type.toUpperCase()}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginTop: '4px' }}>{insight.title}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{insight.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export interface ForecastChartProps extends BaseWidgetProps {
  historicalData: ChartDataPoint[];
  forecastData: ChartDataPoint[];
  xKey: string;
  yKey: string;
  confidenceInterval?: number;
}

export const ForecastChart: React.FC<ForecastChartProps> = ({
  title,
  historicalData,
  forecastData,
  xKey,
  yKey,
  confidenceInterval = 95,
  isLoading,
  error,
  className,
  style,
}) => {
  return (
    <div className={classNames('forecast', { 'is-loading': isLoading, 'has-error': error, [className]: className })}
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        ...style,
      }}>
      <h3 style={{ margin: '0 0 12px 0' }}>{title}</h3>
      {error ? <div style={{ color: '#ef4444' }}>{error}</div> : (
        <div style={{ height: '300px', display: 'flex', flexDirection: 'column' }}>
          <svg width="100%" height="100%" style={{ flex: 1 }}>
            {/* Historical data line */}
            <polyline
              points={historicalData
                .map((d, i) => {
                  const x = (i / Math.max(historicalData.length - 1, 1)) * 80 + 5;
                  const y = 85;
                  return `${x}%,${y}%`;
                })
                .join(' ')}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
            />
            {/* Forecast line */}
            <polyline
              points={forecastData
                .map((d, i) => {
                  const x = (80 + (i / Math.max(forecastData.length - 1, 1)) * 15);
                  const y = 85;
                  return `${x}%,${y}%`;
                })
                .join(' ')}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeDasharray="4"
            />
            {/* Divider line */}
            <line x1="80%" y1="5%" x2="80%" y2="95%" stroke="#9ca3af" strokeDasharray="2" />
            <text x="77%" y="2%" textAnchor="end" fontSize="11" fill="#6b7280">Now</text>
          </svg>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#9ca3af' }}>
            {historicalData.length} historical, {forecastData.length} forecast points ({confidenceInterval}% CI)
          </div>
        </div>
      )}
    </div>
  );
};

export default {
  MetricCard,
  LineChart,
  BarChart,
  PieChart,
  Table,
  Heatmap,
  Gauge,
  TrendIndicator,
  InsightPanel,
  ForecastChart,
};
