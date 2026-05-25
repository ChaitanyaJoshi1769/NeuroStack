import pino from 'pino';
import pinoHttp from 'pino-http';
import express, { Express, Request, Response } from 'express';
import { createServer as createHttpServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { StreamingCore, StreamMessage, MessageType } from '@neurostack/streaming-core';
import { generateId } from '@neurostack/shared';

/**
 * WebSocket Server Types
 */

export interface WebSocketServerConfig {
  port: number;
  host?: string;
  path?: string;
  maxConnections?: number;
  pingInterval?: number;
  maxBackpressure?: number;
}

export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channel?: string;
  channels?: string[];
  clientId?: string;
  requestId?: string;
}

export interface ServerStats {
  uptime: number;
  activeConnections: number;
  totalConnections: number;
  messagesSent: number;
  messagesReceived: number;
  averageLatency: number;
  errors: number;
}

/**
 * Production WebSocket Server
 *
 * Features:
 * - HTTP + WebSocket integration
 * - Automatic heartbeat/ping
 * - Message compression ready
 * - Error recovery
 * - Rate limiting ready
 * - Connection pooling
 * - Per-client subscriptions
 */
export class WebSocketServer {
  private logger = pino();
  private httpLogger = pinoHttp({ logger: this.logger });
  private app: Express;
  private httpServer: HttpServer;
  private wsServer: WebSocketServer<WebSocket>;
  private streaming: StreamingCore;
  private clients: Map<string, WebSocketClient> = new Map();
  private startTime: number = Date.now();
  private stats = {
    totalConnections: 0,
    messagesSent: 0,
    messagesReceived: 0,
    errors: 0,
  };

