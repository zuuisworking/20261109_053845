import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '.temp/**',
      'coverage/**',
      'data/**',
      'database/**',
      'frontend/**',
      'logs/**',
      'node_modules/**',
      'out/**',
      'storage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['backend/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
];
