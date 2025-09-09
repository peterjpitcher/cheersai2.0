/**
 * Reliable API client with circuit breaker, retries, and timeouts
 * Provides a unified interface for all external API calls
 */

import { withRetry, getRetryOptions, RetryError } from './retry';
import { getCircuitBreaker } from './circuit-breaker';
import { fetchWithTimeout, getTimeout, TimeoutError } from './timeout';

export interface ApiClientOptions {
  service: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

export interface ApiRequest {
  method?: string;
  path: string;
  body?: any;
  headers?: Record<string, string>;
  timeout?: number;
  skipRetry?: boolean;
  skipCircuitBreaker?: boolean;
}

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  headers: Headers;
  success: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: Response,
    public readonly data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ReliableApiClient {
  private service: string;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;

  constructor(options: ApiClientOptions) {
    this.service = options.service;
    this.baseUrl = options.baseUrl || '';
    this.defaultHeaders = options.defaultHeaders || {};
    this.timeout = options.timeout || getTimeout(options.service);
  }

  async request<T = any>(request: ApiRequest): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      path,
      body,
      headers = {},
      timeout = this.timeout,
      skipRetry = false,
      skipCircuitBreaker = false,
    } = request;

    const url = this.baseUrl + path;
    const fullHeaders = { ...this.defaultHeaders, ...headers };

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: fullHeaders,
    };

    if (body) {
      if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        fetchOptions.body = JSON.stringify(body);
        fullHeaders['Content-Type'] = 'application/json';
      } else {
        fetchOptions.body = body;
      }
    }

    // Create the actual fetch function
    const fetchFn = async (): Promise<ApiResponse<T>> => {
      const response = await fetchWithTimeout(url, { ...fetchOptions, timeout });
      
      // Parse response
      let data: T;
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = (await response.text()) as unknown as T;
      }

      // Check if response indicates an error
      if (!response.ok) {
        throw new ApiError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          response,
          data
        );
      }

      return {
        data,
        status: response.status,
        headers: response.headers,
        success: true,
      };
    };

    const context = `${this.service} ${method} ${path}`;

    try {
      if (skipRetry && skipCircuitBreaker) {
        // Direct call without reliability features
        return await fetchFn();
      }

      if (skipCircuitBreaker) {
        // Use retry but skip circuit breaker
        const retryOptions = getRetryOptions();
        return await withRetry(fetchFn, retryOptions);
      }

      if (skipRetry) {
        // Use circuit breaker but skip retry
        const circuitBreaker = getCircuitBreaker(this.service);
        return await circuitBreaker.execute(fetchFn);
      }

      // Use both circuit breaker and retry (recommended)
      const circuitBreaker = getCircuitBreaker(this.service);
      const retryOptions = getRetryOptions();
      
      return await circuitBreaker.execute(async () => await withRetry(fetchFn, retryOptions));
    } catch (error) {
      // Add context to errors
      if (error instanceof TimeoutError) {
        console.error(`${context} timed out after ${timeout}ms`);
      } else if (error instanceof RetryError) {
        console.error(`${context} failed after ${error.attempts} attempts`);
      } else if (error instanceof ApiError) {
        console.error(`${context} returned ${error.status}: ${error.message}`);
      } else {
        console.error(`${context} failed with unexpected error:`, error);
      }
      
      throw error;
    }
  }

  // Convenience methods
  async get<T = any>(path: string, options?: Omit<ApiRequest, 'method' | 'path'>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'GET', path });
  }

  async post<T = any>(path: string, body?: any, options?: Omit<ApiRequest, 'method' | 'path' | 'body'>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'POST', path, body });
  }

  async put<T = any>(path: string, body?: any, options?: Omit<ApiRequest, 'method' | 'path' | 'body'>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'PUT', path, body });
  }

  async delete<T = any>(path: string, options?: Omit<ApiRequest, 'method' | 'path'>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'DELETE', path });
  }

  async patch<T = any>(path: string, body?: any, options?: Omit<ApiRequest, 'method' | 'path' | 'body'>): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'PATCH', path, body });
  }

  // Override this method to provide service-specific fallbacks
  protected getFallback(request: ApiRequest): (() => Promise<ApiResponse>) | undefined {
    return undefined;
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      await this.get('/health', { timeout: 5000, skipRetry: true });
      return true;
    } catch {
      return false;
    }
  }

  // Get circuit breaker status
  getCircuitStatus() {
    const circuitBreaker = getCircuitBreaker(this.service);
    return circuitBreaker.getStats();
  }
}

// Factory function to create service-specific API clients
export function createApiClient(service: string, options: Omit<ApiClientOptions, 'service'> = {}): ReliableApiClient {
  return new ReliableApiClient({ ...options, service });
}

// Pre-configured clients for common services
export const openaiClient = createApiClient('openai', {
  baseUrl: 'https://api.openai.com/v1',
  defaultHeaders: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

export const facebookClient = createApiClient('facebook', {
  baseUrl: 'https://graph.facebook.com/v23.0',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
});

export const instagramClient = createApiClient('instagram', {
  baseUrl: 'https://graph.facebook.com/v23.0',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
});

export const twitterClient = createApiClient('twitter', {
  baseUrl: 'https://api.twitter.com/2',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
});

// LinkedIn removed

export const stripeClient = createApiClient('stripe', {
  baseUrl: 'https://api.stripe.com/v1',
  defaultHeaders: {
    'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
});
