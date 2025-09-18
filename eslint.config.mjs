import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tailwindcss from "eslint-plugin-tailwindcss";
import tseslint from "@typescript-eslint/eslint-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Global ignores for generated and build files
  {
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "*.config.js",
      "*.config.mjs",
      "next-env.d.ts", // Next.js generated file
    ],
  },

  // Base Next.js + TypeScript rules
  ...compat.extends(
    "next/core-web-vitals",
    "next/typescript",
    "plugin:jsx-a11y/recommended",
    "plugin:tailwindcss/recommended"
  ),

  // Global plugin registration and rule customisations
  {
    plugins: {
      "jsx-a11y": jsxA11y,
      tailwindcss: tailwindcss,
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Keep new code clean; repo debt handled via changed-file linting
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "warn",
      "tailwindcss/classnames-order": "warn",
      // Project import guardrails
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/components/ui/old-button", message: "Deprecated. Use '@/components/ui/button'" },
            { name: "@/components/legacy/*", message: "Legacy components are banned." },
            { name: "@/components/ui/header", message: "Use '@/components/layout/app-header' instead." },
          ],
          patterns: [
            { group: ["**/legacy/**"], message: "Legacy imports are banned." },
          ],
        },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },

  // UI/Copy and legacy class enforcement for app/components/lib
  {
    files: ["app/**/*.{ts,tsx,js,jsx}", "components/**/*.{ts,tsx,js,jsx}", "lib/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\\bbtn-(primary|secondary|ghost|danger|destructive)\\\b/]",
          message: "Legacy btn-* classes are deprecated. Use <Button> with variants instead.",
        },
        {
          selector: "Literal[value=/\\\binput-field\\\b/]",
          message: "Legacy input-field class is deprecated. Use shadcn/ui form components.",
        },
        {
          selector: "Literal[value=/Google My Business/]",
          message: "Use 'Google Business Profile' via TERMS.GBP (lib/copy).",
        },
        {
          selector: "Literal[value=/^Pro$/]",
          message: "Use 'Professional' in user-facing copy.",
        },
      ],
    },
  },

  // Prevent server-only imports in client components
  {
    files: ["components/**/*.{ts,tsx,js,jsx}", "app/**/*.{ts,tsx,js,jsx}"],
    ignores: ["app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/server-only", message: "Do not import server-only modules from client components" },
          ],
        },
      ],
    },
  },

  // Node configs and scripts: allow CommonJS 'require'
  {
    files: [
      "*.config.{js,ts,mjs,cjs}",
      "next.config.*",
      "tailwind.config.*",
      "jest.config.*",
      "scripts/**/*.{js,ts}",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },

  // Server routes: forbid console usage (use structured logger instead)
  {
    files: ["app/api/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-console": ["error"],
    },
  },

  // Tests: relax "any" and ban-ts-comment strictness
  {
    files: ["__tests__/**/*.{ts,tsx,js,jsx}", "e2e/**/*.{ts,tsx,js,jsx}", "**/*.test.{ts,tsx,js,jsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": ["warn", { "ts-expect-error": "allow-with-description" }],
      "react/no-unescaped-entities": "off",
    },
  },
];

export default eslintConfig;
