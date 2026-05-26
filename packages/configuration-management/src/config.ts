import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';

export type ConfigEnvironment = 'development' | 'staging' | 'production';
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ConfigSchema {
  key: string;
  type: ConfigValueType;
  required?: boolean;
  default?: any;
  description?: string;
  validation?: (value: any) => boolean;
  sensitive?: boolean; // For secrets
  allowedValues?: any[];
  minValue?: number;
  maxValue?: number;
}

export interface ConfigValue {
  key: string;
  value: any;
  environment: ConfigEnvironment;
  type: ConfigValueType;
  sensitive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ConfigChangeEvent {
  timestamp: Date;
  key: string;
  oldValue: any;
  newValue: any;
  changedBy: string;
  environment: ConfigEnvironment;
  reason?: string;
}

export class ConfigurationManager {
  private logger: Logger;
  private configs: Map<string, ConfigValue>;
  private schemas: Map<string, ConfigSchema>;
  private changeHistory: ConfigChangeEvent[];
  private environment: ConfigEnvironment;
  private readonly maxHistorySize = 10000;

  constructor(
    private distributedLogger: DistributedLogger,
    logger: Logger,
    environment: ConfigEnvironment = 'development'
  ) {
    this.logger = logger.child({ component: 'ConfigurationManager', environment });
    this.configs = new Map();
    this.schemas = new Map();
    this.changeHistory = [];
    this.environment = environment;

    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    // Default configurations
    const defaults = [
      { key: 'app.name', value: 'NeuroStack', environment: this.environment },
      { key: 'app.version', value: '2.5.0', environment: this.environment },
      { key: 'app.environment', value: this.environment, environment: this.environment },
      { key: 'server.port', value: this.environment === 'production' ? 8080 : 3000, environment: this.environment },
      { key: 'server.host', value: '0.0.0.0', environment: this.environment },
      { key: 'log.level', value: this.environment === 'production' ? 'info' : 'debug', environment: this.environment },
      { key: 'cache.enabled', value: true, environment: this.environment },
      { key: 'cache.ttl', value: 3600, environment: this.environment },
      { key: 'database.poolSize', value: this.environment === 'production' ? 20 : 5, environment: this.environment },
    ];

    for (const config of defaults) {
      this.configs.set(config.key, {
        key: config.key,
        value: config.value,
        environment: config.environment,
        type: typeof config.value === 'number' ? 'number' : typeof config.value === 'boolean' ? 'boolean' : 'string',
        sensitive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
    }
  }

  registerSchema(schema: ConfigSchema): void {
    this.schemas.set(schema.key, schema);
    this.logger.debug({ key: schema.key, type: schema.type }, 'Configuration schema registered');
  }

  setConfig(key: string, value: any, changedBy: string = 'system', reason?: string): void {
    const schema = this.schemas.get(key);

    // Validate type
    if (schema && typeof value !== schema.type.toLowerCase()) {
      throw new Error(`Invalid type for ${key}: expected ${schema.type}, got ${typeof value}`);
    }

    // Validate against schema
    if (schema && schema.validation && !schema.validation(value)) {
      throw new Error(`Validation failed for ${key}`);
    }

    // Check allowed values
    if (schema && schema.allowedValues && !schema.allowedValues.includes(value)) {
      throw new Error(`Value not in allowed values for ${key}`);
    }

    // Check min/max
    if (schema && typeof value === 'number') {
      if (schema.minValue !== undefined && value < schema.minValue) {
        throw new Error(`Value ${value} is below minimum ${schema.minValue}`);
      }
      if (schema.maxValue !== undefined && value > schema.maxValue) {
        throw new Error(`Value ${value} is above maximum ${schema.maxValue}`);
      }
    }

    const oldConfig = this.configs.get(key);
    const oldValue = oldConfig?.value;

    // Update config
    const now = new Date();
    this.configs.set(key, {
      key,
      value,
      environment: this.environment,
      type: schema?.type || (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'),
      sensitive: schema?.sensitive || false,
      createdAt: oldConfig?.createdAt || now,
      updatedAt: now,
      version: (oldConfig?.version || 0) + 1,
    });

    // Record change
    this.changeHistory.push({
      timestamp: now,
      key,
      oldValue,
      newValue: value,
      changedBy,
      environment: this.environment,
      reason,
    });

    if (this.changeHistory.length > this.maxHistorySize) {
      this.changeHistory = this.changeHistory.slice(-this.maxHistorySize);
    }

    this.logger.info({ key, changedBy, reason }, 'Configuration updated');
  }

  getConfig(key: string, defaultValue?: any): any {
    const config = this.configs.get(key);

    if (!config) {
      const schema = this.schemas.get(key);
      if (schema && schema.default !== undefined) {
        return schema.default;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`Configuration key '${key}' not found`);
    }

    // Don't log sensitive values
    if (!config.sensitive) {
      this.logger.debug({ key, value: config.value }, 'Configuration retrieved');
    }

    return config.value;
  }

  getConfigSafe(key: string, defaultValue?: any): any {
    try {
      return this.getConfig(key, defaultValue);
    } catch {
      return defaultValue;
    }
  }

  hasConfig(key: string): boolean {
    return this.configs.has(key);
  }

  getAllConfigs(includeSensitive: boolean = false): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, config] of this.configs.entries()) {
      if (config.sensitive && !includeSensitive) {
        result[key] = '***REDACTED***';
      } else {
        result[key] = config.value;
      }
    }

    return result;
  }

