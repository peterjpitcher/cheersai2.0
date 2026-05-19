/**
 * Combined MSW handler array for all provider integrations.
 * Used by the MSW server setup to register all default success handlers.
 * Error handlers are re-exported for test-specific overrides.
 */

import { metaHandlers } from './meta';
import { gbpHandlers } from './gbp';

export const allHandlers = [...metaHandlers, ...gbpHandlers];

// Re-export error handlers for test-specific overrides via server.use()
export {
  metaAuthErrorHandler,
  metaRateLimitHandler,
  metaContentRejectedHandler,
  metaIgAuthErrorHandler,
} from './meta';

export {
  gbpAuthErrorHandler,
  gbpRateLimitHandler,
} from './gbp';
