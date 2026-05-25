import pino from 'pino';
import { generateId } from '@neurostack/shared';
import {
  SemanticDefinition,
  DefinitionType,
  SemanticContext,
  SemanticValidationResult,
  SemanticResolution,
  OntologyGraph,
  RelationshipDefinition,
  OntologyNode,
  OntologyEdge,
} from './types';

export class SemanticEngine {
  private logger = pino();
  private contexts: Map<string, SemanticContext> = new Map();
  private ontologies: Map<string, OntologyGraph> = new Map();
  private definitions: Map<string, SemanticDefinition> = new Map();

  /**
   * Register a semantic definition
   */
  registerDefinition(
    tenantId: string,
    definition: Omit<SemanticDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ): SemanticDefinition {
    const fullDefinition: SemanticDefinition = {
      ...definition,
      id: generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.definitions.set(fullDefinition.id, fullDefinition);

    // Update context
    const context = this.contexts.get(tenantId) || this.createContext(tenantId);
    context.definitions.set(fullDefinition.id, fullDefinition);
    this.contexts.set(tenantId, context);

    this.logger.info({ definitionId: fullDefinition.id }, 'Definition registered');
    return fullDefinition;
  }

  /**
   * Get a semantic definition by ID
   */
  getDefinition(id: string): SemanticDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * List all definitions for a tenant
   */
  listDefinitions(tenantId: string): SemanticDefinition[] {
    const context = this.contexts.get(tenantId);
    if (!context) {
      return [];
    }
    return Array.from(context.definitions.values());
  }

  /**
   * Update a semantic definition
   */
  updateDefinition(
    id: string,
    updates: Partial<SemanticDefinition>
  ): SemanticDefinition {
    const existing = this.definitions.get(id);
    if (!existing) {
      throw new Error(`Definition ${id} not found`);
    }

    const updated: SemanticDefinition = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    this.definitions.set(id, updated);
    this.logger.info({ definitionId: id }, 'Definition updated');
    return updated;
  }

  /**
   * Validate semantic definitions
   */
  validate(tenantId: string): SemanticValidationResult {
    const context = this.contexts.get(tenantId);
    if (!context) {
      return { valid: true, errors: [], warnings: [] };
    }

    const errors: Array<{ definition: string; message: string; code: string }> = [];
    const warnings: Array<{ definition: string; message: string }> = [];

    // Validate each definition
    for (const [id, def] of context.definitions) {
      // Check for required fields
      if (!def.name || !def.description) {
        errors.push({
          definition: id,
          message: 'Missing required fields',
          code: 'MISSING_FIELDS',
        });
      }

      // Type-specific validation
      switch (def.type) {
        case DefinitionType.METRIC:
          if (!def.definition.sql) {
            errors.push({
              definition: id,
              message: 'Metric missing SQL definition',
              code: 'INVALID_METRIC',
            });
          }
          break;
        case DefinitionType.RELATIONSHIP:
          const rel = def as RelationshipDefinition;
          if (!rel.definition.source || !rel.definition.target) {
            errors.push({
              definition: id,
              message: 'Relationship missing source or target',
              code: 'INVALID_RELATIONSHIP',
            });
          }
          break;
      }
    }

    // Check for missing relationships
    for (const rel of Array.from(context.relationships.values())) {
      if (!context.definitions.has(rel.definition.source)) {
        warnings.push({
          definition: rel.id,
          message: `Source entity ${rel.definition.source} not defined`,
        });
      }
      if (!context.definitions.has(rel.definition.target)) {
        warnings.push({
          definition: rel.id,
          message: `Target entity ${rel.definition.target} not defined`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Resolve semantic terms to definitions
   */
  resolve(tenantId: string, terms: string[]): SemanticResolution {
    const context = this.contexts.get(tenantId);
    if (!context) {
      return {
        originalQuery: terms.join(', '),
        resolvedDefinitions: [],
        ambiguities: [],
      };
    }

    const resolvedDefinitions = [];
    const ambiguities = [];

    for (const term of terms) {
      const matches: Array<{ def: SemanticDefinition; score: number }> = [];

      // Find matching definitions
      for (const def of context.definitions.values()) {
        const score = this.calculateSimilarity(term.toLowerCase(), def.name.toLowerCase());
        if (score > 0.5) {
          matches.push({ def, score });
        }
      }

      if (matches.length === 1) {
        resolvedDefinitions.push({
          term,
          definition: matches[0].def,
          confidence: matches[0].score,
        });
      } else if (matches.length > 1) {
        matches.sort((a, b) => b.score - a.score);
        ambiguities.push({
          term,
          candidates: matches.map((m) => m.def),
        });
      }
    }

    return {
      originalQuery: terms.join(', '),
      resolvedDefinitions,
      ambiguities,
    };
  }

  /**
   * Create or get an ontology for a tenant
   */
  createOntology(tenantId: string): OntologyGraph {
    let ontology = this.ontologies.get(tenantId);
    if (!ontology) {
      ontology = {
        nodes: new Map(),
        edges: new Map(),
      };
      this.ontologies.set(tenantId, ontology);
    }
    return ontology;
  }

  /**
   * Add a node to the ontology
   */
  addOntologyNode(tenantId: string, node: OntologyNode): void {
    const ontology = this.createOntology(tenantId);
    ontology.nodes.set(node.id, node);
  }

  /**
   * Add an edge to the ontology
   */
  addOntologyEdge(tenantId: string, edge: OntologyEdge): void {
    const ontology = this.createOntology(tenantId);
    const edgeId = `${edge.source}-${edge.target}`;
    ontology.edges.set(edgeId, edge);
  }

  /**
   * Get ontology paths between two nodes
   */
  findOntologyPaths(
    tenantId: string,
    source: string,
    target: string
  ): string[][] {
    const ontology = this.ontologies.get(tenantId);
    if (!ontology) {
      return [];
    }

    const paths: string[][] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: string[]): void => {
      if (current === target) {
        paths.push([...path, current]);
        return;
      }

      if (visited.has(current)) {
        return;
      }

      visited.add(current);

      for (const [edgeId, edge] of ontology.edges) {
        if (edge.source === current) {
          dfs(edge.target, [...path, current]);
        }
      }

      visited.delete(current);
    };

    dfs(source, []);
    return paths;
  }

  /**
   * Enrich a query with semantic context
   */
  enrichQuery(tenantId: string, query: string): Record<string, unknown> {
    const context = this.contexts.get(tenantId);
    if (!context) {
      return { query };
    }

    return {
      query,
      semanticDefinitions: Array.from(context.definitions.values()).map((def) => ({
        id: def.id,
        name: def.name,
        type: def.type,
      })),
      semanticContext: {
        version: context.metadata.version,
        lastUpdated: context.metadata.lastUpdated,
      },
    };
  }

  // Private helper methods

  private createContext(tenantId: string): SemanticContext {
    return {
      definitions: new Map(),
      relationships: new Map(),
      metadata: {
        version: '1.0.0',
        lastUpdated: new Date(),
        source: tenantId,
      },
    };
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Levenshtein distance-based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }
}

// Export singleton instance
export const semanticEngine = new SemanticEngine();
