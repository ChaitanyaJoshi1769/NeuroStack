import { DistributedLogger } from '@neurostack/distributed-logging';
import { AdvancedMonitoringPlatform } from '@neurostack/advanced-monitoring';
import { Logger } from 'pino';

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type WorkflowStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ScheduleFrequency = 'once' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'cron';

export interface WorkflowTask {
  taskId: string;
  name: string;
  action: string;
  parameters?: Record<string, any>;
  retryAttempts?: number;
  timeout?: number;
  dependencies?: string[];
  condition?: (context: ExecutionContext) => boolean;
  onSuccess?: (output: any) => void;
  onFailure?: (error: Error) => void;
}

export interface Workflow {
  workflowId: string;
  name: string;
  description?: string;
  tasks: Map<string, WorkflowTask>;
  triggers?: WorkflowTrigger[];
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTrigger {
  triggerId: string;
  type: 'scheduled' | 'event' | 'webhook' | 'manual';
  frequency?: ScheduleFrequency;
  cronExpression?: string;
  eventName?: string;
  webhookUrl?: string;
}

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  taskResults: Map<string, any>;
  variables: Map<string, any>;
  timestamp: Date;
}

export interface TaskExecution {
  taskId: string;
  executionId: string;
  status: TaskStatus;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  output?: any;
  error?: string;
  retryCount: number;
  logs: string[];
}

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  status: WorkflowStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  taskExecutions: Map<string, TaskExecution>;
  variables: Map<string, any>;
  triggeredBy: string;
  result?: any;
}

export class WorkflowOrchestrationEngine {
  private logger: Logger;
  private workflows: Map<string, Workflow>;
  private executions: Map<string, WorkflowExecution>;
  private scheduledTasks: Map<string, NodeJS.Timeout>;
  private executionHistory: WorkflowExecution[];
  private readonly maxHistorySize = 10000;

