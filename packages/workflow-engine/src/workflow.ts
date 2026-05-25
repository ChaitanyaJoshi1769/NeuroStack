import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Workflow Engine Types
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  version: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  agentType?: string;
  config: StepConfig;
  inputs: StepInput[];
  outputs: StepOutput[];
  errorHandling?: ErrorHandler;
  retryPolicy?: RetryPolicy;
  timeout?: number; // milliseconds
  dependencies?: string[]; // Step IDs
}

export enum StepType {
  AGENT = 'agent',
  DECISION = 'decision',
  FORK = 'fork',
  JOIN = 'join',
  TRANSFORM = 'transform',
  VALIDATION = 'validation',
  NOTIFICATION = 'notification',
}

export interface StepConfig {
  [key: string]: unknown;
}

export interface StepInput {
  name: string;
  source: InputSource;
  path?: string; // JSONPath in workflow context
  required: boolean;
  validation?: ValidationRule;
}

export enum InputSource {
  WORKFLOW_CONTEXT = 'workflow_context',
  PREVIOUS_STEP = 'previous_step',
  EXTERNAL = 'external',
  CONSTANT = 'constant',
}

export interface StepOutput {
  name: string;
  path: string; // JSONPath in step result
  storeIn: 'context' | 'memory';
  ttl?: number; // seconds
}

export interface ErrorHandler {
  type: ErrorHandlingType;
  fallbackStep?: string;
  retryAttempts?: number;
  retryDelay?: number;
  notification?: string;
}

export enum ErrorHandlingType {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  SKIP = 'skip',
  FAIL = 'fail',
  ESCALATE = 'escalate',
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface ValidationRule {
  type: ValidationType;
  pattern?: string;
  minValue?: number;
  maxValue?: number;
  allowedValues?: unknown[];
}

export enum ValidationType {
  REGEX = 'regex',
  RANGE = 'range',
  ENUM = 'enum',
  CUSTOM = 'custom',
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  context: Record<string, unknown>;
  stepResults: Map<string, StepResult>;
  startTime: Date;
  endTime?: Date;
  error?: Error;
  executionPlan: ExecutionPlan;
}

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface StepResult {
  stepId: string;
  status: ExecutionStatus;
  result?: unknown;
  duration: number;
  error?: string;
  retriedAttempts: number;
  timestamp: Date;
}

export interface ExecutionPlan {
  steps: string[]; // Ordered step IDs
  parallelGroups: string[][]; // Groups of steps that can run in parallel
  criticalPath: string[];
  estimatedDuration: number;
}

/**
 * Agentic Workflow Orchestration Engine
 */
export class WorkflowEngine {
  private logger = pino();
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private executor: WorkflowExecutor;
  private planner: ExecutionPlanner;

  constructor() {
    this.executor = new WorkflowExecutor(this);
    this.planner = new ExecutionPlanner();
  }

