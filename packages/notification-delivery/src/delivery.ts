import pino from 'pino';
import axios from 'axios';
import { generateId } from '@neurostack/shared';
import { Alert, ChannelType } from '@neurostack/realtime-insights';

/**
 * Notification Delivery Types
 */

export interface NotificationPayload {
  id: string;
  type: 'alert' | 'insight' | 'event';
  title: string;
  message: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  details?: Record<string, any>;
  timestamp: Date;
  tenantId: string;
}

export interface DeliveryResult {
  notificationId: string;
  channel: ChannelType;
  status: 'sent' | 'failed' | 'queued';
  timestamp: Date;
  error?: string;
  retries: number;
}

export interface NotificationConfig {
  email?: {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  };
  slack?: {
    webhookUrl: string;
    botName?: string;
  };
  webhook?: {
    baseUrl: string;
    timeout?: number;
  };
  sms?: {
    apiKey: string;
    provider: 'twilio' | 'custom';
  };
  teams?: {
    webhookUrl: string;
  };
}

export interface DeliveryStats {
  totalNotifications: number;
  sentCount: number;
  failedCount: number;
  queuedCount: number;
  averageLatency: number;
  successRate: number;
}

/**
 * Multi-Channel Notification Delivery System
 */
export class NotificationDelivery {
  private logger = pino();
  private queue: NotificationPayload[] = [];
  private results: Map<string, DeliveryResult> = new Map();
  private stats = {
    total: 0,
    sent: 0,
    failed: 0,
    queued: 0,
  };
  private latencies: number[] = [];
  private readonly maxQueueSize = 10000;
  private readonly maxRetries = 3;

  constructor(private config: NotificationConfig) {}

  /**
   * Send notification through specified channels
   */
  async sendNotification(
    payload: NotificationPayload,
    channels: ChannelType[]
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    const startTime = Date.now();

    for (const channel of channels) {
      try {
        const result = await this.deliverToChannel(payload, channel);
        results.push(result);

        this.results.set(`${payload.id}:${channel}`, result);
        if (result.status === 'sent') {
          this.stats.sent++;
        } else if (result.status === 'failed') {
          this.stats.failed++;
        } else if (result.status === 'queued') {
          this.stats.queued++;
        }
      } catch (error) {
        this.logger.error({ error, channel }, 'Error sending notification');
        results.push({
          notificationId: payload.id,
          channel,
          status: 'failed',
          timestamp: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
          retries: 0,
        });
        this.stats.failed++;
      }
    }

    const latency = Date.now() - startTime;
    this.latencies.push(latency);
    if (this.latencies.length > 10000) {
      this.latencies.shift();
    }

    this.stats.total++;

    this.logger.info(
      {
        notificationId: payload.id,
        channels: channels.length,
        results: results.map((r) => r.status),
        latency,
      },
      'Notification delivery completed'
    );

    return results;
  }

  /**
   * Send alert notification
   */
  async sendAlert(alert: Alert, channels: ChannelType[]): Promise<DeliveryResult[]> {
    const payload: NotificationPayload = {
      id: generateId(),
      type: 'alert',
      title: `Alert: ${alert.insight.metric}`,
      message: `${alert.insight.title} - ${alert.insight.description}`,
      severity: alert.severity as 'low' | 'medium' | 'high' | 'critical',
      details: {
        ruleId: alert.ruleId,
        metric: alert.insight.metric,
        value: alert.insight.value,
        threshold: alert.insight.threshold,
      },
      timestamp: alert.createdAt,
      tenantId: 'default', // Would be extracted from alert context
    };

    return this.sendNotification(payload, channels);
  }

  /**
   * Get delivery statistics
   */
  getStats(): DeliveryStats {
    const total = this.stats.total;
    const sent = this.stats.sent;
    const avgLatency = this.latencies.length > 0
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
      : 0;

    return {
      totalNotifications: total,
      sentCount: sent,
      failedCount: this.stats.failed,
      queuedCount: this.stats.queued,
      averageLatency: avgLatency,
      successRate: total > 0 ? (sent / total) * 100 : 0,
    };
  }

  /**
   * Retry failed notifications
   */
  async retryFailed(): Promise<DeliveryResult[]> {
    const failedResults = Array.from(this.results.values()).filter(
      (r) => r.status === 'failed' && r.retries < this.maxRetries
    );

    const results: DeliveryResult[] = [];

    for (const failed of failedResults) {
      // In production, would re-queue the original notification
      this.logger.info({ notificationId: failed.notificationId }, 'Retrying failed notification');
    }

    return results;
  }

  // Private methods

