/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync, spawn } = require('child_process') as {
  spawnSync(cmd: string, args: string[], o: { cwd: string; encoding: 'utf8' }): { status: number | null; stdout: string; stderr: string };
  spawn(cmd: string, args: string[], o: { cwd: string; stdio: 'ignore' }): { pid: number; kill(sig: string): void };
};
declare function setTimeout(f: () => void, ms: number): unknown;
declare const process: { execPath: string; kill(pid: number, sig: string | number): void };
const { join } = require('path') as { join(...p: string[]): string };
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

  it('adds --maxWorkers=2 unless the caller passes its own worker setting', () => {
    expect(planOf('--burners', '0', 'food-screen').jest).toEqual(['food-screen', '--maxWorkers=2']);
    for (const own of [['-w', '3'], ['-w=3'], ['--maxWorkers=1'], ['--maxWorkers', '50%'], ['-i'], ['--runInBand']]) {
      expect(planOf('--burners', '0', 'food-screen', ...own).jest).toEqual(['food-screen', ...own]);
    }
  });
});

// Real processes: the burners must not outlive a parent that was SIGKILLed (no exit handler can run then).
const ps = () =>
  spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { cwd, encoding: 'utf8' })
    .stdout.split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] ?? '' }));
const alive = (pid: number) => ps().some((p) => p.pid === pid);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await sleep(50);
  return f();
};

describe('scripts/test-under-load.mjs burners', () => {
  it('exit within about a second when the parent is SIGKILLed', async () => {
    const parent = spawn(process.execPath, ['scripts/test-under-load.mjs', '--burners', '2', 'no-such-test-file-zzz'], { cwd, stdio: 'ignore' });
    const started: number[] = [];
    try {
      const burnersOf = () => ps().filter((p) => p.ppid === parent.pid && p.cmd.includes('process.ppid'));
      expect(await until(() => burnersOf().length === 2, 10000)).toBe(true);
      started.push(...burnersOf().map((p) => p.pid));
      process.kill(parent.pid, 'SIGKILL');
      expect(await until(() => started.every((pid) => !alive(pid)), 1500)).toBe(true);
    } finally {
      // Stop everything this test started, whatever happened: the parent, its jest child and the burners.
      const kids = ps().filter((p) => p.ppid === parent.pid || started.includes(p.pid));
      for (const pid of [parent.pid, ...kids.map((k) => k.pid)]) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
  }, 20000);
});
