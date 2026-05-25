import express, { Express, Request, Response } from 'express';
import pino from 'pino';
import { generateId } from '@neurostack/shared';
import {
  AnalyticsAgent,
  DataQualityAgent,
  OrchestrationAgent,
} from '@neurostack/agent-core';
import { MemorySystem, ContextEngine } from '@neurostack/memory-system';

const logger = pino();
const app: Express = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Initialize systems
const memorySystem = new MemorySystem();
const contextEngine = new ContextEngine(memorySystem);

// Agent registry
const agents: Map<string, any> = new Map();

// ==================== Routes ====================

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'agent-orchestrator',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Register an agent
 */
app.post('/agents', (req: Request, res: Response) => {
  const { tenantId, type } = req.body;

  if (!tenantId || !type) {
    return res.status(400).json({
      error: 'Missing required fields: tenantId, type',
    });
  }

  let agent;
  switch (type) {
    case 'analytics':
      agent = new AnalyticsAgent(tenantId);
      break;
    case 'data_quality':
      agent = new DataQualityAgent(tenantId);
      break;
    case 'orchestration':
      agent = new OrchestrationAgent(tenantId);
      break;
    default:
      return res.status(400).json({
        error: `Unknown agent type: ${type}`,
      });
  }

  agents.set(agent.id, agent);

  res.status(201).json({
    agent_id: agent.id,
    tenant_id: tenantId,
    name: agent.name,
    description: agent.description,
    type,
    created_at: new Date().toISOString(),
  });
});

/**
 * List agents for a tenant
 */
app.get('/agents', (req: Request, res: Response) => {
  const { tenantId } = req.query;

  const tenantAgents = Array.from(agents.values()).filter(
    (a) => a.tenantId === tenantId
  );

  res.json({
    agents: tenantAgents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
    })),
    count: tenantAgents.length,
  });
});

/**
 * Execute an agent
 */
app.post('/agents/:agentId/execute', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { input } = req.body;

  const agent = agents.get(agentId);
  if (!agent) {
    return res.status(404).json({
      error: `Agent ${agentId} not found`,
    });
  }

  try {
    logger.info({ agentId, input }, 'Executing agent');

    const execution = await agent.execute(input || {});

    res.json({
      execution_id: execution.id,
      agent_id: agentId,
      status: execution.status,
      steps: execution.steps.length,
      output: execution.output,
      started_at: execution.startedAt,
      completed_at: execution.completedAt,
    });
  } catch (error) {
    logger.error(error, 'Agent execution failed');
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get agent execution history
 */
app.get('/agents/:agentId/executions', (req: Request, res: Response) => {
  const { agentId } = req.params;

  const agent = agents.get(agentId);
  if (!agent) {
    return res.status(404).json({
      error: `Agent ${agentId} not found`,
    });
  }

  const executions = agent.listExecutions();

  res.json({
    agent_id: agentId,
    executions: executions.map((e) => ({
      id: e.id,
      status: e.status,
      input: e.input,
      output: e.output,
      started_at: e.startedAt,
      completed_at: e.completedAt,
    })),
    count: executions.length,
  });
});

/**
 * Get execution details
 */
app.get(
  '/agents/:agentId/executions/:executionId',
  (req: Request, res: Response) => {
    const { agentId, executionId } = req.params;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        error: `Agent ${agentId} not found`,
      });
    }

    const execution = agent.getExecution(executionId);
    if (!execution) {
      return res.status(404).json({
        error: `Execution ${executionId} not found`,
      });
    }

    res.json({
      id: execution.id,
      agent_id: agentId,
      status: execution.status,
      input: execution.input,
      output: execution.output,
      steps: execution.steps,
      started_at: execution.startedAt,
      completed_at: execution.completedAt,
    });
  }
);

/**
 * Store agent memory
 */
app.post('/memory/store', (req: Request, res: Response) => {
  const { tenantId, agentId, type, content, metadata } = req.body;

  const memory = memorySystem.storeMemory(
    tenantId,
    type,
    content,
    metadata || {},
    agentId
  );

  res.status(201).json({
    memory_id: memory.id,
    agent_id: agentId,
    type,
    created_at: memory.createdAt,
  });
});

/**
 * Retrieve agent memory
 */
app.post('/memory/retrieve', (req: Request, res: Response) => {
  const { tenantId, agentId, query, maxTokens } = req.body;

  const context = contextEngine.assembleContext(
    tenantId,
    agentId,
    query,
    maxTokens || 4000
  );

  res.json(context);
});

/**
 * Get memory statistics
 */
app.get('/memory/stats', (req: Request, res: Response) => {
  const { tenantId } = req.query;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Missing required parameter: tenantId',
    });
  }

  const stats = memorySystem.getStats(tenantId as string);

  res.json(stats);
});

/**
 * Orchestrate a workflow
 */
app.post('/workflows/execute', async (req: Request, res: Response) => {
  const { tenantId, definition } = req.body;

  const workflowId = generateId();
  logger.info({ workflowId, tenantId }, 'Executing workflow');

  res.json({
    workflow_id: workflowId,
    status: 'running',
    steps: definition.steps || [],
    created_at: new Date().toISOString(),
  });
});

// ==================== Error Handling ====================

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
  });
});

// ==================== Server Startup ====================

app.listen(port, () => {
  logger.info(`Agent Orchestrator listening on port ${port}`);
  logger.info('Service: NeuroStack Agent Orchestrator');
  logger.info('Version: 0.1.0');
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error(reason, 'Unhandled rejection');
});

process.on('uncaughtException', (error: Error) => {
  logger.error(error, 'Uncaught exception');
  process.exit(1);
});
