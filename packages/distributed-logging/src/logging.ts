import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Distributed Logging Types
 */

export interface LogEntry {
  logId: string;
  timestamp: Date;
  nodeId: string;
  service: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  context: Record<string, any>;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  duration?: number; // milliseconds
  error?: ErrorInfo;
  tags: string[];
  userId?: string;
  requestId?: string;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack?: string;
  code?: string;
}

export interface LogStream {
  streamId: string;
  nodeId: string;
  service: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'closed';
  logCount: number;
  errorCount: number;
}

export interface LogQuery {
  queryId: string;
  filters: LogFilter[];
  startTime: Date;
  endTime: Date;
  limit: number;
  offset: number;
}

export interface LogFilter {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'greater_than' | 'less_than';
  value: any;
}

export interface LogStats {
  totalLogs: number;
  logsByLevel: Record<string, number>;
  logsByService: Record<string, number>;
  logsByNode: Record<string, number>;
  errorCount: number;
  errorRate: number; // percentage
  averageResponseTime: number; // ms
  p95ResponseTime: number; // ms
  p99ResponseTime: number; // ms
}

export interface DistributedTrace {
  traceId: string;
  rootSpanId: string;
  startTime: Date;
  endTime: Date;
  duration: number; // ms
  spans: TraceSpan[];
  status: 'success' | 'failure';
  nodeCount: number;
  serviceCount: number;
}

export interface TraceSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  duration: number; // ms
  nodeId: string;
  service: string;
  tags: Record<string, any>;
  logs: LogEntry[];
  status: 'ok' | 'error';
}

export interface MetricsSnapshot {
  snapshotId: string;
  timestamp: Date;
  nodeId: string;
  service: string;
  cpuUsagePercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  diskUsageMB: number;
  networkInMBps: number;
  networkOutMBps: number;
  requestsPerSecond: number;
  errorRate: number;
}

/**
 * Distributed Logger
 *
 * Comprehensive logging and observability:
 * - Centralized log collection across nodes
 * - Structured logging with context tracking
 * - Distributed tracing with span correlation
 * - Log query and search capabilities
 * - Performance metrics collection
 * - Error tracking and aggregation
 * - Request tracing across services
 * - Log aggregation and analysis
 * - Sampling for high-volume scenarios
 * - Retention policy management
 */
export class DistributedLogger {
  private logger = pino();
  private logs: Map<string, LogEntry> = new Map();
  private streams: Map<string, LogStream> = new Map();
  private traces: Map<string, DistributedTrace> = new Map();
  private spans: Map<string, TraceSpan> = new Map();
  private metrics: Map<string, MetricsSnapshot> = new Map();
  private readonly maxLogs = 10000000;
  private readonly maxTraces = 100000;
  private readonly samplingRate = 0.1; // 10% default sampling

  constructor() {
    this.logger.info('DistributedLogger initialized');
  }

  /**
   * Log an entry
   */
  log(
    nodeId: string,
    service: string,
    level: LogEntry['level'],
    message: string,
    context: Record<string, any> = {},
    options?: {
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
      duration?: number;
      userId?: string;
      requestId?: string;
      tags?: string[];
      error?: ErrorInfo;
    }
  ): LogEntry {
    const logId = generateId();

    const logEntry: LogEntry = {
      logId,
      timestamp: new Date(),
      nodeId,
      service,
      level,
      message,
      context,
      traceId: options?.traceId,
      spanId: options?.spanId,
      parentSpanId: options?.parentSpanId,
      duration: options?.duration,
      error: options?.error,
      tags: options?.tags || [],
      userId: options?.userId,
      requestId: options?.requestId,
    };

    this.logs.set(logId, logEntry);

    // Maintain size limit
    if (this.logs.size > this.maxLogs) {
      const oldestKey = this.logs.keys().next().value;
      this.logs.delete(oldestKey);
    }

    // Update stream
    this.updateStream(nodeId, service);

    // Track trace if present
    if (options?.traceId) {
      this.updateTrace(options.traceId, nodeId, service);
    }

    return logEntry;
  }

