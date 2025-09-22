/**
 * Retry utility with exponential backoff for external API calls
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: unknown) => void;
  // Legacy-compatible options
  baseDelay?: number;
  exponentialBase?: number;
  jitter?: boolean;
}

type DefaultOptions = Required<RetryOptions>;
const DEFAULT_OPTIONS: DefaultOptions = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'RATE_LIMIT',
    'TEMPORARY_ERROR',
  ],
  onRetry: () => {},
  jitter: true,
  baseDelay: 1000,
  exponentialBase: 2,
};

export class RetryError extends Error {
  public attempts: number;
  public lastError: unknown;
  static [Symbol.hasInstance](instance: unknown) {
    try {
      return (
        instance instanceof Error &&
        ((instance as Error).name === 'RetryError' || Object.getPrototypeOf(instance)?.constructor?.name === 'RetryError')
      );
    } catch {
      return false;
    }
  }

  constructor(message: string, attempts: number, lastError: unknown) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
    // Ensure instanceof works across transpilation boundaries
    Object.setPrototypeOf(this, new.target.prototype);
    // Helpful stack traces in V8
    const captureStackTrace = (Error as typeof Error & { captureStackTrace?: typeof Error.captureStackTrace }).captureStackTrace;
    if (typeof captureStackTrace === 'function') {
      captureStackTrace(this, RetryError);
    }
  }
}

type RetryableErrorShape = {
  code?: string | number;
  status?: number;
  message?: string;
  error?: {
    is_transient?: boolean;
    code?: number;
  };
};

function toRetryableError(error: unknown): RetryableErrorShape {
  if (error && typeof error === 'object') {
    return error as RetryableErrorShape;
  }

  return { message: typeof error === 'string' ? error : String(error) };
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  const inspectedError = toRetryableError(error);
  // Network errors
  if (inspectedError.code && retryableErrors.includes(String(inspectedError.code))) {
    return true;
  }

  // HTTP status codes that are retryable
  if (typeof inspectedError.status === 'number') {
    // 429 (Rate Limit), 503 (Service Unavailable), 504 (Gateway Timeout)
    if ([429, 503, 504].includes(inspectedError.status)) {
      return true;
    }
    // 5xx errors are generally retryable
    if (inspectedError.status >= 500 && inspectedError.status < 600) {
      return true;
    }
    // Treat 4xx (except 429) as non-retryable
    return false;
  }

  // If no explicit status, default to retryable for transient resilience
  // OpenAI specific errors
  if (inspectedError.message?.includes('rate limit') || 
      inspectedError.message?.includes('temporarily unavailable')) {
    return true;
  }

  // Facebook/Instagram API errors
  if (inspectedError.error?.is_transient || 
      inspectedError.error?.code === 1 || // Unknown error
      inspectedError.error?.code === 2) {  // Service temporarily unavailable
    return true;
  }

  return true;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffFactor: number,
  jitter: boolean
): number {
  // Exponential backoff with jitter
  const exponentialDelay = initialDelay * Math.pow(backoffFactor, attempt - 1);
  const withJitter = jitter ? exponentialDelay * (0.5 + Math.random() * 0.5) : exponentialDelay;
  return Math.min(withJitter, maxDelay);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const mapped: RetryOptions = { ...options };
  if (mapped.baseDelay && !mapped.initialDelay) mapped.initialDelay = mapped.baseDelay;
  if (mapped.exponentialBase && !mapped.backoffFactor) mapped.backoffFactor = mapped.exponentialBase;
  const opts: DefaultOptions = { ...DEFAULT_OPTIONS, ...mapped, baseDelay: mapped.baseDelay ?? DEFAULT_OPTIONS.baseDelay, exponentialBase: mapped.exponentialBase ?? DEFAULT_OPTIONS.exponentialBase };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if this is the last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error, opts.retryableErrors)) {
        throw error;
      }

      // Calculate delay
      const delay = calculateDelay(
        attempt,
        opts.initialDelay,
        opts.maxDelay,
        opts.backoffFactor,
        opts.jitter
      );

      // Call retry callback
      opts.onRetry(attempt, error);

      // Wait before next attempt
      await sleep(delay);
    }
  }

  throw new RetryError(
    `Failed after ${opts.maxAttempts} attempts`,
    opts.maxAttempts,
    lastError
  );
}

/**
 * Backwards-compatible alias used elsewhere in the codebase
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}, _label?: string) {
  void _label
  return retry(fn, options);
}

/**
 * Expose default retry options for callers that want to inspect/tweak
 */
export function getRetryOptions(): Required<RetryOptions> {
  return { ...DEFAULT_OPTIONS };
}

/**
 * Retry with timeout
 */
export async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  options: RetryOptions = {}
): Promise<T> {
  return Promise.race([
    retry(fn, options),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Platform-specific retry configurations
 */
export const PLATFORM_RETRY_CONFIGS = {
  openai: {
    maxAttempts: 3,
    initialDelay: 2000,
    maxDelay: 60000,
    backoffFactor: 2,
    retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'SERVICE_UNAVAILABLE'],
  },
  facebook: {
    maxAttempts: 4,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    retryableErrors: ['TRANSIENT_ERROR', 'RATE_LIMIT', 'UNKNOWN_ERROR'],
  },
  instagram: {
    maxAttempts: 4,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    retryableErrors: ['TRANSIENT_ERROR', 'RATE_LIMIT', 'MEDIA_PROCESSING'],
  },
  stripe: {
    maxAttempts: 2,
    initialDelay: 500,
    maxDelay: 5000,
    backoffFactor: 2,
    retryableErrors: ['RATE_LIMIT', 'NETWORK_ERROR'],
  },
};
