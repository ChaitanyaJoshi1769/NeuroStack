import { DistributedLogger } from '@neurostack/distributed-logging';
import { RedisCache } from '@neurostack/redis-cache';
import { AdvancedMonitoringPlatform } from '@neurostack/advanced-monitoring';
import { Logger } from 'pino';

export type LoadBalancingStrategy = 'round_robin' | 'least_connections' | 'random' | 'weighted' | 'consistent_hash';
export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface ServiceEndpoint {
  instanceId: string;
  host: string;
  port: number;
  weight?: number;
  healthy: boolean;
  lastHealthCheck?: Date;
}

export interface ServiceDefinition {
  serviceId: string;
  name: string;
  endpoints: ServiceEndpoint[];
  healthCheckPath?: string;
  healthCheckIntervalMs?: number;
  loadBalancingStrategy: LoadBalancingStrategy;
  circuitBreakerThreshold?: number;
  rateLimitPerSecond?: number;
  timeout?: number;
}

export interface Route {
  routeId: string;
  path: string;
  methods: string[];
  serviceId: string;
  transformRequest?: (req: any) => any;
  transformResponse?: (res: any) => any;
  requiresAuth?: boolean;
  rateLimit?: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSizeMs: number;
  perClient?: boolean;
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes before closing
  timeout: number; // Time in ms before trying half-open
  volumeThreshold: number; // Min requests before evaluating
}

export interface GatewayRequest {
  requestId: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  clientId?: string;
  timestamp: Date;
}

export interface GatewayResponse {
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  latencyMs: number;
  sourceServiceId: string;
  timestamp: Date;
}

export interface CircuitBreaker {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  lastStateChangeTime: Date;
  totalRequests: number;
  totalFailures: number;
}

export class APIGateway {
  private logger: Logger;
  private services: Map<string, ServiceDefinition>;
  private routes: Map<string, Route>;
  private circuitBreakers: Map<string, CircuitBreaker>;
  private rateLimiters: Map<string, Map<string, number[]>>;
  private requestHistory: GatewayRequest[];
  private responseHistory: GatewayResponse[];
  private instanceRoundRobinState: Map<string, number>;
  private readonly maxHistoryRecords = 50000;

