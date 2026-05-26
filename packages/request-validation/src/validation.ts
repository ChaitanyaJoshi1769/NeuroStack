import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';

export type ValidatorType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url' | 'date' | 'enum' | 'custom';
export type SanitizationType = 'trim' | 'lowercase' | 'uppercase' | 'strip_html' | 'escape' | 'remove_special';

export interface FieldSchema {
  name: string;
  type: ValidatorType;
  required?: boolean;
  default?: any;
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: RegExp;
  enum?: string[];
  allowedValues?: any[];
  sanitization?: SanitizationType[];
  customValidator?: (value: any) => boolean;
  errorMessage?: string;
}

export interface RequestSchema {
  schemaId: string;
  name: string;
  fields: Map<string, FieldSchema>;
  strict?: boolean; // Reject unknown fields
  custom?: (data: Record<string, any>) => ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  code?: string;
}

export interface ValidationResult {
  valid: boolean;
  data?: Record<string, any>;
  errors: ValidationError[];
  warnings?: string[];
}

export interface SecurityCheckConfig {
  checkSQLInjection?: boolean;
  checkXSS?: boolean;
  checkPathTraversal?: boolean;
  maxRequestSize?: number;
  allowedContentTypes?: string[];
}

export class RequestValidationFramework {
  private logger: Logger;
  private schemas: Map<string, RequestSchema>;
  private validationCache: Map<string, ValidationResult>;
  private securityCheckConfig: SecurityCheckConfig;
  private validationStats: Map<string, { totalRequests: number; validRequests: number; invalidRequests: number }>;
  private readonly maxCacheSize = 10000;

  constructor(private distributedLogger: DistributedLogger, logger: Logger) {
    this.logger = logger.child({ component: 'RequestValidationFramework' });
    this.schemas = new Map();
    this.validationCache = new Map();
    this.validationStats = new Map();
    this.securityCheckConfig = {
      checkSQLInjection: true,
      checkXSS: true,
      checkPathTraversal: true,
      maxRequestSize: 10 * 1024 * 1024, // 10MB
    };
  }

  registerSchema(schema: RequestSchema): void {
    this.schemas.set(schema.schemaId, schema);
    this.validationStats.set(schema.schemaId, {
      totalRequests: 0,
      validRequests: 0,
      invalidRequests: 0,
    });
    this.logger.info({ schemaId: schema.schemaId, fields: schema.fields.size }, 'Schema registered');
  }

