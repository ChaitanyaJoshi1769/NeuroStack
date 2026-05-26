import { RedisCache } from '@neurostack/redis-cache';
import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';

export type CacheLevel = 'L1' | 'L2' | 'L3';
export type EvictionPolicy = 'LRU' | 'LFU' | 'FIFO' | 'ARC';

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number;
  level: CacheLevel;
  accessCount: number;
  lastAccessed: number;
  size: number;
}

export interface CacheConfig {
  l1Size?: number; // In-memory cache size (bytes)
  l1TTL?: number; // Default 5 minutes
  l2TTL?: number; // Default 1 hour
  l3TTL?: number; // Default 24 hours
  evictionPolicy?: EvictionPolicy;
  compressionThreshold?: number; // Size threshold for compression
  enableMonitoring?: boolean;
}

export interface CacheStats {
  level: CacheLevel;
  hitCount: number;
  missCount: number;
  hitRate: number;
  size: number;
  entryCount: number;
  avgAccessTime: number;
}

export interface CacheMetrics {
  l1: CacheStats;
  l2: CacheStats;
  l3: CacheStats;
  totalHitRate: number;
  totalSize: number;
  avgLatency: number;
}

export class PerformanceCacheLayer {
  private logger: Logger;
  private l1Cache: Map<string, CacheEntry<any>>;
  private l2Cache: RedisCache;
  private l1Stats: Map<string, { hits: number; misses: number; accessTime: number[] }>;
  private l2Stats: Map<string, { hits: number; misses: number; accessTime: number[] }>;
  private l3Stats: Map<string, { hits: number; misses: number; accessTime: number[] }>;
  private config: Required<CacheConfig>;
  private currentL1Size: number = 0;
  private accessLog: Array<{ key: string; level: CacheLevel; timestamp: number }>;

  constructor(
    l2Cache: RedisCache,
    private distributedLogger: DistributedLogger,
    logger: Logger,
    config?: CacheConfig
  ) {
    this.logger = logger.child({ component: 'PerformanceCacheLayer' });
    this.l2Cache = l2Cache;
    this.l1Cache = new Map();
    this.l1Stats = new Map();
    this.l2Stats = new Map();
    this.l3Stats = new Map();
    this.accessLog = [];

    this.config = {
      l1Size: config?.l1Size || 100 * 1024 * 1024, // 100MB default
      l1TTL: config?.l1TTL || 5 * 60 * 1000, // 5 minutes
      l2TTL: config?.l2TTL || 60 * 60 * 1000, // 1 hour
      l3TTL: config?.l3TTL || 24 * 60 * 60 * 1000, // 24 hours
      evictionPolicy: config?.evictionPolicy || 'LRU',
      compressionThreshold: config?.compressionThreshold || 1024, // 1KB
      enableMonitoring: config?.enableMonitoring !== false,
    };
  }