  constructor(
    private distributedLogger: DistributedLogger,
    private redisCache: RedisCache,
    private monitoring: AdvancedMonitoringPlatform,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'APIGateway' });
    this.services = new Map();
    this.routes = new Map();
    this.circuitBreakers = new Map();
    this.rateLimiters = new Map();
    this.requestHistory = [];
    this.responseHistory = [];
    this.instanceRoundRobinState = new Map();
  }

  async registerService(definition: ServiceDefinition): Promise<void> {
    try {
      this.services.set(definition.serviceId, definition);

      // Initialize circuit breaker
      this.circuitBreakers.set(definition.serviceId, {
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastStateChangeTime: new Date(),
        totalRequests: 0,
        totalFailures: 0,
      });

      // Initialize rate limiter
      this.rateLimiters.set(definition.serviceId, new Map());

      // Initialize round-robin state
      this.instanceRoundRobinState.set(definition.serviceId, 0);

      await this.distributedLogger.log({
        level: 'info',
        message: `Service registered: ${definition.serviceId}`,
        metadata: {
          name: definition.name,
          endpoints: definition.endpoints.length,
          strategy: definition.loadBalancingStrategy,
        },
      });
    } catch (error) {
      this.logger.error({ error, serviceId: definition.serviceId }, 'Failed to register service');
      throw error;
    }
  }

  async registerRoute(route: Route): Promise<void> {
    try {
      const service = this.services.get(route.serviceId);
      if (!service) {
        throw new Error(`Service ${route.serviceId} not registered`);
      }

      this.routes.set(route.routeId, route);

      this.logger.info({ routeId: route.routeId, path: route.path }, 'Route registered');
    } catch (error) {
      this.logger.error({ error, routeId: route.routeId }, 'Failed to register route');
      throw error;
    }
  }

  async handleRequest(request: GatewayRequest): Promise<GatewayResponse> {
    const requestId = request.requestId || `req_${Date.now()}_${Math.random()}`;
    const requestStartTime = Date.now();

    try {
      this.recordRequest(request);

      // Find matching route
      const route = this.findMatchingRoute(request.path, request.method);
      if (!route) {
        return this.createErrorResponse(requestId, 404, 'Route not found', requestStartTime);
      }

      // Check authentication
      if (route.requiresAuth && !this.validateAuth(request)) {
        return this.createErrorResponse(requestId, 401, 'Unauthorized', requestStartTime);
      }

      // Check rate limit
      const clientId = request.clientId || request.headers['x-client-id'] || 'anonymous';
      const service = this.services.get(route.serviceId)!;
      const rateLimitExceeded = await this.checkRateLimit(route.serviceId, clientId, route.rateLimit || service.rateLimitPerSecond);
      if (rateLimitExceeded) {
        return this.createErrorResponse(requestId, 429, 'Rate limit exceeded', requestStartTime);
      }

      // Check circuit breaker
      const breaker = this.circuitBreakers.get(route.serviceId)!;
      if (breaker.state === 'open') {
        const now = Date.now();
        const timeSinceLastFailure = now - (breaker.lastFailureTime?.getTime() || 0);
        const timeout = 30000; // 30 seconds
        if (timeSinceLastFailure < timeout) {
          return this.createErrorResponse(requestId, 503, 'Service unavailable', requestStartTime);
        }
        breaker.state = 'half_open';
      }

      // Select endpoint
      const endpoint = this.selectEndpoint(service);
      if (!endpoint) {
        return this.createErrorResponse(requestId, 503, 'No healthy endpoints', requestStartTime);
      }

      // Transform request
      let transformedBody = request.body;
      if (route.transformRequest) {
        transformedBody = route.transformRequest(request.body);
      }

      // Make request to service
      const result = await this.forwardRequest(endpoint, request, transformedBody, service.timeout || 30000);

      // Update circuit breaker on success
      if (result.statusCode >= 200 && result.statusCode < 300) {
        if (breaker.state === 'half_open') {
          breaker.state = 'closed';
          breaker.failureCount = 0;
          breaker.successCount = 0;
        }
        breaker.successCount++;
      } else {
        breaker.failureCount++;
        breaker.lastFailureTime = new Date();
        breaker.totalFailures++;

        if (breaker.failureCount >= (service.circuitBreakerThreshold || 5)) {
          breaker.state = 'open';
          breaker.lastStateChangeTime = new Date();
        }
      }

      breaker.totalRequests++;

      // Transform response
      let responseBody = result.body;
      if (route.transformResponse) {
        responseBody = route.transformResponse(result.body);
      }

      const latency = Date.now() - requestStartTime;

      const response: GatewayResponse = {
        requestId,
        statusCode: result.statusCode,
        headers: result.headers,
        body: responseBody,
        latencyMs: latency,
        sourceServiceId: route.serviceId,
        timestamp: new Date(),
      };

      this.recordResponse(response);

      // Record metrics
      await this.monitoring.recordMetric(`gateway.request_latency`, latency, { service: route.serviceId });
      await this.monitoring.recordMetric(`gateway.response_status`, result.statusCode, { service: route.serviceId });

      return response;
    } catch (error) {
      this.logger.error({ error, requestId }, 'Request processing failed');
      return this.createErrorResponse(requestId, 500, 'Internal server error', requestStartTime);
    }
  }

  private findMatchingRoute(path: string, method: string): Route | undefined {
    for (const route of this.routes.values()) {
      if (this.pathMatches(route.path, path) && route.methods.includes(method.toUpperCase())) {
        return route;
      }
    }
    return undefined;
  }

  private pathMatches(routePath: string, requestPath: string): boolean {
    // Simple path matching - can be extended for wildcards and parameters
    return routePath === requestPath || routePath === '/*' || this.wildcardMatch(routePath, requestPath);
  }

  private wildcardMatch(pattern: string, path: string): boolean {
    const regexPattern = pattern.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`).test(path);
  }

  private validateAuth(request: GatewayRequest): boolean {
    // Simplified auth validation
    return !!request.headers['authorization'];
  }

  private async checkRateLimit(serviceId: string, clientId: string, limit?: number): Promise<boolean> {
    if (!limit) return false;

    const limiter = this.rateLimiters.get(serviceId);
    if (!limiter) return false;

    const key = `${clientId}`;
    const now = Date.now();
    const windowStart = now - 1000; // 1 second window

    let requests = limiter.get(key) || [];
    requests = requests.filter(time => time > windowStart);

    if (requests.length >= limit) {
      return true;
    }

    requests.push(now);
    limiter.set(key, requests);

    return false;
  }

  private selectEndpoint(service: ServiceDefinition): ServiceEndpoint | undefined {
    const healthyEndpoints = service.endpoints.filter(e => e.healthy);

    if (healthyEndpoints.length === 0) {
      return undefined;
    }

    const strategy = service.loadBalancingStrategy;

    switch (strategy) {
      case 'round_robin':
        return this.roundRobinSelect(service.serviceId, healthyEndpoints);
      case 'least_connections':
        return this.leastConnectionsSelect(healthyEndpoints);
      case 'random':
        return healthyEndpoints[Math.floor(Math.random() * healthyEndpoints.length)];
      case 'weighted':
        return this.weightedSelect(healthyEndpoints);
      case 'consistent_hash':
        return healthyEndpoints[0]; // Simplified
      default:
        return healthyEndpoints[0];
    }
  }

  private roundRobinSelect(serviceId: string, endpoints: ServiceEndpoint[]): ServiceEndpoint {
    let index = this.instanceRoundRobinState.get(serviceId) || 0;
    const endpoint = endpoints[index];
    this.instanceRoundRobinState.set(serviceId, (index + 1) % endpoints.length);
    return endpoint;
  }

  private leastConnectionsSelect(endpoints: ServiceEndpoint[]): ServiceEndpoint {
    // Simplified - would track active connections
    return endpoints[0];
  }

  private weightedSelect(endpoints: ServiceEndpoint[]): ServiceEndpoint {
    const totalWeight = endpoints.reduce((sum, e) => sum + (e.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const endpoint of endpoints) {
      random -= endpoint.weight || 1;
      if (random <= 0) {
        return endpoint;
      }
    }

    return endpoints[0];
  }

  private async forwardRequest(
    endpoint: ServiceEndpoint,
    request: GatewayRequest,
    body: any,
    timeout: number
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: any }> {
    // Simulate forwarding request to endpoint
    // In production, would use HTTP client like axios or node-fetch
    return {
      statusCode: 200,
      headers: {},
      body: { success: true },
    };
  }

  private createErrorResponse(requestId: string, statusCode: number, message: string, requestStartTime: number): GatewayResponse {
    return {
      requestId,
      statusCode,
      headers: { 'content-type': 'application/json' },
      body: { error: message },
      latencyMs: Date.now() - requestStartTime,
      sourceServiceId: 'gateway',
      timestamp: new Date(),
    };
  }

  private recordRequest(request: GatewayRequest): void {
    this.requestHistory.push(request);
    if (this.requestHistory.length > this.maxHistoryRecords) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistoryRecords);
    }
  }

  private recordResponse(response: GatewayResponse): void {
    this.responseHistory.push(response);
    if (this.responseHistory.length > this.maxHistoryRecords) {
      this.responseHistory = this.responseHistory.slice(-this.maxHistoryRecords);
    }
  }

  async updateServiceHealth(serviceId: string, healthy: boolean): Promise<void> {
    const service = this.services.get(serviceId);
    if (service) {
      for (const endpoint of service.endpoints) {
        endpoint.healthy = healthy;
        endpoint.lastHealthCheck = new Date();
      }
    }
  }

  async getServiceMetrics(serviceId: string): Promise<Record<string, any>> {
    const service = this.services.get(serviceId);
    const breaker = this.circuitBreakers.get(serviceId);

    if (!service || !breaker) {
      return {};
    }

    return {
      serviceId,
      name: service.name,
      endpoints: service.endpoints.length,
      healthyEndpoints: service.endpoints.filter(e => e.healthy).length,
      circuitBreakerState: breaker.state,
      totalRequests: breaker.totalRequests,
      totalFailures: breaker.totalFailures,
      failureRate: breaker.totalRequests > 0 ? breaker.totalFailures / breaker.totalRequests : 0,
    };
  }

  async getGatewayMetrics(): Promise<Record<string, any>> {
    const totalRequests = this.requestHistory.length;
    const totalResponses = this.responseHistory.length;
    const successResponses = this.responseHistory.filter(r => r.statusCode >= 200 && r.statusCode < 300).length;
    const avgLatency = totalResponses > 0 ? this.responseHistory.reduce((a, r) => a + r.latencyMs, 0) / totalResponses : 0;

    return {
      totalRequests,
      totalResponses,
      successResponses,
      successRate: totalRequests > 0 ? successResponses / totalRequests : 0,
      avgLatencyMs: avgLatency,
      servicesRegistered: this.services.size,
      routesRegistered: this.routes.size,
      circuitBreakersOpen: Array.from(this.circuitBreakers.values()).filter(b => b.state === 'open').length,
    };
  }

  async listServices(): Promise<ServiceDefinition[]> {
    return Array.from(this.services.values());
  }

  async listRoutes(): Promise<Route[]> {
    return Array.from(this.routes.values());
  }

  async getRequestHistory(limit: number = 100): Promise<GatewayRequest[]> {
    return this.requestHistory.slice(-limit);
  }

  async getResponseHistory(limit: number = 100): Promise<GatewayResponse[]> {
    return this.responseHistory.slice(-limit);
  }

  async cleanupHistory(olderThanMinutes: number = 60): Promise<number> {
    const cutoffTime = Date.now() - olderThanMinutes * 60 * 1000;
    const initialRequestCount = this.requestHistory.length;
    const initialResponseCount = this.responseHistory.length;

    this.requestHistory = this.requestHistory.filter(r => r.timestamp.getTime() >= cutoffTime);
    this.responseHistory = this.responseHistory.filter(r => r.timestamp.getTime() >= cutoffTime);

    return initialRequestCount - this.requestHistory.length + (initialResponseCount - this.responseHistory.length);
  }
}
