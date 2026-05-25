import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Distributed Alert Coordination Types
 */

export interface NodeInfo {
  nodeId: string;
  hostname: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastHeartbeat: Date;
  alertsProcessed: number;
  loadFactor: number; // 0-1
}

export interface ConsensusAlert {
  alertId: string;
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  consensus: number; // 0-1 (0.5+ required)
  votingNodes: string[];
  votes: Map<string, boolean>;
  createdAt: Date;
  resolvedAt?: Date;
  status: 'pending' | 'agreed' | 'disagreed' | 'cancelled';
}

export interface AlertReplication {
  alertId: string;
  replicationStatus: Map<string, 'pending' | 'acknowledged' | 'failed'>;
  requiredReplicas: number;
  currentReplicas: number;
  lastSyncTime: Date;
}

export interface DistributedAlertStats {
  totalAlerts: number;
  consensusedAlerts: number;
  disagreedAlerts: number;
  replicationLatency: number;
  consensusTime: number;
  nodeCount: number;
}

/**
 * Distributed Alert Coordinator
 *
 * Manages alert coordination across multiple nodes with:
 * - Consensus voting for critical alerts
 * - Alert replication and synchronization
 * - Node health tracking
 * - Load balancing
 * - Conflict resolution
 */
export class DistributedAlertCoordinator {
  private logger = pino();
  private nodeId: string;
  private nodes: Map<string, NodeInfo> = new Map();
  private consensusAlerts: Map<string, ConsensusAlert> = new Map();
  private replications: Map<string, AlertReplication> = new Map();
  private stats: DistributedAlertStats;
  private readonly quorumThreshold = 0.6; // 60% consensus required
  private readonly heartbeatInterval = 5000; // 5 seconds
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(nodeId: string = generateId()) {
    this.nodeId = nodeId;
    this.stats = {
      totalAlerts: 0,
      consensusedAlerts: 0,
      disagreedAlerts: 0,
      replicationLatency: 0,
      consensusTime: 0,
      nodeCount: 0,
    };

    this.logger.info({ nodeId }, 'DistributedAlertCoordinator initialized');
  }

  /**
   * Register node in cluster
   */
  registerNode(nodeId: string, hostname: string): void {
    const nodeInfo: NodeInfo = {
      nodeId,
      hostname,
      status: 'healthy',
      lastHeartbeat: new Date(),
      alertsProcessed: 0,
      loadFactor: 0,
    };

    this.nodes.set(nodeId, nodeInfo);
    this.stats.nodeCount = this.nodes.size;

    this.logger.info({ nodeId, hostname }, 'Node registered');
  }

  /**
   * Propose alert for consensus voting
   */
  async proposeAlert(alert: any, votingNodes?: string[]): Promise<ConsensusAlert> {
    const alertId = alert.id || generateId();
    const nodes = votingNodes || Array.from(this.nodes.keys());

    const consensusAlert: ConsensusAlert = {
      alertId,
      ruleId: alert.ruleId,
      severity: alert.severity,
      consensus: 0,
      votingNodes: nodes,
      votes: new Map(),
      createdAt: new Date(),
      status: 'pending',
    };

    // Initialize votes
    for (const node of nodes) {
      consensusAlert.votes.set(node, false);
    }

    this.consensusAlerts.set(alertId, consensusAlert);
    this.stats.totalAlerts++;

    this.logger.info(
      {
        alertId,
        ruleId: alert.ruleId,
        votingNodes: nodes.length,
      },
      'Alert proposed for consensus'
    );

    return consensusAlert;
  }

  /**
   * Cast vote on alert
   */
  castVote(alertId: string, nodeId: string, vote: boolean): boolean {
    const alert = this.consensusAlerts.get(alertId);
    if (!alert) {
      this.logger.warn({ alertId, nodeId }, 'Alert not found for voting');
      return false;
    }

    if (!alert.votingNodes.includes(nodeId)) {
      this.logger.warn({ alertId, nodeId }, 'Node not authorized to vote');
      return false;
    }

    alert.votes.set(nodeId, vote);

    // Check if consensus is reached
    this.evaluateConsensus(alertId);

    this.logger.debug({ alertId, nodeId, vote }, 'Vote cast');

    return true;
  }

  /**
   * Evaluate consensus for alert
   */
  private evaluateConsensus(alertId: string): void {
    const alert = this.consensusAlerts.get(alertId);
    if (!alert) return;

    const votes = Array.from(alert.votes.values());
    const affirmativeVotes = votes.filter((v) => v).length;
    const consensusPercent = affirmativeVotes / votes.length;

    alert.consensus = consensusPercent;

    if (consensusPercent >= this.quorumThreshold) {
      alert.status = 'agreed';
      this.stats.consensusedAlerts++;

      this.logger.info(
        {
          alertId: alert.alertId,
          consensus: Math.round(consensusPercent * 100),
        },
        'Alert consensus reached'
      );
    } else if (consensusPercent < 1 - this.quorumThreshold) {
      alert.status = 'disagreed';
      this.stats.disagreedAlerts++;

      this.logger.info(
        {
          alertId: alert.alertId,
          consensus: Math.round(consensusPercent * 100),
        },
        'Alert consensus failed'
      );
    }
  }

