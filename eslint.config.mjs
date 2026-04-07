// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Workspace ESLint config (flat).
 *
 * Severity is intentionally `warn` in this commit so the tooling
 * foundation can land green without forcing application code changes.
 * Rules are flipped to `error` in the upcoming "enable strict flags"
 * PR, after the shared Zod schemas land and the boundary-validation
 * pass deletes every `any` and `as unknown as X` cast in the repo.
 *
 * The point of shipping the config now (even at warn) is to make every
 * subsequent PR diff visible: a reviewer can run `npm run lint` and
 * see exactly which boundaries still need validation, because each one
 * shows up as an ESLint warning.
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
      // ── Anti-`any` rules — the whole point of the upcoming
      //    boundary-validation PR. All at warn for now; flipped to
      //    error in the strict-mode PR.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // ── Style and correctness ──
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',

      // ── Demoted recommended-preset rules ──
      // These default to `error` from `recommendedTypeChecked` but
      // would block this PR's "no app code changes" rule. They flip
      // back to `error` in the strict-mode PR.
      '@typescript-eslint/prefer-regexp-exec': 'warn',
      '@typescript-eslint/only-throw-error': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      '@typescript-eslint/restrict-plus-operands': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      'no-useless-escape': 'warn',

      // ── Loosen rules that conflict with the existing codebase shape. ──
      '@typescript-eslint/no-unused-vars': [
        'warn',
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
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
      'react/jsx-key': 'warn',
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
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
