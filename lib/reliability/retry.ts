/**
 * Retry utility with exponential backoff for external API calls
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: any) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
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
};

export class RetryError extends Error {
  public attempts: number;
  public lastError: any;

  constructor(message: string, attempts: number, lastError: any) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: any, retryableErrors: string[]): boolean {
  // Network errors
  if (error.code && retryableErrors.includes(error.code)) {
    return true;
  }

  // HTTP status codes that are retryable
  if (error.status) {
    // 429 (Rate Limit), 503 (Service Unavailable), 504 (Gateway Timeout)
    if ([429, 503, 504].includes(error.status)) {
      return true;
    }
    // 5xx errors are generally retryable
    if (error.status >= 500 && error.status < 600) {
      return true;
    }
  }

  // OpenAI specific errors
  if (error.message?.includes('rate limit') || 
      error.message?.includes('temporarily unavailable')) {
    return true;
  }

  // Facebook/Instagram API errors
  if (error.error?.is_transient || 
      error.error?.code === 1 || // Unknown error
      error.error?.code === 2) {  // Service temporarily unavailable
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffFactor: number
): number {
  // Exponential backoff with jitter
  const exponentialDelay = initialDelay * Math.pow(backoffFactor, attempt - 1);
  const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5);
  return Math.min(jitteredDelay, maxDelay);
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
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;

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
        opts.backoffFactor
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