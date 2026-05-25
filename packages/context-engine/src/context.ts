import pino from 'pino';
import { generateId } from '@neurostack/shared';
import { SemanticEngine, MetricDefinition } from '@neurostack/semantic-engine';
import { VectorRuntime, VectorSearchQuery } from '@neurostack/vector-runtime';

/**
 * Context Engine Types
 */
export interface ContextSource {
  id: string;
  name: string;
  type: SourceType;
  priority: number;
  embeddings?: number[];
}

export enum SourceType {
  METRIC_DEFINITION = 'metric_definition',
  ENTITY_DEFINITION = 'entity_definition',
  DOCUMENT = 'document',
  CODE_SNIPPET = 'code_snippet',
  EXAMPLE = 'example',
  HISTORICAL_INSIGHT = 'historical_insight',
}

export interface QueryIntent {
  primary: IntentType;
  secondary?: IntentType[];
  confidence: number;
  entities: string[];
  metrics: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
}

export enum IntentType {
  ANALYZE = 'analyze',
  FORECAST = 'forecast',
  COMPARE = 'compare',
  EXPLAIN = 'explain',
  OPTIMIZE = 'optimize',
  DIAGNOSE = 'diagnose',
  TREND = 'trend',
  ANOMALY = 'anomaly',
}

export interface RankedContext {
  source: ContextSource;
  relevanceScore: number;
  semanticDistance?: number;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface AssembledContext {
  id: string;
  query: string;
  intent: QueryIntent;
  sources: RankedContext[];
  summary: string;
  tokenCount: number;
  assembledAt: Date;
}

export interface ContextRoute {
  domain: string;
  intent: IntentType;
  relevantMetrics: string[];
  relevantEntities: string[];
  requiredDefinitions: string[];
  suggestedAgents: string[];
}

/**
 * Advanced Semantic Context Resolution and Routing Engine
 */
export class ContextEngine {
  private logger = pino();
  private semanticEngine: SemanticEngine;
  private vectorRuntime: VectorRuntime;
  private sources: Map<string, ContextSource> = new Map();
  private contextCache: Map<string, AssembledContext> = new Map();
  private intentClassifier: IntentClassifier;
  private contextRouter: ContextRouter;

  constructor(
    semanticEngine: SemanticEngine,
    vectorRuntime: VectorRuntime
  ) {
    this.semanticEngine = semanticEngine;
    this.vectorRuntime = vectorRuntime;
    this.intentClassifier = new IntentClassifier();
    this.contextRouter = new ContextRouter();
  }

  /**
   * Register a context source
   */
  registerSource(
    name: string,
    type: SourceType,
    priority: number,
    embeddings?: number[]
  ): ContextSource {
    const source: ContextSource = {
      id: generateId(),
      name,
      type,
      priority,
      embeddings,
    };

    this.sources.set(source.id, source);
    this.logger.info({ sourceId: source.id, name, type }, 'Context source registered');
    return source;
  }

  /**
   * Detect query intent through semantic analysis
   */
  detectIntent(query: string, metrics: string[] = []): QueryIntent {
    const intent = this.intentClassifier.classify(query);
    const detectedEntities = this.extractEntities(query);
    const detectedMetrics = metrics.length > 0
      ? metrics
      : this.extractMetrics(query);

    return {
      primary: intent.primary,
      secondary: intent.secondary,
      confidence: intent.confidence,
      entities: detectedEntities,
      metrics: detectedMetrics,
    };
  }

  /**
   * Assemble relevant context for a query
   */
  async assembleContext(
    query: string,
    tenantId: string,
    maxTokens: number = 4000
  ): Promise<AssembledContext> {
    const cacheKey = `${tenantId}:${query}`;
    if (this.contextCache.has(cacheKey)) {
      return this.contextCache.get(cacheKey)!;
    }

    // Detect intent
    const intent = this.detectIntent(query);

    // Get relevant sources
    const rankedSources = await this.rankSources(query, intent, tenantId);

    // Filter sources by token budget
    const selectedSources = this.selectSourcesByTokenBudget(
      rankedSources,
      maxTokens
    );

    // Assemble context
    const context: AssembledContext = {
      id: generateId(),
      query,
      intent,
      sources: selectedSources,
      summary: this.generateContextSummary(selectedSources),
      tokenCount: this.estimateTokenCount(selectedSources),
      assembledAt: new Date(),
    };

    // Cache assembled context
    this.contextCache.set(cacheKey, context);

    this.logger.info(
      { queryId: context.id, sourceCount: selectedSources.length },
      'Context assembled'
    );

    return context;
  }

