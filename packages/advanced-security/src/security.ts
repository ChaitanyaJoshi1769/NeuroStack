import { DistributedLogger } from '@neurostack/distributed-logging';
import { Logger } from 'pino';
import * as crypto from 'crypto';

export type AccessLevel = 'read' | 'write' | 'delete' | 'admin';
export type ResourceType = 'model' | 'dataset' | 'configuration' | 'workflow' | 'system';

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  resource: ResourceType;
  access: AccessLevel[];
  conditions?: Record<string, any>;
}

export interface User {
  id: string;
  username: string;
  roles: Role[];
  email: string;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface AuditEntry {
  timestamp: Date;
  userId: string;
  action: string;
  resource: ResourceType;
  resourceId?: string;
  accessLevel: AccessLevel;
  result: 'success' | 'failure';
  details?: Record<string, any>;
  ipAddress?: string;
}

export interface EncryptedField {
  value: string; // Encrypted value (base64)
  algorithm: string;
  iv: string; // Initialization vector (base64)
  salt: string; // Salt (base64)
  metadata?: Record<string, any>;
}

export class AdvancedSecurityManager {
  private logger: Logger;
  private users: Map<string, User>;
  private roles: Map<string, Role>;
  private auditLog: AuditEntry[];
  private encryptionKey: Buffer;
  private readonly maxAuditSize = 50000;
  private readonly algorithm = 'aes-256-cbc';
  private readonly keyDerivation = 'sha256';

  constructor(
    private distributedLogger: DistributedLogger,
    logger: Logger,
    encryptionSecret: string = 'default-secret-key-change-in-production'
  ) {
    this.logger = logger.child({ component: 'AdvancedSecurityManager' });
    this.users = new Map();
    this.roles = new Map();
    this.auditLog = [];

    // Derive encryption key from secret
    this.encryptionKey = crypto.pbkdf2Sync(encryptionSecret, 'neurostack-salt', 100000, 32, 'sha256');

    this.initializeDefaultRoles();
    this.logger.info('AdvancedSecurityManager initialized');
  }