  async get<T>(key: string): Promise<T | null> {
    const startTime = performance.now();

    try {
      // Try L1 (in-memory)
      const l1Entry = this.l1Cache.get(key);
      if (l1Entry) {
        if (this.isExpired(l1Entry)) {
          this.l1Cache.delete(key);
          this.recordMiss('L1', key, startTime);
        } else {
          l1Entry.accessCount++;
          l1Entry.lastAccessed = Date.now();
          this.recordHit('L1', key, startTime);
          this.logAccess(key, 'L1');
          return l1Entry.value as T;
        }
      }

      this.recordMiss('L1', key, startTime);

      // Try L2 (distributed cache)
      const l2Value = await this.l2Cache.get(key);
      if (l2Value) {
        this.recordHit('L2', key, startTime);
        this.logAccess(key, 'L2');
        // Promote to L1
        await this.promoteToL1(key, l2Value);
        return l2Value as T;
      }

      this.recordMiss('L2', key, startTime);

      // L3 would be database lookup (placeholder)
      this.recordMiss('L3', key, startTime);

      return null;
    } catch (error) {
      this.logger.error({ error, key }, 'Cache get failed');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const entrySize = this.estimateSize(value);
      const ttlMs = ttl || this.config.l1TTL;

      // Always store in L2
      await this.l2Cache.set(key, value, Math.floor(ttlMs / 1000));

      // Store in L1 if fits
      if (this.currentL1Size + entrySize <= this.config.l1Size) {
        const entry: CacheEntry<T> = {
          key,
          value,
          timestamp: Date.now(),
          ttl: ttlMs,
          level: 'L1',
          accessCount: 1,
          lastAccessed: Date.now(),
          size: entrySize,
        };

        this.l1Cache.set(key, entry);
        this.currentL1Size += entrySize;
      } else {
        // Evict if necessary
        await this.evictL1(entrySize);
        const entry: CacheEntry<T> = {
          key,
          value,
          timestamp: Date.now(),
          ttl: ttlMs,
          level: 'L1',
          accessCount: 1,
          lastAccessed: Date.now(),
          size: entrySize,
        };

        this.l1Cache.set(key, entry);
        this.currentL1Size += entrySize;
      }

      this.logger.debug({ key, size: entrySize, ttl: ttlMs }, 'Cache set');
    } catch (error) {
      this.logger.error({ error, key }, 'Cache set failed');
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const l1Entry = this.l1Cache.get(key);
      if (l1Entry) {
        this.currentL1Size -= l1Entry.size;
        this.l1Cache.delete(key);
      }

      await this.l2Cache.delete(key);

      this.logger.debug({ key }, 'Cache entry deleted');
    } catch (error) {
      this.logger.error({ error, key }, 'Cache delete failed');
    }
  }

  async clear(): Promise<void> {
    try {
      this.l1Cache.clear();
      this.l1Stats.clear();
      this.l2Stats.clear();
      this.l3Stats.clear();
      this.currentL1Size = 0;
      this.accessLog = [];

      this.logger.info('Cache cleared');
    } catch (error) {
      this.logger.error({ error }, 'Cache clear failed');
    }
  }

  private async promoteToL1<T>(key: string, value: T): Promise<void> {
    const entrySize = this.estimateSize(value);

    if (this.currentL1Size + entrySize > this.config.l1Size) {
      await this.evictL1(entrySize);
    }

    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttl: this.config.l1TTL,
      level: 'L1',
      accessCount: 1,
      lastAccessed: Date.now(),
      size: entrySize,
    };

