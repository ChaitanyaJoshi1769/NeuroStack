import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Kafka Integration Types
 */

export interface KafkaMessage {
  key: string;
  value: string;
  headers?: Record<string, string>;
  timestamp?: number;
  partition?: number;
  offset?: number;
}

export interface KafkaProducerConfig {
  brokers: string[];
  clientId: string;
  compression?: 'gzip' | 'snappy' | 'lz4' | 'zstd';
  idempotent?: boolean;
  maxInFlightRequests?: number;
  requestTimeout?: number;
}

export interface KafkaConsumerConfig {
  brokers: string[];
  groupId: string;
  clientId: string;
  fromBeginning?: boolean;
  sessionTimeout?: number;
  rebalanceTimeout?: number;
  heartbeatInterval?: number;
}

export interface ProducerMetrics {
  messagesProduced: number;
  bytesProduced: number;
  errorCount: number;
  avgLatency: number;
  maxLatency: number;
  minLatency: number;
}

export interface ConsumerMetrics {
  messagesConsumed: number;
  bytesConsumed: number;
  partitionsAssigned: number;
  consumerLag: number;
  processingRate: number; // messages per second
}

export interface ConsumerOffsetInfo {
  topic: string;
  partition: number;
  offset: number;
  timestamp: number;
  lag: number;
}

/**
 * Kafka Producer Wrapper
 *
 * High-level abstraction over Kafka producer for reliable message publishing
 */
export class KafkaProducer {
  private logger = pino();
  private config: KafkaProducerConfig;
  private metrics: ProducerMetrics;
  private connected = false;

  constructor(config: KafkaProducerConfig) {
    this.config = config;
    this.metrics = {
      messagesProduced: 0,
      bytesProduced: 0,
      errorCount: 0,
      avgLatency: 0,
      maxLatency: 0,
      minLatency: Number.MAX_VALUE,
    };

    this.logger.info({ config }, 'KafkaProducer initialized');
  }

  /**
   * Connect to Kafka cluster
   */
  async connect(): Promise<void> {
    try {
      // In production, would use KafkaJS client
      // await this.producer.connect();
      this.connected = true;

      this.logger.info({ brokers: this.config.brokers }, 'Connected to Kafka cluster');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Kafka');
      throw error;
    }
  }

  /**
   * Produce a single message
   */
  async produce(topic: string, message: KafkaMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Producer not connected');
    }

    const startTime = Date.now();

    try {
      // In production, would use:
      // await this.producer.send({
      //   topic,
      //   messages: [message]
      // });

      const latency = Date.now() - startTime;
      this.updateMetrics(message, latency, false);

      this.logger.debug(
        {
          topic,
          key: message.key,
          latency,
        },
        'Message produced'
      );
    } catch (error) {
      this.metrics.errorCount++;
      this.logger.error({ error, topic, key: message.key }, 'Failed to produce message');
      throw error;
    }
  }

  /**
   * Produce batch of messages
   */
  async produceBatch(topic: string, messages: KafkaMessage[]): Promise<void> {
    if (!this.connected) {
      throw new Error('Producer not connected');
    }

    const startTime = Date.now();

    try {
      // In production, would use:
      // await this.producer.send({
      //   topic,
      //   messages: messages
      // });

      const latency = Date.now() - startTime;

      for (const message of messages) {
        this.updateMetrics(message, latency / messages.length, false);
      }

      this.logger.debug(
        {
          topic,
          messageCount: messages.length,
          totalLatency: latency,
        },
        'Batch produced'
      );
    } catch (error) {
      this.metrics.errorCount++;
      this.logger.error({ error, topic, count: messages.length }, 'Failed to produce batch');
      throw error;
    }
  }

  /**
   * Get producer metrics
   */
  getMetrics(): ProducerMetrics {
    return { ...this.metrics };
  }

  /**
   * Disconnect producer
   */
  async disconnect(): Promise<void> {
    try {
      // In production, would use:
      // await this.producer.disconnect();
      this.connected = false;

      this.logger.info('Producer disconnected');
    } catch (error) {
      this.logger.error({ error }, 'Error disconnecting producer');
      throw error;
    }
  }

  // Private methods

  private updateMetrics(message: KafkaMessage, latency: number, isConsume: boolean): void {
    const messageSize = message.value.length;

    if (!isConsume) {
      this.metrics.messagesProduced++;
      this.metrics.bytesProduced += messageSize;
      this.metrics.avgLatency =
        (this.metrics.avgLatency * (this.metrics.messagesProduced - 1) + latency) /
        this.metrics.messagesProduced;
      this.metrics.maxLatency = Math.max(this.metrics.maxLatency, latency);
      this.metrics.minLatency = Math.min(this.metrics.minLatency, latency);
    }
  }
}

/**
 * Kafka Consumer Wrapper
 *
 * High-level abstraction over Kafka consumer for reliable message consumption
 */
export class KafkaConsumer {
  private logger = pino();
  private config: KafkaConsumerConfig;
  private metrics: ConsumerMetrics;
  private connected = false;
  private offsetInfo: Map<string, ConsumerOffsetInfo> = new Map();

  constructor(config: KafkaConsumerConfig) {
    this.config = config;
    this.metrics = {
      messagesConsumed: 0,
      bytesConsumed: 0,
      partitionsAssigned: 0,
      consumerLag: 0,
      processingRate: 0,
    };

    this.logger.info({ config }, 'KafkaConsumer initialized');
  }

