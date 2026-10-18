/* eslint-disable @typescript-eslint/no-require-imports */
import { dirname } from 'path';

// expo prebuild (iOS) loads xcode, which calls uuid.v4() through CommonJS. package.json overrides xcode's uuid
// to 11.1.1 (GHSA-w5hq-g745-h8pq). Android CI never loads it, so this guards the override: it fails if the
// override is bumped to an ESM-only uuid (12+) or removed (xcode's own uuid 7 would come back).
describe("xcode's uuid override", () => {
  const xcodeDir = dirname(require.resolve('xcode/package.json'));

  it('loads uuid from xcode as CommonJS with a v4 function', () => {
    const uuid = require(require.resolve('uuid', { paths: [xcodeDir] }));
    expect(typeof uuid.v4).toBe('function');
  });

  it('resolves a patched uuid (11.x, not the vulnerable 7.x)', () => {
    const pkg = require(require.resolve('uuid/package.json', { paths: [xcodeDir] }));
    expect(pkg.version.split('.')[0]).toBe('11');
  });

  it('generates 24-char uppercase hex ids the way prebuild does', () => {
    const PbxProject = require('xcode/lib/pbxProject');
    const project = new PbxProject('unused.pbxproj');
    project.hash = { project: { objects: {} } };
    expect(project.generateUuid()).toMatch(/^[0-9A-F]{24}$/);
  });
});
