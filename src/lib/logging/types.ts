export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  correlationId: string;
  timestamp: string; // ISO 8601
  service: string; // 'cheersai'
  environment: string; // process.env.NODE_ENV
  duration?: number; // milliseconds
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}
