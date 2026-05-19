import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/types.ts",
        "src/**/*.d.ts",
        "src/env.ts",
      ],
      thresholds: {
        // Per D-13: auth >= 80%, scheduling >= 90%, publishing >= 85%
        "src/lib/auth/**": {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        "src/lib/publishing/**": {
          branches: 85,
          functions: 85,
          lines: 85,
          statements: 85,
        },
        "src/lib/scheduling/**": {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      { find: /^npm:@supabase\/supabase-js@2/, replacement: "@supabase/supabase-js" },
      { find: /^https:\/\/esm\.sh\/@supabase\/supabase-js@2.*/, replacement: "@supabase/supabase-js" },
      { find: /^https:\/\/esm\.sh\/luxon@.*/, replacement: "luxon" },
      { find: /^https:\/\/esm\.sh\/@ffmpeg\/ffmpeg@.*/, replacement: resolve(__dirname, "tests/__mocks__/ffmpeg.ts") }
    ]
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
});
