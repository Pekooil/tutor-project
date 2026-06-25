/**
 * Shared ESLint config for the MathMentor monorepo.
 * Each workspace extends this from its own .eslintrc.
 */
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    es2022: true,
    node: true,
    webextensions: true,
  },
  ignorePatterns: ['node_modules', 'dist', '.output', '.wxt', '.turbo'],
};
