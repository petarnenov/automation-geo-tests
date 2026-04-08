// ESLint flat config for the @pepi Playwright test suite.
// Loaded by ESLint 9+ automatically; works regardless of package.json `type`.
//
// Scope:
//   - Lint test specs and helpers under tests/, plus reporters/ and scripts/
//   - Ignore generated artefacts (node_modules, test-results, playwright-report)
//   - Use Playwright plugin's recommended rules + a small house-style overlay
//   - Defer all formatting to Prettier (eslint-config-prettier turns off
//     conflicting style rules)
//
// Run:
//   npm run lint           — report
//   npm run lint:fix       — auto-fix
//   npm run format         — Prettier write
//   npm run format:check   — Prettier dry-run

import js from '@eslint/js';
import playwright from 'eslint-plugin-playwright';
import prettierConfig from 'eslint-config-prettier/flat';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      '.playwright-mcp/**',
      'tests/.auth/**',
      // Auto-generated state — never lint.
      '**/*.min.js',
    ],
  },

  // Baseline JS recommended rules for every JS/MJS file in the repo.
  js.configs.recommended,

  // Repo-wide CommonJS files (specs, helpers, reporter, scripts).
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        // page.evaluate(() => {…}) callbacks run in the browser context, so
        // browser globals (document, window, MouseEvent, …) appear inline in
        // helpers and specs. ESLint can't know which arrow runs where, so we
        // grant the union here.
        ...globals.browser,
      },
    },
    rules: {
      // House style — minor sharpening over @eslint/js recommended.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off', // Test specs legitimately log progress for parallel-run debugging.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Playwright fixture extensions use `async ({}, use, info) => …`
      // legitimately — the empty pattern is the no-deps marker.
      'no-empty-pattern': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },

  // ESLint flat config files themselves are ESM.
  {
    files: ['**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Playwright-specific rules: only apply to spec files and shared helpers
  // that interact with Playwright APIs.
  {
    ...playwright.configs['flat/recommended'],
    files: ['tests/**/*.js', 'tests/**/*.mjs'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      // Allow conditional logic in tests — many @pepi specs branch on captured
      // state (e.g. flip Yes↔No, set baseline if missing). The default rule is
      // too strict for state-machine-style tests.
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
      // page.waitForTimeout is documented as a code smell in this repo, but a
      // few specs need it for React state hydration races (see C26306, C25201).
      // Warn rather than error — we want visibility, not blockage.
      'playwright/no-wait-for-timeout': 'warn',
      // Skipped tests are intentional (test.fixme for blocked-by-test-data
      // cases) — don't fail on them.
      'playwright/no-skipped-test': 'off',
      // Custom expect helpers (e.g. expect.poll, expect with custom message)
      // are widely used.
      'playwright/valid-expect': ['error', { maxArgs: 2 }],
    },
  },

  // The Node-side reporter and scripts are not Playwright tests.
  {
    files: ['reporters/**/*.js', 'scripts/**/*.js'],
    rules: {
      'no-process-exit': 'off',
    },
  },

  // Must come LAST so it can disable any conflicting style rules from above.
  prettierConfig,
];
