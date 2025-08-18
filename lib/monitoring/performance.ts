import { createClient } from '@/lib/supabase/client';

interface PerformanceMetric {
  metric: string;
  value: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface ErrorLog {
  error: string;
  context: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private errors: ErrorLog[] = [];
  private batchInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_INTERVAL = 30000; // 30 seconds

  constructor() {
    // Start batch processing
    this.startBatchProcessing();
  }

  // Track page load time
  trackPageLoad(page: string, loadTime: number) {
    this.addMetric('page_load', loadTime, { page });
  }

  // Track API call performance
  trackApiCall(endpoint: string, duration: number, status: number) {
    this.addMetric('api_call', duration, { 
      endpoint, 
      status,
      success: status >= 200 && status < 300 
    });
  }

  // Track publishing performance
  trackPublishing(platform: string, success: boolean, duration: number) {
    this.addMetric('publishing', duration, {
      platform,
      success,
      timestamp: new Date().toISOString()
    });
  }

  // Track AI generation performance
  trackAiGeneration(type: string, duration: number, tokenCount?: number) {
    this.addMetric('ai_generation', duration, {
      type,
      tokenCount,
      timestamp: new Date().toISOString()
    });
  }

  // Track database query performance
  trackDatabaseQuery(query: string, duration: number, rowCount: number) {
    this.addMetric('database_query', duration, {
      query: query.substring(0, 100), // Truncate for security
      rowCount,
      timestamp: new Date().toISOString()
    });
  }

  // Track user actions
  trackUserAction(action: string, metadata?: Record<string, any>) {
    this.addMetric('user_action', 1, {
      action,
      ...metadata,
      timestamp: new Date().toISOString()
    });
  }

  // Log errors
  logError(error: Error | string, context: string, severity: ErrorLog['severity'] = 'medium') {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorLog: ErrorLog = {
      error: errorMessage,
      context,
      severity,
      timestamp: new Date().toISOString(),
      metadata: error instanceof Error ? {
        stack: error.stack,
        name: error.name
      } : undefined
    };

    this.errors.push(errorLog);
    
    // Immediately send critical errors
    if (severity === 'critical') {
      this.sendErrors([errorLog]);
    }
  }

  // Add metric to queue
  private addMetric(metric: string, value: number, metadata?: Record<string, any>) {
    this.metrics.push({
      metric,
      value,
      timestamp: new Date().toISOString(),
      metadata
    });

    // Send batch if it reaches the size limit
    if (this.metrics.length >= this.BATCH_SIZE) {
      this.sendBatch();
    }
  }

  // Start batch processing timer
  private startBatchProcessing() {
    this.batchInterval = setInterval(() => {
      this.sendBatch();
    }, this.BATCH_INTERVAL);
  }

  // Send metrics batch to server
  private async sendBatch() {
    if (this.metrics.length === 0 && this.errors.length === 0) return;

    const metricsToSend = [...this.metrics];
    const errorsToSend = [...this.errors];
    
    // Clear local arrays
    this.metrics = [];
    this.errors = [];

    try {
      // Send metrics
      if (metricsToSend.length > 0) {
        await this.sendMetrics(metricsToSend);
      }

      // Send errors
      if (errorsToSend.length > 0) {
        await this.sendErrors(errorsToSend);
      }
    } catch (error) {
      console.error('Failed to send performance data:', error);
      // Re-add failed items back to queue
      this.metrics.unshift(...metricsToSend);
      this.errors.unshift(...errorsToSend);
    }
  }

  // Send metrics to server
  private async sendMetrics(metrics: PerformanceMetric[]) {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Store metrics in database
    await supabase
      .from('performance_metrics')
      .insert(
        metrics.map(m => ({
          tenant_id: userData.tenant_id,
          user_id: user.id,
          metric_type: m.metric,
          value: m.value,
          metadata: m.metadata,
          created_at: m.timestamp
        }))
      );
  }

  // Send errors to server
  private async sendErrors(errors: ErrorLog[]) {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Store errors in database
    await supabase
      .from('error_logs')
      .insert(
        errors.map(e => ({
          tenant_id: userData.tenant_id,
          user_id: user.id,
          error_message: e.error,
          context: e.context,
          severity: e.severity,
          metadata: e.metadata,
          created_at: e.timestamp
        }))
      );

    // Send critical errors as notifications
    const criticalErrors = errors.filter(e => e.severity === 'critical');
    if (criticalErrors.length > 0) {
      await supabase
        .from('notifications')
        .insert(
          criticalErrors.map(e => ({
            user_id: user.id,
            tenant_id: userData.tenant_id,
            type: 'system_error',
            title: 'Critical System Error',
            message: `${e.context}: ${e.error}`,
            data: e.metadata,
            read: false,
            created_at: e.timestamp
          }))
        );
    }
  }

  // Get performance summary
  async getPerformanceSummary(timeRange: 'hour' | 'day' | 'week' | 'month' = 'day') {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!userData?.tenant_id) return null;

    const now = new Date();
    const startDate = new Date();
    
    switch (timeRange) {
      case 'hour':
        startDate.setHours(now.getHours() - 1);
        break;
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
    }

    const { data: metrics } = await supabase
      .from('performance_metrics')
      .select('*')
      .eq('tenant_id', userData.tenant_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    const { data: errors } = await supabase
      .from('error_logs')
      .select('*')
      .eq('tenant_id', userData.tenant_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    return {
      metrics: metrics || [],
      errors: errors || [],
      summary: this.calculateSummary(metrics || [], errors || [])
    };
  }

  // Calculate performance summary
  private calculateSummary(metrics: any[], errors: any[]) {
    const pageLoads = metrics.filter(m => m.metric_type === 'page_load');
    const apiCalls = metrics.filter(m => m.metric_type === 'api_call');
    const publishing = metrics.filter(m => m.metric_type === 'publishing');

    return {
      avgPageLoad: pageLoads.length > 0 
        ? pageLoads.reduce((sum, m) => sum + m.value, 0) / pageLoads.length 
        : 0,
      avgApiResponse: apiCalls.length > 0
        ? apiCalls.reduce((sum, m) => sum + m.value, 0) / apiCalls.length
        : 0,
      publishingSuccess: publishing.length > 0
        ? publishing.filter(m => m.metadata?.success).length / publishing.length * 100
        : 0,
      errorRate: errors.length,
      criticalErrors: errors.filter(e => e.severity === 'critical').length,
      totalMetrics: metrics.length
    };
  }

  // Cleanup
  destroy() {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
    }
    this.sendBatch(); // Send any remaining data
  }
}

// Create singleton instance
let performanceMonitor: PerformanceMonitor | null = null;

export function getPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitor) {
    performanceMonitor = new PerformanceMonitor();
  }
  return performanceMonitor;
}

// Export helper functions for easy use
export const trackPageLoad = (page: string, loadTime: number) => 
  getPerformanceMonitor().trackPageLoad(page, loadTime);

export const trackApiCall = (endpoint: string, duration: number, status: number) =>
  getPerformanceMonitor().trackApiCall(endpoint, duration, status);

export const trackPublishing = (platform: string, success: boolean, duration: number) =>
  getPerformanceMonitor().trackPublishing(platform, success, duration);

export const trackAiGeneration = (type: string, duration: number, tokenCount?: number) =>
  getPerformanceMonitor().trackAiGeneration(type, duration, tokenCount);

export const trackUserAction = (action: string, metadata?: Record<string, any>) =>
  getPerformanceMonitor().trackUserAction(action, metadata);

export const logError = (error: Error | string, context: string, severity?: 'low' | 'medium' | 'high' | 'critical') =>
  getPerformanceMonitor().logError(error, context, severity);