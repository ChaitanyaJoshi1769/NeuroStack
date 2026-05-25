import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';

/**
 * Dashboard Container Component
 */

export interface DashboardWidget {
  id: string;
  component: ReactNode;
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface DashboardConfig {
  id: string;
  name: string;
  columns: number;
  rowHeight: number;
  gap: number;
  responsive: boolean;
  widgets: DashboardWidget[];
}

export interface DashboardProps {
  config: DashboardConfig;
  isLoading?: boolean;
  error?: string;
  onWidgetRemove?: (widgetId: string) => void;
  onWidgetMove?: (widgetId: string, row: number, col: number) => void;
  onRefresh?: () => Promise<void>;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Dashboard Grid System
 *
 * - Responsive 12-column grid
 * - Variable row heights
 * - Configurable gap between widgets
 * - Real-time data binding support
 * - Drag-and-drop ready structure
 */
export const Dashboard: React.FC<DashboardProps> = ({
  config,
  isLoading = false,
  error,
  onWidgetRemove,
  onWidgetMove,
  onRefresh,
  className,
  style,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  // Calculate grid dimensions
  const maxRow = Math.max(...config.widgets.map((w) => w.row + w.height), 1);
  const totalHeight = maxRow * config.rowHeight + (maxRow - 1) * config.gap;

  return (
    <div
      className={classNames('dashboard', {
        'is-loading': isLoading,
        'has-error': error,
        [className]: className,
      })}
      style={{
        padding: '24px',
        backgroundColor: '#ffffff',
        ...style,
      }}
    >
      {/* Dashboard Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          paddingBottom: '16px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div>
          <h1 style={{ margin: '0', fontSize: '24px', fontWeight: 700 }}>{config.name}</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
            {config.widgets.length} widgets
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isRefreshing ? 'default' : 'pointer',
              opacity: isRefreshing ? 0.6 : 1,
            }}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            color: '#991b1b',
            marginBottom: '16px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            color: '#9ca3af',
          }}
        >
          <div style={{ fontSize: '14px', marginBottom: '12px' }}>Loading dashboard...</div>
          <div style={{ fontSize: '12px' }}>Please wait while we fetch the latest data</div>
        </div>
      )}

      {/* Grid Container */}
      {!isLoading && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: `${totalHeight}px`,
          }}
        >
          {config.widgets.map((widget) => (
            <DashboardWidgetContainer
              key={widget.id}
              widget={widget}
              rowHeight={config.rowHeight}
              gap={config.gap}
              columns={config.columns}
              onRemove={onWidgetRemove}
              onMove={onWidgetMove}
            >
              {widget.component}
            </DashboardWidgetContainer>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && config.widgets.length === 0 && (
        <div
          style={{
            padding: '64px 32px',
            textAlign: 'center',
            color: '#9ca3af',
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>No widgets yet</div>
          <div style={{ fontSize: '14px' }}>Add widgets to get started with your dashboard</div>
        </div>
      )}
    </div>
  );
};

/**
 * Dashboard Widget Container with positioning
 */
interface DashboardWidgetContainerProps {
  widget: DashboardWidget;
  rowHeight: number;
  gap: number;
  columns: number;
  onRemove?: (widgetId: string) => void;
  onMove?: (widgetId: string, row: number, col: number) => void;
  children: ReactNode;
}

const DashboardWidgetContainer: React.FC<DashboardWidgetContainerProps> = ({
  widget,
  rowHeight,
  gap,
  columns,
  onRemove,
  onMove,
  children,
}) => {
  const colWidth = 100 / columns;
  const x = (widget.col / columns) * 100;
  const y = widget.row * rowHeight + widget.row * gap;
  const width = (widget.width / columns) * 100;
  const height = widget.height * rowHeight + (widget.height - 1) * gap;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}px`,
        width: `${width}%`,
        height: `${height}px`,
        padding: `${gap / 2}px`,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          backgroundColor: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Widget Controls */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            gap: '4px',
            zIndex: 10,
          }}
        >
          {onRemove && (
            <button
              onClick={() => onRemove(widget.id)}
              title="Remove widget"
              style={{
                width: '24px',
                height: '24px',
                padding: '0',
                backgroundColor: '#ffffff',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#6b7280',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Widget Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
};

/**
 * Dashboard Builder Helper
 */
export interface DashboardBuilderOptions {
  name: string;
  columns?: number;
  rowHeight?: number;
  gap?: number;
  responsive?: boolean;
}

export class DashboardBuilder {
  private config: DashboardConfig;
  private widgets: DashboardWidget[] = [];

  constructor(id: string, options: DashboardBuilderOptions) {
    this.config = {
      id,
      name: options.name,
      columns: options.columns || 12,
      rowHeight: options.rowHeight || 300,
      gap: options.gap || 16,
      responsive: options.responsive !== false,
      widgets: [],
    };
  }

  addWidget(widget: DashboardWidget): this {
    this.widgets.push(widget);
    return this;
  }

  addWidgets(widgets: DashboardWidget[]): this {
    this.widgets.push(...widgets);
    return this;
  }

  /**
   * Auto-layout widgets in a grid
   */
  autoLayout(): this {
    let row = 0;
    let col = 0;

    const sortedWidgets = [...this.widgets].sort((a, b) => {
      // Sort by importance/size (larger widgets first)
      return b.width * b.height - a.width * a.height;
    });

    for (const widget of sortedWidgets) {
      // Check if widget fits in current row
      if (col + widget.width > this.config.columns) {
        row++;
        col = 0;
      }

      widget.row = row;
      widget.col = col;
      col += widget.width;
    }

    this.config.widgets = this.widgets;
    return this;
  }

  /**
   * Build the dashboard configuration
   */
  build(): DashboardConfig {
    return {
      ...this.config,
      widgets: this.widgets,
    };
  }

  /**
   * Get dashboard configuration
   */
  getConfig(): DashboardConfig {
    return this.config;
  }
}

export default {
  Dashboard,
  DashboardBuilder,
};