  constructor(private config: WebSocketServerConfig) {
    this.app = express();
    this.httpServer = createHttpServer(this.app);
    this.wsServer = new WebSocketServer({
      server: this.httpServer,
      path: config.path || '/ws',
      maxPayload: 100 * 1024 * 1024, // 100MB
    });
    this.streaming = new StreamingCore();

    this.setupExpress();
    this.setupWebSocket();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host || 'localhost', () => {
        this.logger.info(
          { port: this.config.port, host: this.config.host },
          'WebSocket server started'
        );
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all client connections
      for (const client of this.clients.values()) {
        client.close();
      }
      this.clients.clear();

      // Close streaming system
      this.streaming.shutdown();

      // Close HTTP server
      this.httpServer.close((err) => {
        if (err) {
          this.logger.error(err, 'Error closing server');
          reject(err);
        } else {
          this.logger.info('WebSocket server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Broadcast message to subscribers
   */
  async broadcast<T>(channel: string, data: T, tenantId?: string): Promise<void> {
    const message = await this.streaming.publish(channel, data, tenantId);
    this.broadcastToClients(message);
  }

  /**
   * Get server statistics
   */
  getStats(): ServerStats {
    return {
      uptime: Date.now() - this.startTime,
      activeConnections: this.clients.size,
      totalConnections: this.stats.totalConnections,
      messagesSent: this.stats.messagesSent,
      messagesReceived: this.stats.messagesReceived,
      averageLatency: this.calculateAverageLatency(),
      errors: this.stats.errors,
    };
  }

  // Private methods

  private setupExpress(): void {
    this.app.use(this.httpLogger);

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      const stats = this.getStats();
      res.json({
        status: 'ok',
        uptime: stats.uptime,
        activeConnections: stats.activeConnections,
        timestamp: new Date().toISOString(),
      });
    });

    // Server statistics endpoint
    this.app.get('/stats', (req: Request, res: Response) => {
      res.json(this.getStats());
    });

    // Streaming statistics endpoint
    this.app.get('/streaming-stats', (req: Request, res: Response) => {
      res.json(this.streaming.getStats());
    });

    // Publish endpoint (for HTTP clients)
    this.app.post('/publish', express.json(), async (req: Request, res: Response) => {
      try {
        const { channel, data, tenantId } = req.body;

        if (!channel || !data) {
          return res.status(400).json({ error: 'Missing channel or data' });
        }

        const message = await this.streaming.publish(channel, data, tenantId);
        this.broadcastToClients(message);

        res.json({
          success: true,
          messageId: message.id,
          recipients: Array.from(this.clients.keys()).length,
        });
      } catch (error) {
        this.logger.error(error, 'Error publishing message');
        res.status(500).json({ error: 'Failed to publish message' });
      }
    });

    // Subscribe endpoint (for HTTP clients)
    this.app.post('/subscribe', express.json(), (req: Request, res: Response) => {
      try {
        const { tenantId, channels, userId } = req.body;

        if (!tenantId || !channels || !Array.isArray(channels)) {
          return res.status(400).json({ error: 'Missing tenantId or channels' });
        }

        const connectionId = generateId();
        const connection = this.streaming.createConnection(tenantId, userId);

        for (const channel of channels) {
          this.streaming.subscribe(connection.id, channel);
        }

        res.json({
          connectionId: connection.id,
          channels,
          message: 'Use WebSocket for real-time updates',
        });
      } catch (error) {
        this.logger.error(error, 'Error subscribing');
        res.status(500).json({ error: 'Failed to subscribe' });
      }
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  private setupWebSocket(): void {
    this.wsServer.on('connection', (ws: WebSocket, request) => {
      const clientId = generateId();
      const client = new WebSocketClient(clientId, ws, this.streaming, this.logger);

      // Check connection limit
      if (this.config.maxConnections && this.clients.size >= this.config.maxConnections) {
        this.logger.warn({ clientId }, 'Connection limit reached');
        ws.close(1008, 'Server connection limit reached');
        this.stats.errors++;
        return;
      }

      this.clients.set(clientId, client);
      this.stats.totalConnections++;

      this.logger.info({ clientId, totalClients: this.clients.size }, 'Client connected');

      // Setup ping/pong for heartbeat
      const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      }, this.config.pingInterval || 30000);

      // Handle client messages
      ws.on('message', (data: Buffer) => {
        try {
          this.stats.messagesReceived++;
          const message: ClientMessage = JSON.parse(data.toString());
          client.handleMessage(message);
        } catch (error) {
          this.logger.error({ error, clientId }, 'Error handling client message');
          this.stats.errors++;
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Invalid message format',
          }));
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        clearInterval(pingInterval);
        client.close();
        this.clients.delete(clientId);
        this.logger.info({ clientId, remainingClients: this.clients.size }, 'Client disconnected');
      });

      // Handle errors
      ws.on('error', (error) => {
        this.logger.error({ error, clientId }, 'WebSocket error');
        this.stats.errors++;
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        clientId,
        serverTime: new Date().toISOString(),
        message: 'Connected to NeuroStack WebSocket server',
      }));
    });

    this.wsServer.on('error', (error) => {
      this.logger.error(error, 'WebSocket server error');
      this.stats.errors++;
    });
  }

  private broadcastToClients(message: StreamMessage): void {
    const payload = JSON.stringify({
      type: 'message',
      data: message,
    });

    let sentCount = 0;
    for (const client of this.clients.values()) {
      if (client.isSubscribedTo(message.channel)) {
        client.send(payload);
        sentCount++;
      }
    }

    this.stats.messagesSent += sentCount;

    if (sentCount > 0) {
      this.logger.debug(
        { channel: message.channel, recipients: sentCount },
        'Message broadcasted'
      );
    }
  }

  private calculateAverageLatency(): number {
    // In production, would track actual latencies
    // For now, return 0 as baseline
    return 0;
  }
}

/**
 * WebSocket Client Manager
 */
class WebSocketClient {
  private subscriptions: Set<string> = new Set();
  private lastMessageTime: number = Date.now();

  constructor(
    private clientId: string,
    private ws: WebSocket,
    private streaming: StreamingCore,
    private logger: pino.Logger
  ) {}

  handleMessage(message: ClientMessage): void {
    this.lastMessageTime = Date.now();

    switch (message.type) {
      case 'subscribe':
        if (message.channel) {
          this.subscribe(message.channel);
        } else if (message.channels) {
          for (const channel of message.channels) {
            this.subscribe(channel);
          }
        }
        break;

      case 'unsubscribe':
        if (message.channel) {
          this.unsubscribe(message.channel);
        }
        break;

      case 'ping':
        this.ws.send(JSON.stringify({ type: 'pong', requestId: message.requestId }));
        break;

      default:
        this.logger.warn({ type: message.type }, 'Unknown message type');
    }
  }

  private subscribe(channel: string): void {
    if (this.subscriptions.has(channel)) return;

    this.subscriptions.add(channel);
    this.logger.debug({ clientId: this.clientId, channel }, 'Subscribed');

    this.ws.send(JSON.stringify({
      type: 'subscribed',
      channel,
      message: `Subscribed to ${channel}`,
    }));
  }

  private unsubscribe(channel: string): void {
    if (!this.subscriptions.has(channel)) return;

    this.subscriptions.delete(channel);
    this.logger.debug({ clientId: this.clientId, channel }, 'Unsubscribed');

    this.ws.send(JSON.stringify({
      type: 'unsubscribed',
      channel,
      message: `Unsubscribed from ${channel}`,
    }));
  }

  isSubscribedTo(channel: string): boolean {
    return this.subscriptions.has(channel);
  }

  send(data: string): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(data);
    }
  }

  close(): void {
    this.subscriptions.clear();
  }
}

export default WebSocketServer;
