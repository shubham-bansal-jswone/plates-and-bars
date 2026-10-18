/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('child_process') as { spawnSync(cmd: string, args: string[], o: { cwd: string; encoding: 'utf8' }): { status: number | null; stderr: string; stdout: string } };
const { join } = require('path') as { join(...p: string[]): string };
const { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } = require('fs') as {
  mkdtempSync(prefix: string): string;
  readFileSync(p: string, enc: 'utf8'): string;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  unlinkSync(p: string): void;
  writeFileSync(p: string, data: string): void;
};
const { tmpdir } = require('os') as { tmpdir(): string };
declare const __dirname: string;

const app = join(__dirname, '..');
const run = (...args: string[]) => spawnSync('node', ['scripts/licences.mjs', ...args], { cwd: app, encoding: 'utf8' });
const committed = readFileSync(join(app, 'scripts/android-classpath.txt'), 'utf8');

// CI runs this with the rest of the tests, so a lockfile change without regenerating src/about/licences.json fails the build.
describe('scripts/licences.mjs --check', () => {
  it('finds src/about/licences.json current', () => {
    const r = run('--check');
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: '' });
  });
});

// android-release.yml passes the classpath the release build resolved; these stand in for that file.
describe('scripts/licences.mjs --classpath', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'classpath-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const withClasspath = (text: string) => {
    const f = join(dir, `${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(f, text);
    return run('--classpath', f);
  };

  it('passes when the build resolved the committed list', () => {
    const r = withClasspath(committed);
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: '' });
    expect(r.stdout).toMatch(/matches scripts\/android-classpath\.txt \(\d+ libraries\)/);
  });

  it('fails on an artifact with no licence row, naming each one', () => {
    const r = withClasspath(`${committed}com.example:mystery:1.0\norg.example:other:2.1\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no licence in scripts/licences.mjs (ANDROID_LICENCES) for com.example:mystery:1.0, org.example:other:2.1');
  });

  it('fails on a version no licence row was checked at, until the row is re-checked', () => {
    const r = withClasspath(committed.replace('androidx.core:core:1.18.0\n', 'androidx.core:core:9.9.9\n'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no licence in scripts/licences.mjs (ANDROID_LICENCES) for androidx.core:core:9.9.9 (row checked at 1.18.0)');
    expect(r.stderr).toContain("for a new version, check that version's POM, LICENSE and any NOTICE, then update the row's version");
  });

  it('fails on a NOTICE the build no longer finds, showing the difference', () => {
    const r = withClasspath(committed.replace('commons-io:commons-io:1.4 META-INF/NOTICE.txt@953ed0a73373ef5e', 'commons-io:commons-io:1.4'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('differs from scripts/android-classpath.txt');
    expect(r.stderr).toContain('+ commons-io:commons-io:1.4\n');
    expect(r.stderr).toContain('- commons-io:commons-io:1.4 META-INF/NOTICE.txt@953ed0a73373ef5e');
  });

  it('fails on a library the build no longer resolves', () => {
    const r = withClasspath(committed.replace('org.jspecify:jspecify:1.0.0\n', ''));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('- org.jspecify:jspecify:1.0.0');
  });

  it('fails on a NOTICE file that has no copy in scripts/licence-texts', () => {
    const r = withClasspath(committed.replace('commons-io:commons-io:1.4 META-INF/NOTICE.txt@953ed0a73373ef5e', 'commons-io:commons-io:1.4 META-INF/NOTICE.txt@0000000000000000'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NOTICE not copied to scripts/licence-texts/notice-<hash>.txt: commons-io:commons-io:1.4 META-INF/NOTICE.txt');
  });

  it('fails on a NOTICE copy whose content does not match its hash', () => {
    const copy = join(app, 'scripts/licence-texts/notice-ffffffffffffffff.txt');
    writeFileSync(copy, 'edited by hand\n');
    try {
      const r = withClasspath(committed.replace('commons-io:commons-io:1.4 META-INF/NOTICE.txt@953ed0a73373ef5e', 'commons-io:commons-io:1.4 META-INF/NOTICE.txt@ffffffffffffffff'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('scripts/licence-texts/notice-ffffffffffffffff.txt does not match its hash (commons-io:commons-io:1.4 META-INF/NOTICE.txt)');
    } finally {
      unlinkSync(copy);
    }
  });

  it('fails on a line that is not group:name:version with path@hash notices', () => {
    for (const bad of ['androidx.core:core', 'commons-io:commons-io:1.4 META-INF/NOTICE.txt@../../x']) {
      const r = withClasspath(`${committed}${bad}\n`);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`not group:name:version [path@sha256-prefix]...: ${bad}`);
    }
  });

  it('fails without a file', () => {
    expect(run('--classpath', join(dir, 'missing.txt')).status).toBe(1);
  });
});

// android-release.yml passes the .so file names of the APK it built; these stand in for that file.
describe('scripts/licences.mjs --native-libs', () => {
  const soCommitted = readFileSync(join(app, 'scripts/android-native-libs.txt'), 'utf8');
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'native-libs-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const withLibs = (text: string) => {
    const f = join(dir, `${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(f, text);
    return run('--native-libs', f);
  };

  it('passes when the build shipped the committed .so files', () => {
    const r = withLibs(soCommitted);
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: '' });
    expect(r.stdout).toMatch(/match scripts\/android-native-libs\.txt \(\d+ libraries\)/);
  });

  it('fails on a new .so with no notice entry, naming it', () => {
    const r = withLibs(`${soCommitted}libmystery.so\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no notice for native library libmystery.so');
  });

  it('fails on a .so that has an entry but is not in the committed list, and on one that vanished', () => {
    const r = withLibs(soCommitted.replace('libzstd-kmp.so\n', '').replace('libsentry.so\n', '') + 'libnot-a-real-one.so\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no notice for native library libnot-a-real-one.so');
    const only = withLibs(soCommitted.replace('libzstd-kmp.so\n', ''));
    expect(only.status).toBe(1);
    expect(only.stderr).toContain('- libzstd-kmp.so');
  });

  it('fails without a file', () => {
    expect(run('--native-libs', join(dir, 'missing.txt')).status).toBe(1);
  });

  it('lists every .so of the committed list in the Native section, and no component that no .so links', () => {
    const data = JSON.parse(readFileSync(join(app, 'src/about/licences.json'), 'utf8')) as { native: { name: string; licence: string; in: string[]; text: string }[]; texts: Record<string, string> };
    const names = soCommitted.split('\n').filter(Boolean);
    for (const c of data.native) {
      expect(data.texts[c.text]).toBeTruthy();
      expect(c.in.length).toBeGreaterThan(0);
      for (const n of c.in) expect(names).toContain(n);
    }
  });

  it('ships each MIT notice whole: it ends with its last sentence, not cut off', () => {
    const data = JSON.parse(readFileSync(join(app, 'src/about/licences.json'), 'utf8')) as { native: { name: string; text: string }[]; texts: Record<string, string> };
    // The two MIT notices copied from a source header (sentry-native), where a cut-off is easy; {fmt}'s text goes on after it on purpose.
    const mit = data.native.filter((c) => c.name === 'jsmn' || c.name === 'MPack');
    expect(mit).toHaveLength(2);
    for (const c of mit) expect(data.texts[c.text]!.trim()).toMatch(/DEALINGS IN\s+(THE\s+)?SOFTWARE\.$/);
  });
});

describe('Android section of licences.json', () => {
  const data = JSON.parse(readFileSync(join(app, 'src/about/licences.json'), 'utf8')) as {
    android: { name: string; version: string; licence: string; url: string; text: string }[];
    texts: Record<string, string>;
  };
  const by = (name: string) => data.android.find((a) => a.name === name)!;

  it('lists exactly the committed resolved classpath', () => {
    const coords = committed.split('\n').filter(Boolean).map((l) => l.split(' ')[0]);
    expect(data.android.map((a) => `${a.name}:${a.version}`).sort()).toEqual([...coords].sort());
  });

  it('gives each row a name, version, licence, licence URL and text, and nothing else', () => {
    for (const a of data.android) {
      expect(Object.keys(a)).toEqual(['name', 'version', 'licence', 'url', 'text']);
      expect(a.url).toMatch(/^https:\/\//);
      expect(data.texts[a.text]).toBeTruthy();
    }
  });

  it('maps each artifact to its own licence and text', () => {
    expect(by('androidx.core:core')).toMatchObject({ licence: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' });
    expect(data.texts[by('androidx.core:core').text]).toContain('Version 2.0, January 2004');
    expect(by('com.facebook.soloader:soloader').licence).toBe('Apache-2.0');
    expect(by('com.facebook.fresco:soloader').licence).toBe('MIT');
    expect(by('com.facebook.react:react-android').licence).toBe('MIT');
    expect(data.texts[by('com.facebook.react:react-android').text]).toContain('Meta Platforms, Inc. and affiliates');
    expect(data.texts[by('io.sentry:sentry-native-ndk').text]).toContain('Copyright (c) 2019 Sentry (https://sentry.io)');
    expect(by('com.parse.bolts:bolts-tasks')).toMatchObject({ licence: 'BSD-3-Clause with Facebook Additional Grant of Patent Rights v2', url: 'https://opensource.org/license/bsd-3-clause' });
    expect(data.texts[by('com.parse.bolts:bolts-tasks').text]).toContain('Additional Grant of Patent Rights Version 2');
    expect(by('com.github.bumptech.glide:glide').licence).toBe('BSD-2-Clause AND MIT AND Apache-2.0');
  });

  it('includes the NOTICE text a library ships', () => {
    expect(data.texts[by('commons-codec:commons-codec').text]).toContain('NOTICE (META-INF/NOTICE.txt)\n\nApache Commons Codec\nCopyright 2002-2014 The Apache Software Foundation');
    expect(data.texts[by('commons-io:commons-io').text]).toContain('Apache Commons IO');
    expect(by('com.squareup.okhttp3:okhttp').licence).toBe('Apache-2.0 AND MPL-2.0');
    expect(data.texts[by('com.squareup.okhttp3:okhttp').text]).toContain('Mozilla Public License, v. 2.0');
    expect(data.texts[by('com.squareup.okhttp3:okhttp-urlconnection').text]).not.toContain('publicsuffix');
    expect(data.texts[by('io.sentry:sentry').text]).toContain('NOTICE (META-INF/SENTRY_THIRD_PARTY_NOTICES.md)\n\n# Third-Party Software Notices and Information');
  });
});

// #965: NOTICE (third-party material only) must not credit images THIRD_PARTY.md marks as own work.
describe('scripts/licences.mjs NOTICE and THIRD_PARTY.md agree on app images', () => {
  const repoRoot = join(app, '../..');
  const runWith = (notice: string, thirdParty: string) => {
    const d = mkdtempSync(join(tmpdir(), 'notice-'));
    try {
      writeFileSync(join(d, 'NOTICE'), notice);
      writeFileSync(join(d, 'THIRD_PARTY.md'), thirdParty);
      return spawnSync('node', ['scripts/licences.mjs', '--check'], { cwd: app, encoding: 'utf8', env: { ...process.env, LICENCES_REPO_DIR: d } } as never);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };
  const notice = readFileSync(join(repoRoot, 'NOTICE'), 'utf8');
  const thirdParty = readFileSync(join(repoRoot, 'THIRD_PARTY.md'), 'utf8');

  it('passes with the committed files', () => {
    expect(runWith(notice, thirdParty).status).toBe(0);
  });
  it('fails when NOTICE lists an own-work PNG', () => {
    const r = runWith(`${notice}\n- Splash image apps/mobile/assets/splash-icon.png from a template.\n`, thirdParty);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NOTICE lists splash-icon.png but THIRD_PARTY.md marks it own work');
  });
  it('fails when THIRD_PARTY.md has no own-work row for the images', () => {
    const r = runWith(notice, thirdParty.split('\n').filter((l) => !l.includes('apps/mobile/assets')).join('\n'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no row marking the app icon and splash images');
  });
  it('accepts the row in any letter case', () => {
    expect(runWith(notice, thirdParty.replace('Own work (original artwork', 'own work (original artwork')).status).toBe(0);
  });
});
