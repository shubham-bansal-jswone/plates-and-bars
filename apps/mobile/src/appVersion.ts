import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** The release version and, on Android, the build (versionCode). Both come from app.json via expo-constants (set from the tag by the release script). */
export function appVersion(): { version: string; build: string | null } | null {
  const cfg = Constants.expoConfig;
  const version = cfg?.version?.trim();
  if (!version) return null;
  const code = cfg?.android?.versionCode;
  return { version, build: code === undefined || code === null ? null : String(code) };
}

/** "Version 1.2.3 (1002003)" on Android, "Version 1.2.3" elsewhere (and on Android builds without a versionCode). Null without a version. */
export function versionLine(): string | null {
  const v = appVersion();
  if (!v) return null;
  return Platform.OS === 'android' && v.build ? `Version ${v.version} (${v.build})` : `Version ${v.version}`;
}

/** Error-report release name: plate-and-bar@X.Y.Z+versionCode (without "+code" when there is no build). Undefined without a version. */
export function errorRelease(): string | undefined {
  const v = appVersion();
  return v ? `plate-and-bar@${v.version}${v.build ? `+${v.build}` : ''}` : undefined;
}
