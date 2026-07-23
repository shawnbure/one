import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "apps/platform-worker/worker-configuration.d.ts"
    ]
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...eslint.configs.recommended,
    languageOptions: {
      ...eslint.configs.recommended.languageOptions,
      globals: { ...globals.node }
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"]
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "@typescript-eslint/no-floating-promises": ["error", {
        allowForKnownSafeCalls: [{ from: "lib", name: ["queueMicrotask"] }]
      }],
      "@typescript-eslint/no-misused-promises": ["error", {
        checksVoidReturn: { arguments: false, attributes: false }
      }]
    }
  },
  {
    files: ["apps/admin/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
      ...reactRefresh.configs.vite.rules
    }
  },
  {
    files: ["apps/platform-worker/src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.webworker,
        ExecutionContext: "readonly",
        DurableObjectState: "readonly",
        DurableObjectStub: "readonly",
        D1Database: "readonly",
        R2Bucket: "readonly",
        VectorizeIndex: "readonly",
        Ai: "readonly"
      }
    }
  },
  {
    files: ["apps/platform-worker/src/agent.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off"
    }
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}", "**/*.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: false,
        projectService: false
      }
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off"
    }
  }
);
