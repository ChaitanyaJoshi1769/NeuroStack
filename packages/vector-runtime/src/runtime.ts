import pino from 'pino';
import { generateId } from '@neurostack/shared';
import {
  Vector,
  VectorConfig,
  VectorSearchQuery,
  VectorSearchResult,
  VectorMetadata,
  BatchInsertResult,
  VectorIndexStats,
  HybridSearchQuery,
  HybridSearchResult,
  RetrievalContext,
  RetrievalResult,
  DistanceMetric,
} from './types';

export class VectorRuntime {
  private logger = pino();
  private vectors: Map<string, Vector> = new Map();
  private indices: Map<string, VectorIndex> = new Map();
  private configs: Map<string, VectorConfig> = new Map();

  /**
   * Initialize a vector index for a tenant
   */
  initializeIndex(tenantId: string, config: VectorConfig): void {
    const index = new VectorIndex(config);
    this.indices.set(tenantId, index);
    this.configs.set(tenantId, config);
    this.logger.info({ tenantId }, 'Vector index initialized');
  }

  /**
   * Insert a single vector
   */
  insertVector(
    tenantId: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Vector {
    const vector: Vector = {
      id: generateId(),
      tenantId,
      embedding,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.vectors.set(vector.id, vector);

    const index = this.indices.get(tenantId);
    if (index) {
      index.insert(vector.id, embedding);
    }

    return vector;
  }

  /**
   * Batch insert vectors
   */
  insertVectorsBatch(
    tenantId: string,
    vectors: Array<{
      embedding: number[];
      metadata: VectorMetadata;
    }>
  ): BatchInsertResult {
    const result: BatchInsertResult = {
      insertedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    const config = this.configs.get(tenantId);
    if (!config) {
      throw new Error(`Vector index not initialized for tenant ${tenantId}`);
    }

    const index = this.indices.get(tenantId)!;

    for (const vec of vectors) {
      try {
        if (vec.embedding.length !== config.dimension) {
          throw new Error(
            `Vector dimension mismatch. Expected ${config.dimension}, got ${vec.embedding.length}`
          );
        }

        const vector = this.insertVector(tenantId, vec.embedding, vec.metadata);
        index.insert(vector.id, vec.embedding);
        result.insertedCount++;
      } catch (error) {
        result.errors.push({
          vectorId: vec.metadata.sourceId || 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.info(
      { tenantId, insertedCount: result.insertedCount },
      'Batch insert completed'
    );

    return result;
  }

  /**
   * Search for similar vectors
   */
  search(tenantId: string, query: VectorSearchQuery): VectorSearchResult[] {
    const index = this.indices.get(tenantId);
    if (!index) {
      throw new Error(`Vector index not initialized for tenant ${tenantId}`);
    }

    const config = this.configs.get(tenantId)!;

    // Validate query vector dimension
    if (query.vector.length !== config.dimension) {
      throw new Error(
        `Query vector dimension mismatch. Expected ${config.dimension}, got ${query.vector.length}`
      );
    }

    // Search in index
    const candidates = index.search(query.vector, query.topK * 2);

    // Calculate distances and apply filters
    const results: VectorSearchResult[] = [];

    for (const [vectorId, distance] of candidates) {
      const vector = this.vectors.get(vectorId);
      if (!vector) continue;

      // Apply threshold filter
      if (query.threshold !== undefined) {
        const normalizedDistance = this.normalizeDistance(distance, config.metric);
        if (normalizedDistance < query.threshold) {
          continue;
        }
      }

      // Apply custom filters
      if (query.filters && !this.matchesFilters(vector.metadata, query.filters)) {
        continue;
      }

      results.push({
        id: vectorId,
        score: this.calculateScore(distance, config.metric),
        vector,
        distance,
      });

      if (results.length >= query.topK) {
        break;
      }
    }

    return results;
  }

  /**
   * Hybrid search combining vector and keyword search
   */
  hybridSearch(
    tenantId: string,
    query: HybridSearchQuery
  ): HybridSearchResult {
    const vectorResults = this.search(tenantId, query.vectorQuery);

    // For now, keyword search is a placeholder
    // In production, this would integrate with a full-text search engine
    const keywordResults = [];

    // Merge results
    const mergedResults = vectorResults.map((vr) => ({
      id: vr.id,
      vectorScore: vr.score,
      keywordScore: undefined,
      finalScore: vr.score * (query.vectorWeight || 1.0),
      vector: vr.vector,
    }));

    mergedResults.sort((a, b) => b.finalScore - a.finalScore);

    return {
      vectorResults,
      keywordResults,
      mergedResults,
    };
  }

  /**
   * Retrieve vectors based on retrieval context
   */
  retrieve(tenantId: string, context: RetrievalContext): RetrievalResult {
    const startTime = Date.now();

    const results = this.search(tenantId, {
      vector: context.embedding,
      topK: context.topK,
      filters: context.filters,
    });

    const executionTimeMs = Date.now() - startTime;

    return {
      query: context.query,
      results,
      executionTimeMs,
    };
  }

  /**
   * Get vector by ID
   */
  getVector(id: string): Vector | undefined {
    return this.vectors.get(id);
  }

  /**
   * Delete a vector
   */
  deleteVector(tenantId: string, id: string): boolean {
    const vector = this.vectors.get(id);
    if (!vector || vector.tenantId !== tenantId) {
      return false;
    }

    this.vectors.delete(id);

    const index = this.indices.get(tenantId);
    if (index) {
      index.delete(id);
    }

    return true;
  }

  /**
   * Get index statistics
   */
  getIndexStats(tenantId: string): VectorIndexStats {
    const config = this.configs.get(tenantId);
    if (!config) {
      throw new Error(`Vector index not initialized for tenant ${tenantId}`);
    }

    const count = Array.from(this.vectors.values()).filter(
      (v) => v.tenantId === tenantId
    ).length;

    return {
      vectorCount: count,
      dimension: config.dimension,
      indexSize: count * config.dimension * 4, // Approximate: vectors are float32
      lastUpdated: new Date(),
    };
  }

  /**
   * Clear all vectors for a tenant
   */
  clearIndex(tenantId: string): void {
    const vectorIds = Array.from(this.vectors.entries())
      .filter(([_, v]) => v.tenantId === tenantId)
      .map(([id, _]) => id);

    for (const id of vectorIds) {
      this.vectors.delete(id);
    }

    const index = this.indices.get(tenantId);
    if (index) {
      index.clear();
    }

    this.logger.info({ tenantId }, 'Vector index cleared');
  }

  // Private helper methods

  private normalizeDistance(distance: number, metric: DistanceMetric): number {
    switch (metric) {
      case DistanceMetric.COSINE:
        // Cosine distance is already between 0 and 2, normalize to 0-1
        return distance / 2;
      case DistanceMetric.EUCLIDEAN:
        // Euclidean distance needs normalization based on dimensions
        return Math.min(distance, 1);
      case DistanceMetric.DOT_PRODUCT:
        // Invert to make higher = more similar
        return 1 / (1 + Math.exp(-distance));
      default:
        return distance;
    }
  }

  private calculateScore(distance: number, metric: DistanceMetric): number {
    switch (metric) {
      case DistanceMetric.COSINE:
        return 1 - distance / 2;
      case DistanceMetric.EUCLIDEAN:
        return 1 / (1 + distance);
      case DistanceMetric.DOT_PRODUCT:
        return 1 / (1 + Math.exp(-distance));
      default:
        return 0.5;
    }
  }

  private matchesFilters(
    metadata: VectorMetadata,
    filters: any[]
  ): boolean {
    for (const filter of filters) {
      const value = this.getMetadataValue(metadata, filter.field);
      if (!this.applyFilter(value, filter)) {
        return false;
      }
    }
    return true;
  }

  private getMetadataValue(
    metadata: VectorMetadata,
    field: string
  ): unknown {
    if (field in metadata) {
      return (metadata as any)[field];
    }
    if (metadata.customMetadata && field in metadata.customMetadata) {
      return metadata.customMetadata[field];
    }
    return undefined;
  }

  private applyFilter(value: unknown, filter: any): boolean {
    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'ne':
        return value !== filter.value;
      case 'gt':
        return (value as number) > filter.value;
      case 'lt':
        return (value as number) < filter.value;
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      case 'contains':
        return typeof value === 'string' && value.includes(filter.value as string);
      default:
        return true;
    }
  }
}

/**
 * Simple in-memory vector index implementation
 * In production, this would be replaced with a real vector database
 */
class VectorIndex {
  private vectors: Map<string, number[]> = new Map();
  private config: VectorConfig;

  constructor(config: VectorConfig) {
    this.config = config;
  }

  insert(id: string, embedding: number[]): void {
    this.vectors.set(id, embedding);
  }

  delete(id: string): void {
    this.vectors.delete(id);
  }

  search(query: number[], topK: number): Array<[string, number]> {
    const results: Array<[string, number]> = [];

    for (const [id, embedding] of this.vectors) {
      const distance = this.calculateDistance(query, embedding);
      results.push([id, distance]);
    }

    results.sort((a, b) => b[1] - a[1]);
    return results.slice(0, topK);
  }

  clear(): void {
    this.vectors.clear();
  }

  private calculateDistance(vec1: number[], vec2: number[]): number {
    switch (this.config.metric) {
      case DistanceMetric.COSINE:
        return this.cosineSimilarity(vec1, vec2);
      case DistanceMetric.EUCLIDEAN:
        return this.euclideanDistance(vec1, vec2);
      case DistanceMetric.DOT_PRODUCT:
        return this.dotProduct(vec1, vec2);
      default:
        return 0;
    }
  }

  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = this.dotProduct(vec1, vec2);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, x) => sum + x * x, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, x) => sum + x * x, 0));
    return dotProduct / (magnitude1 * magnitude2);
  }

  private euclideanDistance(vec1: number[], vec2: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = vec1[i] - vec2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private dotProduct(vec1: number[], vec2: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      sum += vec1[i] * vec2[i];
    }
    return sum;
  }
}

export { VectorIndex };
