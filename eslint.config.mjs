// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Workspace ESLint config (flat).
 *
 * Every rule below is at `error` severity. The lint script also runs
 * with `--max-warnings=0`, so any future warning surfaces as a hard
 * failure in CI and the prepush hook. The progression was:
 *
 *   PR #3 — config introduced at `warn` so the tooling could land
 *           without forcing application code changes.
 *   PR #5 — schema-validate every runtime boundary; deleted every
 *           `any` and `as unknown as X` cast in the repo.
 *   PR #6 — turn on the four strict TypeScript flags and flip every
 *           rule below from `warn` to `error`.
 *
 * The intent is that any new `any`, unsafe member access, floating
 * Promise, non-null assertion, or empty-string-vs-nullish bug fails
 * the build at the earliest possible point — local typecheck, then
 * lefthook, then CI.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '.cache/**',
      'coverage/**',
      'migrations/**',
      'apps/dashboard/dist/**',
      'apps/web/dist/**',
      'apps/worker/dist/**',
      'apps/cron/dist/**',
      'packages/shared/dist/**',
      'packages/video/dist/**',
      // Agentskills.io install artifacts. The skills bundle ships
      // example .tsx files inside the per-rule docs directory; they
      // are documentation, not source we own, and they live outside
      // any tsconfig project so the type-aware lint rules cannot
      // analyse them anyway. Match every shadow location the
      // installer drops them into.
      '.agents/**',
      '.augment/**',
      '.bob/**',
      '.codebuddy/**',
      '.commandcode/**',
      '.continue/**',
      '.cortex/**',
      '.crush/**',
      '.factory/**',
      '.goose/**',
      '.junie/**',
      '.kilocode/**',
      '.kiro/**',
      '.kode/**',
      '.mcpjam/**',
      '.mux/**',
      '.neovate/**',
      '.openhands/**',
      '.pi/**',
      '.pochi/**',
      '.qoder/**',
      '.qwen/**',
      '.roo/**',
      '.trae/**',
      '.windsurf/**',
      '.zencoder/**',
      'skills/**',
    ],
  },

  // Base recommended rules from ESLint and typescript-eslint.
  // (The stylistic preset is intentionally omitted in this PR — those
  //  rules ship in the strict-mode PR once the codebase is clean.)
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Type-aware parser configuration for every TS/TSX file in the
  // workspace. Server-side files (web/worker/cron) get the node global
  // set; the React-scoped block below adds browser globals on top for
  // dashboard and video files only. Mixing both at this layer would
  // hide bugs where a server-side file accidentally references
  // `window` or `document`.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      // ── Anti-`any` rules ──
      //
      // The boundary-validation pass in PR #5 deleted every `any` and
      // `as unknown as X` cast. These rules guard the regression: a
      // new `any` anywhere in the worker / web / cron / shared / video
      // surface is a hard build failure, not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // ── Style and correctness ──
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ── Recommended-typed preset rules ──
      '@typescript-eslint/prefer-regexp-exec': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      'no-useless-escape': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Allow snake_case for fields that map to external APIs.
      '@typescript-eslint/naming-convention': 'off',
    },
  },

  // React rules — only for files that actually use React.
  {
    files: [
      'apps/dashboard/src/**/*.{ts,tsx}',
      'packages/video/src/**/*.{ts,tsx}',
    ],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      // React surfaces (dashboard SPA, Remotion video composition) need
      // browser globals on top of the base node set.
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // The new JSX transform doesn't need React in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'error',
      'react/jsx-key': 'error',
      'react/no-unescaped-entities': 'error',

      // React event handlers commonly accept async functions whose
      // return value is intentionally discarded. The default
      // `no-misused-promises` errors on every `onClick={async () =>
      // ...}` and forces a `void` wrapper that adds noise without
      // catching real bugs. We disable the attribute check for React
      // files only — server-side files keep the strict default.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // Config files and plain JS scripts don't go through the project
  // service (no tsconfig covers them). Disable type-aware rules
  // entirely on these.
  //
  // The `**/*.config.{ts,mts,cts}` glob is a flat-config pattern that
  // matches files at every directory level, including the workspace
  // root (`drizzle.config.ts`, `vite.config.ts` in apps/dashboard,
  // etc.). It is intentionally broad — any future `*.config.ts` file
  // anywhere in the tree gets the same treatment.
  {
    files: [
      '**/*.{js,mjs,cjs}',
      '**/*.config.{ts,mts,cts}',
      'scripts/**/*.{js,mjs,ts}',
      'seed.ts',
      'tests/**/*.{js,mjs,cjs}',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // The seed and config scripts intentionally feed local literal
      // data into the API at the type-erased boundary; the schemas
      // catch shape mistakes at runtime, so the `any` constraint
      // here is more noise than safety.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