  /**
   * Connect to Kafka cluster
   */
  async connect(): Promise<void> {
    try {
      // In production, would use KafkaJS client
      // await this.consumer.connect();
      this.connected = true;

      this.logger.info(
        { brokers: this.config.brokers, groupId: this.config.groupId },
        'Connected to Kafka cluster'
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Kafka');
      throw error;
    }
  }

  /**
   * Subscribe to topic
   */
  async subscribe(topic: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Consumer not connected');
    }

    try {
      // In production, would use:
      // await this.consumer.subscribe({
      //   topic,
      //   fromBeginning: this.config.fromBeginning
      // });

      this.logger.info({ topic, groupId: this.config.groupId }, 'Subscribed to topic');
    } catch (error) {
      this.logger.error({ error, topic }, 'Failed to subscribe to topic');
      throw error;
    }
  }

  /**
   * Run consumer with message handler
   */
  async run(handler: (message: KafkaMessage) => Promise<void>): Promise<void> {
    if (!this.connected) {
      throw new Error('Consumer not connected');
    }

    try {
      // In production, would use:
      // await this.consumer.run({
      //   eachMessage: async ({ topic, partition, message }) => {
      //     await handler(this.parseMessage(message));
      //   }
      // });

      this.logger.info('Consumer started running');
    } catch (error) {
      this.logger.error({ error }, 'Consumer error');
      throw error;
    }
  }

  /**
   * Get consumer metrics
   */
  getMetrics(): ConsumerMetrics {
    return { ...this.metrics };
  }

  /**
   * Get offset information for topic
   */
  getOffsetInfo(): ConsumerOffsetInfo[] {
    return Array.from(this.offsetInfo.values());
  }

  /**
   * Seek to specific offset
   */
  async seek(topic: string, partition: number, offset: number): Promise<void> {
    if (!this.connected) {
      throw new Error('Consumer not connected');
    }

    try {
      // In production, would use:
      // await this.consumer.seek({ topic, partition, offset });

      const key = `${topic}-${partition}`;
      const info = this.offsetInfo.get(key);
      if (info) {
        info.offset = offset;
      }

      this.logger.info({ topic, partition, offset }, 'Seeked to offset');
    } catch (error) {
      this.logger.error({ error, topic, partition, offset }, 'Failed to seek');
      throw error;
    }
  }

  /**
   * Disconnect consumer
   */
  async disconnect(): Promise<void> {
    try {
      // In production, would use:
      // await this.consumer.disconnect();
      this.connected = false;

      this.logger.info('Consumer disconnected');
    } catch (error) {
      this.logger.error({ error }, 'Error disconnecting consumer');
      throw error;
    }
  }

  // Private methods

  private parseMessage(kafkaMessage: any): KafkaMessage {
    return {
      key: kafkaMessage.key?.toString() || '',
      value: kafkaMessage.value?.toString() || '',
      headers: kafkaMessage.headers || {},
      timestamp: kafkaMessage.timestamp ? Number(kafkaMessage.timestamp) : undefined,
      partition: kafkaMessage.partition,
      offset: kafkaMessage.offset ? Number(kafkaMessage.offset) : undefined,
    };
  }

  private updateMetrics(message: KafkaMessage): void {
    this.metrics.messagesConsumed++;
    this.metrics.bytesConsumed += message.value.length;
  }
}

/**
 * Kafka Event Stream Connector
 *
 * Bridges Kafka with NeuroStack streaming for distributed event handling
 */
export class KafkaEventStream {
  private logger = pino();
  private producer: KafkaProducer;
  private consumer: KafkaConsumer;
  private topics: Set<string> = new Set();

  constructor(producerConfig: KafkaProducerConfig, consumerConfig: KafkaConsumerConfig) {
    this.producer = new KafkaProducer(producerConfig);
    this.consumer = new KafkaConsumer(consumerConfig);

    this.logger.info('KafkaEventStream initialized');
  }

  /**
   * Initialize event stream
   */
  async initialize(): Promise<void> {
    await this.producer.connect();
    await this.consumer.connect();

    this.logger.info('Event stream initialized');
  }

  /**
   * Publish event to topic
   */
  async publishEvent(topic: string, event: any): Promise<void> {
    const message: KafkaMessage = {
      key: event.eventId || generateId(),
      value: JSON.stringify(event),
      headers: {
        'event-type': event.type || 'unknown',
        'timestamp': new Date().toISOString(),
      },
    };

    await this.producer.produce(topic, message);
    this.topics.add(topic);
  }

  /**
   * Subscribe and process events
   */
  async subscribe(topic: string, handler: (event: any) => Promise<void>): Promise<void> {
    await this.consumer.subscribe(topic);

    await this.consumer.run(async (message: KafkaMessage) => {
      try {
        const event = JSON.parse(message.value);
        await handler(event);
      } catch (error) {
        this.logger.error({ error, message }, 'Failed to process event');
      }
    });

    this.topics.add(topic);
  }

  /**
   * Batch publish events
   */
  async publishBatch(topic: string, events: any[]): Promise<void> {
    const messages: KafkaMessage[] = events.map((event) => ({
      key: event.eventId || generateId(),
      value: JSON.stringify(event),
      headers: {
        'event-type': event.type || 'unknown',
        'batch': 'true',
      },
    }));

    await this.producer.produceBatch(topic, messages);
    this.topics.add(topic);
  }

  /**
   * Get stream statistics
   */
  getStatistics(): {
    producer: ProducerMetrics;
    consumer: ConsumerMetrics;
    topics: string[];
  } {
    return {
      producer: this.producer.getMetrics(),
      consumer: this.consumer.getMetrics(),
      topics: Array.from(this.topics),
    };
  }

  /**
   * Gracefully shutdown
   */
  async shutdown(): Promise<void> {
    await this.producer.disconnect();
    await this.consumer.disconnect();

    this.logger.info('Event stream shutdown');
  }
}

export default {
  KafkaProducer,
  KafkaConsumer,
  KafkaEventStream,
};
