import type { LogLevel, LogEntry } from './types';
import { getCorrelationId, getRequestStartTime } from './correlation';
import { sendToAxiom } from './axiom';

const AXIOM_DATASET = process.env.AXIOM_DATASET ?? 'cheersai';

function buildEntry(level: LogLevel, message: string, metadata?: Record<string, unknown>): LogEntry {
  return {
    level,
    message,
    correlationId: getCorrelationId(),
    timestamp: new Date().toISOString(),
    service: 'cheersai',
    environment: process.env.NODE_ENV ?? 'development',
    duration: Date.now() - getRequestStartTime(),
    metadata,
  };
}

function emit(entry: LogEntry): void {
  // Always log to console in structured JSON
  const consoleFn = entry.level === 'error' ? console.error
    : entry.level === 'warn' ? console.warn
    : console.log;
  consoleFn(JSON.stringify(entry));

  // Send to Axiom if configured
  sendToAxiom(AXIOM_DATASET, [entry as unknown as Record<string, unknown>]);
}

/** Structured logger with JSON output, correlation IDs, and Axiom transport. */
export const log = {
  debug: (message: string, metadata?: Record<string, unknown>): void => emit(buildEntry('debug', message, metadata)),
  info: (message: string, metadata?: Record<string, unknown>): void => emit(buildEntry('info', message, metadata)),
  warn: (message: string, metadata?: Record<string, unknown>): void => emit(buildEntry('warn', message, metadata)),
  error: (message: string, error?: Error, metadata?: Record<string, unknown>): void => {
    const entry = buildEntry('error', message, metadata);
    if (error) {
      entry.error = { name: error.name, message: error.message, stack: error.stack };
    }
    emit(entry);
  },
};

/** Create a domain-scoped logger that prefixes all messages with [domain]. */
export function createLogger(domain: string) {
  return {
    debug: (message: string, metadata?: Record<string, unknown>): void => log.debug(`[${domain}] ${message}`, metadata),
    info: (message: string, metadata?: Record<string, unknown>): void => log.info(`[${domain}] ${message}`, metadata),
    warn: (message: string, metadata?: Record<string, unknown>): void => log.warn(`[${domain}] ${message}`, metadata),
    error: (message: string, error?: Error, metadata?: Record<string, unknown>): void => log.error(`[${domain}] ${message}`, error, metadata),
  };
}
