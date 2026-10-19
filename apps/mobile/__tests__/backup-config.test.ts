/** @jest-environment node */
import appJson from '../app.json';

// The local SQLite file holds health data unencrypted. Expo defaults to allowBackup=true, which would let Google
// auto-backup and adb backup copy it; our own rules also keep it out of Android 12+ device-to-device transfer.
// Security review M6. The plugin's mods are run here on a sample manifest and a temp project folder.
type Mod = (c: unknown) => unknown | Promise<unknown>;
const mods: { manifest?: Mod; dangerous?: Mod; appDelegate?: Mod } = {};
jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config: unknown, fn: Mod) => ((mods.manifest = fn), config),
  withAppDelegate: (config: unknown, fn: Mod) => ((mods.appDelegate = fn), config),
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
const withNoBackup = require('../plugins/with-no-backup') as ((c: unknown) => unknown) & { IOS_EXCLUDED_FOLDERS: string[] };

const excluded = (xml: string, section?: string) => {
  const body = section ? (new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? '') : xml;
  return [...body.matchAll(/<exclude domain="(\w+)" path="\." \/>/g)].map((m) => m[1]);
};

describe('android backup', () => {
  it('app.json turns allowBackup off, registers our plugin and stops expo-secure-store from writing its own rules', () => {
    expect((appJson.expo.android as { allowBackup?: boolean }).allowBackup).toBe(false);
    expect(appJson.expo.plugins).toContain('./plugins/with-no-backup');
    expect(appJson.expo.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: false, faceIDPermission: false }]);
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

describe('ios backup and config (#948)', () => {
  const swift = `@main
class AppDelegate: ExpoAppDelegate {
  public override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    reactNativeFactory = factory
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;
  const run = async (language: string, contents: string) => {
    withNoBackup({});
    const c = { modResults: { language, contents } };
    await mods.appDelegate?.(c);
    return c.modResults.contents;
  };

  it('the plugin hooks the launch and flags Documents, SQLite and the photo vault as excluded from backup', async () => {
    const out = await run('swift', swift);
    expect(out.indexOf('excludeAppDataFromBackup()\n')).toBeLessThan(out.indexOf('return super.application'));
    expect(out).toContain('func excludeAppDataFromBackup()');
    expect(out).toContain('["SQLite", "photos"]');
    expect(out).toContain('.documentDirectory');
    // Documents itself, then each subfolder, are the folders that get flagged...
    expect(out).toContain('var folders = [documents]');
    expect(out).toContain('folders.append(folder)');
    // ...and the flag is set and applied to every one of them, in that order, inside the loop over them.
    const loop = /for var url in folders \{([\s\S]*?)\n  \}/.exec(out)?.[1] ?? '';
    expect(loop.indexOf('values.isExcludedFromBackup = true')).toBeGreaterThanOrEqual(0);
    expect(loop.indexOf('try? url.setResourceValues(values)')).toBeGreaterThan(loop.indexOf('values.isExcludedFromBackup = true'));
  });

  it('is idempotent, and fails loudly when the template has no launch return or is not Swift', async () => {
    const once = await run('swift', swift);
    expect(await run('swift', once)).toBe(once);
    await expect(run('swift', 'class AppDelegate {}')).rejects.toThrow(/launch return/);
    await expect(run('objc', swift)).rejects.toThrow(/Swift/);
  });

  it('the excluded folders are where the app writes: expo-sqlite SQLite folder and the vault folder', () => {
    expect(withNoBackup.IOS_EXCLUDED_FOLDERS).toEqual(['SQLite', 'photos']);
    const vault = fs.readFileSync(path.join(__dirname, '..', 'src', 'photos', 'vault.ts'), 'utf8');
    expect(vault).toContain("new Directory(Paths.document, 'photos')");
  });

  it('app.json: iPhone only, no Face ID string, no tracking, API categories declared', () => {
    const ios = appJson.expo.ios as { supportsTablet: boolean; privacyManifests: { NSPrivacyTracking: boolean; NSPrivacyTrackingDomains: string[]; NSPrivacyCollectedDataTypes: unknown[]; NSPrivacyAccessedAPITypes: { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] }[] } };
    expect(ios.supportsTablet).toBe(false);
    expect(appJson.expo.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: false, faceIDPermission: false }]);
    const m = ios.privacyManifests;
    expect(m.NSPrivacyTracking).toBe(false);
    expect(m.NSPrivacyTrackingDomains).toEqual([]);
    const reasons = Object.fromEntries(m.NSPrivacyAccessedAPITypes.map((t) => [t.NSPrivacyAccessedAPIType, t.NSPrivacyAccessedAPITypeReasons]));
    // Only codes that match the app's own use (Apple, "Describing use of required reason API"): CA92.1 own settings,
    // C617.1 timestamps of files in the app container, E174.1 free space before writing, 35F9.1 elapsed time.
    expect(reasons).toEqual({
      NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1'],
      NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1'],
      NSPrivacyAccessedAPICategoryDiskSpace: ['E174.1'],
      NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'],
    });
  });

  it('app.json declares the collected data types from our flows (same as docs/PLAY-DATA-SAFETY.md), none used for tracking', () => {
    const ios = appJson.expo.ios as { privacyManifests: { NSPrivacyCollectedDataTypes: { NSPrivacyCollectedDataType: string; NSPrivacyCollectedDataTypeLinked: boolean; NSPrivacyCollectedDataTypeTracking: boolean; NSPrivacyCollectedDataTypePurposes: string[] }[] } };
    const got = ios.privacyManifests.NSPrivacyCollectedDataTypes.map((r) => ({
      type: r.NSPrivacyCollectedDataType.replace('NSPrivacyCollectedDataType', ''),
      linked: r.NSPrivacyCollectedDataTypeLinked,
      tracking: r.NSPrivacyCollectedDataTypeTracking,
      purposes: r.NSPrivacyCollectedDataTypePurposes.map((p) => p.replace('NSPrivacyCollectedDataTypePurpose', '')),
    }));
    const af = ['AppFunctionality'];
    const both = ['AppFunctionality', 'Analytics'];
    expect(got).toEqual([
      { type: 'EmailAddress', linked: true, tracking: false, purposes: af },
      { type: 'Health', linked: true, tracking: false, purposes: af },
      { type: 'Fitness', linked: true, tracking: false, purposes: af },
      { type: 'SensitiveInfo', linked: true, tracking: false, purposes: af }, // pregnancy or breastfeeding status
      { type: 'OtherUserContent', linked: true, tracking: false, purposes: af },
      { type: 'UserID', linked: true, tracking: false, purposes: both },
      { type: 'ProductInteraction', linked: true, tracking: false, purposes: af }, // card progress, check-in seen, dismissed suggestions
      { type: 'OtherDataTypes', linked: true, tracking: false, purposes: af }, // sex and age
      { type: 'DeviceID', linked: false, tracking: false, purposes: both }, // the per-install id
      { type: 'CrashData', linked: false, tracking: false, purposes: both },
      { type: 'PerformanceData', linked: false, tracking: false, purposes: both },
      { type: 'OtherDiagnosticData', linked: false, tracking: false, purposes: both },
    ]);
    // Photos or Videos are not declared: photos never leave the device. Add them when the meal-photo AI call ships.
    expect(got.map((r) => r.type)).not.toContain('PhotosorVideos');
  });

  it('only the camera and photo library strings are set, and the microphone one stays off', () => {
    const picker = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, Record<string, unknown>];
    expect(Object.keys(picker[1]).sort()).toEqual(['cameraPermission', 'microphonePermission', 'photosPermission']);
    expect(picker[1].microphonePermission).toBe(false);
    expect((appJson.expo.ios as Record<string, unknown>).infoPlist).toBeUndefined();
  });
});

describe('android permissions and photo permission copy', () => {
  const android = appJson.expo.android as { blockedPermissions?: string[] };
  const picker = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, Record<string, unknown>];

  // SYSTEM_ALERT_WINDOW comes from the Expo prebuild template; USE_BIOMETRIC and USE_FINGERPRINT from androidx.biometric
  // (pulled in by expo-secure-store). The app has no overlay and no biometric lock, so none is needed.
  it('blocks permissions the app does not use', () => {
    expect(android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ]),
    );
  });

  it('does not block VIBRATE, which haptics uses', () => {
    expect(android.blockedPermissions).not.toContain('android.permission.VIBRATE');
  });

  it('image picker strings say what is sent and when', () => {
    expect(picker[1].photosPermission).toBe(
      'Progress photos stay on this device. A photo or clip you choose for an AI meal estimate or form check is sent only when you ask; for form check, only still frames are sent.',
    );
    expect(picker[1].cameraPermission).toMatch(/AI meal estimate or form check is sent only when you ask/);
  });

  // USE_BIOMETRIC is blocked in app.json, so a biometric secure-store option would fail at runtime on Android.
  it('no screen or module asks secure-store for biometric authentication', () => {
    const fsx = fs as unknown as {
      readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
      readFileSync(p: string, e: string): string;
    };
    const names = ['requireAuthentication', 'canUseBiometricAuthentication'];
    const walk = (dir: string): string[] =>
      fsx.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.(tsx?|jsx?)$/.test(e.name) ? [full] : [];
      });
    const hits = ['src', 'app']
      .flatMap((d) => walk(path.join(__dirname, '..', d)))
      .filter((f) => names.some((n) => fsx.readFileSync(f, 'utf8').includes(n)));
    if (hits.length > 0) {
      throw new Error(
        `Found requireAuthentication or canUseBiometricAuthentication in ${hits.join(', ')}. USE_BIOMETRIC is blocked in app.json (blockedPermissions), so biometric secure-store options would fail at runtime on Android. Unblock it there first.`,
      );
    }
  });
});
