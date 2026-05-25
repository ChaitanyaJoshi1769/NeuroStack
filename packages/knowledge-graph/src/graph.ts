import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Knowledge Graph Types
 */
export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export enum EntityType {
  BUSINESS_METRIC = 'business_metric',
  DIMENSION = 'dimension',
  ENTITY = 'entity',
  SYSTEM = 'system',
  PROCESS = 'process',
  USER = 'user',
  DATASET = 'dataset',
  ALGORITHM = 'algorithm',
  RULE = 'rule',
  DOMAIN = 'domain',
}

export interface Relationship {
  id: string;
  type: RelationType;
  source: string; // Entity ID
  target: string; // Entity ID
  strength: number; // 0-1
  direction: 'directed' | 'undirected';
  properties?: Record<string, unknown>;
  createdAt: Date;
}

export enum RelationType {
  DEPENDS_ON = 'depends_on',
  IMPACTS = 'impacts',
  CONTAINS = 'contains',
  DERIVED_FROM = 'derived_from',
  CORRELATED_WITH = 'correlated_with',
  OWNS = 'owns',
  DEFINED_BY = 'defined_by',
  MEASURES = 'measures',
  USES = 'uses',
  PART_OF = 'part_of',
}

export interface GraphPath {
  nodes: Entity[];
  relationships: Relationship[];
  totalStrength: number;
}

export interface PatternMatch {
  entities: Entity[];
  relationships: Relationship[];
  confidence: number;
  explanation: string;
}

export interface SemanticRelationship {
  entity1: string;
  entity2: string;
  relationshipType: RelationType;
  confidence: number;
  reasoning: string;
}

/**
 * Enterprise Knowledge Graph System
 */
export class KnowledgeGraph {
  private logger = pino();
  private entities: Map<string, Entity> = new Map();
  private relationships: Map<string, Relationship> = new Map();
  private entityIndex: Map<string, Set<string>> = new Map(); // Type -> Entity IDs
  private adjacencyList: Map<string, Set<string>> = new Map(); // Entity ID -> Connected Entity IDs
  private reasoningEngine: ReasoningEngine;

  constructor() {
    this.reasoningEngine = new ReasoningEngine(this);
  }

