// jest-expo's Babel transform handles TypeScript in packages/core too: the symlinked real path
// (packages/core/src) is not under node_modules, so it is not ignored by transformIgnorePatterns.
module.exports = {
  preset: 'jest-expo',
  // Dependencies of linked packages/core (e.g. @babel/runtime injected by the transform) resolve
  // from this app's node_modules, since CI installs only apps/mobile.
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  // The setup-flow test walks every step of a long form; on a cold CI runner it needs more than jest's 5 s default.
  testTimeout: 20000,
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
};