  private initializeDefaultRoles(): void {
    // Admin role - full access
    this.createRole({
      id: 'admin',
      name: 'Administrator',
      description: 'Full system access',
      permissions: [
        {
          resource: 'model',
          access: ['read', 'write', 'delete', 'admin'],
        },
        {
          resource: 'dataset',
          access: ['read', 'write', 'delete', 'admin'],
        },
        {
          resource: 'configuration',
          access: ['read', 'write', 'delete', 'admin'],
        },
        {
          resource: 'workflow',
          access: ['read', 'write', 'delete', 'admin'],
        },
        {
          resource: 'system',
          access: ['read', 'write', 'delete', 'admin'],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Data Scientist role - read/write models and datasets
    this.createRole({
      id: 'data-scientist',
      name: 'Data Scientist',
      description: 'Model and dataset access',
      permissions: [
        {
          resource: 'model',
          access: ['read', 'write'],
        },
        {
          resource: 'dataset',
          access: ['read', 'write'],
        },
        {
          resource: 'workflow',
          access: ['read', 'write'],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Analyst role - read-only access
    this.createRole({
      id: 'analyst',
      name: 'Analyst',
      description: 'Read-only access',
      permissions: [
        {
          resource: 'model',
          access: ['read'],
        },
        {
          resource: 'dataset',
          access: ['read'],
        },
        {
          resource: 'workflow',
          access: ['read'],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Service role - system operations
    this.createRole({
      id: 'service',
      name: 'Service Account',
      description: 'Service-to-service operations',
      permissions: [
        {
          resource: 'model',
          access: ['read'],
        },
        {
          resource: 'dataset',
          access: ['read'],
        },
        {
          resource: 'workflow',
          access: ['read', 'write'],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  createRole(role: Omit<Role, 'createdAt' | 'updatedAt'>): Role {
    const newRole: Role = {
      ...role,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.roles.set(role.id, newRole);
    this.logger.info({ roleId: role.id }, 'Role created');
    return newRole;
  }

  createUser(user: Omit<User, 'createdAt'>): User {
    const newUser: User = {
      ...user,
      createdAt: new Date(),
    };
    this.users.set(user.id, newUser);
    this.logger.info({ userId: user.id, username: user.username }, 'User created');
    return newUser;
  }

  assignRoleToUser(userId: string, roleId: string): void {
    const user = this.users.get(userId);
    const role = this.roles.get(roleId);

    if (!user) {
      throw new Error(`User '${userId}' not found`);
    }
    if (!role) {
      throw new Error(`Role '${roleId}' not found`);
    }

    if (!user.roles.find(r => r.id === roleId)) {
      user.roles.push(role);
      this.logger.info({ userId, roleId }, 'Role assigned to user');
    }
  }

  revokeRoleFromUser(userId: string, roleId: string): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User '${userId}' not found`);
    }

    user.roles = user.roles.filter(r => r.id !== roleId);
    this.logger.info({ userId, roleId }, 'Role revoked from user');
  }

  checkAccess(
    userId: string,
    resource: ResourceType,
    accessLevel: AccessLevel,
    context?: Record<string, any>,
    ipAddress?: string
  ): boolean {
    const user = this.users.get(userId);
    if (!user) {
      this.auditAccess(userId, 'access_check', resource, accessLevel, 'failure', { reason: 'User not found' }, ipAddress);
      return false;
    }

    // Check if user has permission through any of their roles
    const hasAccess = user.roles.some(role =>
      role.permissions.some(perm => {
        if (perm.resource !== resource) return false;
        if (!perm.access.includes(accessLevel)) return false;

        // Check conditions if specified
        if (perm.conditions && context) {
          return this.evaluateConditions(perm.conditions, context);
        }
        return true;
      })
    );

    this.auditAccess(
      userId,
      'access_check',
      resource,
      accessLevel,
      hasAccess ? 'success' : 'failure',
      { hasAccess, rolesCount: user.roles.length },
      ipAddress
    );

    return hasAccess;
  }

  private evaluateConditions(conditions: Record<string, any>, context: Record<string, any>): boolean {
    // Simple condition evaluation
    for (const [key, expectedValue] of Object.entries(conditions)) {
      if (context[key] !== expectedValue) {
        return false;
      }
    }
    return true;
  }

  encryptField(value: string, metadata?: Record<string, any>): EncryptedField {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      value: encrypted,
      algorithm: this.algorithm,
      iv: iv.toString('base64'),
      salt: 'neurostack-salt',
      metadata,
    };
  }

  decryptField(encryptedField: EncryptedField): string {
    const iv = Buffer.from(encryptedField.iv, 'base64');
    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);

    let decrypted = decipher.update(encryptedField.value, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  encryptObject(obj: Record<string, any>, fieldsToEncrypt: string[]): Record<string, any> {
    const encrypted = { ...obj };

    for (const field of fieldsToEncrypt) {
      if (field in encrypted && encrypted[field]) {
        encrypted[field] = this.encryptField(String(encrypted[field]));
      }
    }

    return encrypted;
  }

  decryptObject(obj: Record<string, any>, fieldsToDecrypt: string[]): Record<string, any> {
    const decrypted = { ...obj };

    for (const field of fieldsToDecrypt) {
      if (field in decrypted && decrypted[field] && typeof decrypted[field] === 'object' && 'value' in decrypted[field]) {
        decrypted[field] = this.decryptField(decrypted[field]);
      }
    }

    return decrypted;
  }

  auditAccess(
    userId: string,
    action: string,
    resource: ResourceType,
    accessLevel: AccessLevel,
    result: 'success' | 'failure',
    details?: Record<string, any>,
    ipAddress?: string
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date(),
      userId,
      action,
      resource,
      accessLevel,
      result,
      details,
      ipAddress,
    };

    this.auditLog.push(entry);

    if (this.auditLog.length > this.maxAuditSize) {
      this.auditLog = this.auditLog.slice(-this.maxAuditSize);
    }

    // Log to distributed logger
    this.logger.info(
      { userId, action, resource, result, ...details },
      `Access audit: ${action} on ${resource} by ${userId} - ${result}`
    );
  }

  getAuditLog(filters?: {
    userId?: string;
    resource?: ResourceType;
    result?: 'success' | 'failure';
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): AuditEntry[] {
    let entries = [...this.auditLog];

    if (filters) {
      if (filters.userId) {
        entries = entries.filter(e => e.userId === filters.userId);
      }
      if (filters.resource) {
        entries = entries.filter(e => e.resource === filters.resource);
      }
      if (filters.result) {
        entries = entries.filter(e => e.result === filters.result);
      }
      if (filters.startTime) {
        entries = entries.filter(e => e.timestamp >= filters.startTime!);
      }
      if (filters.endTime) {
        entries = entries.filter(e => e.timestamp <= filters.endTime!);
      }
    }

    const limit = filters?.limit || 100;
    return entries.slice(-limit);
  }

  recordResourceAccess(
    userId: string,
    resource: ResourceType,
    resourceId: string,
    accessLevel: AccessLevel,
    action: string
  ): void {
    // Check access first
    const hasAccess = this.checkAccess(userId, resource, accessLevel);

    this.auditAccess(
      userId,
      action,
      resource,
      accessLevel,
      hasAccess ? 'success' : 'failure',
      { resourceId, action }
    );

    if (!hasAccess) {
      throw new Error(`Access denied: ${action} on ${resource}/${resourceId}`);
    }
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  revokeUserAccess(userId: string, reason: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.isActive = false;
      this.auditAccess(userId, 'user_revoked', 'system', 'admin', 'success', { reason });
      this.logger.info({ userId, reason }, 'User access revoked');
    }
  }

  getMetrics(): Record<string, any> {
    return {
      totalUsers: this.users.size,
      activeUsers: Array.from(this.users.values()).filter(u => u.isActive).length,
      totalRoles: this.roles.size,
      auditLogSize: this.auditLog.length,
      successfulAudits: this.auditLog.filter(e => e.result === 'success').length,
      failedAudits: this.auditLog.filter(e => e.result === 'failure').length,
    };
  }
}
