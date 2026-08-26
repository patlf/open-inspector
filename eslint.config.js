import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    /*
     * Build output and tool scratch space, not source.
     *
     * `.wrangler/` is the one that bites: wrangler writes generated bundles and
     * a no-op worker into `.wrangler/tmp` whenever the site is served or
     * deployed, and those are third-party code written in a style this config
     * rejects. CI ran the site before linting and failed on fifteen errors in
     * files nobody wrote.
     */
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/.wrangler/**',
      // Harness config and vendored skill scripts, not this project's source.
      '**/.claude/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/*.tsbuildinfo',
    ],
  },

  ...tseslint.configs.recommended,

  {
    rules: {
      // Unused args are legitimate when they document a callback's shape;
      // the leading-underscore convention marks the deliberate ones.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` erases exactly the guarantees this codebase relies on when
      // reaching into untyped DOM shapes.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Build scripts run in node and are allowed to talk to the console.
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
);
