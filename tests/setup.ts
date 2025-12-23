
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