  /**
   * Replicate alert to nodes
   */
  async replicateAlert(alertId: string, targetNodes?: string[]): Promise<AlertReplication> {
    const nodes = targetNodes || Array.from(this.nodes.keys()).filter((n) => n !== this.nodeId);

    const replication: AlertReplication = {
      alertId,
      replicationStatus: new Map(),
      requiredReplicas: Math.ceil(nodes.length * 0.6), // 60% replication
      currentReplicas: 0,
      lastSyncTime: new Date(),
    };

    // Initialize replication status
    for (const node of nodes) {
      replication.replicationStatus.set(node, 'pending');
    }

    this.replications.set(alertId, replication);

    this.logger.info(
      {
        alertId,
        targetCount: nodes.length,
        requiredReplicas: replication.requiredReplicas,
      },
      'Alert replication started'
    );

    return replication;
  }

  /**
   * Acknowledge alert replication
   */
  acknowledgeReplication(alertId: string, nodeId: string, success: boolean): void {
    const replication = this.replications.get(alertId);
    if (!replication) return;

    const status = success ? 'acknowledged' : 'failed';
    replication.replicationStatus.set(nodeId, status);

    if (success) {
      replication.currentReplicas++;
    }

    replication.lastSyncTime = new Date();

    this.logger.debug({ alertId, nodeId, status }, 'Replication acknowledged');
  }

  /**
   * Update node heartbeat and status
   */
  updateNodeStatus(nodeId: string, loadFactor: number, alertsProcessed: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      this.logger.warn({ nodeId }, 'Node not found for status update');
      return;
    }

    node.lastHeartbeat = new Date();
    node.loadFactor = loadFactor;
    node.alertsProcessed = alertsProcessed;

    // Determine health status
    const timeSinceLastHeartbeat = Date.now() - node.lastHeartbeat.getTime();
    if (timeSinceLastHeartbeat > 30000) {
      node.status = 'unhealthy';
    } else if (loadFactor > 0.8) {
      node.status = 'degraded';
    } else {
      node.status = 'healthy';
    }

    this.logger.debug({ nodeId, status: node.status, loadFactor }, 'Node status updated');
  }

  /**
   * Get cluster consensus status
   */
  getClusterStatus(): {
    healthy: number;
    degraded: number;
    unhealthy: number;
    avgLoadFactor: number;
  } {
    const nodes = Array.from(this.nodes.values());
    let healthy = 0;
    let degraded = 0;
    let unhealthy = 0;
    let totalLoad = 0;

    for (const node of nodes) {
      totalLoad += node.loadFactor;

      switch (node.status) {
        case 'healthy':
          healthy++;
          break;
        case 'degraded':
          degraded++;
          break;
        case 'unhealthy':
          unhealthy++;
          break;
      }
    }

    return {
      healthy,
      degraded,
      unhealthy,
      avgLoadFactor: nodes.length > 0 ? totalLoad / nodes.length : 0,
    };
  }

  /**
   * Select best node for task execution
   */
  selectBestNode(): string | null {
    const healthyNodes = Array.from(this.nodes.values()).filter((n) => n.status === 'healthy');

    if (healthyNodes.length === 0) {
      return null;
    }

    // Select node with lowest load factor
    return healthyNodes.reduce((best, current) =>
      current.loadFactor < best.loadFactor ? current : best
    ).nodeId;
  }

  /**
   * Get distributed alert statistics
   */
  getStats(): DistributedAlertStats {
    return { ...this.stats };
  }

  /**
   * Get all alerts in cluster
   */
  getAllAlerts(): ConsensusAlert[] {
    return Array.from(this.consensusAlerts.values());
  }

  /**
   * Resolve alert (mark as resolved)
   */
  resolveAlert(alertId: string): void {
    const alert = this.consensusAlerts.get(alertId);
    if (!alert) return;

    alert.resolvedAt = new Date();

    this.logger.info({ alertId }, 'Alert resolved');
  }

  /**
   * Cleanup old alerts
   */
  cleanup(olderThanMs: number = 86400000): number {
    let count = 0;
    const cutoffTime = Date.now() - olderThanMs;

    for (const [alertId, alert] of this.consensusAlerts.entries()) {
      if (alert.resolvedAt && alert.resolvedAt.getTime() < cutoffTime) {
        this.consensusAlerts.delete(alertId);
        count++;
      }
    }

    this.logger.info({ count }, 'Old alerts cleaned up');

    return count;
  }

  /**
   * Get node list
   */
  getNodes(): NodeInfo[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get current node ID
   */
  getCurrentNodeId(): string {
    return this.nodeId;
  }
}

export default DistributedAlertCoordinator;
