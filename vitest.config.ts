import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      { find: /^npm:@supabase\/supabase-js@2/, replacement: "@supabase/supabase-js" },
      { find: /^https:\/\/esm\.sh\/@supabase\/supabase-js@2/, replacement: "@supabase/supabase-js" }
    ]
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
});