  getConfigsByPrefix(prefix: string, includeSensitive: boolean = false): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, config] of this.configs.entries()) {
      if (key.startsWith(prefix)) {
        if (config.sensitive && !includeSensitive) {
          result[key] = '***REDACTED***';
        } else {
          result[key] = config.value;
        }
      }
    }

    return result;
  }

  deleteConfig(key: string, changedBy: string = 'system'): void {
    const config = this.configs.get(key);
    if (!config) {
      throw new Error(`Configuration key '${key}' not found`);
    }

    this.configs.delete(key);

    // Record change
    this.changeHistory.push({
      timestamp: new Date(),
      key,
      oldValue: config.value,
      newValue: undefined,
      changedBy,
      environment: this.environment,
      reason: 'Deletion',
    });

    this.logger.info({ key, changedBy }, 'Configuration deleted');
  }

  importConfig(configs: Record<string, any>, changedBy: string = 'system'): void {
    for (const [key, value] of Object.entries(configs)) {
      try {
        this.setConfig(key, value, changedBy, 'Bulk import');
      } catch (error) {
        this.logger.warn({ key, error }, 'Failed to import configuration');
      }
    }
  }

  exportConfig(includeSensitive: boolean = false, environment?: ConfigEnvironment): Record<string, any> {
    const target = environment || this.environment;
    const result: Record<string, any> = {};

    for (const [key, config] of this.configs.entries()) {
      if (config.environment === target) {
        if (config.sensitive && !includeSensitive) {
          result[key] = '***REDACTED***';
        } else {
          result[key] = config.value;
        }
      }
    }

    return result;
  }

  getChangeHistory(key?: string, limit: number = 100): ConfigChangeEvent[] {
    let history = key ? this.changeHistory.filter(e => e.key === key) : this.changeHistory;
    return history.slice(-limit);
  }

  validateAll(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [key, schema] of this.schemas.entries()) {
      if (schema.required && !this.configs.has(key)) {
        errors.push(`Required configuration '${key}' is missing`);
      }

      const config = this.configs.get(key);
      if (config && schema.validation && !schema.validation(config.value)) {
        errors.push(`Configuration '${key}' failed validation`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getEnvironment(): ConfigEnvironment {
    return this.environment;
  }

  switchEnvironment(environment: ConfigEnvironment): void {
    this.environment = environment;
    this.logger.info({ environment }, 'Configuration environment switched');
  }

  getMetrics(): Record<string, any> {
    return {
      environment: this.environment,
      totalConfigs: this.configs.size,
      registeredSchemas: this.schemas.size,
      changeHistorySize: this.changeHistory.length,
      sensitiveConfigs: Array.from(this.configs.values()).filter(c => c.sensitive).length,
    };
  }
}
