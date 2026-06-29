import { describe, it, expect } from 'vitest';
import {
  classifyMetaError,
  ErrorClassification,
  isExplicitMetaConnectionFailure,
  parseMetaGraphError,
  ProviderError,
} from './errors';

describe('classifyMetaError', () => {
  it('should classify 429 as RATE_LIMIT', () => {
    expect(classifyMetaError(429, {})).toBe(ErrorClassification.RATE_LIMIT);
  });

  it('should classify 401 as AUTH', () => {
    expect(classifyMetaError(401, {})).toBe(ErrorClassification.AUTH);
  });

  it('should classify 403 as AUTH', () => {
    expect(classifyMetaError(403, {})).toBe(ErrorClassification.AUTH);
  });

  it('should classify subcode 190 as AUTH regardless of status code', () => {
    expect(classifyMetaError(200, { error: { error_subcode: 190 } })).toBe(ErrorClassification.AUTH);
  });

  it('should classify subcode 463 as AUTH', () => {
    expect(classifyMetaError(200, { error: { error_subcode: 463 } })).toBe(ErrorClassification.AUTH);
  });

  it('should classify subcode 467 as AUTH', () => {
    expect(classifyMetaError(200, { error: { error_subcode: 467 } })).toBe(ErrorClassification.AUTH);
  });

  it('should classify Graph code 190 as AUTH', () => {
    expect(classifyMetaError(400, { error: { code: 190 } })).toBe(ErrorClassification.AUTH);
  });

  it('should not classify ambiguous Graph code 100 authorization errors as AUTH', () => {
    expect(classifyMetaError(400, {
      error: {
        message: 'GraphMethodException: Authorization Error',
        type: 'GraphMethodException',
        code: 100,
      },
    })).toBe(ErrorClassification.CONTENT_REJECTED);
  });

  it('should classify 500 as TRANSIENT', () => {
    expect(classifyMetaError(500, {})).toBe(ErrorClassification.TRANSIENT);
  });

  it('should classify 503 as TRANSIENT', () => {
    expect(classifyMetaError(503, {})).toBe(ErrorClassification.TRANSIENT);
  });

  it('should classify 400 as CONTENT_REJECTED', () => {
    expect(classifyMetaError(400, {})).toBe(ErrorClassification.CONTENT_REJECTED);
  });

  it('should classify 200 with no subcode as UNKNOWN', () => {
    expect(classifyMetaError(200, {})).toBe(ErrorClassification.UNKNOWN);
  });
});

describe('parseMetaGraphError', () => {
  it('should parse structured Meta error metadata', () => {
    const parsed = parseMetaGraphError(400, {
      error: {
        message: 'Authorization Error',
        type: 'GraphMethodException',
        code: 100,
        error_subcode: 33,
        fbtrace_id: 'trace-123',
      },
    });

    expect(parsed).toEqual({
      status: 400,
      message: 'Authorization Error',
      type: 'GraphMethodException',
      code: 100,
      subcode: 33,
      fbtrace_id: 'trace-123',
    });
  });

  it('should identify explicit connection failures but not code 100 alone', () => {
    expect(isExplicitMetaConnectionFailure(parseMetaGraphError(400, {
      error: { message: 'Authorization Error', type: 'GraphMethodException', code: 100 },
    }))).toBe(false);

    expect(isExplicitMetaConnectionFailure(parseMetaGraphError(400, {
      error: { message: 'Invalid OAuth 2.0 Access Token', type: 'OAuthException', code: 190 },
    }))).toBe(true);
  });
});

describe('ProviderError', () => {
  it('should create an error with all fields', () => {
    const err = new ProviderError('test error', 'facebook', ErrorClassification.AUTH, false, undefined, { raw: true });
    expect(err.message).toBe('test error');
    expect(err.platform).toBe('facebook');
    expect(err.classification).toBe(ErrorClassification.AUTH);
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.rawError).toEqual({ raw: true });
    expect(err.name).toBe('ProviderError');
  });

  it('should be an instance of Error', () => {
    const err = new ProviderError('test', 'instagram', ErrorClassification.TRANSIENT, true, 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });
});
