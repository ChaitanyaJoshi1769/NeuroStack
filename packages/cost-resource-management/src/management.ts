import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';

export type ResourceType = 'compute' | 'storage' | 'network' | 'memory';
export type CostMetric = 'cpu-hours' | 'gb-months' | 'gb-transferred' | 'memory-hours';

export interface ResourceUsage {
  timestamp: Date;
  resourceType: ResourceType;
  amount: number;
  unit: string;
  service: string;
  region?: string;
  tags?: Record<string, string>;
}

export interface CostEntry {
  timestamp: Date;
  resourceType: ResourceType;
  metric: CostMetric;
  quantity: number;
  unitPrice: number;
  totalCost: number;
  service: string;
  metadata?: Record<string, any>;
}

export interface BudgetAlert {
  id: string;
  budgetId: string;
  type: 'warning' | 'critical' | 'exceeded';
  threshold: number;
  currentSpend: number;
  alertedAt: Date;
  acknowledged: boolean;
}

export interface Budget {
  id: string;
  name: string;
  limit: number;
  period: 'monthly' | 'quarterly' | 'yearly';
  spent: number;
  alerts: BudgetAlert[];
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  tags?: Record<string, string>;
}

export interface OptimizationRecommendation {
  id: string;
  type: 'scale-down' | 'use-reserved' | 'consolidate' | 'right-size';
  resource: string;
  description: string;
  estimatedSavings: number;
  confidence: number; // 0-1
  priority: 'low' | 'medium' | 'high';
  actionRequired: string;
  createdAt: Date;
}

export interface ResourceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  storageUsage: number;
  networkUsage: number;
  timestamp: Date;
  service: string;
}

export class CostResourceManager {
  private logger: Logger;
  private usageHistory: ResourceUsage[];
  private costHistory: CostEntry[];
  private budgets: Map<string, Budget>;
  private recommendations: OptimizationRecommendation[];
  private metrics: Map<string, ResourceMetrics[]>;
  private readonly maxHistorySize = 100000;
  private costMultipliers: Map<ResourceType, number>;

