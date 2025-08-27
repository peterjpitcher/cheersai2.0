/**
 * Tests for circuit breaker implementation
 */

import { CircuitBreaker, CircuitState } from '@/lib/reliability/circuit-breaker';

// Mock timers for testing
jest.useFakeTimers();

describe('Circuit Breaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 120000, // 2 minutes
      minimumRequests: 5,
    });
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('should allow requests when circuit is closed', async () => {
    const mockOperation = jest.fn().mockResolvedValue('success');
    
    const result = await circuitBreaker.execute('test-service', mockOperation);
    
    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(1);
    
    const status = circuitBreaker.getStatus('test-service');
    expect(status?.state).toBe(CircuitState.CLOSED);
  });

  it('should open circuit after threshold failures', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
    
    // Execute minimum requests to trigger circuit evaluation
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        circuitBreaker.execute('test-service', mockOperation).catch(() => {})
      );
    }
    await Promise.all(promises);
    
    // Check status
    const status = circuitBreaker.getStatus('test-service');
    expect(status?.state).toBe(CircuitState.OPEN);
    expect(status?.failures).toBe(5);
  });

  it('should reject requests when circuit is open', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
    const mockFallback = jest.fn().mockResolvedValue('fallback result');
    
    // First, open the circuit
    for (let i = 0; i < 5; i++) {
      await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    }
    
    // Now try to execute with circuit open
    const result = await circuitBreaker.execute('test-service', mockOperation, mockFallback);
    
    expect(result).toBe('fallback result');
    expect(mockFallback).toHaveBeenCalledTimes(1);
    
    // Original operation should not be called again
    expect(mockOperation).toHaveBeenCalledTimes(5); // Only from opening phase
  });

  it('should throw error when circuit is open and no fallback provided', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
    
    // First, open the circuit
    for (let i = 0; i < 5; i++) {
      await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    }
    
    // Now try to execute without fallback
    await expect(
      circuitBreaker.execute('test-service', mockOperation)
    ).rejects.toThrow('Circuit breaker OPEN for test-service');
  });

  it('should transition to half-open after recovery timeout', async () => {
    const mockOperation = jest
      .fn()
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce('service recovered');
    
    // Open the circuit
    for (let i = 0; i < 5; i++) {
      await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    }
    
    expect(circuitBreaker.getStatus('test-service')?.state).toBe(CircuitState.OPEN);
    
    // Fast forward past recovery timeout
    jest.advanceTimersByTime(61000); // 61 seconds
    
    // Next request should transition to half-open and succeed
    const result = await circuitBreaker.execute('test-service', mockOperation);
    
    expect(result).toBe('service recovered');
    expect(circuitBreaker.getStatus('test-service')?.state).toBe(CircuitState.CLOSED);
  });

  it('should return to open state if half-open request fails', async () => {
    const mockOperation = jest
      .fn()
      .mockRejectedValue(new Error('Service unavailable'));
    
    // Open the circuit
    for (let i = 0; i < 5; i++) {
      await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    }
    
    // Fast forward past recovery timeout
    jest.advanceTimersByTime(61000);
    
    // Next request should fail and return circuit to open state
    await expect(
      circuitBreaker.execute('test-service', mockOperation)
    ).rejects.toThrow('Service unavailable');
    
    expect(circuitBreaker.getStatus('test-service')?.state).toBe(CircuitState.OPEN);
  });

  it('should not open circuit if minimum requests threshold not met', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
    
    // Execute fewer than minimum requests
    for (let i = 0; i < 3; i++) {
      await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    }
    
    const status = circuitBreaker.getStatus('test-service');
    expect(status?.state).toBe(CircuitState.CLOSED);
    expect(status?.failures).toBe(3);
  });

  it('should reset counters after monitoring period', async () => {
    const mockOperation = jest
      .fn()
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValue('success');
    
    // Fail twice
    await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    
    expect(circuitBreaker.getStatus('test-service')?.failures).toBe(2);
    
    // Fast forward past monitoring period
    jest.advanceTimersByTime(130000); // 130 seconds
    
    // Next request should succeed and reset counters
    const result = await circuitBreaker.execute('test-service', mockOperation);
    
    expect(result).toBe('success');
    expect(circuitBreaker.getStatus('test-service')?.failures).toBe(0);
  });

  it('should handle multiple services independently', async () => {
    const mockOperation1 = jest.fn().mockRejectedValue(new Error('Service 1 down'));
    const mockOperation2 = jest.fn().mockResolvedValue('service 2 ok');
    
    // Fail service 1
    for (let i = 0; i < 5; i++) {
      await circuitBreaker.execute('service-1', mockOperation1).catch(() => {});
    }
    
    // Service 2 should still work
    const result = await circuitBreaker.execute('service-2', mockOperation2);
    
    expect(result).toBe('service 2 ok');
    expect(circuitBreaker.getStatus('service-1')?.state).toBe(CircuitState.OPEN);
    expect(circuitBreaker.getStatus('service-2')?.state).toBe(CircuitState.CLOSED);
  });

  it('should track success after failures', async () => {
    const mockOperation = jest
      .fn()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValue('success');
    
    // One failure
    await circuitBreaker.execute('test-service', mockOperation).catch(() => {});
    
    expect(circuitBreaker.getStatus('test-service')?.failures).toBe(1);
    
    // Then success
    const result = await circuitBreaker.execute('test-service', mockOperation);
    
    expect(result).toBe('success');
    // Failures should not reset on success in closed state
    expect(circuitBreaker.getStatus('test-service')?.failures).toBe(1);
  });
});