  /**
   * Start distributed trace
   */
  startTrace(
    nodeId: string,
    service: string,
    operationName: string
  ): DistributedTrace {
    const traceId = generateId();
    const rootSpanId = generateId();

    const trace: DistributedTrace = {
      traceId,
      rootSpanId,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      spans: [],
      status: 'success',
      nodeCount: 1,
      serviceCount: 1,
    };

    const span: TraceSpan = {
      spanId: rootSpanId,
      traceId,
      operationName,
      startTime: new Date(),
      duration: 0,
      nodeId,
      service,
      tags: {},
      logs: [],
      status: 'ok',
    };

    this.traces.set(traceId, trace);
    this.spans.set(rootSpanId, span);
    trace.spans.push(span);

    // Maintain size limit
    if (this.traces.size > this.maxTraces) {
      const oldestKey = this.traces.keys().next().value;
      this.traces.delete(oldestKey);
    }

    return trace;
  }

  /**
   * Add span to trace
   */
  addSpan(
    traceId: string,
    parentSpanId: string,
    nodeId: string,
    service: string,
    operationName: string
  ): TraceSpan | null {
    const trace = this.traces.get(traceId);

    if (!trace) {
      return null;
    }

    const spanId = generateId();

    const span: TraceSpan = {
      spanId,
      traceId,
      parentSpanId,
      operationName,
      startTime: new Date(),
      duration: 0,
      nodeId,
      service,
      tags: {},
      logs: [],
      status: 'ok',
    };

    this.spans.set(spanId, span);
    trace.spans.push(span);

    // Update trace node/service count
    const nodes = new Set(trace.spans.map((s) => s.nodeId));
    const services = new Set(trace.spans.map((s) => s.service));
    trace.nodeCount = nodes.size;
    trace.serviceCount = services.size;

    return span;
  }

  /**
   * End trace
   */
  endTrace(traceId: string, duration: number): boolean {
    const trace = this.traces.get(traceId);

    if (!trace) {
      return false;
    }

    trace.endTime = new Date();
    trace.duration = duration;

    for (const span of trace.spans) {
      if (span.spanId === trace.rootSpanId) {
        span.duration = duration;
      }
    }

    this.logger.debug(
      {
        traceId,
        duration,
        spanCount: trace.spans.length,
        nodeCount: trace.nodeCount,
      },
      'Trace completed'
    );

    return true;
  }

  /**
   * Record span duration
   */
  recordSpanDuration(spanId: string, duration: number): boolean {
    const span = this.spans.get(spanId);

    if (!span) {
      return false;
    }

    span.duration = duration;

    return true;
  }