  constructor(
    private distributedLogger: DistributedLogger,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'CostResourceManager' });
    this.usageHistory = [];
    this.costHistory = [];
    this.budgets = new Map();
    this.recommendations = [];
    this.metrics = new Map();
    this.costMultipliers = new Map([
      ['compute', 0.0116], // $0.0116/CPU-hour (on-demand)
      ['storage', 0.023], // $0.023/GB-month
      ['network', 0.09], // $0.09/GB transferred
      ['memory', 0.0145], // $0.0145/GB-hour
    ]);

    this.logger.info('CostResourceManager initialized');
  }

  recordUsage(usage: Omit<ResourceUsage, 'timestamp'>): ResourceUsage {
    const entry: ResourceUsage = {
      ...usage,
      timestamp: new Date(),
    };

    this.usageHistory.push(entry);

    if (this.usageHistory.length > this.maxHistorySize) {
      this.usageHistory = this.usageHistory.slice(-this.maxHistorySize);
    }

    // Calculate cost
    this.calculateAndRecordCost(entry);

    this.logger.debug(
      { resourceType: usage.resourceType, amount: usage.amount, service: usage.service },
      'Resource usage recorded'
    );

    return entry;
  }

  private calculateAndRecordCost(usage: ResourceUsage): void {
    const costMetricMap: Record<ResourceType, CostMetric> = {
      compute: 'cpu-hours',
      storage: 'gb-months',
      network: 'gb-transferred',
      memory: 'memory-hours',
    };

    const metric = costMetricMap[usage.resourceType];
    const multiplier = this.costMultipliers.get(usage.resourceType) || 0;
    const unitPrice = multiplier;
    const totalCost = usage.amount * unitPrice;

    const costEntry: CostEntry = {
      timestamp: new Date(),
      resourceType: usage.resourceType,
      metric,
      quantity: usage.amount,
      unitPrice,
      totalCost,
      service: usage.service,
      metadata: {
        unit: usage.unit,
        region: usage.region,
        tags: usage.tags,
      },
    };

    this.costHistory.push(costEntry);

    if (this.costHistory.length > this.maxHistorySize) {
      this.costHistory = this.costHistory.slice(-this.maxHistorySize);
    }

    // Update budgets
    for (const budget of this.budgets.values()) {
      budget.spent += totalCost;
      this.checkBudgetAlerts(budget);
    }
  }

  createBudget(budget: Omit<Budget, 'createdAt' | 'spent' | 'alerts'>): Budget {
    const newBudget: Budget = {
      ...budget,
      spent: 0,
      alerts: [],
      createdAt: new Date(),
    };

    this.budgets.set(budget.id, newBudget);
    this.logger.info({ budgetId: budget.id, limit: budget.limit }, 'Budget created');

    return newBudget;
  }

  private checkBudgetAlerts(budget: Budget): void {
    const percentageSpent = (budget.spent / budget.limit) * 100;

    // Critical alert (90%+)
    if (percentageSpent >= 90) {
      const criticalAlert = budget.alerts.find(a => a.type === 'critical');
      if (!criticalAlert) {
        const alert: BudgetAlert = {
          id: `alert-${budget.id}-${Date.now()}`,
          budgetId: budget.id,
          type: 'critical',
          threshold: 90,
          currentSpend: budget.spent,
          alertedAt: new Date(),
          acknowledged: false,
        };
        budget.alerts.push(alert);
        this.logger.warn({ budgetId: budget.id, spent: budget.spent }, 'Critical budget alert triggered');
      }
    }
    // Warning alert (70-90%)
    else if (percentageSpent >= 70 && percentageSpent < 90) {
      const warningAlert = budget.alerts.find(a => a.type === 'warning');
      if (!warningAlert) {
        const alert: BudgetAlert = {
          id: `alert-${budget.id}-${Date.now()}`,
          budgetId: budget.id,
          type: 'warning',
          threshold: 70,
          currentSpend: budget.spent,
          alertedAt: new Date(),
          acknowledged: false,
        };
        budget.alerts.push(alert);
        this.logger.info({ budgetId: budget.id, spent: budget.spent }, 'Budget warning alert triggered');
      }
    }

    // Exceeded alert
    if (budget.spent > budget.limit) {
      const exceededAlert = budget.alerts.find(a => a.type === 'exceeded');
      if (!exceededAlert) {
        const alert: BudgetAlert = {
          id: `alert-${budget.id}-${Date.now()}`,
          budgetId: budget.id,
          type: 'exceeded',
          threshold: 100,
          currentSpend: budget.spent,
          alertedAt: new Date(),
          acknowledged: false,
        };
        budget.alerts.push(alert);
        this.logger.error({ budgetId: budget.id, spent: budget.spent, limit: budget.limit }, 'Budget exceeded');
      }
    }
  }

  getBudget(budgetId: string): Budget | undefined {
    return this.budgets.get(budgetId);
  }

  getAllBudgets(): Budget[] {
    return Array.from(this.budgets.values());
  }

  acknowledgeBudgetAlert(budgetId: string, alertId: string): void {
    const budget = this.budgets.get(budgetId);
    if (budget) {
      const alert = budget.alerts.find(a => a.id === alertId);
      if (alert) {
        alert.acknowledged = true;
        this.logger.info({ budgetId, alertId }, 'Budget alert acknowledged');
      }
    }
  }

  recordMetrics(metrics: Omit<ResourceMetrics, 'timestamp'>): void {
    const entry: ResourceMetrics = {
      ...metrics,
      timestamp: new Date(),
    };

    if (!this.metrics.has(metrics.service)) {
      this.metrics.set(metrics.service, []);
    }

    const serviceMetrics = this.metrics.get(metrics.service)!;
    serviceMetrics.push(entry);

    // Keep only last 1000 entries per service
    if (serviceMetrics.length > 1000) {
      serviceMetrics.shift();
    }

    this.logger.debug(
      { service: metrics.service, cpuUsage: metrics.cpuUsage, memoryUsage: metrics.memoryUsage },
      'Resource metrics recorded'
    );
  }

  getMetricsForService(service: string, limit: number = 100): ResourceMetrics[] {
    const metrics = this.metrics.get(service) || [];
    return metrics.slice(-limit);
  }

  generateOptimizationRecommendations(): OptimizationRecommendation[] {
    this.recommendations = [];

    // Analyze usage patterns
    const serviceUsage = this.aggregateUsageByService();

    for (const [service, usage] of Object.entries(serviceUsage)) {
      // Scale-down recommendation
      if (usage.avgCpu < 20) {
        this.recommendations.push({
          id: `rec-${service}-scale-down`,
          type: 'scale-down',
          resource: service,
          description: `${service} is underutilized (avg CPU: ${usage.avgCpu}%)`,
          estimatedSavings: usage.monthlySpend * 0.3,
          confidence: 0.8,
          priority: 'medium',
          actionRequired: `Reduce compute capacity for ${service}`,
          createdAt: new Date(),
        });
      }

      // Right-size recommendation
      if (usage.avgMemory < 30 && usage.monthlySpend > 100) {
        this.recommendations.push({
          id: `rec-${service}-rightsize`,
          type: 'right-size',
          resource: service,
          description: `${service} memory is overprovisioned (avg: ${usage.avgMemory}%)`,
          estimatedSavings: usage.monthlySpend * 0.2,
          confidence: 0.75,
          priority: 'medium',
          actionRequired: `Right-size memory allocation for ${service}`,
          createdAt: new Date(),
        });
      }

      // Reserved instance recommendation
      if (usage.monthlySpend > 1000) {
        this.recommendations.push({
          id: `rec-${service}-reserved`,
          type: 'use-reserved',
          resource: service,
          description: `${service} is a consistent workload - use reserved instances`,
          estimatedSavings: usage.monthlySpend * 0.25,
          confidence: 0.85,
          priority: 'high',
          actionRequired: `Purchase reserved instances for ${service}`,
          createdAt: new Date(),
        });
      }
    }

    return this.recommendations;
  }

  private aggregateUsageByService(): Record<string, any> {
    const aggregated: Record<string, any> = {};

    for (const usage of this.usageHistory) {
      if (!aggregated[usage.service]) {
        aggregated[usage.service] = {
          cpuCount: 0,
          totalCpu: 0,
          memoryCount: 0,
          totalMemory: 0,
          monthlySpend: 0,
        };
      }

      if (usage.resourceType === 'compute') {
        aggregated[usage.service].cpuCount++;
        aggregated[usage.service].totalCpu += usage.amount;
      } else if (usage.resourceType === 'memory') {
        aggregated[usage.service].memoryCount++;
        aggregated[usage.service].totalMemory += usage.amount;
      }
    }

    // Calculate costs for services
    for (const [service, agg] of Object.entries(aggregated)) {
      const costs = this.costHistory.filter(c => c.service === service);
      agg.monthlySpend = costs.reduce((sum, c) => sum + c.totalCost, 0);
      agg.avgCpu = agg.cpuCount > 0 ? (agg.totalCpu / agg.cpuCount) * 100 : 0;
      agg.avgMemory = agg.memoryCount > 0 ? (agg.totalMemory / agg.memoryCount) * 100 : 0;
    }

    return aggregated;
  }

  getCostSummary(
    serviceFilter?: string,
    startDate?: Date,
    endDate?: Date
  ): Record<string, any> {
    let entries = [...this.costHistory];

    if (serviceFilter) {
      entries = entries.filter(e => e.service === serviceFilter);
    }
    if (startDate) {
      entries = entries.filter(e => e.timestamp >= startDate);
    }
    if (endDate) {
      entries = entries.filter(e => e.timestamp <= endDate);
    }

    const byResource: Record<ResourceType, number> = {
      compute: 0,
      storage: 0,
      network: 0,
      memory: 0,
    };

    let total = 0;

    for (const entry of entries) {
      byResource[entry.resourceType] += entry.totalCost;
      total += entry.totalCost;
    }

    return {
      total,
      byResource,
      entryCount: entries.length,
      breakdown: this.getDetailedCostBreakdown(entries),
    };
  }

  private getDetailedCostBreakdown(entries: CostEntry[]): Record<string, number> {
    const breakdown: Record<string, number> = {};

    for (const entry of entries) {
      const key = `${entry.service}-${entry.resourceType}`;
      breakdown[key] = (breakdown[key] || 0) + entry.totalCost;
    }

    return breakdown;
  }

  getUsageHistory(service?: string, resourceType?: ResourceType, limit: number = 100): ResourceUsage[] {
    let history = [...this.usageHistory];

    if (service) {
      history = history.filter(u => u.service === service);
    }
    if (resourceType) {
      history = history.filter(u => u.resourceType === resourceType);
    }

    return history.slice(-limit);
  }

  getMetrics(): Record<string, any> {
    const totalCost = this.costHistory.reduce((sum, c) => sum + c.totalCost, 0);
    const avgDailyCost = totalCost / Math.max(1, this.costHistory.length);
    const budgetsOverspent = Array.from(this.budgets.values()).filter(b => b.spent > b.limit).length;

    return {
      totalCost,
      avgDailyCost,
      usageEntries: this.usageHistory.length,
      costEntries: this.costHistory.length,
      budgetCount: this.budgets.size,
      budgetsOverspent,
      recommendationCount: this.recommendations.length,
      servicesTracked: new Set(this.usageHistory.map(u => u.service)).size,
    };
  }
}
