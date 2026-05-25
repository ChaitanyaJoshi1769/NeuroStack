import pino from 'pino';
import { generateId } from '@neurostack/shared';

/**
 * Redis Cache Types
 */

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  ttl?: number; // milliseconds
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, any>;
}

export interface CacheConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetries?: number;
  retryDelay?: number;
  defaultTTL?: number;
}

export interface CacheStats {
  totalKeys: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  memoryUsage: number;
  avgAccessTime: number;
}

export interface CachePattern {
  pattern: string;
  count: number;
  avgTTL: number;
  hits: number;
}

export interface DistributedLock {
  key: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
  renewalCount: number;
}

/**
 * Redis Distributed Cache
 *
 * High-performance distributed caching layer for multi-node deployment:
 * - Automatic TTL management
 * - Distributed locking
 * - Pattern-based operations
 * - Cache statistics
 */
export class RedisCache {
  private logger = pino();
  private config: CacheConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private stats: CacheStats;
  private locks: Map<string, DistributedLock> = new Map();
  private accessTimes: number[] = [];
  private readonly maxAccessTimeSamples = 10000;

  constructor(config: CacheConfig) {
    this.config = {
      defaultTTL: 3600000, // 1 hour default
      maxRetries: 3,
      retryDelay: 100,
      ...config,
    };

    this.stats = {
      totalKeys: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      evictions: 0,
      memoryUsage: 0,
      avgAccessTime: 0,
    };

    this.logger.info({ config: this.config }, 'RedisCache initialized');
  }

  /**
   * Set cache value
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const startTime = Date.now();

    try {
      const expiresAt = ttl ? Date.now() + ttl : Date.now() + (this.config.defaultTTL || 3600000);

      const entry: CacheEntry<T> = {
        key,
        value,
        ttl,
        createdAt: Date.now(),
        expiresAt,
      };

      this.cache.set(key, entry);

      // Check expiration and clean up
      if (expiresAt <= Date.now()) {
        this.cache.delete(key);
      }

      this.stats.totalKeys = this.cache.size;
      this.recordAccessTime(Date.now() - startTime);

      this.logger.debug({ key, ttl }, 'Cache value set');
    } catch (error) {
      this.logger.error({ error, key }, 'Error setting cache value');
      throw error;
    }
  }

  /**
   * Get cache value
   */
  get<T>(key: string): T | undefined {
    const startTime = Date.now();

    try {
      const entry = this.cache.get(key);

      if (!entry) {
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      // Check expiration
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        this.cache.delete(key);
        this.stats.evictions++;
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      this.stats.hits++;
      this.updateHitRate();
      this.recordAccessTime(Date.now() - startTime);

      this.logger.debug({ key }, 'Cache hit');

      return entry.value as T;
    } catch (error) {
      this.logger.error({ error, key }, 'Error getting cache value');
      throw error;
    }
  }

  /**
   * Delete cache value
   */
  delete(key: string): boolean {
    try {
      const deleted = this.cache.delete(key);
      this.stats.totalKeys = this.cache.size;

      if (deleted) {
        this.logger.debug({ key }, 'Cache value deleted');
      }

      return deleted;
    } catch (error) {
      this.logger.error({ error, key }, 'Error deleting cache value');
      throw error;
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    try {
      const count = this.cache.size;
      this.cache.clear();
      this.stats.totalKeys = 0;
      this.stats.evictions += count;

      this.logger.info({ count }, 'Cache cleared');
    } catch (error) {
      this.logger.error({ error }, 'Error clearing cache');
      throw error;
    }
  }

  /**
   * Acquire distributed lock
   */
  async acquireLock(key: string, ttl: number = 5000): Promise<string> {
    const owner = generateId();
    const acquiredAt = Date.now();
    const expiresAt = acquiredAt + ttl;

    try {
      // Check if lock already exists and is not expired
      const existingLock = this.locks.get(key);
      if (existingLock && existingLock.expiresAt > Date.now()) {
        throw new Error(`Lock already held by ${existingLock.owner}`);
      }

      const lock: DistributedLock = {
        key,
        owner,
        acquiredAt,
        expiresAt,
        renewalCount: 0,
      };

      this.locks.set(key, lock);

      this.logger.debug({ key, owner, ttl }, 'Lock acquired');

      return owner;
    } catch (error) {
      this.logger.error({ error, key }, 'Failed to acquire lock');
      throw error;
    }
  }

  /**
   * Release distributed lock
   */
  releaseLock(key: string, owner: string): boolean {
    try {
      const lock = this.locks.get(key);

      if (!lock) {
        this.logger.warn({ key }, 'Lock not found');
        return false;
      }

      if (lock.owner !== owner) {
        throw new Error(`Lock owner mismatch: expected ${lock.owner}, got ${owner}`);
      }

      this.locks.delete(key);

      this.logger.debug({ key, owner }, 'Lock released');

      return true;
    } catch (error) {
      this.logger.error({ error, key, owner }, 'Error releasing lock');
      throw error;
    }
  }

  /**
   * Renew distributed lock
   */
  renewLock(key: string, owner: string, ttl: number = 5000): boolean {
    try {
      const lock = this.locks.get(key);

      if (!lock) {
        return false;
      }

      if (lock.owner !== owner) {
        return false;
      }

      lock.expiresAt = Date.now() + ttl;
      lock.renewalCount++;

      this.locks.set(key, lock);

      this.logger.debug({ key, renewalCount: lock.renewalCount }, 'Lock renewed');

      return true;
    } catch (error) {
      this.logger.error({ error, key }, 'Error renewing lock');
      throw error;
    }
  }

  /**
   * Get multiple values
   */
  mget<T>(keys: string[]): (T | undefined)[] {
    return keys.map((key) => this.get<T>(key));
  }

  /**
   * Set multiple values
   */
  mset(entries: Array<[string, any, number?]>): void {
    for (const [key, value, ttl] of entries) {
      this.set(key, value, ttl);
    }
  }

  /**
   * Get keys matching pattern
   */
  keys(pattern: string): string[] {
    const regex = this.patternToRegex(pattern);
    const matchedKeys: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        matchedKeys.push(key);
      }
    }

    return matchedKeys;
  }

