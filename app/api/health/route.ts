import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOpenAIClient } from '@/lib/openai/client';
import { logger } from '@/lib/observability/logger';
import { healthMetrics, metrics } from '@/lib/observability/metrics';
import { withTiming } from '@/lib/observability/metrics';

interface HealthCheck {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  details?: any;
}

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const checks: HealthCheck[] = [];
  let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

  // Database health check
  try {
    const dbCheck = await withTiming('health.database', async () => {
      const supabase = await createClient();
      const { error } = await supabase.from('tenants').select('id').limit(1);
      
      if (error) {
        throw error;
      }
      
      return { status: 'healthy' as const };
    });
    
    const dbResponseTime = Date.now() - startTime;
    checks.push({
      service: 'database',
      status: 'healthy',
      responseTime: dbResponseTime,
    });
    
    healthMetrics.setDatabaseHealth(true, dbResponseTime);
  } catch (error) {
    const dbResponseTime = Date.now() - startTime;
    checks.push({
      service: 'database',
      status: 'unhealthy',
      responseTime: dbResponseTime,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
    
    healthMetrics.setDatabaseHealth(false, dbResponseTime);
    overallStatus = 'unhealthy';
    
    logger.error('Database health check failed', { error: error instanceof Error ? error : new Error(String(error)) });
  }

  // OpenAI health check (lightweight)
  let openaiStart = Date.now();
  try {
    const openai = getOpenAIClient();
    
    // Just check if client can be created (doesn't make API call)
    if (openai && process.env.OPENAI_API_KEY) {
      const openaiResponseTime = Date.now() - openaiStart;
      checks.push({
        service: 'openai',
        status: 'healthy',
        responseTime: openaiResponseTime,
      });
      
      healthMetrics.setExternalServiceHealth('openai', true, openaiResponseTime);
    } else {
      throw new Error('OpenAI client configuration missing');
    }
  } catch (error) {
    const openaiResponseTime = Date.now() - openaiStart;
    checks.push({
      service: 'openai',
      status: 'degraded', // Not critical for basic functionality
      responseTime: openaiResponseTime,
      details: error instanceof Error ? error.message : 'Configuration error',
    });
    
    healthMetrics.setExternalServiceHealth('openai', false, openaiResponseTime);
    
    if (overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
    
    logger.warn('OpenAI health check failed', { error: error instanceof Error ? error : new Error(String(error)) });
  }

  // System metrics
  const memoryUsage = process.memoryUsage();
  const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
  healthMetrics.setMemoryUsage(memoryUsageMB);

  // Get current metrics summary
  const metricsSummary = metrics.getMetricsSummary();

  const totalResponseTime = Date.now() - startTime;

  const healthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    responseTime: totalResponseTime,
    checks,
    system: {
      memory: {
        used: Math.round(memoryUsageMB),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
      },
      uptime: process.uptime(),
      nodeVersion: process.version,
    },
    metrics: {
      requestCount: metricsSummary.counters['api.requests'] || 0,
      errorCount: metricsSummary.counters['api.errors'] || 0,
      avgResponseTime: metricsSummary.timers['api.duration']?.avg || 0,
    },
  };

  // Log health check
  logger.info('Health check completed', {
    status: overallStatus,
    responseTime: totalResponseTime,
    checks: checks.length,
  });

  // Return appropriate HTTP status
  const httpStatus = overallStatus === 'healthy' ? 200 : 
                    overallStatus === 'degraded' ? 207 : 503;

  return NextResponse.json(healthResponse, { status: httpStatus });
}
