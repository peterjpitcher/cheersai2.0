/**
 * MSW server setup for Vitest integration tests.
 * Provides setupServer with all provider handlers pre-registered
 * and a lifecycle helper for consistent setup/teardown.
 *
 * Usage in test files:
 *   import { server, setupMswLifecycle } from '../../../tests/msw/server';
 *   setupMswLifecycle();
 */

import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { allHandlers } from './handlers';

export const server = setupServer(...allHandlers);

/**
 * Register MSW lifecycle hooks for Vitest.
 * Call this at the top level of each integration test file's describe block.
 *
 * - beforeAll: start the server with 'warn' on unhandled requests
 * - afterEach: reset handlers to defaults (clears server.use() overrides)
 * - afterAll: close the server
 */
export function setupMswLifecycle(): void {
  beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
