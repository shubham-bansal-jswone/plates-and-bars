/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.ts$': '@swc/jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageProvider: 'v8',
  coverageReporters: ['text', 'text-summary'],
  coverageThreshold: { global: { lines: 90 } },
};