    this.l1Cache.set(key, entry);
    this.currentL1Size += entrySize;
  }

  private async evictL1(requiredSize: number): Promise<void> {
    const targetSize = this.config.l1Size * 0.75; // Evict until 75% full
    let freedSize = 0;

    const entries = Array.from(this.l1Cache.values());

    // Sort based on eviction policy
    switch (this.config.evictionPolicy) {
      case 'LRU':
        entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
        break;
      case 'LFU':
        entries.sort((a, b) => a.accessCount - b.accessCount);
        break;
      case 'FIFO':
        entries.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case 'ARC':
        // Adaptive Replacement Cache - simplified
        entries.sort((a, b) => {
          const scoreA = a.accessCount / ((Date.now() - a.timestamp) / 1000);
          const scoreB = b.accessCount / ((Date.now() - b.timestamp) / 1000);
          return scoreA - scoreB;
        });
        break;
    }

    for (const entry of entries) {
      if (freedSize >= requiredSize || this.currentL1Size - freedSize <= targetSize) {
        break;
      }

      this.l1Cache.delete(entry.key);
      freedSize += entry.size;
    }

    this.currentL1Size -= freedSize;
    this.logger.debug({ freedSize, policy: this.config.evictionPolicy }, 'L1 cache evicted');
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private estimateSize(value: any): number {
    try {
      return JSON.stringify(value).length * 2; // Rough estimate (UTF-16)
    } catch {
      return 1024; // Default fallback
    }
  }

  private recordHit(level: CacheLevel, key: string, startTime: number): void {
    const latency = performance.now() - startTime;
    const stats = this.getStats(level);
    stats.hits++;

    this.logger.debug({ level, key, latency: latency.toFixed(2) }, 'Cache hit');
  }

  private recordMiss(level: CacheLevel, key: string, startTime: number): void {
    const latency = performance.now() - startTime;
    const stats = this.getStats(level);
    stats.misses++;

    this.logger.debug({ level, key }, 'Cache miss');
  }

  private getStats(level: CacheLevel): any {
    switch (level) {
      case 'L1':
        if (!this.l1Stats.has('stats')) {
          this.l1Stats.set('stats', { hits: 0, misses: 0, accessTime: [] });
        }
        return this.l1Stats.get('stats')!;
      case 'L2':
        if (!this.l2Stats.has('stats')) {
          this.l2Stats.set('stats', { hits: 0, misses: 0, accessTime: [] });
        }
        return this.l2Stats.get('stats')!;
      case 'L3':
        if (!this.l3Stats.has('stats')) {
          this.l3Stats.set('stats', { hits: 0, misses: 0, accessTime: [] });
        }
        return this.l3Stats.get('stats')!;
    }
  }

  private logAccess(key: string, level: CacheLevel): void {
    this.accessLog.push({ key, level, timestamp: Date.now() });
    if (this.accessLog.length > 100000) {
      this.accessLog = this.accessLog.slice(-50000);
    }
  }

  async getMetrics(): Promise<CacheMetrics> {
    const l1Stat = this.l1Stats.get('stats') || { hits: 0, misses: 0 };
    const l2Stat = this.l2Stats.get('stats') || { hits: 0, misses: 0 };
    const l3Stat = this.l3Stats.get('stats') || { hits: 0, misses: 0 };

    const calculateHitRate = (hits: number, misses: number) => {
      const total = hits + misses;
      return total > 0 ? (hits / total) * 100 : 0;
    };

    const totalHits = l1Stat.hits + l2Stat.hits + l3Stat.hits;
    const totalMisses = l1Stat.misses + l2Stat.misses + l3Stat.misses;

    return {
      l1: {
        level: 'L1',
        hitCount: l1Stat.hits,
        missCount: l1Stat.misses,
        hitRate: calculateHitRate(l1Stat.hits, l1Stat.misses),
        size: this.currentL1Size,
        entryCount: this.l1Cache.size,
        avgAccessTime: l1Stat.accessTime.length > 0 ? l1Stat.accessTime.reduce((a, b) => a + b) / l1Stat.accessTime.length : 0,
      },
      l2: {
        level: 'L2',
        hitCount: l2Stat.hits,
        missCount: l2Stat.misses,
        hitRate: calculateHitRate(l2Stat.hits, l2Stat.misses),
        size: 0, // Would need Redis stats
        entryCount: 0,
        avgAccessTime: l2Stat.accessTime.length > 0 ? l2Stat.accessTime.reduce((a, b) => a + b) / l2Stat.accessTime.length : 0,
      },
      l3: {
        level: 'L3',
        hitCount: l3Stat.hits,
        missCount: l3Stat.misses,
        hitRate: calculateHitRate(l3Stat.hits, l3Stat.misses),
        size: 0,
        entryCount: 0,
        avgAccessTime: l3Stat.accessTime.length > 0 ? l3Stat.accessTime.reduce((a, b) => a + b) / l3Stat.accessTime.length : 0,
      },
      totalHitRate: (totalHits / (totalHits + totalMisses)) * 100 || 0,
      totalSize: this.currentL1Size,
      avgLatency: 0,
    };
  }

  getL1Size(): number {
    return this.currentL1Size;
  }

  getL1Capacity(): number {
    return this.config.l1Size;
  }

  getL1Utilization(): number {
    return (this.currentL1Size / this.config.l1Size) * 100;
  }
}