  /**
   * Register a workflow definition
   */
  registerWorkflow(
    name: string,
    description: string,
    steps: WorkflowStep[],
    tenantId: string
  ): WorkflowDefinition {
    // Validate workflow
    this.validateWorkflow(steps);

    const workflow: WorkflowDefinition = {
      id: generateId(),
      name,
      description,
      steps,
      version: '1.0.0',
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.workflows.set(workflow.id, workflow);
    this.logger.info(
      { workflowId: workflow.id, name, stepCount: steps.length },
      'Workflow registered'
    );

    return workflow;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    context: Record<string, unknown> = {}
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Create execution plan
    const executionPlan = this.planner.createPlan(workflow);

    // Create execution context
    const execution: WorkflowExecution = {
      id: generateId(),
      workflowId,
      status: ExecutionStatus.RUNNING,
      context: { ...context, _workflowId: workflowId },
      stepResults: new Map(),
      startTime: new Date(),
      executionPlan,
    };

    this.executions.set(execution.id, execution);

    try {
      // Execute workflow
      await this.executor.execute(execution, workflow);
      execution.status = ExecutionStatus.COMPLETED;
      execution.endTime = new Date();

      this.logger.info(
        {
          executionId: execution.id,
          workflowId,
          duration: execution.endTime.getTime() - execution.startTime.getTime(),
        },
        'Workflow execution completed'
      );
    } catch (error) {
      execution.status = ExecutionStatus.FAILED;
      execution.error = error as Error;
      execution.endTime = new Date();

      this.logger.error(
        {
          executionId: execution.id,
          workflowId,
          error: (error as Error).message,
        },
        'Workflow execution failed'
      );
    }

    return execution;
  }

  /**
   * Get workflow execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get execution history
   */
  getExecutionHistory(workflowId: string, limit: number = 10): WorkflowExecution[] {
    return Array.from(this.executions.values())
      .filter((e) => e.workflowId === workflowId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }

  /**
   * Update workflow definition
   */
  updateWorkflow(
    workflowId: string,
    updates: Partial<WorkflowDefinition>
  ): WorkflowDefinition {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const updated = {
      ...workflow,
      ...updates,
      id: workflow.id,
      createdAt: workflow.createdAt,
      updatedAt: new Date(),
    };

    // Re-validate if steps changed
    if (updates.steps) {
      this.validateWorkflow(updates.steps);
    }

    this.workflows.set(workflowId, updated);
    return updated;
  }

  /**
   * Delete workflow
   */
  deleteWorkflow(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  /**
   * Get workflow statistics
   */
  getStatistics(workflowId: string): WorkflowStatistics {
    const executions = Array.from(this.executions.values()).filter(
      (e) => e.workflowId === workflowId
    );

    const durations = executions
      .filter((e) => e.endTime)
      .map((e) => e.endTime!.getTime() - e.startTime.getTime());

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const successCount = executions.filter(
      (e) => e.status === ExecutionStatus.COMPLETED
    ).length;
    const successRate = executions.length > 0
      ? (successCount / executions.length) * 100
      : 0;

    return {
      totalExecutions: executions.length,
      successCount,
      failureCount: executions.length - successCount,
      successRate,
      averageDurationMs: avgDuration,
      lastExecution: executions[0]?.startTime,
    };
  }

  // Private helper methods

  private validateWorkflow(steps: WorkflowStep[]): void {
    // Check for circular dependencies
    const visited = new Set<string>();
    const recStack = new Set<string>();

    for (const step of steps) {
      if (!visited.has(step.id)) {
        this.detectCycle(step, steps, visited, recStack);
      }
    }

    // All dependencies must exist
    const stepIds = new Set(steps.map((s) => s.id));
    for (const step of steps) {
      if (step.dependencies) {
        for (const dep of step.dependencies) {
          if (!stepIds.has(dep)) {
            throw new Error(`Dependency ${dep} not found in workflow`);
          }
        }
      }
    }
  }

  private detectCycle(
    step: WorkflowStep,
    steps: WorkflowStep[],
    visited: Set<string>,
    recStack: Set<string>
  ): void {
    visited.add(step.id);
    recStack.add(step.id);

    if (step.dependencies) {
      for (const depId of step.dependencies) {
        const depStep = steps.find((s) => s.id === depId);
        if (!depStep) continue;

        if (!visited.has(depId)) {
          this.detectCycle(depStep, steps, visited, recStack);
        } else if (recStack.has(depId)) {
          throw new Error(`Circular dependency detected in workflow`);
        }
      }
    }

    recStack.delete(step.id);
  }
}

/**
 * Workflow Execution Engine
 */
class WorkflowExecutor {
  private workflowEngine: WorkflowEngine;
  private logger = pino();

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine;
  }

  async execute(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const { steps } = workflow;

    // Execute steps in order
    for (const stepId of execution.executionPlan.steps) {
      const step = steps.find((s) => s.id === stepId);
      if (!step) continue;

      // Check dependencies
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          const depResult = execution.stepResults.get(depId);
          if (!depResult || depResult.status !== ExecutionStatus.COMPLETED) {
            throw new Error(`Dependency ${depId} not completed for step ${stepId}`);
          }
        }
      }

      // Execute step with retry logic
      const result = await this.executeStep(step, execution);
      execution.stepResults.set(stepId, result);

      if (result.status === ExecutionStatus.FAILED) {
        if (step.errorHandling?.type === ErrorHandlingType.FAIL) {
          throw new Error(`Step ${stepId} failed: ${result.error}`);
        }
      }
    }
  }

