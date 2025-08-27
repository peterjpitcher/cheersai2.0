/**
 * Metrics collection and monitoring utilities
 * Provides performance metrics and business intelligence data
 */

import { logger } from './logger';

export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  tags: Record<string, string>;
  unit: string;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
}

export interface BusinessMetrics {
  campaigns_created: number;
  posts_published: number;
  ai_generations: number;
  social_connections: number;
  subscription_upgrades: number;
  user_signups: number;
  tenant_churned: number;
}

export interface TechnicalMetrics {
  api_requests: number;
  api_errors: number;
  database_queries: number;
  external_api_calls: number;
  auth_attempts: number;
  auth_failures: number;
  rate_limit_hits: number;
}

class MetricsCollector {
  private metrics: MetricPoint[] = [];
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private timers: Map<string, number[]> = new Map();
  
  // Counter methods
  incrementCounter(name: string, value: number = 1, tags: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, tags);
    const currentValue = this.counters.get(key) || 0;
    this.counters.set(key, currentValue + value);
    
    this.addMetricPoint({
      name,
      value: currentValue + value,
      timestamp: Date.now(),
      tags,
      unit: 'count',
      type: 'counter',
    });
  }

  // Gauge methods
  setGauge(name: string, value: number, tags: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, tags);
    this.gauges.set(key, value);
    
    this.addMetricPoint({
      name,
      value,
      timestamp: Date.now(),
      tags,
      unit: 'value',
      type: 'gauge',
    });
  }

  // Timer methods
  recordTimer(name: string, duration: number, tags: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, tags);
    const timings = this.timers.get(key) || [];
    timings.push(duration);
    this.timers.set(key, timings);
    
    this.addMetricPoint({
      name,
      value: duration,
      timestamp: Date.now(),
      tags,
      unit: 'milliseconds',
      type: 'timer',
    });
  }

  // Histogram methods
  recordHistogram(name: string, value: number, tags: Record<string, string> = {}): void {
    this.addMetricPoint({
      name,
      value,
      timestamp: Date.now(),
      tags,
      unit: 'value',
      type: 'histogram',
    });
  }

  private getMetricKey(name: string, tags: Record<string, string>): string {
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(',');
    return `${name}{${tagString}}`;
  }

  private addMetricPoint(point: MetricPoint): void {
    this.metrics.push(point);
    
    // Log significant metrics
    if (this.isSignificantMetric(point)) {
      logger.businessMetric(point.name, point.value, point.unit, {
        tags: point.tags,
        type: point.type,
      });
    }
    
    // Prevent memory leaks by limiting stored metrics
    if (this.metrics.length > 10000) {
      this.metrics = this.metrics.slice(-5000);
    }
  }

  private isSignificantMetric(point: MetricPoint): boolean {
    const significantMetrics = [
      'campaigns.created',
      'posts.published',
      'users.signup',
      'subscription.upgraded',
      'api.errors',
      'auth.failures',
    ];
    
    return significantMetrics.some(metric => point.name.startsWith(metric));
  }

  // Get metrics summary
  getMetricsSummary(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    timers: Record<string, { count: number; avg: number; min: number; max: number; p95: number }>;
  } {
    const timerSummary: Record<string, any> = {};
    
    for (const [key, timings] of this.timers.entries()) {
      if (timings.length > 0) {
        const sorted = [...timings].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        
        timerSummary[key] = {
          count: timings.length,
          avg: timings.reduce((a, b) => a + b, 0) / timings.length,
          min: Math.min(...timings),
          max: Math.max(...timings),
          p95: sorted[p95Index] || 0,
        };
      }
    }
    
    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries()),
      timers: timerSummary,
    };
  }

  // Export metrics in a format suitable for monitoring systems
  exportMetrics(): MetricPoint[] {
    return [...this.metrics];
  }

  // Clear metrics (useful for testing)
  clearMetrics(): void {
    this.metrics = [];
    this.counters.clear();
    this.gauges.clear();
    this.timers.clear();
  }
}

// Global metrics collector
export const metrics = new MetricsCollector();

