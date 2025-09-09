/**
 * Structured logging system with correlation IDs
 * Provides consistent logging across the application
 */

// Use crypto.randomUUID in Node.js or crypto.randomUUID() in browser
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export interface LogContext {
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  traceId?: string;
  userAgent?: string;
  ip?: string;
  route?: string;
  method?: string;
  duration?: number;
  error?: Error;
  // Pipeline/event fields
  area?: 'publish'|'queue'|'verify'|'auth'|'billing'|'api'|'gmb'|'twitter'|'facebook'|'instagram'|string;
  op?: string; // e.g., 'fb.publish'
  platform?: 'facebook'|'instagram'|'twitter'|'gbp'|string;
  connectionId?: string;
  status?: 'ok'|'fail'|string|number;
  errorCode?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context: LogContext;
  service: string;
  version: string;
  environment: string;
}

class Logger {
  private service: string = 'cheersai';
  private version: string = process.env.npm_package_version || '1.0.0';
  private environment: string = process.env.NODE_ENV || 'development';
  private minLevel: LogLevel = this.getMinLogLevel();

  private getMinLogLevel(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase();
    switch (level) {
      case 'DEBUG': return LogLevel.DEBUG;
      case 'INFO': return LogLevel.INFO;
      case 'WARN': return LogLevel.WARN;
      case 'ERROR': return LogLevel.ERROR;
      case 'FATAL': return LogLevel.FATAL;
      default: return this.environment === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  private formatLogEntry(level: LogLevel, message: string, context: LogContext = {}): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      context: {
        correlationId: context.correlationId || this.generateCorrelationId(),
        ...context,
      },
      service: this.service,
      version: this.version,
      environment: this.environment,
    };
  }

  private output(logEntry: LogEntry): void {
    const output = JSON.stringify(logEntry);
    
    // In development, use console with colors
    if (this.environment === 'development') {
      const colors = {
        DEBUG: '\x1b[36m', // Cyan
        INFO: '\x1b[32m',  // Green
        WARN: '\x1b[33m',  // Yellow
        ERROR: '\x1b[31m', // Red
        FATAL: '\x1b[35m', // Magenta
      };
      
      const reset = '\x1b[0m';
      const color = colors[logEntry.level as keyof typeof colors] || '';
      
      console.log(`${color}[${logEntry.level}]${reset} ${logEntry.message}`, {
        ...logEntry.context,
        timestamp: logEntry.timestamp,
      });
    } else {
      // In production, output structured JSON
      console.log(output);
    }
  }