  /**
   * Query logs
   */
  queryLogs(
    filters: LogFilter[],
    startTime: Date,
    endTime: Date,
    limit: number = 1000
  ): LogEntry[] {
    const results: LogEntry[] = [];

    for (const logEntry of this.logs.values()) {
      if (
        logEntry.timestamp < startTime ||
        logEntry.timestamp > endTime
      ) {
        continue;
      }

      if (this.matchesFilters(logEntry, filters)) {
        results.push(logEntry);
      }

      if (results.length >= limit) {
        break;
      }
    }

    return results.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Get log statistics
   */
  getLogStats(): LogStats {
    const stats: LogStats = {
      totalLogs: this.logs.size,
      logsByLevel: {},
      logsByService: {},
      logsByNode: {},
      errorCount: 0,
      errorRate: 0,
      averageResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
    };

    const responseTimes: number[] = [];

    for (const log of this.logs.values()) {
      // Count by level
      stats.logsByLevel[log.level] = (stats.logsByLevel[log.level] || 0) + 1;

      // Count by service
      stats.logsByService[log.service] =
        (stats.logsByService[log.service] || 0) + 1;

      // Count by node
      stats.logsByNode[log.nodeId] = (stats.logsByNode[log.nodeId] || 0) + 1;

      // Count errors
      if (log.level === 'error' || log.level === 'fatal') {
        stats.errorCount++;
      }

      // Collect response times
      if (log.duration) {
        responseTimes.push(log.duration);
      }
    }

    stats.errorRate =
      this.logs.size > 0 ? (stats.errorCount / this.logs.size) * 100 : 0;

    if (responseTimes.length > 0) {
      responseTimes.sort((a, b) => a - b);

      stats.averageResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      stats.p95ResponseTime =
        responseTimes[Math.floor(responseTimes.length * 0.95)];

      stats.p99ResponseTime =
        responseTimes[Math.floor(responseTimes.length * 0.99)];
    }

    return stats;
  }

  /**
   * Get trace details
   */
  getTrace(traceId: string): DistributedTrace | null {
    return this.traces.get(traceId) || null;
  }

  /**
   * Get error logs
   */
  getErrorLogs(
    startTime: Date,
    endTime: Date,
    limit: number = 1000
  ): LogEntry[] {
    const errors: LogEntry[] = [];

    for (const log of this.logs.values()) {
      if (
        (log.level === 'error' || log.level === 'fatal') &&
        log.timestamp >= startTime &&
        log.timestamp <= endTime
      ) {
        errors.push(log);

        if (errors.length >= limit) {
          break;
        }
      }
    }

    return errors.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Record metrics snapshot
   */
  recordMetrics(
    nodeId: string,
    service: string,
    metrics: Omit<MetricsSnapshot, 'snapshotId' | 'timestamp' | 'nodeId' | 'service'>
  ): MetricsSnapshot {
    const snapshot: MetricsSnapshot = {
      snapshotId: generateId(),
      timestamp: new Date(),
      nodeId,
      service,
      ...metrics,
    };

    this.metrics.set(snapshot.snapshotId, snapshot);

    return snapshot;
  }

  /**
   * Get metrics for service
   */
  getServiceMetrics(
    service: string,
    startTime: Date,
    endTime: Date
  ): MetricsSnapshot[] {
    const serviceMetrics: MetricsSnapshot[] = [];

    for (const metric of this.metrics.values()) {
      if (
        metric.service === service &&
        metric.timestamp >= startTime &&
        metric.timestamp <= endTime
      ) {
        serviceMetrics.push(metric);
      }
    }

    return serviceMetrics.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  /**
   * Cleanup old logs
   */
  cleanupOldLogs(retentionDays: number = 30): number {
    let removedCount = 0;
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const [logId, log] of this.logs.entries()) {
      if (log.timestamp.getTime() < cutoffTime) {
        this.logs.delete(logId);
        removedCount++;
      }
    }

    this.logger.info({ removedCount }, 'Old logs cleaned up');
    return removedCount;
  }

  /**
   * Export logs for analysis
   */
  exportLogs(
    startTime: Date,
    endTime: Date,
    format: 'json' | 'csv' = 'json'
  ): string {
    const logs = Array.from(this.logs.values()).filter(
      (l) => l.timestamp >= startTime && l.timestamp <= endTime
    );

    if (format === 'csv') {
      const headers = [
        'LogId',
        'Timestamp',
        'NodeId',
        'Service',
        'Level',
        'Message',
      ];

      const rows = logs.map((l) => [
        l.logId,
        l.timestamp.toISOString(),
        l.nodeId,
        l.service,
        l.level,
        l.message,
      ]);

      return [
        headers.join(','),
        ...rows.map((r) => r.map((v) => `"${v}"`).join(',')),
      ].join('\n');
    }

    return JSON.stringify(logs, null, 2);
  }

  // Private methods

  private updateStream(nodeId: string, service: string): void {
    const streamId = `${nodeId}:${service}`;

    if (!this.streams.has(streamId)) {
      this.streams.set(streamId, {
        streamId,
        nodeId,
        service,
        startTime: new Date(),
        status: 'active',
        logCount: 0,
        errorCount: 0,
      });
    }

    const stream = this.streams.get(streamId)!;
    stream.logCount++;
  }

  private updateTrace(
    traceId: string,
    nodeId: string,
    service: string
  ): void {
    const trace = this.traces.get(traceId);

    if (trace) {
      const nodes = new Set(trace.spans.map((s) => s.nodeId));
      const services = new Set(trace.spans.map((s) => s.service));

      nodes.add(nodeId);
      services.add(service);

      trace.nodeCount = nodes.size;
      trace.serviceCount = services.size;
    }
  }

  private matchesFilters(log: LogEntry, filters: LogFilter[]): boolean {
    for (const filter of filters) {
      const value = (log as any)[filter.field];

      switch (filter.operator) {
        case 'equals':
          if (value !== filter.value) return false;
          break;

        case 'contains':
          if (!String(value).includes(filter.value)) return false;
          break;

        case 'regex':
          if (!new RegExp(filter.value).test(String(value))) return false;
          break;

        case 'greater_than':
          if (!(value > filter.value)) return false;
          break;

        case 'less_than':
          if (!(value < filter.value)) return false;
          break;
      }
    }

    return true;
  }
}

export default DistributedLogger;
