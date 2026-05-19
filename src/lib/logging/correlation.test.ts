import { describe, it, expect } from 'vitest';
import {
  createCorrelationId,
  withCorrelationId,
  getCorrelationId,
} from './correlation';

describe('correlation', () => {
  it('should return a valid UUID string from createCorrelationId()', () => {
    const id = createCorrelationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should set correlationId in AsyncLocalStorage and callback can read it via getCorrelationId()', () => {
    const testId = 'test-correlation-id-123';
    withCorrelationId(() => {
      expect(getCorrelationId()).toBe(testId);
    }, testId);
  });

  it('should return "no-context" when getCorrelationId() is called outside withCorrelationId()', () => {
    expect(getCorrelationId()).toBe('no-context');
  });

  it('should maintain correct isolation for nested withCorrelationId() calls', () => {
    const outerId = 'outer-id';
    const innerId = 'inner-id';

    withCorrelationId(() => {
      expect(getCorrelationId()).toBe(outerId);

      withCorrelationId(() => {
        expect(getCorrelationId()).toBe(innerId);
      }, innerId);

      // After inner completes, outer context is restored
      expect(getCorrelationId()).toBe(outerId);
    }, outerId);
  });
});
