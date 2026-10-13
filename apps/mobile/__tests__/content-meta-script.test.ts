/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync, spawnSync } = require('child_process') as {
  execFileSync(cmd: string, args: string[], o: { cwd: string; stdio: 'ignore'; env: Record<string, string | undefined> }): void;
  spawnSync(cmd: string, args: string[], o: { cwd: string; encoding: 'utf8' }): { status: number | null; stderr: string };
};
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('fs') as {
  cpSync(a: string, b: string, o?: { recursive: boolean }): void;
  mkdirSync(p: string, o: { recursive: boolean }): void;
  mkdtempSync(p: string): string;
  readFileSync(p: string, e: string): string;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  writeFileSync(p: string, d: string): void;
};
const { tmpdir } = require('os') as { tmpdir(): string };
declare const process: { env: Record<string, string | undefined> };
const { join } = require('path') as { join(...p: string[]): string };
declare const __dirname: string;

// scripts/content-meta.mjs --check on a shallow clone: dates cannot be recomputed, but a malformed or future one
// must still fail (#412), because the app would then reject every server copy of that bundle.
const root = join(__dirname, '../../..');
let work: string;
const HEAD = '2026-06-01T00:00:00Z';

function shallowCloneWith(updatedAt: unknown): string {
  const src = join(work, 'src');
  mkdirSync(join(src, 'apps/mobile/scripts'), { recursive: true });
  mkdirSync(join(src, 'apps/mobile/src/content'), { recursive: true });
  cpSync(join(root, 'apps/mobile/scripts/content-meta.mjs'), join(src, 'apps/mobile/scripts/content-meta.mjs'));
  cpSync(join(root, 'content'), join(src, 'content'), { recursive: true });
  const meta = JSON.parse(readFileSync(join(root, 'apps/mobile/src/content/bundled.json'), 'utf8'));
  for (const m of Object.values(meta) as { updated_at: unknown }[]) m.updated_at = '2026-01-01T00:00:00Z';
  (Object.values(meta)[0] as { updated_at: unknown }).updated_at = updatedAt;
  writeFileSync(join(src, 'apps/mobile/src/content/bundled.json'), `${JSON.stringify(meta, null, 2)}\n`);
  // HEAD's committer date is fixed (the script compares against it) and the developer's global git config is ignored.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: HEAD, GIT_COMMITTER_DATE: HEAD };
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore', env });
  git(src, 'init', '-q');
  git(src, 'add', '-A');
  git(src, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'x');
  const clone = join(work, `clone-${Math.random().toString(36).slice(2)}`);
  git(work, 'clone', '-q', '--depth', '1', `file://${src}`, clone);
  rmSync(src, { recursive: true, force: true });
  return clone;
}

const check = (clone: string) => spawnSync('node', ['apps/mobile/scripts/content-meta.mjs', '--check'], { cwd: clone, encoding: 'utf8' });

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'content-meta-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

it.each([
  ['a date in the future', '2099-01-01T00:00:00Z'],
  ['not a date', 'garbage'],
  ['missing', undefined],
  ['not UTC', '2026-01-01T00:00:00+05:30'],
  ['an impossible date', '2026-02-30T00:00:00Z'],
  ['one second after HEAD', '2026-06-01T00:00:01Z'],
])('a shallow --check fails on an updated_at that is %s', (_name, value) => {
  const r = check(shallowCloneWith(value));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('bad updated_at');
});

it.each([['a past date', '2026-01-01T00:00:00Z'], ['HEAD itself', HEAD]])('a shallow --check passes on %s', (_name, value) => {
  const r = check(shallowCloneWith(value));
  expect(r.stderr).not.toContain('bad updated_at');
  expect(r.status).toBe(0);
});
