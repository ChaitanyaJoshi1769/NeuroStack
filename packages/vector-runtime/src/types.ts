// Vector Runtime Types

export interface VectorConfig {
  dimension: number;
  metric: DistanceMetric;
  indexType: IndexType;
  batchSize?: number;
  maxRetries?: number;
}

export enum DistanceMetric {
  COSINE = 'cosine',
  EUCLIDEAN = 'euclidean',
  DOT_PRODUCT = 'dot_product',
  MANHATTAN = 'manhattan',
}

export enum IndexType {
  HNSW = 'hnsw',
  IVFFLAT = 'ivfflat',
  FLAT = 'flat',
}

export interface Vector {
  id: string;
  tenantId: string;
  embedding: number[];
  metadata: VectorMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface VectorMetadata {
  source: string;
  sourceId?: string;
  contentHash?: string;
  tags?: string[];
  customMetadata?: Record<string, unknown>;
}

export interface VectorSearchQuery {
  vector: number[];
  topK: number;
  filters?: VectorFilter[];
  threshold?: number;
}

export interface VectorFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export enum FilterOperator {
  EQ = 'eq',
  NE = 'ne',
  GT = 'gt',
  LT = 'lt',
  GTE = 'gte',
  LTE = 'lte',
  IN = 'in',
  NOT_IN = 'not_in',
  CONTAINS = 'contains',
}

export interface VectorSearchResult {
  id: string;
  score: number;
  vector: Vector;
  distance: number;
}

export interface BatchInsertResult {
  insertedCount: number;
  skippedCount: number;
  errors: BatchInsertError[];
}

export interface BatchInsertError {
  vectorId: string;
  error: string;
}

export interface VectorIndexStats {
  vectorCount: number;
  dimension: number;
  indexSize: number;
  lastUpdated: Date;
}

export interface HybridSearchQuery {
  vectorQuery: VectorSearchQuery;
  keywordTerms?: string[];
  keywordWeight?: number;
  vectorWeight?: number;
}

export interface HybridSearchResult {
  vectorResults: VectorSearchResult[];
  keywordResults: KeywordSearchResult[];
  mergedResults: MergedSearchResult[];
}

export interface KeywordSearchResult {
  id: string;
  score: number;
  matchedFields: string[];
}

export interface MergedSearchResult {
  id: string;
  vectorScore: number;
  keywordScore?: number;
  finalScore: number;
  vector: Vector;
}

export interface EmbeddingModel {
  name: string;
  provider: string;
  version: string;
  dimension: number;
  maxInputLength?: number;
  costPerMillionTokens?: number;
}

export interface EmbeddingRequest {
  texts: string[];
  model: string;
  tenantId: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface MemoryVector extends Vector {
  memoryId: string;
  memoryType: string;
  expiresAt?: Date;
}

export interface RetrievalContext {
  query: string;
  embedding: number[];
  topK: number;
  filters?: VectorFilter[];
  includeMetadata?: boolean;
}

export interface RetrievalResult {
  query: string;
  results: VectorSearchResult[];
  executionTimeMs: number;
}
