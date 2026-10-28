/** @jest-environment node */
import appJson from '../app.json';

// The Expo template adds an unfiltered maven { url 'https://www.jitpack.io' } to every Android project, which defeats
// the per-module includeGroup limits. #1079. The plugin's mods are run here on the template's android/build.gradle.
type Mod = (c: unknown) => unknown;
const mods: { buildGradle?: Mod; properties?: Mod } = {};
jest.mock('expo/config-plugins', () => ({
  withProjectBuildGradle: (config: unknown, fn: Mod) => ((mods.buildGradle = fn), config),
  withGradleProperties: (config: unknown, fn: Mod) => ((mods.properties = fn), config),
}));
/* eslint-disable @typescript-eslint/no-require-imports */
const withNoJitpack = require('../plugins/with-no-jitpack') as ((c: unknown) => unknown) & {
  GRADLE_PROPERTY: string;
  removeJitpack(s: string): string;
};

// The allprojects block as Expo SDK 58 generates it.
const TEMPLATE = `allprojects {
  repositories {
    google()
    mavenCentral()
    maven { url 'https://www.jitpack.io' }
  }
}
`;
const UNFILTERED_JITPACK = /jitpack/i;

describe('no unfiltered JitPack repository', () => {
  it('app.json registers the plugin', () => {
    expect(JSON.stringify(appJson.expo.plugins)).toContain('./plugins/with-no-jitpack');
  });
  it('removes the template JitPack line and keeps the other repositories', () => {
    withNoJitpack({});
    const out = (mods.buildGradle?.({ modResults: { language: 'groovy', contents: TEMPLATE } }) as { modResults: { contents: string } }).modResults.contents;
    expect(out).not.toMatch(UNFILTERED_JITPACK);
    expect(out).toContain('google()');
    expect(out).toContain('mavenCentral()');
  });
  it.each([
    `maven { url "https://jitpack.io" }`,
    `maven { url = uri("https://www.jitpack.io") }`,
    `maven { url 'https://www.jitpack.io/' }`,
  ])('removes the variant %s', (line) => {
    expect(withNoJitpack.removeJitpack(`repositories {\n    ${line}\n}\n`)).toBe('repositories {\n}\n');
  });
  it.each([`allprojects {\n  repositories {\n    maven { setUrl("https://www.jitpack.io") }\n  }\n}\n`, `allprojects { repositories { maven { url 'https://www.jitpack.io' } } }\n`])(
    'fails prebuild when JitPack is in a form the plugin cannot remove: %s',
    (contents) => {
      withNoJitpack({});
      expect(() => mods.buildGradle?.({ modResults: { language: 'groovy', contents } })).toThrow(/still mentions JitPack/);
    },
  );
  it('is idempotent and leaves a build.gradle without JitPack unchanged', () => {
    const once = withNoJitpack.removeJitpack(TEMPLATE);
    expect(withNoJitpack.removeJitpack(once)).toBe(once);
  });
  it('turns off the React Native Gradle plugin JitPack repository, replacing an existing value', () => {
    withNoJitpack({});
    const out = (mods.properties?.({ modResults: [{ type: 'property', key: 'react.includeJitpackRepository', value: 'true' }, { type: 'property', key: 'a', value: 'b' }] }) as {
      modResults: unknown[];
    }).modResults;
    expect(out).toEqual([{ type: 'property', key: 'a', value: 'b' }, { type: 'property', key: 'react.includeJitpackRepository', value: 'false' }]);
  });
});