  async validateRequest(schemaId: string, data: Record<string, any>): Promise<ValidationResult> {
    const schema = this.schemas.get(schemaId);
    if (!schema) {
      return {
        valid: false,
        errors: [
          {
            field: '_root',
            message: `Schema '${schemaId}' not found`,
            code: 'SCHEMA_NOT_FOUND',
          },
        ],
      };
    }

    // Check cache
    const cacheKey = `${schemaId}:${JSON.stringify(data)}`;
    const cached = this.validationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const errors: ValidationError[] = [];
    const warnings: string[] = [];
    const validatedData: Record<string, any> = {};

    // Update stats
    const stats = this.validationStats.get(schemaId)!;
    stats.totalRequests++;

    try {
      // Security checks
      const securityErrors = await this.performSecurityChecks(data);
      errors.push(...securityErrors);

      if (securityErrors.length > 0) {
        stats.invalidRequests++;
        const result: ValidationResult = { valid: false, errors };
        this.cacheValidationResult(cacheKey, result);
        return result;
      }

      // Field validation
      for (const field of schema.fields.values()) {
        const value = data[field.name];

        if (field.required && (value === null || value === undefined)) {
          errors.push({
            field: field.name,
            message: field.errorMessage || `Field '${field.name}' is required`,
            code: 'REQUIRED_FIELD',
          });
          continue;
        }

        if (value === null || value === undefined) {
          if (field.default !== undefined) {
            validatedData[field.name] = field.default;
          }
          continue;
        }

        // Type validation
        const typeError = this.validateType(value, field);
        if (typeError) {
          errors.push(typeError);
          continue;
        }

        // Additional validations
        const validationErrors = this.validateField(value, field);
        errors.push(...validationErrors);

        if (validationErrors.length === 0) {
          // Apply sanitization
          const sanitized = this.sanitizeValue(value, field);
          validatedData[field.name] = sanitized;
        }
      }

      // Check for unknown fields if strict mode
      if (schema.strict) {
        const allowedFields = new Set(schema.fields.keys());
        for (const key of Object.keys(data)) {
          if (!allowedFields.has(key)) {
            warnings.push(`Unknown field '${key}' ignored`);
          }
        }
      }

      // Custom validation
      if (schema.custom) {
        const customErrors = schema.custom(validatedData);
        errors.push(...customErrors);
      }

      const valid = errors.length === 0;
      if (valid) {
        stats.validRequests++;
      } else {
        stats.invalidRequests++;
      }

      const result: ValidationResult = {
        valid,
        data: valid ? validatedData : undefined,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      this.cacheValidationResult(cacheKey, result);

      if (!valid) {
        await this.distributedLogger.log({
          level: 'warn',
          message: `Validation failed for schema: ${schemaId}`,
          metadata: {
            errorCount: errors.length,
            errors: errors.map(e => ({ field: e.field, message: e.message })),
          },
        });
      }

      return result;
    } catch (error) {
      this.logger.error({ error, schemaId }, 'Validation error');
      stats.invalidRequests++;
      return {
        valid: false,
        errors: [
          {
            field: '_root',
            message: 'Internal validation error',
            code: 'VALIDATION_ERROR',
          },
        ],
      };
    }
  }

  private validateType(value: any, field: FieldSchema): ValidationError | null {
    switch (field.type) {
      case 'string':
        if (typeof value !== 'string') {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a string`,
            value,
            code: 'TYPE_MISMATCH',
          };
        }
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a number`,
            value,
            code: 'TYPE_MISMATCH',
          };
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a boolean`,
            value,
            code: 'TYPE_MISMATCH',
          };
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be an array`,
            value,
            code: 'TYPE_MISMATCH',
          };
        }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be an object`,
            value,
            code: 'TYPE_MISMATCH',
          };
        }
        break;
      case 'email':
        if (!this.isValidEmail(value)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a valid email`,
            value,
            code: 'INVALID_EMAIL',
          };
        }
        break;
      case 'url':
        if (!this.isValidUrl(value)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a valid URL`,
            value,
            code: 'INVALID_URL',
          };
        }
        break;
      case 'date':
        if (isNaN(new Date(value).getTime())) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a valid date`,
            value,
            code: 'INVALID_DATE',
          };
        }
        break;
      case 'enum':
        if (!field.enum?.includes(value)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be one of: ${field.enum?.join(', ')}`,
            value,
            code: 'INVALID_ENUM',
          };
        }
        break;
    }

    return null;
  }

  private validateField(value: any, field: FieldSchema): ValidationError[] {
    const errors: ValidationError[] = [];

    if (typeof value === 'string') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' must be at least ${field.minLength} characters`,
          code: 'MIN_LENGTH',
        });
      }

      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' must be at most ${field.maxLength} characters`,
          code: 'MAX_LENGTH',
        });
      }

      if (field.pattern && !field.pattern.test(value)) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' does not match required pattern`,
          code: 'PATTERN_MISMATCH',
        });
      }
    }

    if (typeof value === 'number') {
      if (field.minValue !== undefined && value < field.minValue) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' must be at least ${field.minValue}`,
          code: 'MIN_VALUE',
        });
      }

      if (field.maxValue !== undefined && value > field.maxValue) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' must be at most ${field.maxValue}`,
          code: 'MAX_VALUE',
        });
      }
    }

    if (field.allowedValues && !field.allowedValues.includes(value)) {
      errors.push({
        field: field.name,
        message: `Field '${field.name}' contains invalid value`,
        code: 'INVALID_VALUE',
      });
    }

    if (field.customValidator && !field.customValidator(value)) {
      errors.push({
        field: field.name,
        message: field.errorMessage || `Field '${field.name}' failed custom validation`,
        code: 'CUSTOM_VALIDATION',
      });
    }

    return errors;
  }

  private sanitizeValue(value: any, field: FieldSchema): any {
    if (!field.sanitization || !Array.isArray(field.sanitization)) {
      return value;
    }

    let sanitized = value;

    for (const sanitizer of field.sanitization) {
      switch (sanitizer) {
        case 'trim':
          if (typeof sanitized === 'string') {
            sanitized = sanitized.trim();
          }
          break;
        case 'lowercase':
          if (typeof sanitized === 'string') {
            sanitized = sanitized.toLowerCase();
          }
          break;
        case 'uppercase':
          if (typeof sanitized === 'string') {
            sanitized = sanitized.toUpperCase();
          }
          break;
        case 'strip_html':
          if (typeof sanitized === 'string') {
            sanitized = sanitized.replace(/<[^>]*>/g, '');
          }
          break;
        case 'escape':
          if (typeof sanitized === 'string') {
            sanitized = this.escapeHtml(sanitized);
          }
          break;
        case 'remove_special':
          if (typeof sanitized === 'string') {
            sanitized = sanitized.replace(/[^a-zA-Z0-9\s]/g, '');
          }
          break;
      }
    }

    return sanitized;
  }

  private async performSecurityChecks(data: Record<string, any>): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const dataStr = JSON.stringify(data);

    if (this.securityCheckConfig.checkSQLInjection && this.detectSQLInjection(dataStr)) {
      errors.push({
        field: '_security',
        message: 'Potential SQL injection detected',
        code: 'SQL_INJECTION',
      });
    }

    if (this.securityCheckConfig.checkXSS && this.detectXSS(dataStr)) {
      errors.push({
        field: '_security',
        message: 'Potential XSS attack detected',
        code: 'XSS',
      });
    }

    if (this.securityCheckConfig.checkPathTraversal && this.detectPathTraversal(dataStr)) {
      errors.push({
        field: '_security',
        message: 'Potential path traversal detected',
        code: 'PATH_TRAVERSAL',
      });
    }

    return errors;
  }

  private detectSQLInjection(str: string): boolean {
    const sqlPatterns = [/('|")(\s)?(union|select|insert|update|delete|drop|create|alter)/i, /;(\s)?(drop|delete|truncate)/i];

    return sqlPatterns.some(pattern => pattern.test(str));
  }

  private detectXSS(str: string): boolean {
    const xssPatterns = [/<script[^>]*>/i, /javascript:/i, /on\w+(\s)?=/i, /<iframe/i, /<object/i, /<embed/i];

    return xssPatterns.some(pattern => pattern.test(str));
  }

  private detectPathTraversal(str: string): boolean {
    return /\.\.[\\/]/.test(str) || /\.\.%2[fF]/.test(str);
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  private cacheValidationResult(key: string, result: ValidationResult): void {
    this.validationCache.set(key, result);

    if (this.validationCache.size > this.maxCacheSize) {
      const firstKey = this.validationCache.keys().next().value;
      this.validationCache.delete(firstKey);
    }
  }

  getSchemaStats(schemaId: string): Record<string, any> | undefined {
    const stats = this.validationStats.get(schemaId);
    if (!stats) return undefined;

    return {
      schemaId,
      totalRequests: stats.totalRequests,
      validRequests: stats.validRequests,
      invalidRequests: stats.invalidRequests,
      validationRate: stats.totalRequests > 0 ? (stats.validRequests / stats.totalRequests) * 100 : 0,
    };
  }

  getAllSchemaStats(): Record<string, any>[] {
    return Array.from(this.validationStats.entries()).map(([schemaId, stats]) => ({
      schemaId,
      totalRequests: stats.totalRequests,
      validRequests: stats.validRequests,
      invalidRequests: stats.invalidRequests,
      validationRate: stats.totalRequests > 0 ? (stats.validRequests / stats.totalRequests) * 100 : 0,
    }));
  }

  clearCache(): void {
    this.validationCache.clear();
  }

  getRegisteredSchemas(): string[] {
    return Array.from(this.schemas.keys());
  }
}
