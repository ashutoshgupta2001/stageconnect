/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/.test-dist/tests'],
  testMatch: ['**/*.test.js'],
  // TypeScript emits native ESM before Jest starts.
  transform: {},
  injectGlobals: false,
  testTimeout: 15000,
  coverageProvider: 'v8',
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  watchman: false,
  verbose: true
};
