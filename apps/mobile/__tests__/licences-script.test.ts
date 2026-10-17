/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('child_process') as { spawnSync(cmd: string, args: string[], o: { cwd: string; encoding: 'utf8' }): { status: number | null; stderr: string; stdout: string } };
const { join } = require('path') as { join(...p: string[]): string };
declare const __dirname: string;

// CI runs this with the rest of the tests, so a lockfile change without regenerating src/about/licences.json fails the build.
describe('scripts/licences.mjs --check', () => {
  it('finds src/about/licences.json current', () => {
    const r = spawnSync('node', ['scripts/licences.mjs', '--check'], { cwd: join(__dirname, '..'), encoding: 'utf8' });
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: '' });
  });
});
