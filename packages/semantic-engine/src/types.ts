// Semantic Engine specific types

export interface SemanticDefinition {
  id: string;
  tenantId: string;
  name: string;
  type: DefinitionType;
  description: string;
  definition: Record<string, unknown>;
  tags: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum DefinitionType {
  METRIC = 'metric',
  DIMENSION = 'dimension',
  ENTITY = 'entity',
  RELATIONSHIP = 'relationship',
  CALCULATION = 'calculation',
}

export interface MetricDefinition extends SemanticDefinition {
  type: DefinitionType.METRIC;
  definition: {
    sql: string;
    dimensions?: string[];
    measures?: string[];
    filters?: Record<string, string>;
    aggregation: AggregationType;
  };
}

export enum AggregationType {
  SUM = 'sum',
  AVG = 'avg',
  COUNT = 'count',
  MIN = 'min',
  MAX = 'max',
  DISTINCT_COUNT = 'distinct_count',
}

export interface DimensionDefinition extends SemanticDefinition {
  type: DefinitionType.DIMENSION;
  definition: {
    dataType: string;
    values?: string[];
    hierarchy?: string[];
  };
}

export interface EntityDefinition extends SemanticDefinition {
  type: DefinitionType.ENTITY;
  definition: {
    primaryKey: string;
    attributes: Record<string, unknown>;
  };
}

export interface RelationshipDefinition extends SemanticDefinition {
  type: DefinitionType.RELATIONSHIP;
  definition: {
    source: string;
    target: string;
    joinCondition: string;
    cardinality: Cardinality;
  };
}

export enum Cardinality {
  ONE_TO_ONE = 'one_to_one',
  ONE_TO_MANY = 'one_to_many',
  MANY_TO_MANY = 'many_to_many',
}

export interface SemanticContext {
  definitions: Map<string, SemanticDefinition>;
  relationships: Map<string, RelationshipDefinition>;
  metadata: ContextMetadata;
}

export interface ContextMetadata {
  version: string;
  lastUpdated: Date;
  source: string;
}

export interface SemanticValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  definition: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  definition: string;
  message: string;
}

export interface SemanticResolution {
  originalQuery: string;
  resolvedDefinitions: ResolvedDefinition[];
  ambiguities: Ambiguity[];
}

export interface ResolvedDefinition {
  term: string;
  definition: SemanticDefinition;
  confidence: number;
}

export interface Ambiguity {
  term: string;
  candidates: SemanticDefinition[];
}

export interface OntologyNode {
  id: string;
  name: string;
  type: string;
  attributes: Record<string, unknown>;
  children: string[];
  parent?: string;
}

export interface OntologyGraph {
  nodes: Map<string, OntologyNode>;
  edges: Map<string, OntologyEdge>;
}

export interface OntologyEdge {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}
