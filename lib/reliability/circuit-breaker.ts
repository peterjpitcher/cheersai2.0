/**
 * Circuit Breaker pattern implementation for external service calls
 */

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing, reject all calls
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;     // Number of failures before opening
  resetTimeout?: number;          // Time to wait before trying again (ms)
  monitoringWindow?: number;      // Time window for counting failures (ms)
  minimumRequests?: number;       // Minimum requests before opening
  successThreshold?: number;      // Successes needed in half-open to close
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  monitoringWindow: 60000, // 1 minute
  minimumRequests: 10,
  successThreshold: 1,
  onStateChange: () => {},
};

export class CircuitBreakerError extends Error {
  public state: CircuitState;
  public nextAttempt: Date;

  constructor(message: string, state: CircuitState, nextAttempt: Date) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.state = state;
    this.nextAttempt = nextAttempt;
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: Date[] = [];
  private successes: Date[] = [];
  private lastFailTime?: Date;
  private nextAttemptTime?: Date;
  private halfOpenTests = 0;
  private halfOpenSuccesses = 0;
  private readonly options: Required<CircuitBreakerOptions>;
  private readonly name: string;
  // Maintain per-service states for legacy API usage
  private serviceStates: Map<string, {
    state: CircuitState;
    failures: Date[];
    successes: Date[];
    lastFailTime?: Date;
    nextAttemptTime?: Date;
    halfOpenTests: number;
    halfOpenSuccesses: number;
  }> = new Map();