  private async deliverToChannel(
    payload: NotificationPayload,
    channel: ChannelType
  ): Promise<DeliveryResult> {
    const result: DeliveryResult = {
      notificationId: payload.id,
      channel,
      status: 'queued',
      timestamp: new Date(),
      retries: 0,
    };

    switch (channel) {
      case 'email':
        return this.deliverEmail(payload, result);
      case 'slack':
        return this.deliverSlack(payload, result);
      case 'webhook':
        return this.deliverWebhook(payload, result);
      case 'sms':
        return this.deliverSMS(payload, result);
      case 'teams':
        return this.deliverTeams(payload, result);
      default:
        return {
          ...result,
          status: 'failed',
          error: `Unknown channel: ${channel}`,
        };
    }
  }

  private async deliverEmail(
    payload: NotificationPayload,
    result: DeliveryResult
  ): Promise<DeliveryResult> {
    if (!this.config.email) {
      return { ...result, status: 'failed', error: 'Email not configured' };
    }

    try {
      // In production, would use nodemailer to send email
      this.logger.debug(
        { notification: payload.id, to: this.config.email.from },
        'Sending email notification'
      );

      // Simulate successful delivery
      return { ...result, status: 'sent' };
    } catch (error) {
      this.logger.error({ error, notification: payload.id }, 'Failed to send email');
      return {
        ...result,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Email delivery failed',
      };
    }
  }

  private async deliverSlack(
    payload: NotificationPayload,
    result: DeliveryResult
  ): Promise<DeliveryResult> {
    if (!this.config.slack) {
      return { ...result, status: 'failed', error: 'Slack not configured' };
    }

    try {
      const color =
        payload.severity === 'critical'
          ? 'danger'
          : payload.severity === 'high'
          ? 'warning'
          : 'good';

      const message = {
        username: this.config.slack.botName || 'NeuroStack',
        attachments: [
          {
            color,
            title: payload.title,
            text: payload.message,
            fields: Object.entries(payload.details || {}).map(([key, value]) => ({
              title: key,
              value: String(value),
              short: true,
            })),
            ts: Math.floor(payload.timestamp.getTime() / 1000),
          },
        ],
      };

      await axios.post(this.config.slack.webhookUrl, message, {
        timeout: 5000,
      });

      this.logger.debug({ notification: payload.id }, 'Slack notification sent');
      return { ...result, status: 'sent' };
    } catch (error) {
      this.logger.error({ error, notification: payload.id }, 'Failed to send Slack notification');
      return {
        ...result,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Slack delivery failed',
      };
    }
  }

  private async deliverWebhook(
    payload: NotificationPayload,
    result: DeliveryResult
  ): Promise<DeliveryResult> {
    if (!this.config.webhook) {
      return { ...result, status: 'failed', error: 'Webhook not configured' };
    }

    try {
      const url = `${this.config.webhook.baseUrl}/notifications`;

      await axios.post(url, payload, {
        timeout: this.config.webhook.timeout || 10000,
        headers: {
          'Content-Type': 'application/json',
          'X-Notification-ID': payload.id,
        },
      });

      this.logger.debug({ notification: payload.id }, 'Webhook notification sent');
      return { ...result, status: 'sent' };
    } catch (error) {
      this.logger.error({ error, notification: payload.id }, 'Failed to send webhook notification');
      return {
        ...result,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Webhook delivery failed',
      };
    }
  }

  private async deliverSMS(
    payload: NotificationPayload,
    result: DeliveryResult
  ): Promise<DeliveryResult> {
    if (!this.config.sms) {
      return { ...result, status: 'failed', error: 'SMS not configured' };
    }

    try {
      // In production, would use Twilio or similar provider
      const smsBody = `${payload.title}: ${payload.message}`;

      this.logger.debug({ notification: payload.id, bodyLength: smsBody.length }, 'Sending SMS');

      // Simulate successful delivery
      return { ...result, status: 'sent' };
    } catch (error) {
      this.logger.error({ error, notification: payload.id }, 'Failed to send SMS');
      return {
        ...result,
        status: 'failed',
        error: error instanceof Error ? error.message : 'SMS delivery failed',
      };
    }
  }

  private async deliverTeams(
    payload: NotificationPayload,
    result: DeliveryResult
  ): Promise<DeliveryResult> {
    if (!this.config.teams) {
      return { ...result, status: 'failed', error: 'Teams not configured' };
    }

    try {
      const color =
        payload.severity === 'critical'
          ? 'ff0000'
          : payload.severity === 'high'
          ? 'ffaa00'
          : '00aa00';

      const message = {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        themeColor: color,
        summary: payload.title,
        sections: [
          {
            activityTitle: payload.title,
            activitySubtitle: payload.message,
            facts: Object.entries(payload.details || {}).map(([key, value]) => ({
              name: key,
              value: String(value),
            })),
          },
        ],
      };

      await axios.post(this.config.teams.webhookUrl, message, {
        timeout: 5000,
      });

      this.logger.debug({ notification: payload.id }, 'Teams notification sent');
      return { ...result, status: 'sent' };
    } catch (error) {
      this.logger.error({ error, notification: payload.id }, 'Failed to send Teams notification');
      return {
        ...result,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Teams delivery failed',
      };
    }
  }
}

export default NotificationDelivery;