  /**
   * Route context based on query intent and domain
   */
  routeContext(
    intent: QueryIntent,
    domain: string = 'general'
  ): ContextRoute {
    return this.contextRouter.route(intent, domain);
  }

  /**
   * Get metrics relevant to intent
   */
  getRelevantMetrics(intent: QueryIntent): MetricDefinition[] {
    const metrics: MetricDefinition[] = [];

    for (const metricName of intent.metrics) {
      const definition = this.semanticEngine.getDefinition(metricName);
      if (definition && 'aggregationType' in definition) {
        metrics.push(definition as MetricDefinition);
      }
    }

    return metrics;
  }

  /**
   * Resolve semantic context with business definitions
   */
  resolveSemanticContext(query: string): Map<string, unknown> {
    const context = new Map<string, unknown>();

    // Extract and resolve metrics
    const metrics = this.extractMetrics(query);
    for (const metric of metrics) {
      const definition = this.semanticEngine.getDefinition(metric);
      if (definition) {
        context.set(metric, definition);
      }
    }

    // Extract and resolve entities
    const entities = this.extractEntities(query);
    for (const entity of entities) {
      const definition = this.semanticEngine.getDefinition(entity);
      if (definition) {
        context.set(entity, definition);
      }
    }

    return context;
  }

  /**
   * Clear context cache (useful for updates)
   */
  clearCache(): void {
    this.contextCache.clear();
    this.logger.info('Context cache cleared');
  }

  // Private helper methods

  private async rankSources(
    query: string,
    intent: QueryIntent,
    tenantId: string
  ): Promise<RankedContext[]> {
    const ranked: RankedContext[] = [];

    for (const source of this.sources.values()) {
      let score = source.priority * 0.5; // Base priority weight

      // Type-based scoring
      const typeScore = this.getTypeScore(source.type, intent);
      score += typeScore * 0.3;

      // Vector-based semantic matching (if embeddings available)
      if (source.embeddings) {
        const semanticScore = await this.getSemanticScore(
          query,
          source.embeddings,
          tenantId
        );
        score += semanticScore * 0.2;
      }

      ranked.push({
        source,
        relevanceScore: Math.min(score, 1.0),
      });
    }

    // Sort by relevance
    ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return ranked;
  }

  private getTypeScore(type: SourceType, intent: QueryIntent): number {
    switch (intent.primary) {
      case IntentType.ANALYZE:
      case IntentType.COMPARE:
        return type === SourceType.METRIC_DEFINITION ? 0.9 : 0.5;
      case IntentType.FORECAST:
        return type === SourceType.HISTORICAL_INSIGHT ? 0.9 : 0.5;
      case IntentType.EXPLAIN:
        return type === SourceType.DOCUMENT ? 0.9 : 0.5;
      case IntentType.OPTIMIZE:
        return type === SourceType.CODE_SNIPPET ? 0.9 : 0.5;
      case IntentType.DIAGNOSE:
        return type === SourceType.EXAMPLE ? 0.9 : 0.5;
      default:
        return 0.6;
    }
  }

  private async getSemanticScore(
    query: string,
    embeddings: number[],
    tenantId: string
  ): Promise<number> {
    // This would integrate with VectorRuntime for semantic similarity
    // For now, return a placeholder
    return 0.7;
  }

  private selectSourcesByTokenBudget(
    sources: RankedContext[],
    maxTokens: number
  ): RankedContext[] {
    const selected: RankedContext[] = [];
    let totalTokens = 0;

    for (const source of sources) {
      const sourceTokens = source.source.name.split(' ').length * 3; // Rough estimate
      if (totalTokens + sourceTokens <= maxTokens) {
        selected.push(source);
        totalTokens += sourceTokens;
      }
    }

    return selected;
  }

  private generateContextSummary(sources: RankedContext[]): string {
    const names = sources.map((s) => s.source.name).slice(0, 5);
    return `Context assembled from: ${names.join(', ')}`;
  }

  private estimateTokenCount(sources: RankedContext[]): number {
    return sources.reduce((total, s) => {
      return total + (s.source.name.split(' ').length * 3);
    }, 0);
  }

  private extractMetrics(query: string): string[] {
    // Simple extraction - in production, use NLP-based approach
    const metrics: string[] = [];
    const definitions = this.semanticEngine.listDefinitions();

    for (const def of definitions) {
      if (query.toLowerCase().includes(def.name.toLowerCase())) {
        metrics.push(def.name);
      }
    }

    return metrics;
  }

