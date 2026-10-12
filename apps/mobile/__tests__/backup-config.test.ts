import appJson from '../app.json';

// The local SQLite file holds health data unencrypted. Expo defaults to allowBackup=true, which would let Google
// auto-backup and adb backup copy it; our own rules also keep it out of Android 12+ device-to-device transfer.
// Security review M6.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../plugins/with-no-backup') as { DOMAINS: string[]; FULL_BACKUP_CONTENT: string; DATA_EXTRACTION_RULES: string };

const excluded = (xml: string, section?: string) => {
  const body = section ? (new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? '') : xml;
  return [...body.matchAll(/<exclude domain="(\w+)" path="\." \/>/g)].map((m) => m[1]);
};

describe('android backup', () => {
  it('app.json turns allowBackup off and registers the rules plugin', () => {
    expect((appJson.expo.android as { allowBackup?: boolean }).allowBackup).toBe(false);
    expect(appJson.expo.plugins).toContain('./plugins/with-no-backup');
  });

  it('the rules exclude databases, files, shared prefs and external storage, for backup and for device transfer', () => {
    for (const d of ['database', 'file', 'sharedpref', 'external', 'root']) {
      expect(excluded(plugin.FULL_BACKUP_CONTENT)).toContain(d);
      expect(excluded(plugin.DATA_EXTRACTION_RULES, 'cloud-backup')).toContain(d);
      expect(excluded(plugin.DATA_EXTRACTION_RULES, 'device-transfer')).toContain(d);
    }
    expect(plugin.DATA_EXTRACTION_RULES).not.toMatch(/<include/);
    expect(plugin.FULL_BACKUP_CONTENT).not.toMatch(/<include/);
  });
});
