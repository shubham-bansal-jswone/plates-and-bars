/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('child_process') as {
  spawnSync(cmd: string, args: string[], o: { cwd: string; encoding: 'utf8' }): { status: number | null; stdout: string; stderr: string };
};
const { join } = require('path') as { join(...p: string[]): string };
declare const process: { execPath: string };
declare const __dirname: string;

// scripts/test-under-load.mjs (#660): the plan it makes for the loaded jest run. `--dry-run` prints it without starting anything.
const cwd = join(__dirname, '..');
const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/test-under-load.mjs', '--dry-run', ...args], { cwd, encoding: 'utf8' });
const planOf = (...args: string[]) => JSON.parse(run(...args).stdout) as { burners: number; stallMs: number; jest: string[] };

describe('scripts/test-under-load.mjs', () => {
  it('runs jest with two workers and no stall by default, with one burner per CPU', () => {
    const p = planOf();
    expect(p.jest).toEqual(['--maxWorkers=2']);
    expect(p.stallMs).toBe(0);
    expect(p.burners).toBeGreaterThanOrEqual(1);
  });

  it('passes unknown arguments to jest and keeps them ahead of the setup file', () => {
    const p = planOf('--burners', '3', '--stall-ms', '5', 'food-screen', '--maxWorkers=1');
    expect(p.burners).toBe(3);
    expect(p.stallMs).toBe(5);
    expect(p.jest.slice(0, 2)).toEqual(['food-screen', '--maxWorkers=1']);
    expect(p.jest[2]).toBe('--setupFilesAfterEnv');
    expect(p.jest[3]).toMatch(/scripts[\\/]load-stall-setup\.cjs$/);
  });

  it('adds no setup file when there is no stall', () => {
    expect(planOf('--burners', '0').jest).toEqual(['--maxWorkers=2']);
  });

  it('refuses a number that is missing or not whole', () => {
    for (const args of [['--burners'], ['--burners', 'x'], ['--stall-ms', '-1'], ['--stall-ms', '1.5']]) {
      const r = run(...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/needs a whole number/);
    }
  });
});
