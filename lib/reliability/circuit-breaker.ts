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

interface CircuitStateData {
  state: CircuitState;
  failures: Date[];
  successes: Date[];
  lastFailTime?: Date;
  nextAttemptTime?: Date;
  halfOpenTests: number;
  halfOpenSuccesses: number;
}

type LegacyCircuitBreakerOptions = CircuitBreakerOptions & {
  recoveryTimeout?: number;
  monitoringPeriod?: number;
};

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
  private serviceStates: Map<string, CircuitStateData> = new Map();

  constructor(
    nameOrOptions: string | CircuitBreakerOptions = 'default',
    maybeOptions: CircuitBreakerOptions = {}
  ) {
    // Support both signatures: (name, options) and (options)
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : 'default';
    const options = typeof nameOrOptions === 'string' ? maybeOptions : nameOrOptions;
    this.name = name;
    // Map legacy option names from tests
    const normalized: LegacyCircuitBreakerOptions = { ...options };
    if (typeof normalized.recoveryTimeout === 'number') {
      normalized.resetTimeout = normalized.recoveryTimeout;
      delete normalized.recoveryTimeout;
    }
    if (typeof normalized.monitoringPeriod === 'number') {
      normalized.monitoringWindow = normalized.monitoringPeriod;
      delete normalized.monitoringPeriod;
    }
    this.options = { ...DEFAULT_OPTIONS, ...normalized } as Required<CircuitBreakerOptions>;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T>;
  async execute<T>(service: string, fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
  async execute<T>(
    arg1: string | (() => Promise<T>),
    arg2?: () => Promise<T>,
    arg3?: () => Promise<T>
  ): Promise<T> {
    if (typeof arg1 === 'function') {
      const fn = arg1;
      const state: CircuitStateData = {
        state: this.state,
        failures: this.failures,
        successes: this.successes,
        lastFailTime: this.lastFailTime,
        nextAttemptTime: this.nextAttemptTime,
        halfOpenTests: this.halfOpenTests,
        halfOpenSuccesses: this.halfOpenSuccesses,
      };
      return this.executeOnState(state, fn, (updated) => {
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
    const service = arg1 as string;
    if (!arg2) {
      throw new Error('CircuitBreaker.execute requires a function argument');
    }
    const fn = arg2;
    const fallback = arg3;
    const state = this.getOrCreateServiceState(service);
    try {
      return await this.executeOnState(state, fn, (updated) => {
        this.serviceStates.set(service, updated);
      });
    } catch (err) {
      if (err instanceof CircuitBreakerError) {
        if (fallback) {
          return await fallback();
        }
        // Match legacy error message expected in tests
        throw new Error(`Circuit breaker OPEN for ${service}`);
      }
      throw err;
    }
  }

  private getOrCreateServiceState(service: string): CircuitStateData {
    const existing = this.serviceStates.get(service);
    if (existing) return existing;
    const fresh: CircuitStateData = {
      state: CircuitState.CLOSED,
      failures: [],
      successes: [],
      lastFailTime: undefined,
      nextAttemptTime: undefined,
      halfOpenTests: 0,
      halfOpenSuccesses: 0,
    };
    this.serviceStates.set(service, fresh);
    return fresh;
  }

  private async executeOnState<T>(
    state: CircuitStateData,
    fn: () => Promise<T>,
    persist: (updated: CircuitStateData) => void
  ): Promise<T> {
    // Check if circuit is open
    if (state.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset(state)) {
        this.transitionTo(state, CircuitState.HALF_OPEN);
        persist(state);
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}`,
          state.state,
          state.nextAttemptTime || new Date()
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess(state);
      persist(state);
      return result;
    } catch (error) {
      this.onFailure(state);
      persist(state);
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
  private onSuccess(state: CircuitStateData): void {
    const now = new Date();
    state.successes.push(now);
    
    // Clean old successes outside monitoring window
    state.successes = state.successes.filter(
      (date) => now.getTime() - date.getTime() < this.options.monitoringWindow
    );

    if (state.state === CircuitState.HALF_OPEN) {
      state.halfOpenSuccesses++;
      
      if (state.halfOpenSuccesses >= this.options.successThreshold) {
        this.transitionTo(state, CircuitState.CLOSED);
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(state: CircuitStateData): void {
    const now = new Date();
    state.failures.push(now);
    state.lastFailTime = now;
    
    // Clean old failures outside monitoring window
    state.failures = state.failures.filter(
      (date) => now.getTime() - date.getTime() < this.options.monitoringWindow
    );

    if (state.state === CircuitState.HALF_OPEN) {
      this.transitionTo(state, CircuitState.OPEN);
      return;
    }

    // Check if we should open the circuit
    const totalRequests = state.failures.length + state.successes.length;
    if (
      state.state === CircuitState.CLOSED &&
      totalRequests >= this.options.minimumRequests &&
      state.failures.length >= this.options.failureThreshold
    ) {
      this.transitionTo(state, CircuitState.OPEN);
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(state: CircuitStateData): boolean {
    if (!state.lastFailTime) return true;
    
    const now = new Date();
    const timeSinceLastFail = now.getTime() - state.lastFailTime.getTime();
    return timeSinceLastFail >= this.options.resetTimeout;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(state: CircuitStateData, newState: CircuitState): void {
    const oldState = state.state;
    state.state = newState;

    switch (newState) {
      case CircuitState.OPEN:
        state.nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
        break;
      case CircuitState.HALF_OPEN:
        state.halfOpenTests = 0;
        state.halfOpenSuccesses = 0;
        break;
      case CircuitState.CLOSED:
        state.failures = [];
        state.halfOpenTests = 0;
        state.halfOpenSuccesses = 0;
        state.nextAttemptTime = undefined;
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
      const recentFailures = s.failures.filter(
        (date) => now.getTime() - date.getTime() < this.options.monitoringWindow
      );
      const recentSuccesses = s.successes.filter(
        (date) => now.getTime() - date.getTime() < this.options.monitoringWindow
      );
      return {
        state: s.state,
        failures: recentFailures.length,
        successes: recentSuccesses.length,
        nextAttemptTime: s.nextAttemptTime,
        lastFailTime: s.lastFailTime,
      };
    }

    const recentFailures = this.failures.filter(
      (date) => now.getTime() - date.getTime() < this.options.monitoringWindow
    );
    const recentSuccesses = this.successes.filter(
      (date) => now.getTime() - date.getTime() < this.options.monitoringWindow
    );
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
    const stats: Record<string, ReturnType<CircuitBreaker['getStats']>> = {};
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