  private async executeStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<StepResult> {
    const startTime = Date.now();
    let retriedAttempts = 0;

    const retryPolicy = step.retryPolicy || {
      maxAttempts: 1,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    };

    for (let attempt = 0; attempt < retryPolicy.maxAttempts; attempt++) {
      try {
        const result = await this.executeStepLogic(step, execution);

        return {
          stepId: step.id,
          status: ExecutionStatus.COMPLETED,
          result,
          duration: Date.now() - startTime,
          retriedAttempts,
          timestamp: new Date(),
        };
      } catch (error) {
        retriedAttempts++;

        if (attempt < retryPolicy.maxAttempts - 1) {
          const delay = Math.min(
            retryPolicy.initialDelayMs * Math.pow(retryPolicy.backoffMultiplier, attempt),
            retryPolicy.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          return {
            stepId: step.id,
            status: ExecutionStatus.FAILED,
            duration: Date.now() - startTime,
            error: (error as Error).message,
            retriedAttempts,
            timestamp: new Date(),
          };
        }
      }
    }

    throw new Error(`Step ${step.id} failed after retries`);
  }

  private async executeStepLogic(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<unknown> {
    switch (step.type) {
      case StepType.AGENT:
        return this.executeAgent(step, execution);
      case StepType.DECISION:
        return this.executeDecision(step, execution);
      case StepType.TRANSFORM:
        return this.executeTransform(step, execution);
      case StepType.VALIDATION:
        return this.executeValidation(step, execution);
      default:
        return null;
    }
  }

  private executeAgent(step: WorkflowStep, execution: WorkflowExecution): unknown {
    // Placeholder for agent execution
    // In production, would instantiate and run the specified agent
    return { agentResult: 'pending' };
  }

  private executeDecision(step: WorkflowStep, execution: WorkflowExecution): boolean {
    // Placeholder for decision logic
    return true;
  }

  private executeTransform(step: WorkflowStep, execution: WorkflowExecution): unknown {
    // Placeholder for data transformation
    return {};
  }

  private executeValidation(step: WorkflowStep, execution: WorkflowExecution): boolean {
    // Placeholder for validation logic
    return true;
  }
}

/**
 * Execution Planner for creating optimal execution plans
 */
class ExecutionPlanner {
  createPlan(workflow: WorkflowDefinition): ExecutionPlan {
    const { steps } = workflow;

    // Topological sort to determine execution order
    const stepIds = steps.map((s) => s.id);
    const order = this.topologicalSort(steps);

    // Identify parallelizable steps
    const parallelGroups = this.identifyParallelGroups(steps);

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(steps);

    // Estimate duration
    const estimatedDuration = this.estimateDuration(steps);

    return {
      steps: order,
      parallelGroups,
      criticalPath,
      estimatedDuration,
    };
  }

  private topologicalSort(steps: WorkflowStep[]): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (step: WorkflowStep) => {
      if (visited.has(step.id)) return;
      visited.add(step.id);

      if (step.dependencies) {
        for (const depId of step.dependencies) {
          const depStep = steps.find((s) => s.id === depId);
          if (depStep) visit(depStep);
        }
      }

      result.push(step.id);
    };

    for (const step of steps) {
      visit(step);
    }

    return result;
  }

  private identifyParallelGroups(steps: WorkflowStep[]): string[][] {
    // Placeholder: identify steps that can run in parallel
    return [steps.map((s) => s.id)];
  }

  private calculateCriticalPath(steps: WorkflowStep[]): string[] {
    // Placeholder: find longest path through dependency graph
    return steps.map((s) => s.id);
  }

  private estimateDuration(steps: WorkflowStep[]): number {
    // Placeholder: estimate total execution time
    return steps.length * 1000; // ms
  }
}

export interface WorkflowStatistics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDurationMs: number;
  lastExecution?: Date;
}

export { WorkflowEngine as default };
