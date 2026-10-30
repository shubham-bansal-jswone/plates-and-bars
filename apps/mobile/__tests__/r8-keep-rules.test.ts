/** @jest-environment node */
import appJson from '../app.json';

// R8 keep rules for WorkManager's Room database (#1435). Without them a release APK dies in
// ActivityThread.installContentProviders before any JS runs: WorkManager (a react-native-android-widget
// dependency) opens its Room database at launch and R8 has renamed androidx.room.
type Mod = (c: unknown) => unknown;
const mods: { android?: Mod } = {};
jest.mock('expo/config-plugins', () => ({
  withDangerousMod: (config: unknown, [platform, fn]: [string, Mod]) => {
    if (platform === 'android') mods.android = fn;
    return config;
  },
}));
/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../plugins/with-r8-keep-rules') as ((c: unknown) => unknown) & {
  MARKER: string;
  RULES: string;
  applyKeepRules(s: string): string;
  readRulesFile(f: string): string;
};

// What the Expo SDK 58 template ships in android/app/proguard-rules.pro.
const TEMPLATE = `# Add project specific ProGuard rules here.

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:
`;

describe('R8 keep rules for WorkManager and Room', () => {
  it('app.json registers the plugin', () => {
    expect(JSON.stringify(appJson.expo.plugins)).toContain('./plugins/with-r8-keep-rules');
  });
  it('keeps both androidx packages Room and WorkManager look up at launch', () => {
    expect(plugin.RULES).toContain('-keep class androidx.room.** { *; }');
    expect(plugin.RULES).toContain('-keep class androidx.work.** { *; }');
  });
  it('writes only ProGuard syntax: # comments, no // (R8 fails the build on a // line)', () => {
    const lines = plugin.RULES.split('\n');
    expect(lines.filter((l) => l.trim() !== '').every((l) => l.startsWith('#') || l.startsWith('-'))).toBe(true);
    expect(plugin.MARKER.startsWith('#')).toBe(true);
  });
  it('appends the rules and keeps the template rules', () => {
    const out = plugin.applyKeepRules(TEMPLATE);
    expect(out).toContain('-keep class com.swmansion.reanimated.** { *; }');
    expect(out).toContain('-keep class androidx.room.** { *; }');
    expect(out).toContain('-keep class androidx.work.** { *; }');
  });
  it('is idempotent, so a second prebuild does not duplicate the block', () => {
    const once = plugin.applyKeepRules(TEMPLATE);
    expect(plugin.applyKeepRules(once)).toBe(once);
    expect(once.split(plugin.MARKER)).toHaveLength(2);
  });
  it('replaces an older block, so a changed RULES reaches an android folder that already exists', () => {
    const stale = `${TEMPLATE}\n${plugin.MARKER}\n-keep class androidx.work.** { *; }\n-keep class androidx.room.old.Only { *; }\n`;
    const out = plugin.applyKeepRules(stale);
    expect(out).not.toContain('androidx.room.old.Only');
    expect(out).toContain('-keep class androidx.room.** { *; }');
    expect(out.split(plugin.MARKER)).toHaveLength(2);
    expect(plugin.applyKeepRules(out)).toBe(out);
  });
  it('names the plugin and the template change when proguard-rules.pro is missing', () => {
    const fs = require('fs') as { readFileSync: () => string };
    const realRead = fs.readFileSync;
    fs.readFileSync = () => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    };
    try {
      expect(() => plugin.readRulesFile('/tmp/android/app/proguard-rules.pro')).toThrow(/with-r8-keep-rules: .*proguard-rules\.pro is missing; the Expo template changed/);
    } finally {
      fs.readFileSync = realRead;
    }
  });
  it('handles an empty file and a file without a trailing newline', () => {
    expect(plugin.applyKeepRules('')).toContain('-keep class androidx.room.** { *; }');
    const out = plugin.applyKeepRules('-keep class a.B { *; }');
    expect(out.startsWith('-keep class a.B { *; }\n')).toBe(true);
    expect(out).toContain('-keep class androidx.work.** { *; }');
  });
  it('writes the file through the android dangerous mod and is a no-op on an applied file', () => {
    const written: string[] = [];
    const fs = require('fs') as { readFileSync: () => string; writeFileSync: (f: string, s: string) => void };
    const realRead = fs.readFileSync;
    const realWrite = fs.writeFileSync;
    let body = TEMPLATE;
    fs.readFileSync = () => body;
    fs.writeFileSync = (_f: string, s: string) => {
      written.push(s);
      body = s;
    };
    try {
      plugin({});
      const run = (ctx: unknown) => mods.android?.(ctx);
      run({ modRequest: { platformProjectRoot: '/tmp/android' } });
      run({ modRequest: { platformProjectRoot: '/tmp/android' } });
    } finally {
      fs.readFileSync = realRead;
      fs.writeFileSync = realWrite;
    }
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('-keep class androidx.room.** { *; }');
  });
});
