import pino from 'pino';
import { generateId, MemoryType, Memory } from '@neurostack/shared';

export class MemorySystem {
  private logger = pino();
  private memories: Map<string, Memory> = new Map();
  private agentMemories: Map<string, Set<string>> = new Map();
  private memoryIndex: Map<string, Set<string>> = new Map();

  /**
   * Store a memory
   */
  storeMemory(
    tenantId: string,
    type: MemoryType,
    content: string,
    metadata: Record<string, unknown>,
    agentId?: string,
    expiresAt?: Date
  ): Memory {
    const memory: Memory = {
      id: generateId(),
      tenantId,
      agentId,
      type,
      content,
      metadata,
      createdAt: new Date(),
      expiresAt,
    };

    this.memories.set(memory.id, memory);

    // Index by tenant
    if (!this.memoryIndex.has(tenantId)) {
      this.memoryIndex.set(tenantId, new Set());
    }
    this.memoryIndex.get(tenantId)!.add(memory.id);

    // Index by agent if provided
    if (agentId) {
      const key = `${tenantId}:${agentId}`;
      if (!this.agentMemories.has(key)) {
        this.agentMemories.set(key, new Set());
      }
      this.agentMemories.get(key)!.add(memory.id);
    }

    this.logger.debug({ memoryId: memory.id }, 'Memory stored');
    return memory;
  }

  /**
   * Retrieve a memory by ID
   */
  getMemory(id: string): Memory | undefined {
    return this.memories.get(id);
  }

  /**
   * Retrieve memories for a tenant
   */
  getTenantMemories(tenantId: string, type?: MemoryType): Memory[] {
    const memoryIds = this.memoryIndex.get(tenantId) || new Set();
    const memories = Array.from(memoryIds)
      .map((id) => this.memories.get(id))
      .filter((m): m is Memory => m !== undefined && m.tenantId === tenantId);

    if (type) {
      return memories.filter((m) => m.type === type);
    }

    return memories;
  }

  /**
   * Retrieve memories for an agent
   */
  getAgentMemories(tenantId: string, agentId: string, type?: MemoryType): Memory[] {
    const key = `${tenantId}:${agentId}`;
    const memoryIds = this.agentMemories.get(key) || new Set();
    const memories = Array.from(memoryIds)
      .map((id) => this.memories.get(id))
      .filter((m): m is Memory => m !== undefined && m.agentId === agentId);

    if (type) {
      return memories.filter((m) => m.type === type);
    }

    return memories;
  }

  /**
   * Update a memory
   */
  updateMemory(id: string, updates: Partial<Memory>): Memory {
    const existing = this.memories.get(id);
    if (!existing) {
      throw new Error(`Memory ${id} not found`);
    }

    const updated: Memory = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
    };

    this.memories.set(id, updated);
    this.logger.debug({ memoryId: id }, 'Memory updated');
    return updated;
  }

  /**
   * Delete a memory
   */
  deleteMemory(id: string): boolean {
    const memory = this.memories.get(id);
    if (!memory) {
      return false;
    }

    this.memories.delete(id);

    // Remove from indices
    const tenantIds = this.memoryIndex.get(memory.tenantId);
    if (tenantIds) {
      tenantIds.delete(id);
    }

    if (memory.agentId) {
      const key = `${memory.tenantId}:${memory.agentId}`;
      const agentIds = this.agentMemories.get(key);
      if (agentIds) {
        agentIds.delete(id);
      }
    }

    this.logger.debug({ memoryId: id }, 'Memory deleted');
    return true;
  }

  /**
   * Clear expired memories
   */
  clearExpired(): number {
    const now = new Date();
    let cleared = 0;

    for (const [id, memory] of this.memories) {
      if (memory.expiresAt && memory.expiresAt < now) {
        this.deleteMemory(id);
        cleared++;
      }
    }

    this.logger.info({ cleared }, 'Expired memories cleared');
    return cleared;
  }

  /**
   * Search memories (simple substring matching)
   */
  searchMemories(
    tenantId: string,
    query: string,
    type?: MemoryType
  ): Memory[] {
    const memories = this.getTenantMemories(tenantId, type);
    const lowerQuery = query.toLowerCase();

    return memories.filter((m) =>
      m.content.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get memory statistics
   */
  getStats(tenantId: string): Record<string, unknown> {
    const memories = this.getTenantMemories(tenantId);
    const typeStats: Record<string, number> = {};

    for (const memory of memories) {
      typeStats[memory.type] = (typeStats[memory.type] || 0) + 1;
    }

    return {
      totalMemories: memories.length,
      memoryTypes: typeStats,
      oldestMemory: memories.length > 0 ? memories[0].createdAt : null,
      newestMemory: memories.length > 0 ? memories[memories.length - 1].createdAt : null,
    };
  }
}

/**
 * Context Engine - assembles relevant context for agents
 */
export class ContextEngine {
  private logger = pino();
  private memorySystem: MemorySystem;

  constructor(memorySystem: MemorySystem) {
    this.memorySystem = memorySystem;
  }

  /**
   * Assemble context for an agent
   */
  assembleContext(
    tenantId: string,
    agentId: string,
    query: string,
    maxTokens: number = 4000
  ): Record<string, unknown> {
    // Get agent memories
    const episodicMemories = this.memorySystem.getAgentMemories(
      tenantId,
      agentId,
      MemoryType.EPISODIC
    );
    const semanticMemories = this.memorySystem.getAgentMemories(
      tenantId,
      agentId,
      MemoryType.SEMANTIC
    );

    // Filter relevant memories
    const relevantEpisodic = this.filterRelevantMemories(
      episodicMemories,
      query
    );
    const relevantSemantic = this.filterRelevantMemories(
      semanticMemories,
      query
    );

    // Rank by relevance and recency
    const rankedEpisodic = this.rankMemories(relevantEpisodic);
    const rankedSemantic = this.rankMemories(relevantSemantic);

    // Pack into context respecting token limit
    const context: Record<string, unknown> = {
      query,
      episodicMemories: [],
      semanticMemories: [],
      assembledAt: new Date(),
    };

    let tokenCount = 0;
    const estimatedTokensPerMemory = 100;

    for (const memory of rankedEpisodic) {
      if (tokenCount + estimatedTokensPerMemory > maxTokens) break;
      (context.episodicMemories as any[]).push({
        id: memory.id,
        content: memory.content,
        createdAt: memory.createdAt,
      });
      tokenCount += estimatedTokensPerMemory;
    }

    for (const memory of rankedSemantic) {
      if (tokenCount + estimatedTokensPerMemory > maxTokens) break;
      (context.semanticMemories as any[]).push({
        id: memory.id,
        content: memory.content,
      });
      tokenCount += estimatedTokensPerMemory;
    }

    this.logger.debug(
      {
        agentId,
        episodicCount: (context.episodicMemories as any[]).length,
        semanticCount: (context.semanticMemories as any[]).length,
      },
      'Context assembled'
    );

    return context;
  }

  private filterRelevantMemories(memories: Memory[], query: string): Memory[] {
    const lowerQuery = query.toLowerCase();
    return memories.filter((m) =>
      m.content.toLowerCase().includes(lowerQuery)
    );
  }

  private rankMemories(memories: Memory[]): Memory[] {
    // Sort by recency (newest first)
    return [...memories].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}
