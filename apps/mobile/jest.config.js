// jest-expo's Babel transform handles TypeScript in packages/core too: the symlinked real path
// (packages/core/src) is not under node_modules, so it is not ignored by transformIgnorePatterns.
module.exports = {
  preset: 'jest-expo',
  // jest 30 (required by #58): jest-expo 58 accepts ^29 || ^30, but Expo's SDK 58 template still pins jest ~29.7.0,
  // so jest and @types/jest are listed in `expo.install.exclude` in package.json to keep `expo install --check` clean.
  // Dependencies of linked packages/core (e.g. @babel/runtime injected by the transform) resolve
  // from this app's node_modules, since CI installs only apps/mobile.
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  // The setup-flow test walks every step of a long form; on a cold CI runner it needs more than jest's 5 s default.
  testTimeout: 20000,
  // openapi-fetch (used by the generated API client): jest-expo resolves its ES module build, so point it at the CommonJS one.
  moduleNameMapper: { '^openapi-fetch$': '<rootDir>/node_modules/openapi-fetch/dist/index.cjs' },
  setupFiles: ['<rootDir>/jest/setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
};