  /**
   * Add an entity to the graph
   */
  addEntity(
    type: EntityType,
    name: string,
    properties: Record<string, unknown> = {}
  ): Entity {
    const entity: Entity = {
      id: generateId(),
      type,
      name,
      properties,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.entities.set(entity.id, entity);

    // Update index
    if (!this.entityIndex.has(type)) {
      this.entityIndex.set(type, new Set());
    }
    this.entityIndex.get(type)!.add(entity.id);

    this.logger.debug({ entityId: entity.id, type, name }, 'Entity added');
    return entity;
  }

  /**
   * Add a relationship between entities
   */
  addRelationship(
    type: RelationType,
    sourceId: string,
    targetId: string,
    strength: number = 0.8,
    directed: boolean = true
  ): Relationship {
    const source = this.entities.get(sourceId);
    const target = this.entities.get(targetId);

    if (!source || !target) {
      throw new Error('Invalid source or target entity');
    }

    const relationship: Relationship = {
      id: generateId(),
      type,
      source: sourceId,
      target: targetId,
      strength,
      direction: directed ? 'directed' : 'undirected',
      createdAt: new Date(),
    };

    this.relationships.set(relationship.id, relationship);

    // Update adjacency list
    if (!this.adjacencyList.has(sourceId)) {
      this.adjacencyList.set(sourceId, new Set());
    }
    this.adjacencyList.get(sourceId)!.add(targetId);

    if (!directed) {
      if (!this.adjacencyList.has(targetId)) {
        this.adjacencyList.set(targetId, new Set());
      }
      this.adjacencyList.get(targetId)!.add(sourceId);
    }

    this.logger.debug(
      { relationshipId: relationship.id, type, source: sourceId, target: targetId },
      'Relationship added'
    );
    return relationship;
  }

  /**
   * Find shortest path between two entities
   */
  findShortestPath(sourceId: string, targetId: string): GraphPath | null {
    const source = this.entities.get(sourceId);
    const target = this.entities.get(targetId);

    if (!source || !target) return null;

    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[]; rels: Relationship[] }> = [
      { id: sourceId, path: [sourceId], rels: [] },
    ];

    while (queue.length > 0) {
      const { id, path, rels } = queue.shift()!;

      if (id === targetId) {
        const nodes = path.map((nid) => this.entities.get(nid)!);
        return {
          nodes,
          relationships: rels,
          totalStrength: rels.reduce((sum, r) => sum + r.strength, 0) / rels.length,
        };
      }

      if (visited.has(id)) continue;
      visited.add(id);

      const neighbors = this.adjacencyList.get(id) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          const rel = this.findRelationship(id, neighborId);
          queue.push({
            id: neighborId,
            path: [...path, neighborId],
            rels: rel ? [...rels, rel] : rels,
          });
        }
      }
    }

    return null;
  }

  /**
   * Find all paths up to specified depth
   */
  findPaths(
    sourceId: string,
    targetId: string,
    maxDepth: number = 5
  ): GraphPath[] {
    const paths: GraphPath[] = [];
    const source = this.entities.get(sourceId);
    const target = this.entities.get(targetId);

    if (!source || !target) return paths;

    const visited = new Set<string>();
    this.dfs(sourceId, targetId, [], [], visited, maxDepth, paths);

    return paths;
  }

  /**
   * Pattern matching on the graph
   */
  findPattern(pattern: EntityType[]): PatternMatch[] {
    const matches: PatternMatch[] = [];

    // Find chains of entities matching the pattern
    for (const firstEntity of this.entities.values()) {
      if (firstEntity.type !== pattern[0]) continue;

      const pathMatches = this.findPatternChains(
        firstEntity.id,
        pattern,
        1,
        [firstEntity],
        []
      );
      matches.push(...pathMatches);
    }

    return matches;
  }

  /**
   * Infer semantic relationships
   */
  inferRelationships(): SemanticRelationship[] {
    const inferred: SemanticRelationship[] = [];

    // Transitive closure: if A depends on B and B depends on C, infer A depends on C
    for (const [entityId, entity] of this.entities) {
      const dependsOn = this.getOutgoingRelationships(
        entityId,
        RelationType.DEPENDS_ON
      );

      for (const rel1 of dependsOn) {
        const targetDependsOn = this.getOutgoingRelationships(
          rel1.target,
          RelationType.DEPENDS_ON
        );

        for (const rel2 of targetDependsOn) {
          // Check if already exists
          if (!this.findRelationship(entityId, rel2.target)) {
            inferred.push({
              entity1: entityId,
              entity2: rel2.target,
              relationshipType: RelationType.DEPENDS_ON,
              confidence: rel1.strength * rel2.strength,
              reasoning: `Transitive: ${entity.name} -> ${this.entities.get(rel1.target)?.name} -> ${this.entities.get(rel2.target)?.name}`,
            });
          }
        }
      }
    }

    return inferred;
  }

  /**
   * Get entities of a specific type
   */
  getEntitiesByType(type: EntityType): Entity[] {
    const ids = this.entityIndex.get(type) || new Set();
    return Array.from(ids).map((id) => this.entities.get(id)!);
  }

  /**
   * Get outgoing relationships
   */
  getOutgoingRelationships(
    entityId: string,
    type?: RelationType
  ): Relationship[] {
    return Array.from(this.relationships.values()).filter(
      (r) => r.source === entityId && (!type || r.type === type)
    );
  }

  /**
   * Get incoming relationships
   */
  getIncomingRelationships(
    entityId: string,
    type?: RelationType
  ): Relationship[] {
    return Array.from(this.relationships.values()).filter(
      (r) => r.target === entityId && (!type || r.type === type)
    );
  }

  /**
   * Analyze impact of entity changes
   */
  analyzeImpact(entityId: string): ImpactAnalysis {
    const impacted = new Set<string>();
    const paths: Map<string, GraphPath> = new Map();

    // Find all entities affected by changes to this entity
    this.bfs(entityId, RelationType.IMPACTS, (targetId, path) => {
      impacted.add(targetId);
      paths.set(targetId, path);
    });

    return {
      sourceEntity: this.entities.get(entityId),
      impactedEntities: Array.from(impacted).map((id) => this.entities.get(id)!),
      impactPaths: paths,
      severityScore: impacted.size / this.entities.size,
    };
  }

  /**
   * Get graph statistics
   */
  getStatistics(): GraphStatistics {
    return {
      entityCount: this.entities.size,
      relationshipCount: this.relationships.size,
      entityTypeDistribution: this.getEntityTypeDistribution(),
      relationshipTypeDistribution: this.getRelationshipTypeDistribution(),
      averageDegree: this.calculateAverageDegree(),
    };
  }

  // Private helper methods

  private findRelationship(sourceId: string, targetId: string): Relationship | null {
    for (const rel of this.relationships.values()) {
      if (rel.source === sourceId && rel.target === targetId) {
        return rel;
      }
    }
    return null;
  }

  private dfs(
    current: string,
    target: string,
    path: string[],
    rels: Relationship[],
    visited: Set<string>,
    depth: number,
    paths: GraphPath[]
  ): void {
    if (depth === 0 || visited.has(current)) return;

    path.push(current);
    visited.add(current);

    if (current === target && path.length > 1) {
      paths.push({
        nodes: path.map((id) => this.entities.get(id)!),
        relationships: rels,
        totalStrength: rels.reduce((sum, r) => sum + r.strength, 0) / (rels.length || 1),
      });
    }

    const neighbors = this.adjacencyList.get(current) || new Set();
    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        const rel = this.findRelationship(current, neighborId);
        const newRels = rel ? [...rels, rel] : rels;
        this.dfs(neighborId, target, [...path], newRels, visited, depth - 1, paths);
      }
    }
  }

  private findPatternChains(
    currentId: string,
    pattern: EntityType[],
    patternIndex: number,
    entities: Entity[],
    relationships: Relationship[]
  ): PatternMatch[] {
    const matches: PatternMatch[] = [];

    if (patternIndex === pattern.length) {
      matches.push({
        entities,
        relationships,
        confidence: 0.85,
        explanation: `Pattern matched: ${pattern.join(' -> ')}`,
      });
      return matches;
    }

    const neighbors = this.adjacencyList.get(currentId) || new Set();
    for (const neighborId of neighbors) {
      const neighbor = this.entities.get(neighborId);
      if (neighbor && neighbor.type === pattern[patternIndex]) {
        const rel = this.findRelationship(currentId, neighborId);
        const newRels = rel ? [...relationships, rel] : relationships;
        const subMatches = this.findPatternChains(
          neighborId,
          pattern,
          patternIndex + 1,
          [...entities, neighbor],
          newRels
        );
        matches.push(...subMatches);
      }
    }

    return matches;
  }

  private bfs(
    startId: string,
    relationshipType: RelationType,
    callback: (entityId: string, path: GraphPath) => void
  ): void {
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: GraphPath }> = [
      {
        id: startId,
        path: {
          nodes: [this.entities.get(startId)!],
          relationships: [],
          totalStrength: 1,
        },
      },
    ];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (visited.has(id)) continue;
      visited.add(id);

      const outgoing = this.getOutgoingRelationships(id, relationshipType);
      for (const rel of outgoing) {
        const target = this.entities.get(rel.target);
        if (target) {
          callback(rel.target, {
            nodes: [...path.nodes, target],
            relationships: [...path.relationships, rel],
            totalStrength: path.totalStrength * rel.strength,
          });

          queue.push({
            id: rel.target,
            path: {
              nodes: [...path.nodes, target],
              relationships: [...path.relationships, rel],
              totalStrength: path.totalStrength * rel.strength,
            },
          });
        }
      }
    }
  }

  private getEntityTypeDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const [type, ids] of this.entityIndex) {
      distribution[type] = ids.size;
    }
    return distribution;
  }

  private getRelationshipTypeDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const rel of this.relationships.values()) {
      distribution[rel.type] = (distribution[rel.type] || 0) + 1;
    }
    return distribution;
  }

  private calculateAverageDegree(): number {
    let totalDegree = 0;
    for (const neighbors of this.adjacencyList.values()) {
      totalDegree += neighbors.size;
    }
    return this.entities.size > 0 ? totalDegree / this.entities.size : 0;
  }
}

/**
 * Reasoning Engine for semantic inference
 */
class ReasoningEngine {
  private graph: KnowledgeGraph;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
  }

  infer(): void {
    // Implement semantic reasoning rules
    const inferred = this.graph.inferRelationships();
    // Apply inferred relationships back to graph
  }
}

export interface ImpactAnalysis {
  sourceEntity?: Entity;
  impactedEntities: Entity[];
  impactPaths: Map<string, GraphPath>;
  severityScore: number;
}

export interface GraphStatistics {
  entityCount: number;
  relationshipCount: number;
  entityTypeDistribution: Record<string, number>;
  relationshipTypeDistribution: Record<string, number>;
  averageDegree: number;
}

export { KnowledgeGraph as default };
