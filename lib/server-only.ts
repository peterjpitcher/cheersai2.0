// Server-only entrypoint for privileged helpers and secrets.
// Throws immediately if evaluated in a browser/client context.
if (typeof window !== 'undefined') {
  throw new Error('Attempted to import a server-only module from the client');
}

// Re-export server-only helpers here to provide a single safe import path.
export { createServiceRoleClient } from '@/lib/supabase/server';

// Optionally expose server-side secrets via this module only (do not import from client components)
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