  constructor(
    nameOrOptions: string | CircuitBreakerOptions = 'default',
    maybeOptions: CircuitBreakerOptions = {}
  ) {
    // Support both signatures: (name, options) and (options)
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : 'default';
    const options = typeof nameOrOptions === 'string' ? maybeOptions : nameOrOptions;
    this.name = name;
    // Map legacy option names from tests
    const normalized: CircuitBreakerOptions = { ...options };
    if ('recoveryTimeout' in (normalized as any)) {
      (normalized as any).resetTimeout = (normalized as any).recoveryTimeout;
    }
    if ('monitoringPeriod' in (normalized as any)) {
      (normalized as any).monitoringWindow = (normalized as any).monitoringPeriod;
    }
    this.options = { ...DEFAULT_OPTIONS, ...normalized } as Required<CircuitBreakerOptions>;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T>;
  async execute<T>(service: string, fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
  async execute<T>(arg1: any, arg2?: any, arg3?: any): Promise<T> {
    if (typeof arg1 === 'function') {
      const fn = arg1 as () => Promise<T>;
      return this.executeOnState({
        state: this.state,
        failures: this.failures,
        successes: this.successes,
        lastFailTime: this.lastFailTime,
        nextAttemptTime: this.nextAttemptTime,
        halfOpenTests: this.halfOpenTests,
        halfOpenSuccesses: this.halfOpenSuccesses,
      }, fn, (updated) => {
        this.state = updated.state;
        this.failures = updated.failures;
        this.successes = updated.successes;
        this.lastFailTime = updated.lastFailTime;
        this.nextAttemptTime = updated.nextAttemptTime;
        this.halfOpenTests = updated.halfOpenTests;
        this.halfOpenSuccesses = updated.halfOpenSuccesses;
      });
    }

    // Legacy signature: (service, fn, fallback?)
    const _service = arg1 as string;
    const fn = arg2 as () => Promise<T>;
    const fallback = arg3 as (() => Promise<T>) | undefined;
    const state = this.getOrCreateServiceState(_service);
    try {
      return await this.executeOnState(state, fn, (updated) => {
        this.serviceStates.set(_service, updated);
      });
    } catch (err) {
      if (err instanceof CircuitBreakerError) {
        if (fallback) {
          return await fallback();
        }
        // Match legacy error message expected in tests
        throw new Error(`Circuit breaker OPEN for ${_service}`);
      }
      throw err;
    }
  }

  private getOrCreateServiceState(service: string) {
    const existing = this.serviceStates.get(service);
    if (existing) return existing;
    const fresh = {
      state: CircuitState.CLOSED,
      failures: [],
      successes: [],
      lastFailTime: undefined as Date | undefined,
      nextAttemptTime: undefined as Date | undefined,
      halfOpenTests: 0,
      halfOpenSuccesses: 0,
    };
    this.serviceStates.set(service, fresh);
    return fresh;
  }

  private async executeOnState<T>(
    s: {
      state: CircuitState;
      failures: Date[];
      successes: Date[];
      lastFailTime?: Date;
      nextAttemptTime?: Date;
      halfOpenTests: number;
      halfOpenSuccesses: number;
    },
    fn: () => Promise<T>,
    persist: (updated: typeof s) => void
  ): Promise<T> {
    // Check if circuit is open
    if (s.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset(s)) {
        this.transitionTo(s, CircuitState.HALF_OPEN);
        persist(s);
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}`,
          s.state,
          s.nextAttemptTime || new Date()
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess(s);
      persist(s);
      return result;
    } catch (error) {
      this.onFailure(s);
      persist(s);
      throw error;
    }
  }

  // Backwards-compatible overload: execute(service, fn, fallback?)
  async executeLegacy<T>(service: string, fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (err) {
      if (err instanceof CircuitBreakerError && fallback) {
        return await fallback();
      }
      throw err;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(s: { state: CircuitState; successes: Date[]; halfOpenSuccesses: number; }): void {
    const now = new Date();
    s.successes.push(now);
    
    // Clean old successes outside monitoring window
    s.successes = s.successes.filter(date => now.getTime() - date.getTime() < this.options.monitoringWindow);

    if (s.state === CircuitState.HALF_OPEN) {
      s.halfOpenSuccesses++;
      
      if (s.halfOpenSuccesses >= this.options.successThreshold) {
        this.transitionTo(s as any, CircuitState.CLOSED);
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(s: { state: CircuitState; failures: Date[]; successes: Date[]; lastFailTime?: Date; }): void {
    const now = new Date();
    s.failures.push(now);
    (s as any).lastFailTime = now;
    
    // Clean old failures outside monitoring window
    s.failures = s.failures.filter(date => now.getTime() - date.getTime() < this.options.monitoringWindow);

    if (s.state === CircuitState.HALF_OPEN) {
      this.transitionTo(s as any, CircuitState.OPEN);
      return;
    }

    // Check if we should open the circuit
    const totalRequests = s.failures.length + s.successes.length;
    if (
      s.state === CircuitState.CLOSED &&
      totalRequests >= this.options.minimumRequests &&
      s.failures.length >= this.options.failureThreshold
    ) {
      this.transitionTo(s as any, CircuitState.OPEN);
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(s: { lastFailTime?: Date }): boolean {
    if (!s.lastFailTime) return true;
    
    const now = new Date();
    const timeSinceLastFail = now.getTime() - s.lastFailTime.getTime();
    return timeSinceLastFail >= this.options.resetTimeout;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(s: {
    state: CircuitState;
    failures: Date[];
    successes: Date[];
    halfOpenTests: number;
    halfOpenSuccesses: number;
    nextAttemptTime?: Date;
  }, newState: CircuitState): void {
    const oldState = s.state;
    s.state = newState;

    switch (newState) {
      case CircuitState.OPEN:
        (s as any).nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
        break;
      case CircuitState.HALF_OPEN:
        s.halfOpenTests = 0;
        s.halfOpenSuccesses = 0;
        break;
      case CircuitState.CLOSED:
        s.failures = [];
        s.halfOpenTests = 0;
        s.halfOpenSuccesses = 0;
        (s as any).nextAttemptTime = undefined;
        break;
    }

    this.options.onStateChange(oldState, newState);
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(service?: string) {
    const now = new Date();
    if (service) {
      const s = this.getOrCreateServiceState(service);
      const recentFailures = s.failures.filter(date => now.getTime() - date.getTime() < this.options.monitoringWindow);
      const recentSuccesses = s.successes.filter(date => now.getTime() - date.getTime() < this.options.monitoringWindow);
      return {
        state: s.state,
        failures: recentFailures.length,
        successes: recentSuccesses.length,
        nextAttemptTime: s.nextAttemptTime,
        lastFailTime: s.lastFailTime,
      };
    }

    const recentFailures = this.failures.filter(date => now.getTime() - date.getTime() < this.options.monitoringWindow);
    const recentSuccesses = this.successes.filter(date => now.getTime() - date.getTime() < this.options.monitoringWindow);
    return {
      state: this.state,
      failures: recentFailures.length,
      successes: recentSuccesses.length,
      nextAttemptTime: this.nextAttemptTime,
      lastFailTime: this.lastFailTime,
    };
  }

  // Backwards-compatible status getter
  getStatus(service?: string) {
    return this.getStats(service);
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    // Reset global/default state
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.successes = [];
    this.halfOpenTests = 0;
    this.halfOpenSuccesses = 0;
    this.nextAttemptTime = undefined;
  }

  /**
   * Manually open the circuit breaker
   */
  open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
  }
}

/**
 * Global circuit breaker registry
 */
class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  get(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name)!;
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }

  getStats() {
    const stats: Record<string, any> = {};
    this.breakers.forEach((breaker, name) => {
      stats[name] = breaker.getStats();
    });
    return stats;
  }
}

// Export singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Platform-specific circuit breaker configurations
 */
export const PLATFORM_CIRCUIT_CONFIG = {
  openai: {
    failureThreshold: 3,
    resetTimeout: 60000,
    minimumRequests: 5,
    successThreshold: 2,
  },
  facebook: {
    failureThreshold: 5,
    resetTimeout: 30000,
    minimumRequests: 10,
    successThreshold: 3,
  },
  instagram: {
    failureThreshold: 5,
    resetTimeout: 30000,
    minimumRequests: 10,
    successThreshold: 3,
  },
  stripe: {
    failureThreshold: 2,
    resetTimeout: 10000,
    minimumRequests: 3,
    successThreshold: 1,
  },
};

// Convenience helper to get a circuit breaker by name (backwards compatibility)
export function getCircuitBreaker(name: string, options?: CircuitBreakerOptions) {
  return circuitBreakerRegistry.get(name, options);
}
