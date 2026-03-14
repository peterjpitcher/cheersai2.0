
import { vi } from 'vitest';

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
                };
                return env[key] || process.env[key];
            },
            toObject: () => process.env,
        },
    };
}
