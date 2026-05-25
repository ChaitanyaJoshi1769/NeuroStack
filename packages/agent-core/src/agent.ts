import pino from 'pino';
import { generateId } from '@neurostack/shared';
import type { Agent, AgentConfig, Tool, AgentExecution, ExecutionStep, ExecutionStatus } from '@neurostack/shared';

export class BaseAgent {
  protected logger = pino();
  protected id: string;
  protected config: AgentConfig;
  protected tools: Map<string, Tool> = new Map();
  protected executions: Map<string, AgentExecution> = new Map();

  constructor(
    public tenantId: string,
    public name: string,
    public description: string,
    config: Partial<AgentConfig> = {}
  ) {
    this.id = generateId();
    this.config = {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxSteps: 10,
      toolTimeout: 30000,
      ...config,
    };
  }

  /**
   * Register a tool with the agent
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.logger.debug({ toolName: tool.name }, 'Tool registered');
  }

  /**
   * Get a registered tool
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools
   */
  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute the agent with input
   */
  async execute(input: Record<string, unknown>): Promise<AgentExecution> {
    const executionId = generateId();
    const execution: AgentExecution = {
      id: executionId,
      agentId: this.id,
      tenantId: this.tenantId,
      input,
      status: 'running',
      startedAt: new Date(),
      steps: [],
    };

    this.executions.set(executionId, execution);

    try {
      execution.steps = await this.plan(input);

      if (execution.steps.some((step) => step.status === 'failed')) {
        execution.status = 'failed';
      } else {
        execution.status = 'success';
        execution.output = this.aggregateResults(execution.steps);
      }
    } catch (error) {
      execution.status = 'failed';
      this.logger.error(error, 'Agent execution failed');
    }

    execution.completedAt = new Date();
    return execution;
  }

  /**
   * Get an execution history
   */
  getExecution(id: string): AgentExecution | undefined {
    return this.executions.get(id);
  }

  /**
   * List all executions
   */
  listExecutions(): AgentExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Plan steps for execution (override in subclasses)
   */
  protected async plan(input: Record<string, unknown>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    // Default planning logic
    const step: ExecutionStep = {
      id: generateId(),
      type: 'default',
      input,
      duration: 0,
      status: 'success',
    };

    steps.push(step);
    return steps;
  }

  /**
   * Aggregate results from execution steps
   */
  protected aggregateResults(steps: ExecutionStep[]): Record<string, unknown> {
    const result: Record<string, unknown> = {
      stepCount: steps.length,
      steps: steps.map((step) => ({
        id: step.id,
        type: step.type,
        status: step.status,
        duration: step.duration,
      })),
    };

    const lastStep = steps[steps.length - 1];
    if (lastStep?.output) {
      result.output = lastStep.output;
    }

    return result;
  }
}

/**
 * Analytics Agent - performs autonomous analysis and reporting
 */
export class AnalyticsAgent extends BaseAgent {
  constructor(tenantId: string) {
    super(tenantId, 'Analytics Agent', 'Autonomous analytics and reporting', {
      model: 'claude-3-5-sonnet-20241022',
      maxSteps: 5,
    });
  }

  protected async plan(input: Record<string, unknown>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    // Step 1: Understand the question
    const understandStep: ExecutionStep = {
      id: generateId(),
      type: 'understand',
      input,
      duration: 100,
      status: 'success',
      output: { intent: 'analyze_data' },
    };
    steps.push(understandStep);

    // Step 2: Retrieve relevant data
    const retrieveStep: ExecutionStep = {
      id: generateId(),
      type: 'retrieve',
      input: understandStep.output,
      duration: 500,
      status: 'success',
      output: { dataPoints: [] },
    };
    steps.push(retrieveStep);

    // Step 3: Analyze
    const analyzeStep: ExecutionStep = {
      id: generateId(),
      type: 'analyze',
      input: retrieveStep.output,
      duration: 1000,
      status: 'success',
      output: { insights: [] },
    };
    steps.push(analyzeStep);

    return steps;
  }
}

/**
 * Data Quality Agent - monitors and improves data quality
 */
export class DataQualityAgent extends BaseAgent {
  constructor(tenantId: string) {
    super(tenantId, 'Data Quality Agent', 'Data quality monitoring and remediation', {
      model: 'claude-3-5-sonnet-20241022',
      maxSteps: 3,
    });
  }

  protected async plan(input: Record<string, unknown>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    // Step 1: Scan data
    const scanStep: ExecutionStep = {
      id: generateId(),
      type: 'scan',
      input,
      duration: 2000,
      status: 'success',
      output: { anomalies: [] },
    };
    steps.push(scanStep);

    // Step 2: Validate
    const validateStep: ExecutionStep = {
      id: generateId(),
      type: 'validate',
      input: scanStep.output,
      duration: 1000,
      status: 'success',
      output: { issues: [] },
    };
    steps.push(validateStep);

    return steps;
  }
}

/**
 * Orchestration Agent - manages data pipelines and workflows
 */
export class OrchestrationAgent extends BaseAgent {
  constructor(tenantId: string) {
    super(tenantId, 'Orchestration Agent', 'Pipeline and workflow orchestration', {
      model: 'claude-3-5-sonnet-20241022',
      maxSteps: 8,
    });
  }

  protected async plan(input: Record<string, unknown>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    // Step 1: Parse workflow definition
    const parseStep: ExecutionStep = {
      id: generateId(),
      type: 'parse',
      input,
      duration: 100,
      status: 'success',
      output: { dag: [] },
    };
    steps.push(parseStep);

    // Step 2: Execute workflow
    const executeStep: ExecutionStep = {
      id: generateId(),
      type: 'execute',
      input: parseStep.output,
      duration: 5000,
      status: 'success',
      output: { results: [] },
    };
    steps.push(executeStep);

    return steps;
  }
}