  constructor(
    private distributedLogger: DistributedLogger,
    private monitoring: AdvancedMonitoringPlatform,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'WorkflowOrchestrationEngine' });
    this.workflows = new Map();
    this.executions = new Map();
    this.scheduledTasks = new Map();
    this.executionHistory = [];
  }

  async createWorkflow(workflow: Workflow): Promise<string> {
    try {
      // Validate DAG (no cycles)
      this.validateDAG(workflow);

      this.workflows.set(workflow.workflowId, workflow);

      await this.distributedLogger.log({
        level: 'info',
        message: `Workflow created: ${workflow.workflowId}`,
        metadata: {
          name: workflow.name,
          taskCount: workflow.tasks.size,
        },
      });

      // Schedule triggers
      if (workflow.triggers) {
        for (const trigger of workflow.triggers) {
          await this.scheduleTrigger(workflow.workflowId, trigger);
        }
      }

      return workflow.workflowId;
    } catch (error) {
      this.logger.error({ error, workflowId: workflow.workflowId }, 'Failed to create workflow');
      throw error;
    }
  }

  async executeWorkflow(workflowId: string, variables?: Map<string, any>, triggeredBy: string = 'manual'): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const execution: WorkflowExecution = {
      executionId,
      workflowId,
      status: 'running',
      startTime: new Date(),
      taskExecutions: new Map(),
      variables: variables || new Map(),
      triggeredBy,
    };

    this.executions.set(executionId, execution);

    try {
      await this.distributedLogger.log({
        level: 'info',
        message: `Workflow execution started: ${executionId}`,
        metadata: { workflowId, taskCount: workflow.tasks.size },
      });

      const context: ExecutionContext = {
        workflowId,
        executionId,
        taskResults: new Map(),
        variables: variables || new Map(),
        timestamp: new Date(),
      };

      // Execute tasks in topological order
      const taskOrder = this.getTopologicalOrder(workflow);

      for (const taskId of taskOrder) {
        const task = workflow.tasks.get(taskId)!;

        // Check condition
        if (task.condition && !task.condition(context)) {
          execution.taskExecutions.set(taskId, {
            taskId,
            executionId,
            status: 'skipped',
            retryCount: 0,
            logs: [],
          });
          continue;
        }

        // Check dependencies
        const depsOk = await this.checkDependencies(taskId, execution, workflow);
        if (!depsOk) {
          execution.taskExecutions.set(taskId, {
            taskId,
            executionId,
            status: 'failed',
            error: 'Dependency failed',
            retryCount: 0,
            logs: [],
          });
          execution.status = 'failed';
          break;
        }

        // Execute task
        const taskExecution = await this.executeTask(task, context, execution);
        execution.taskExecutions.set(taskId, taskExecution);

        if (taskExecution.status === 'failed') {
          execution.status = 'failed';
          break;
        }

        context.taskResults.set(taskId, taskExecution.output);
      }

      // Finalize execution
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      if (execution.status !== 'failed') {
        execution.status = 'succeeded';
      }

      this.executionHistory.push(execution);
      if (this.executionHistory.length > this.maxHistorySize) {
        this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
      }

      await this.distributedLogger.log({
        level: 'info',
        message: `Workflow execution ${execution.status}: ${executionId}`,
        metadata: {
          workflowId,
          duration: execution.duration,
          status: execution.status,
        },
      });

      return executionId;
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      this.logger.error({ error, executionId }, 'Workflow execution failed');
      return executionId;
    }
  }

  private async executeTask(
    task: WorkflowTask,
    context: ExecutionContext,
    execution: WorkflowExecution
  ): Promise<TaskExecution> {
    const taskExecution: TaskExecution = {
      taskId: task.taskId,
      executionId: context.executionId,
      status: 'pending',
      retryCount: 0,
      logs: [],
    };

    let lastError: Error | null = null;
    const maxRetries = task.retryAttempts || 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        taskExecution.status = 'running';
        taskExecution.startTime = new Date();

        // Execute task action
        const output = await this.executeAction(task.action, task.parameters || {}, context);

        taskExecution.status = 'succeeded';
        taskExecution.output = output;
        taskExecution.endTime = new Date();
        taskExecution.duration = taskExecution.endTime.getTime() - (taskExecution.startTime?.getTime() || 0);

        if (task.onSuccess) {
          task.onSuccess(output);
        }

        await this.monitoring.recordMetric(`workflow.task_success`, 1, { task: task.taskId });

        return taskExecution;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        taskExecution.retryCount = attempt;

        if (attempt < maxRetries) {
          taskExecution.logs.push(`Attempt ${attempt + 1} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000)); // Exponential backoff
        }
      }
    }

    taskExecution.status = 'failed';
    taskExecution.error = lastError?.message;
    taskExecution.endTime = new Date();
    taskExecution.duration = taskExecution.endTime.getTime() - (taskExecution.startTime?.getTime() || 0);

    if (task.onFailure && lastError) {
      task.onFailure(lastError);
    }

    await this.monitoring.recordMetric(`workflow.task_failure`, 1, { task: task.taskId });

    return taskExecution;
  }

  private async executeAction(action: string, parameters: Record<string, any>, context: ExecutionContext): Promise<any> {
    // Simulate different actions
    switch (action) {
      case 'train_model':
        return { model_id: 'model_' + Date.now(), accuracy: 0.95 };
      case 'evaluate_model':
        return { f1_score: 0.92, precision: 0.94, recall: 0.90 };
      case 'deploy_model':
        return { deployment_id: 'deploy_' + Date.now(), status: 'active' };
      case 'log_metrics':
        this.logger.info({ parameters }, 'Metrics logged');
        return { logged: true };
      case 'wait':
        const duration = parameters.duration || 1000;
        await new Promise(resolve => setTimeout(resolve, duration));
        return { waited: true };
      default:
        return { action, parameters };
    }
  }

  private async checkDependencies(taskId: string, execution: WorkflowExecution, workflow: Workflow): Promise<boolean> {
    const task = workflow.tasks.get(taskId);
    if (!task || !task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    for (const depId of task.dependencies) {
      const depExecution = execution.taskExecutions.get(depId);
      if (!depExecution || depExecution.status !== 'succeeded') {
        return false;
      }
    }

    return true;
  }

  private getTopologicalOrder(workflow: Workflow): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string): boolean => {
      if (visited.has(taskId)) return true;
      if (visiting.has(taskId)) return false; // Cycle detected

      visiting.add(taskId);

      const task = workflow.tasks.get(taskId);
      if (task && task.dependencies) {
        for (const depId of task.dependencies) {
          if (!visit(depId)) return false;
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);
      order.push(taskId);

      return true;
    };

    for (const taskId of workflow.tasks.keys()) {
      if (!visited.has(taskId)) {
        if (!visit(taskId)) {
          throw new Error('Workflow contains a cycle');
        }
      }
    }

    return order;
  }

  private validateDAG(workflow: Workflow): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const hasCycle = (taskId: string): boolean => {
      if (visited.has(taskId)) return false;
      if (visiting.has(taskId)) return true;

      visiting.add(taskId);

      const task = workflow.tasks.get(taskId);
      if (task && task.dependencies) {
        for (const depId of task.dependencies) {
          if (hasCycle(depId)) return true;
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);

      return false;
    };

    for (const taskId of workflow.tasks.keys()) {
      if (hasCycle(taskId)) {
        throw new Error(`Workflow ${workflow.workflowId} contains a cycle`);
      }
    }
  }

  private async scheduleTrigger(workflowId: string, trigger: WorkflowTrigger): Promise<void> {
    if (trigger.type === 'scheduled' && trigger.frequency) {
      const scheduleKey = `${workflowId}_${trigger.triggerId}`;

      switch (trigger.frequency) {
        case 'hourly':
          this.scheduledTasks.set(
            scheduleKey,
            setInterval(() => this.executeWorkflow(workflowId, undefined, `trigger_${trigger.triggerId}`), 60 * 60 * 1000)
          );
          break;
        case 'daily':
          this.scheduledTasks.set(
            scheduleKey,
            setInterval(() => this.executeWorkflow(workflowId, undefined, `trigger_${trigger.triggerId}`), 24 * 60 * 60 * 1000)
          );
          break;
        case 'weekly':
          this.scheduledTasks.set(
            scheduleKey,
            setInterval(() => this.executeWorkflow(workflowId, undefined, `trigger_${trigger.triggerId}`), 7 * 24 * 60 * 60 * 1000)
          );
          break;
      }
    }
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | undefined> {
    return this.executions.get(executionId);
  }

  async listExecutions(workflowId?: string, limit: number = 100): Promise<WorkflowExecution[]> {
    const executions = workflowId
      ? this.executionHistory.filter(e => e.workflowId === workflowId)
      : this.executionHistory;

    return executions.slice(-limit);
  }

  async getWorkflow(workflowId: string): Promise<Workflow | undefined> {
    return this.workflows.get(workflowId);
  }

  async listWorkflows(): Promise<Workflow[]> {
    return Array.from(this.workflows.values());
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.status = 'cancelled';
      execution.endTime = new Date();
    }
  }
}
