import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

interface RequestContext {
  correlationId: string;
  startTime: number;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Generate a new correlation ID (UUID v4). */
export function createCorrelationId(): string {
  return crypto.randomUUID();
}

/** Get the current correlation ID, or 'no-context' if outside a request scope. */
export function getCorrelationId(): string {
  return requestContext.getStore()?.correlationId ?? 'no-context';
}

/** Get the start time of the current request context. */
export function getRequestStartTime(): number {
  return requestContext.getStore()?.startTime ?? Date.now();
}

/**
 * Run a callback within a correlation context.
 * If no correlationId is provided, a new UUID is generated.
 */
export function withCorrelationId<T>(fn: () => T, correlationId?: string): T {
  const ctx: RequestContext = {
    correlationId: correlationId ?? createCorrelationId(),
    startTime: Date.now(),
  };
  return requestContext.run(ctx, fn);
}