  /**
   * Delete keys matching pattern
   */
  deletePattern(pattern: string): number {
    const keysToDelete = this.keys(pattern);
    let count = 0;

    for (const key of keysToDelete) {
      if (this.delete(key)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.stats.memoryUsage = this.estimateMemoryUsage();
    return { ...this.stats };
  }

  /**
   * Get pattern statistics
   */
  getPatternStats(pattern: string): CachePattern {
    const keys = this.keys(pattern);
    let totalTTL = 0;
    let patternHits = 0;

    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry) {
        if (entry.ttl) {
          totalTTL += entry.ttl;
        }
      }
    }

    return {
      pattern,
      count: keys.length,
      avgTTL: keys.length > 0 ? totalTTL / keys.length : 0,
      hits: patternHits,
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    let count = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.cache.delete(key);
        this.stats.evictions++;
        count++;
      }
    }

    // Clean up expired locks
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }

    this.stats.totalKeys = this.cache.size;

    this.logger.info({ count }, 'Cache cleanup completed');

    return count;
  }

  // Private methods

  private patternToRegex(pattern: string): RegExp {
    // Convert simple glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${regexPattern}$`);
  }

  private recordAccessTime(time: number): void {
    this.accessTimes.push(time);

    if (this.accessTimes.length > this.maxAccessTimeSamples) {
      this.accessTimes.shift();
    }

    this.stats.avgAccessTime =
      this.accessTimes.reduce((a, b) => a + b, 0) / this.accessTimes.length;
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage in bytes
    let totalSize = 0;

    for (const entry of this.cache.values()) {
      totalSize += entry.key.length * 2; // UTF-16
      totalSize += JSON.stringify(entry.value).length;
    }

    return totalSize;
  }
}

export default RedisCache;