  private extractEntities(query: string): string[] {
    // Simple extraction - in production, use NER model
    const words = query.toLowerCase().split(/\s+/);
    return words.filter((w) => w.length > 3).slice(0, 5);
  }
}

/**
 * Intent Classification Engine
 */
class IntentClassifier {
  private intentPatterns: Map<IntentType, RegExp[]> = new Map([
    [
      IntentType.ANALYZE,
      [/analyze|break down|understand|examine|assess/i],
    ],
    [IntentType.FORECAST, [/predict|forecast|project|expect|estimate/i]],
    [IntentType.COMPARE, [/compare|versus|vs|difference|contrast/i]],
    [IntentType.EXPLAIN, [/explain|why|how|reason|cause/i]],
    [IntentType.OPTIMIZE, [/optimize|improve|increase|decrease|best/i]],
    [IntentType.DIAGNOSE, [/problem|issue|error|bug|broken/i]],
    [IntentType.TREND, [/trend|growth|decline|change|direction/i]],
    [IntentType.ANOMALY, [/anomaly|unusual|unexpected|outlier|different/i]],
  ]);

  classify(query: string): {
    primary: IntentType;
    secondary?: IntentType[];
    confidence: number;
  } {
    const scores = new Map<IntentType, number>();

    for (const [intentType, patterns] of this.intentPatterns) {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          score += 1.0;
        }
      }
      if (score > 0) {
        scores.set(intentType, score);
      }
    }

    if (scores.size === 0) {
      return {
        primary: IntentType.ANALYZE,
        confidence: 0.5,
      };
    }

    const sorted = Array.from(scores.entries()).sort(
      (a, b) => b[1] - a[1]
    );

    return {
      primary: sorted[0][0],
      secondary: sorted.slice(1, 3).map(([intent]) => intent),
      confidence: Math.min(sorted[0][1] / 2, 1.0),
    };
  }
}

/**
 * Context Routing Engine
 */
class ContextRouter {
  private routes: Map<string, ContextRoute> = new Map();

  constructor() {
    this.initializeDefaultRoutes();
  }

  route(intent: QueryIntent, domain: string): ContextRoute {
    const routeKey = `${domain}:${intent.primary}`;
    return (
      this.routes.get(routeKey) ||
      this.createDynamicRoute(intent, domain)
    );
  }

  private initializeDefaultRoutes(): void {
    // Analytics domain routes
    this.routes.set('analytics:analyze', {
      domain: 'analytics',
      intent: IntentType.ANALYZE,
      relevantMetrics: [],
      relevantEntities: [],
      requiredDefinitions: ['metric', 'dimension'],
      suggestedAgents: ['AnalyticsAgent', 'DataQualityAgent'],
    });

    this.routes.set('analytics:forecast', {
      domain: 'analytics',
      intent: IntentType.FORECAST,
      relevantMetrics: [],
      relevantEntities: [],
      requiredDefinitions: ['metric', 'time_dimension'],
      suggestedAgents: ['AnalyticsAgent', 'ForecastingAgent'],
    });

    // Operations domain routes
    this.routes.set('operations:diagnose', {
      domain: 'operations',
      intent: IntentType.DIAGNOSE,
      relevantMetrics: [],
      relevantEntities: [],
      requiredDefinitions: ['system', 'event'],
      suggestedAgents: ['DiagnosticsAgent', 'DataQualityAgent'],
    });

    // Business domain routes
    this.routes.set('business:optimize', {
      domain: 'business',
      intent: IntentType.OPTIMIZE,
      relevantMetrics: [],
      relevantEntities: [],
      requiredDefinitions: ['business_metric', 'constraint'],
      suggestedAgents: ['OptimizationAgent'],
    });
  }

  private createDynamicRoute(intent: QueryIntent, domain: string): ContextRoute {
    return {
      domain,
      intent: intent.primary,
      relevantMetrics: intent.metrics,
      relevantEntities: intent.entities,
      requiredDefinitions: [],
      suggestedAgents: this.suggestAgents(intent),
    };
  }

  private suggestAgents(intent: QueryIntent): string[] {
    const agents: string[] = [];

    switch (intent.primary) {
      case IntentType.ANALYZE:
        agents.push('AnalyticsAgent');
        break;
      case IntentType.FORECAST:
        agents.push('AnalyticsAgent');
        agents.push('ForecastingAgent');
        break;
      case IntentType.DIAGNOSE:
        agents.push('DiagnosticsAgent');
        break;
      case IntentType.OPTIMIZE:
        agents.push('OptimizationAgent');
        break;
      default:
        agents.push('GeneralAgent');
    }

    return agents;
  }
}

export { ContextEngine as default };
