/**
 * Timeout utilities for external API calls
 * Prevents hanging requests and provides graceful timeout handling
 */

export class TimeoutError extends Error {
  constructor(timeout: number, operation?: string) {
    super(`${operation || 'Operation'} timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
  }
}

export interface TimeoutOptions {
  timeout: number; // Timeout in milliseconds
  abortController?: AbortController; // Optional abort controller
}

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions,
  operation?: string
): Promise<T> {
  const { timeout, abortController } = options;
  
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
      reject(new TimeoutError(timeout, operation));
    }, timeout);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

/**
 * Create a fetch request with timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  fetchOptions.signal = controller.signal;

  return withTimeout(
    fetch(url, fetchOptions),
    { timeout, abortController: controller },
    `Fetch ${url}`
  );
}

// Default timeout configurations for different services
export const defaultTimeouts: Record<string, number> = {
  openai: 60000, // 1 minute for AI generation
  facebook: 30000, // 30 seconds for social media APIs
  instagram: 30000,
  google: 30000,
  stripe: 20000, // 20 seconds for payment processing
  supabase: 10000, // 10 seconds for database operations
  resend: 15000, // 15 seconds for email
  linkedin: 20000,
  default: 30000, // Default 30 seconds
};

/**
 * Get timeout for a specific service
 */
export function getTimeout(service: string): number {
  return defaultTimeouts[service] || defaultTimeouts.default;
}

/**
 * Create a timeout-aware fetch wrapper for a specific service
 */
export function createServiceFetch(service: string) {
  const timeout = getTimeout(service);
  
  return async (url: string, options: RequestInit = {}): Promise<Response> => {
    return fetchWithTimeout(url, { ...options, timeout });
  };
}

/**
 * Create an AbortController that automatically aborts after a timeout
 */
export function createTimeoutController(timeout: number): AbortController {
  const controller = new AbortController();
  
  setTimeout(() => {
    controller.abort();
  }, timeout);
  
  return controller;
}
