/**
 * Tests for retry logic with exponential backoff
 */

import { withRetry, RetryError } from '@/lib/reliability/retry';

// Mock timers for testing
jest.useFakeTimers();

describe('Retry Logic', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('should succeed on first attempt when function succeeds', async () => {
    const mockFn = jest.fn().mockResolvedValue('success');
    const options = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      exponentialBase: 2,
      jitter: false,
    };

    const result = await withRetry(mockFn, options);

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('success');

    const options = {
      maxAttempts: 3,
      baseDelay: 100,
      maxDelay: 1000,
      exponentialBase: 2,
      jitter: false,
    };

    const promise = withRetry(mockFn, options);

    // Fast-forward timers to simulate delays
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(200);

    const result = await promise;

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should throw RetryError when max attempts reached', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Persistent error'));
    const options = {
      maxAttempts: 3,
      baseDelay: 100,
      maxDelay: 1000,
      exponentialBase: 2,
      jitter: false,
    };

    const promise = withRetry(mockFn, options);

    // Fast-forward all timers
    await jest.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toThrow(RetryError);
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should not retry on non-retryable errors', async () => {
    const error = new Error('Bad Request');
    (error as any).status = 400;

    const mockFn = jest.fn().mockRejectedValue(error);
    const options = {
      maxAttempts: 3,
      baseDelay: 100,
      maxDelay: 1000,
      exponentialBase: 2,
      jitter: false,
    };

    await expect(withRetry(mockFn, options)).rejects.toThrow('Bad Request');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable status codes', async () => {
    const error429 = new Error('Rate limited');
    (error429 as any).status = 429;

    const error500 = new Error('Server error');
    (error500 as any).status = 500;

    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce('success');

    const options = {
      maxAttempts: 3,
      baseDelay: 100,
      maxDelay: 1000,
      exponentialBase: 2,
      jitter: false,
    };

    const promise = withRetry(mockFn, options);
    await jest.advanceTimersByTimeAsync(400);

    const result = await promise;

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should calculate exponential backoff correctly', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockResolvedValueOnce('success');

    const options = {
      maxAttempts: 3,
      baseDelay: 100,
      maxDelay: 10000,
      exponentialBase: 2,
      jitter: false,
    };

    const startTime = Date.now();
    const promise = withRetry(mockFn, options);

    // First retry delay: 100ms
    await jest.advanceTimersByTimeAsync(100);
    
    // Second retry delay: 200ms
    await jest.advanceTimersByTimeAsync(200);

    await promise;

    // Verify the function was called 3 times with appropriate delays
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should respect max delay limit', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Error'))
      .mockResolvedValueOnce('success');

    const options = {
      maxAttempts: 2,
      baseDelay: 1000,
      maxDelay: 500, // Max delay is less than calculated delay
      exponentialBase: 2,
      jitter: false,
    };

    const promise = withRetry(mockFn, options);
    
    // Should use max delay (500ms) instead of calculated delay (1000ms)
    await jest.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe('success');
  });

  it('should add jitter when enabled', async () => {
    // Mock Math.random to return a predictable value
    const originalRandom = Math.random;
    Math.random = jest.fn(() => 0.5);

    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Error'))
      .mockResolvedValueOnce('success');

    const options = {
      maxAttempts: 2,
      baseDelay: 1000,
      maxDelay: 5000,
      exponentialBase: 2,
      jitter: true,
    };

    const promise = withRetry(mockFn, options);
    
    // With jitter and Math.random = 0.5, delay should be 1000 * (0.5 + 0.5 * 0.5) = 750ms
    await jest.advanceTimersByTimeAsync(750);

    const result = await promise;
    expect(result).toBe('success');

    // Restore original Math.random
    Math.random = originalRandom;
  });
});