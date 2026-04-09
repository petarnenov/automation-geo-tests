// GeoWealth E2E — workspace-root ESLint flat config (D-38).
//
// This config covers the entire monorepo: framework, tooling, legacy POC,
// and all per-team test packages. The legacy POC's previous standalone
// `eslint.config.mjs` is merged into this file (per Phase 0 Step 0.A).
//
// Sections, in order:
//   1. Global ignores
//   2. Baseline @eslint/js recommended rules
//   3. Workspace-wide CommonJS .js files (legacy POC + scripts + reporters)
//   4. Workspace-wide ESM .mjs files (eslint configs etc.)
//   5. Workspace-wide TypeScript .ts files (framework + tooling + new tests)
//   6. Playwright-specific overlay for spec files
//   7. Node-side reporter / scripts overlay
//   8. Prettier (must come last to disable conflicting style rules)
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
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  // 1. Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.playwright-mcp/**',
      '**/.playwright-recon/**',
      '**/.auth/**',
      // Build artifacts (none yet, but reserved for Phase 2+)
      '**/dist/**',
      '**/build/**',
      // Auto-generated state — never lint.
      '**/*.min.js',
    ],
  },

  // 2. Baseline JS recommended rules for every JS/MJS/TS file in the repo.
  js.configs.recommended,

  // 3. Workspace-wide CommonJS .js files (legacy POC + scripts + reporters)
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

  // 4. Workspace-wide ESM .mjs files (ESLint flat configs etc.)
  {
    files: ['**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // 5. Workspace-wide TypeScript .ts files (framework + tooling + new tests)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Start permissive — strict mode will be tightened in Phase 2 once
      // the framework's surface stabilizes.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'no-empty-pattern': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },

  // 6. Playwright-specific overlay for spec files (legacy POC + new test packages)
  {
    ...playwright.configs['flat/recommended'],
    files: [
      'packages/legacy-poc/tests/**/*.js',
      'packages/legacy-poc/tests/**/*.mjs',
      'packages/tests-*/tests/**/*.ts',
      'packages/framework/tests/**/*.ts',
    ],
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

  // 7. The Node-side reporter and scripts are not Playwright tests.
  {
    files: [
      'packages/legacy-poc/reporters/**/*.js',
      'packages/legacy-poc/scripts/**/*.js',
      'scripts/**/*.js',
      'packages/tooling/scripts/**/*.{js,ts}',
    ],
    rules: {
      'no-process-exit': 'off',
    },
  },

  // 8. Must come LAST so it can disable any conflicting style rules from above.
  prettierConfig,
];
