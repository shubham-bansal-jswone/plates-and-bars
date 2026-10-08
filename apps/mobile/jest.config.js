// jest-expo's Babel transform handles TypeScript in packages/core too: the symlinked real path
// (packages/core/src) is not under node_modules, so it is not ignored by transformIgnorePatterns.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
};
