/** @jest-environment node */
import appJson from '../app.json';

// The local SQLite file holds health data unencrypted. Expo defaults to allowBackup=true, which would let Google
// auto-backup and adb backup copy it; our own rules also keep it out of Android 12+ device-to-device transfer.
// Security review M6. The plugin's mods are run here on a sample manifest and a temp project folder.
type Mod = (c: unknown) => unknown | Promise<unknown>;
const mods: { manifest?: Mod; dangerous?: Mod } = {};
jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config: unknown, fn: Mod) => ((mods.manifest = fn), config),
  withDangerousMod: (config: unknown, [, fn]: [string, Mod]) => ((mods.dangerous = fn), config),
}));
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  mkdtempSync(p: string): string;
  readFileSync(p: string, e: string): string;
  rmSync(p: string, o: object): void;
};
const os = require('os') as { tmpdir(): string };
const path = require('path') as { join(...p: string[]): string };
const withNoBackup = require('../plugins/with-no-backup') as (c: unknown) => unknown;

const excluded = (xml: string, section?: string) => {
  const body = section ? (new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? '') : xml;
  return [...body.matchAll(/<exclude domain="(\w+)" path="\." \/>/g)].map((m) => m[1]);
};

describe('android backup', () => {
  it('app.json turns allowBackup off, registers our plugin and stops expo-secure-store from writing its own rules', () => {
    expect((appJson.expo.android as { allowBackup?: boolean }).allowBackup).toBe(false);
    expect(appJson.expo.plugins).toContain('./plugins/with-no-backup');
    expect(appJson.expo.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: false }]);
  });

  it('the plugin sets the manifest attributes', async () => {
    withNoBackup({});
    const manifest = { manifest: { application: [{ $: { 'android:allowBackup': 'true' } as Record<string, string> }] } };
    await mods.manifest?.({ modResults: manifest });
    const attrs = manifest.manifest.application[0]?.$;
    expect(attrs?.['android:allowBackup']).toBe('false');
    expect(attrs?.['android:fullBackupContent']).toBe('@xml/plate_and_bar_backup_rules');
    expect(attrs?.['android:dataExtractionRules']).toBe('@xml/plate_and_bar_data_extraction_rules');
  });

  it('the plugin writes rules that exclude databases, files, shared prefs and external storage, for backup and device transfer', async () => {
    withNoBackup({});
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-backup-'));
    await mods.dangerous?.({ modRequest: { platformProjectRoot: root } });
    const dir = path.join(root, 'app', 'src', 'main', 'res', 'xml');
    const full = fs.readFileSync(path.join(dir, 'plate_and_bar_backup_rules.xml'), 'utf8');
    const ext = fs.readFileSync(path.join(dir, 'plate_and_bar_data_extraction_rules.xml'), 'utf8');
    for (const d of ['database', 'file', 'sharedpref', 'external', 'root']) {
      expect(excluded(full)).toContain(d);
      expect(excluded(ext, 'cloud-backup')).toContain(d);
      expect(excluded(ext, 'device-transfer')).toContain(d);
    }
    expect(full + ext).not.toMatch(/<include/);
    fs.rmSync(root, { recursive: true });
  });
});
