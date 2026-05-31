
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const createTestStorage = (): Storage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: createTestStorage(),
});

// Disable Framer Motion animations in tests to prevent timing issues.
// The node test environment has no DOM, so we return simple passthrough stubs.
vi.mock('framer-motion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  motion: new Proxy({}, { get: (_, __) => (props: Record<string, unknown>) => props['children'] ?? null }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn(), set: vi.fn() }),
  useMotionValue: (initial: number) => ({ get: () => initial, set: vi.fn() }),
  useTransform: () => ({ get: () => 0 }),
  useSpring: (initial: number) => ({ get: () => initial, set: vi.fn() }),
}));

// Set env vars required by src/env.ts for tests that import modules using the env singleton.
// These are mock values — no real services are called in tests.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'mock-anon-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://mock.supabase.co';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'mock-openai-key';
process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'mock-cron-secret';
process.env.BANNER_RENDER_URL = process.env.BANNER_RENDER_URL ?? 'http://localhost/api/internal/render-banner';

// Mock Deno global if it doesn't exist
// @ts-expect-error - implicit any on globalThis
if (!globalThis.Deno) {
    // @ts-expect-error - overriding global fetch for tests
    globalThis.Deno = {
        env: {
            get: (key: string) => {
                const env: Record<string, string> = {
                    NEXT_PUBLIC_SUPABASE_URL: "https://mock.supabase.co",
                    SUPABASE_SERVICE_ROLE_KEY: "mock-key",
                    MEDIA_BUCKET: "media",
                    ALERT_EMAIL: "test@example.com",
                    META_GRAPH_VERSION: "v19.0",
                    TOKEN_VAULT_KEY: "0".repeat(64),
                    CRON_SECRET: "mock-cron-secret",
                    BANNER_RENDER_URL: "http://localhost/api/internal/render-banner",
                };
                return env[key] || process.env[key];
            },
            toObject: () => process.env,
        },
    };
}