// Business metrics tracking
export const businessMetrics = {
  campaignCreated(tenantId: string, campaignType: string): void {
    metrics.incrementCounter('campaigns.created', 1, {
      tenant_id: tenantId,
      campaign_type: campaignType,
    });
  },

  postPublished(tenantId: string, platform: string, success: boolean): void {
    metrics.incrementCounter('posts.published', 1, {
      tenant_id: tenantId,
      platform,
      success: success.toString(),
    });
  },

  aiGenerated(tenantId: string, platform: string, tokensUsed: number): void {
    metrics.incrementCounter('ai.generations', 1, {
      tenant_id: tenantId,
      platform,
    });
    
    metrics.recordHistogram('ai.tokens_used', tokensUsed, {
      tenant_id: tenantId,
      platform,
    });
  },

  socialConnected(tenantId: string, platform: string): void {
    metrics.incrementCounter('social.connections', 1, {
      tenant_id: tenantId,
      platform,
    });
  },

  subscriptionUpgraded(tenantId: string, fromTier: string, toTier: string): void {
    metrics.incrementCounter('subscription.upgrades', 1, {
      tenant_id: tenantId,
      from_tier: fromTier,
      to_tier: toTier,
    });
  },

  userSignup(source: string = 'organic'): void {
    metrics.incrementCounter('users.signup', 1, {
      source,
    });
  },

  tenantChurned(tenantId: string, reason: string): void {
    metrics.incrementCounter('tenant.churn', 1, {
      tenant_id: tenantId,
      reason,
    });
  },
};

// Technical metrics tracking
export const technicalMetrics = {
  apiRequest(method: string, endpoint: string, status: number, duration: number): void {
    metrics.incrementCounter('api.requests', 1, {
      method,
      endpoint,
      status: status.toString(),
    });
    
    metrics.recordTimer('api.duration', duration, {
      method,
      endpoint,
    });
    
    if (status >= 400) {
      metrics.incrementCounter('api.errors', 1, {
        method,
        endpoint,
        status: status.toString(),
      });
    }
  },

  databaseQuery(operation: string, table: string, duration: number, success: boolean): void {
    metrics.incrementCounter('database.queries', 1, {
      operation,
      table,
      success: success.toString(),
    });
    
    metrics.recordTimer('database.duration', duration, {
      operation,
      table,
    });
  },

  externalApiCall(service: string, endpoint: string, duration: number, success: boolean): void {
    metrics.incrementCounter('external_api.calls', 1, {
      service,
      endpoint,
      success: success.toString(),
    });
    
    metrics.recordTimer('external_api.duration', duration, {
      service,
      endpoint,
    });
    
    if (!success) {
      metrics.incrementCounter('external_api.errors', 1, {
        service,
        endpoint,
      });
    }
  },

  authAttempt(method: string, success: boolean, tenantId?: string): void {
    metrics.incrementCounter('auth.attempts', 1, {
      method,
      success: success.toString(),
      ...(tenantId && { tenant_id: tenantId }),
    });
    
    if (!success) {
      metrics.incrementCounter('auth.failures', 1, {
        method,
        ...(tenantId && { tenant_id: tenantId }),
      });
    }
  },

  rateLimitHit(endpoint: string, tenantId?: string): void {
    metrics.incrementCounter('rate_limit.hits', 1, {
      endpoint,
      ...(tenantId && { tenant_id: tenantId }),
    });
  },

  circuitBreakerOpened(service: string): void {
    metrics.incrementCounter('circuit_breaker.opened', 1, {
      service,
    });
  },

  retryAttempt(operation: string, attempt: number, success: boolean): void {
    metrics.incrementCounter('retry.attempts', 1, {
      operation,
      attempt: attempt.toString(),
      success: success.toString(),
    });
  },
};

// Health check metrics
export const healthMetrics = {
  setDatabaseHealth(healthy: boolean, responseTime: number): void {
    metrics.setGauge('health.database', healthy ? 1 : 0);
    metrics.recordTimer('health.database.response_time', responseTime);
  },

  setExternalServiceHealth(service: string, healthy: boolean, responseTime: number): void {
    metrics.setGauge(`health.${service}`, healthy ? 1 : 0, {
      service,
    });
    metrics.recordTimer(`health.${service}.response_time`, responseTime, {
      service,
    });
  },

  setMemoryUsage(usage: number): void {
    metrics.setGauge('system.memory_usage', usage);
  },

  setCpuUsage(usage: number): void {
    metrics.setGauge('system.cpu_usage', usage);
  },
};

// Utility to create a timer
export class Timer {
  private startTime: number;
  private name: string;
  private tags: Record<string, string>;

  constructor(name: string, tags: Record<string, string> = {}) {
    this.startTime = Date.now();
    this.name = name;
    this.tags = tags;
  }

  stop(): number {
    const duration = Date.now() - this.startTime;
    metrics.recordTimer(this.name, duration, this.tags);
    return duration;
  }
}

// Utility function to wrap async operations with timing
export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  tags: Record<string, string> = {}
): Promise<T> {
  const timer = new Timer(name, tags);
  try {
    const result = await fn();
    timer.stop();
    return result;
  } catch (error) {
    timer.stop();
    throw error;
  }
}