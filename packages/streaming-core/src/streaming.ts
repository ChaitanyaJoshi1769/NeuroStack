import pino from 'pino';
import { EventEmitter } from 'events';
import { generateId } from '@neurostack/shared';

/**
 * Streaming Core Types
 */

export interface StreamMessage<T = any> {
  id: string;
  type: MessageType;
  channel: string;
  data: T;
  timestamp: Date;
  sequence?: number; // For message ordering
}

export enum MessageType {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  PUBLISH = 'publish',
  ACK = 'ack',
  ERROR = 'error',
  HEARTBEAT = 'heartbeat',
}

export interface SubscriptionFilter {
  channels: string[];
  tenantId: string;
  userId?: string;
  filters?: Record<string, any>;
}

export interface StreamConnection {
  id: string;
  tenantId: string;
  userId?: string;
  connectedAt: Date;
  lastHeartbeat: Date;
  subscriptions: Set<string>;
  messageQueue: StreamMessage[];
}

export interface StreamStats {
  totalConnections: number;
  activeConnections: number;
  totalMessages: number;
  messagesPerSecond: number;
  averageLatency: number;
  connectionErrors: number;
}

/**
 * Event-driven streaming system
 */
export class StreamingCore extends EventEmitter {
  private logger = pino();
  private connections: Map<string, StreamConnection> = new Map();
  private subscribers: Map<string, Set<string>> = new Map(); // channel -> connectionIds
  private messageSequence: number = 0;
  private messageHistory: StreamMessage[] = [];
  private readonly maxHistorySize = 10000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalMessages: 0,
    totalConnections: 0,
    connectionErrors: 0,
    lastStatsReset: Date.now(),
  };

  constructor(private options = { heartbeatIntervalMs: 30000, maxQueueSize: 1000 }) {
    super();
    this.startHeartbeat();
    this.startStatsCollection();
  }

  /**
   * Create new connection
   */
  createConnection(tenantId: string, userId?: string): StreamConnection {
    const connection: StreamConnection = {
      id: generateId(),
      tenantId,
      userId,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      subscriptions: new Set(),
      messageQueue: [],
    };

    this.connections.set(connection.id, connection);
    this.stats.totalConnections++;

    this.logger.info(
      { connectionId: connection.id, tenantId, userId },
      'Connection created'
    );

    this.emit('connection:created', connection);
    return connection;
  }

  /**
   * Close connection
   */
  closeConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    // Unsubscribe from all channels
    for (const channel of connection.subscriptions) {
      this.unsubscribe(connectionId, channel);
    }

    this.connections.delete(connectionId);

    this.logger.info({ connectionId }, 'Connection closed');
    this.emit('connection:closed', connection);

    return true;
  }

  /**
   * Subscribe to channel
   */
  subscribe(connectionId: string, channel: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    connection.subscriptions.add(channel);

    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(connectionId);

    this.logger.debug({ connectionId, channel }, 'Subscription created');
    this.emit('subscription:created', { connectionId, channel });

    return true;
  }

  /**
   * Unsubscribe from channel
   */
  unsubscribe(connectionId: string, channel: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    connection.subscriptions.delete(channel);

    const subs = this.subscribers.get(channel);
    if (subs) {
      subs.delete(connectionId);
      if (subs.size === 0) {
        this.subscribers.delete(channel);
      }
    }

    this.logger.debug({ connectionId, channel }, 'Subscription removed');
    return true;
  }

  /**
   * Publish message to channel
   */
  async publish<T>(channel: string, data: T, tenantId?: string): Promise<StreamMessage<T>> {
    const message: StreamMessage<T> = {
      id: generateId(),
      type: MessageType.PUBLISH,
      channel,
      data,
      timestamp: new Date(),
      sequence: ++this.messageSequence,
    };

    // Store in history
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    // Route to subscribers
    const subscribers = this.subscribers.get(channel);
    if (subscribers && subscribers.size > 0) {
      const recipientConnections: string[] = [];

      for (const connectionId of subscribers) {
        const connection = this.connections.get(connectionId);
        if (!connection) continue;

        // Filter by tenant if specified
        if (tenantId && connection.tenantId !== tenantId) continue;

        // Queue message
        if (connection.messageQueue.length < this.options.maxQueueSize) {
          connection.messageQueue.push(message);
          recipientConnections.push(connectionId);
        } else {
          this.logger.warn(
            { connectionId, queueSize: connection.messageQueue.length },
            'Message queue full - dropping message'
          );
          this.stats.connectionErrors++;
        }
      }

      this.stats.totalMessages++;

      this.logger.debug(
        {
          channel,
          messageId: message.id,
          recipientCount: recipientConnections.length,
        },
        'Message published'
      );

      this.emit('message:published', {
        message,
        recipients: recipientConnections,
      });
    }

    return message;
  }

  /**
   * Get pending messages for connection
   */
  getMessages(connectionId: string, limit: number = 100): StreamMessage[] {
    const connection = this.connections.get(connectionId);
    if (!connection) return [];

    const messages = connection.messageQueue.splice(0, limit);
    return messages;
  }

  /**
   * Acknowledge message (remove from queue)
   */
  acknowledgeMessage(connectionId: string, messageId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    const index = connection.messageQueue.findIndex((m) => m.id === messageId);
    if (index === -1) return false;

    connection.messageQueue.splice(index, 1);
    return true;
  }

  /**
   * Get message history for channel
   */
  getMessageHistory(channel: string, limit: number = 100): StreamMessage[] {
    return this.messageHistory
      .filter((m) => m.channel === channel)
      .slice(-limit);
  }

  /**
   * Get connection stats
   */
  getStats(): StreamStats {
    const now = Date.now();
    const elapsedSeconds = (now - this.stats.lastStatsReset) / 1000;

    const activeConnections = Array.from(this.connections.values()).filter(
      (c) => Date.now() - c.lastHeartbeat.getTime() < 60000 // Active if heartbeat < 60s ago
    );

    return {
      totalConnections: this.stats.totalConnections,
      activeConnections: activeConnections.length,
      totalMessages: this.stats.totalMessages,
      messagesPerSecond: this.stats.totalMessages / Math.max(elapsedSeconds, 1),
      averageLatency: this.calculateAverageLatency(),
      connectionErrors: this.stats.connectionErrors,
    };
  }

  /**
   * Get connection details
   */
  getConnection(connectionId: string): StreamConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all connections for tenant
   */
  getTenantConnections(tenantId: string): StreamConnection[] {
    return Array.from(this.connections.values()).filter((c) => c.tenantId === tenantId);
  }

  /**
   * Get all subscribers for channel
   */
  getChannelSubscribers(channel: string): StreamConnection[] {
    const subs = this.subscribers.get(channel);
    if (!subs) return [];

    return Array.from(subs)
      .map((id) => this.connections.get(id))
      .filter((c) => !!c) as StreamConnection[];
  }

  /**
   * Shutdown streaming system
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    // Close all connections
    const connectionIds = Array.from(this.connections.keys());
    for (const id of connectionIds) {
      this.closeConnection(id);
    }

    this.removeAllListeners();
    this.logger.info('Streaming system shutdown');
  }

  // Private helper methods

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const staleThreshold = 90000; // 90 seconds

      for (const connection of this.connections.values()) {
        const age = now.getTime() - connection.lastHeartbeat.getTime();

        if (age > staleThreshold) {
          this.logger.warn(
            { connectionId: connection.id, age },
            'Connection stale - closing'
          );
          this.closeConnection(connection.id);
        } else {
          // Update heartbeat
          connection.lastHeartbeat = new Date();
        }
      }
    }, this.options.heartbeatIntervalMs);
  }

  private startStatsCollection(): void {
    this.statsInterval = setInterval(() => {
      const stats = this.getStats();
      this.logger.debug(
        {
          activeConnections: stats.activeConnections,
          messagesPerSecond: stats.messagesPerSecond.toFixed(2),
          averageLatency: stats.averageLatency.toFixed(2),
        },
        'Streaming statistics'
      );
    }, 60000); // Every minute
  }

  private calculateAverageLatency(): number {
    if (this.messageHistory.length === 0) return 0;

    const recentMessages = this.messageHistory.slice(-1000);
    const now = Date.now();

    const latencies = recentMessages.map((m) => now - m.timestamp.getTime());
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    return avgLatency;
  }
}

export default StreamingCore;
