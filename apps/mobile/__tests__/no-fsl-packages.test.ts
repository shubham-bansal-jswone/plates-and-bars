/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('fs') as { readFileSync(p: string, e: string): string };
const { join } = require('path') as { join(...p: string[]): string };
declare const __dirname: string;

// FSL (Functional Source License) is source-available, not open source. @sentry/cli carries it and is replaced by the
// stub in stubs/sentry-cli through package.json "overrides" (#687). No other FSL package may enter the lockfile.
const lock = JSON.parse(readFileSync(join(__dirname, '../package-lock.json'), 'utf8')) as { packages: Record<string, { license?: string; link?: boolean; resolved?: string }> };

describe('package-lock.json', () => {
  it('has no FSL-licensed package', () => {
    const fsl = Object.entries(lock.packages).filter(([, p]) => /(^|[^A-Za-z])FSL/i.test(p.license ?? '')).map(([k]) => k);
    expect(fsl).toEqual([]);
  });
  it('resolves @sentry/cli to the local MIT stub, with no registry copy', () => {
    expect(lock.packages['node_modules/@sentry/cli']).toMatchObject({ resolved: 'stubs/sentry-cli', link: true });
    expect(lock.packages['stubs/sentry-cli']).toMatchObject({ license: 'MIT' });
    expect(Object.keys(lock.packages).filter((k) => /@sentry\/cli/.test(k))).toEqual(['node_modules/@sentry/cli']);
  });
});
