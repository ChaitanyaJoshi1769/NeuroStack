// Core Domain Types

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  config: TenantConfig;
}

export interface TenantConfig {
  maxConcurrentQueries: number;
  maxVectorDimensions: number;
  retentionDays: number;
  enabledFeatures: string[];
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export enum UserRole {
  ADMIN = 'admin',
  ANALYST = 'analyst',
  ENGINEER = 'engineer',
  VIEWER = 'viewer',
}

// Query Types

export interface Query {
  id: string;
  tenantId: string;
  userId: string;
  sql: string;
  semanticQuery?: SemanticQuery;
  executedAt: Date;
  duration: number;
  rowCount: number;
  status: QueryStatus;
}

export enum QueryStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface SemanticQuery {
  intent: string;
  entities: SemanticEntity[];
  operations: SemanticOperation[];
}

export interface SemanticEntity {
  name: string;
  type: string;
  semanticType?: string;
}

export interface SemanticOperation {
  type: 'filter' | 'aggregate' | 'join' | 'sort';
  target: string;
  params: Record<string, unknown>;
}

// Semantic Types

export interface Metric {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  definition: MetricDefinition;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MetricDefinition {
  sql: string;
  dimensions: string[];
  measures: string[];
  filters?: string[];
}

export interface Entity {
  id: string;
  tenantId: string;
  name: string;
  semanticType: string;
  definition: Record<string, unknown>;
  relationships: EntityRelationship[];
}

export interface EntityRelationship {
  targetId: string;
  type: string;
  metadata?: Record<string, unknown>;
}

// Vector Types

export interface Embedding {
  id: string;
  tenantId: string;
  content: string;
  model: string;
  vector: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  embedding: Embedding;
}

export interface Memory {
  id: string;
  tenantId: string;
  agentId?: string;
  type: MemoryType;
  content: string;
  embedding?: Embedding;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt?: Date;
}

export enum MemoryType {
  EPISODIC = 'episodic',
  SEMANTIC = 'semantic',
  PROCEDURAL = 'procedural',
}

// Agent Types

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: AgentType;
  config: AgentConfig;
  tools: Tool[];
  createdAt: Date;
  updatedAt: Date;
}

export enum AgentType {
  ANALYTICS = 'analytics',
  DATA_QUALITY = 'data_quality',
  ORCHESTRATION = 'orchestration',
  OPERATIONS = 'operations',
  CUSTOM = 'custom',
}

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxSteps?: number;
  systemPrompt?: string;
  toolTimeout?: number;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: string;
  timeout: number;
}

export interface AgentExecution {
  id: string;
  agentId: string;
  tenantId: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  steps: ExecutionStep[];
}

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

export interface ExecutionStep {
  id: string;
  type: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration: number;
  status: ExecutionStatus;
}

// Lineage Types

export interface LineageNode {
  id: string;
  type: 'dataset' | 'transformation' | 'metric' | 'query';
  name: string;
  metadata: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  type: 'depends_on' | 'produces' | 'consumes';
}

export interface Lineage {
  tenantId: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

// API Response Types

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  metadata?: ResponseMetadata;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResponseMetadata {
  timestamp: Date;
  version: string;
  requestId: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

// Pipeline Types

export interface DataPipeline {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  dag: DAGNode[];
  schedule: PipelineSchedule;
  status: PipelineStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface DAGNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  dependencies: string[];
}

export interface PipelineSchedule {
  type: 'cron' | 'event' | 'manual';
  expression?: string;
  timezone?: string;
}

export enum PipelineStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  FAILED = 'failed',
  ARCHIVED = 'archived',
}

// Analytics Types

export interface Dataset {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  schema: ColumnDefinition[];
  rowCount: number;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnDefinition {
  name: string;
  type: DataType;
  nullable: boolean;
  description?: string;
  tags?: string[];
}

export enum DataType {
  STRING = 'string',
  INTEGER = 'integer',
  FLOAT = 'float',
  BOOLEAN = 'boolean',
  DATE = 'date',
  TIMESTAMP = 'timestamp',
  JSON = 'json',
  ARRAY = 'array',
}

export interface Insight {
  id: string;
  tenantId: string;
  datasetId: string;
  title: string;
  description: string;
  type: InsightType;
  data: Record<string, unknown>;
  confidence: number;
  createdAt: Date;
}

export enum InsightType {
  ANOMALY = 'anomaly',
  TREND = 'trend',
  CORRELATION = 'correlation',
  PATTERN = 'pattern',
  OUTLIER = 'outlier',
}

// Error Types

export class NeuroStackError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'NeuroStackError';
  }
}

export class ValidationError extends NeuroStackError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends NeuroStackError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class AuthenticationError extends NeuroStackError {
  constructor(message: string = 'Authentication failed') {
    super('AUTHENTICATION_ERROR', message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends NeuroStackError {
  constructor(message: string = 'Not authorized') {
    super('AUTHORIZATION_ERROR', message, 403);
    this.name = 'AuthorizationError';
  }
}