  private generateCorrelationId(): string {
    return generateUUID();
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const logEntry = this.formatLogEntry(LogLevel.DEBUG, message, context);
      this.output(logEntry);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const logEntry = this.formatLogEntry(LogLevel.INFO, message, context);
      this.output(logEntry);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const logEntry = this.formatLogEntry(LogLevel.WARN, message, context);
      this.output(logEntry);
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const logEntry = this.formatLogEntry(LogLevel.ERROR, message, context);
      this.output(logEntry);
    }
  }

  fatal(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.FATAL)) {
      const logEntry = this.formatLogEntry(LogLevel.FATAL, message, context);
      this.output(logEntry);
    }
  }

  // Emit a single structured pipeline event (JSON line in prod)
  event(level: 'info'|'warn'|'error', evt: {
    area: LogContext['area'];
    op: string;
    status: 'ok'|'fail';
    platform?: LogContext['platform'];
    connectionId?: string;
    tenantId?: string;
    userId?: string;
    requestId?: string;
    traceId?: string;
    durationMs?: number;
    errorCode?: string;
    msg?: string;
    meta?: Record<string, unknown>;
  }) {
    const ctx: LogContext = {
      area: evt.area,
      op: evt.op,
      status: evt.status,
      platform: evt.platform,
      connectionId: evt.connectionId,
      tenantId: evt.tenantId,
      userId: evt.userId,
      requestId: evt.requestId,
      traceId: evt.traceId,
      duration: evt.durationMs,
      errorCode: evt.errorCode,
      ...(evt.meta || {}),
    };
    const message = evt.msg || `${evt.op} ${evt.status}`;
    if (level === 'error') this.error(message, ctx);
    else if (level === 'warn') this.warn(message, ctx);
    else this.info(message, ctx);
  }

  // Convenience methods for common logging patterns
  apiRequest(method: string, path: string, context?: LogContext): void {
    this.info(`API request: ${method} ${path}`, {
      ...context,
      method,
      route: path,
      type: 'api_request',
    });
  }

  apiResponse(method: string, path: string, status: number, duration: number, context?: LogContext): void {
    const level = status >= 500 ? LogLevel.ERROR : status >= 400 ? LogLevel.WARN : LogLevel.INFO;
    const message = `API response: ${method} ${path} ${status} (${duration}ms)`;
    
    if (level === LogLevel.ERROR) {
      this.error(message, { ...context, method, route: path, status, duration, type: 'api_response' });
    } else if (level === LogLevel.WARN) {
      this.warn(message, { ...context, method, route: path, status, duration, type: 'api_response' });
    } else {
      this.info(message, { ...context, method, route: path, status, duration, type: 'api_response' });
    }
  }

  databaseQuery(query: string, duration: number, context?: LogContext): void {
    this.debug(`Database query executed (${duration}ms)`, {
      ...context,
      query: query.substring(0, 200), // Truncate long queries
      duration,
      type: 'database_query',
    });
  }

  externalApiCall(service: string, endpoint: string, duration: number, success: boolean, context?: LogContext): void {
    const message = `External API call: ${service} ${endpoint} ${success ? 'success' : 'failed'} (${duration}ms)`;
    
    if (success) {
      this.info(message, { ...context, service, endpoint, duration, success, type: 'external_api' });
    } else {
      this.warn(message, { ...context, service, endpoint, duration, success, type: 'external_api' });
    }
  }

  userAction(action: string, userId: string, context?: LogContext): void {
    this.info(`User action: ${action}`, {
      ...context,
      userId,
      action,
      type: 'user_action',
    });
  }

  securityEvent(event: string, severity: 'low' | 'medium' | 'high' | 'critical', context?: LogContext): void {
    const level = severity === 'critical' ? LogLevel.FATAL : 
                  severity === 'high' ? LogLevel.ERROR :
                  severity === 'medium' ? LogLevel.WARN : LogLevel.INFO;
    
    const message = `Security event: ${event} (${severity})`;
    
    if (level === LogLevel.FATAL) {
      this.fatal(message, { ...context, event, severity, type: 'security_event' });
    } else if (level === LogLevel.ERROR) {
      this.error(message, { ...context, event, severity, type: 'security_event' });
    } else if (level === LogLevel.WARN) {
      this.warn(message, { ...context, event, severity, type: 'security_event' });
    } else {
      this.info(message, { ...context, event, severity, type: 'security_event' });
    }
  }

  businessMetric(metric: string, value: number, unit: string, context?: LogContext): void {
    this.info(`Business metric: ${metric} = ${value} ${unit}`, {
      ...context,
      metric,
      value,
      unit,
      type: 'business_metric',
    });
  }

  // Create a child logger with additional context
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    const originalFormatLogEntry = childLogger.formatLogEntry.bind(childLogger);
    
    childLogger.formatLogEntry = (level: LogLevel, message: string, additionalContext: LogContext = {}) => {
      return originalFormatLogEntry(level, message, { ...context, ...additionalContext });
    };
    
    return childLogger;
  }
}

// Global logger instance
export const logger = new Logger();

// Request-scoped logger utility for API routes
export function createRequestLogger(req: Request): Logger {
  const correlationId = req.headers.get('x-correlation-id') || generateUUID();
  const requestId = req.headers.get('x-request-id') || correlationId;
  const traceId = req.headers.get('x-trace-id') || correlationId;
  const userAgent = req.headers.get('user-agent') || '';
  const route = new URL(req.url).pathname;
  const method = req.method;
  
  return logger.child({
    correlationId,
    userAgent,
    route,
    method,
    requestId,
    traceId,
  });
}

// Performance measurement utility
export class PerformanceTracker {
  private startTime: number;
  private operation: string;
  private context: LogContext;

  constructor(operation: string, context: LogContext = {}) {
    this.startTime = Date.now();
    this.operation = operation;
    this.context = context;
    
    logger.debug(`Performance tracking started: ${operation}`, context);
  }

  end(success: boolean = true, additionalContext: LogContext = {}): number {
    const duration = Date.now() - this.startTime;
    const level = success ? LogLevel.INFO : LogLevel.WARN;
    const message = `Performance tracking ended: ${this.operation} (${duration}ms) - ${success ? 'success' : 'failed'}`;
    
    const fullContext = {
      ...this.context,
      ...additionalContext,
      duration,
      success,
      operation: this.operation,
      type: 'performance_tracking',
    };

    if (level === LogLevel.WARN) {
      logger.warn(message, fullContext);
    } else {
      logger.info(message, fullContext);
    }
    
    return duration;
  }
}

// Utility to wrap async operations with performance tracking
export async function withPerformanceTracking<T>(
  operation: string,
  fn: () => Promise<T>,
  context: LogContext = {}
): Promise<T> {
  const tracker = new PerformanceTracker(operation, context);
  
  try {
    const result = await fn();
    tracker.end(true);
    return result;
  } catch (error) {
    tracker.end(false, { error: error instanceof Error ? error : new Error(String(error)) });
    throw error;
  }
}
