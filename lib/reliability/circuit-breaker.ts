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
  successThreshold: 3,
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

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}`,
          this.state,
          this.nextAttemptTime || new Date()
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    const now = new Date();
    this.successes.push(now);
    
    // Clean old successes outside monitoring window
    this.successes = this.successes.filter(
      date => now.getTime() - date.getTime() < this.options.monitoringWindow
    );

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      
      if (this.halfOpenSuccesses >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    const now = new Date();
    this.failures.push(now);
    this.lastFailTime = now;
    
    // Clean old failures outside monitoring window
    this.failures = this.failures.filter(
      date => now.getTime() - date.getTime() < this.options.monitoringWindow
    );

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    // Check if we should open the circuit
    const totalRequests = this.failures.length + this.successes.length;
    if (
      this.state === CircuitState.CLOSED &&
      totalRequests >= this.options.minimumRequests &&
      this.failures.length >= this.options.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailTime) return true;
    
    const now = new Date();
    const timeSinceLastFail = now.getTime() - this.lastFailTime.getTime();
    return timeSinceLastFail >= this.options.resetTimeout;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    switch (newState) {
      case CircuitState.OPEN:
        this.nextAttemptTime = new Date(
          Date.now() + this.options.resetTimeout
        );
        break;
      case CircuitState.HALF_OPEN:
        this.halfOpenTests = 0;
        this.halfOpenSuccesses = 0;
        break;
      case CircuitState.CLOSED:
        this.failures = [];
        this.halfOpenTests = 0;
        this.halfOpenSuccesses = 0;
        this.nextAttemptTime = undefined;
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
  getStats() {
    const now = new Date();
    const recentFailures = this.failures.filter(
      date => now.getTime() - date.getTime() < this.options.monitoringWindow
    );
    const recentSuccesses = this.successes.filter(
      date => now.getTime() - date.getTime() < this.options.monitoringWindow
    );

    return {
      state: this.state,
      failures: recentFailures.length,
      successes: recentSuccesses.length,
      nextAttemptTime: this.nextAttemptTime,
      lastFailTime: this.lastFailTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Manually open the circuit breaker
   */
  open(): void {
    this.transitionTo(CircuitState.OPEN);
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