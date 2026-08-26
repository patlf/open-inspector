import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
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
