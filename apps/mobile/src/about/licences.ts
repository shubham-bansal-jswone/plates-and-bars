// Reads the generated src/about/licences.json (scripts/licences.mjs). The file is large, so it is required on first use only.

export interface LicenceEntry {
  name: string;
  version: string | null;
  licence: string;
  url?: string | null;
  /** Id into `texts`; null when the package ships no licence file. */
  text?: string | null;
  /** Native components only: the shipped .so files this code is linked into. */
  in?: string[];
}
export interface LicenceData {
  packages: LicenceEntry[];
  android: LicenceEntry[];
  native: LicenceEntry[];
  assets: LicenceEntry[];
  texts: Record<string, string>;
}
export type LicenceRow = { kind: 'heading'; key: string; title: string; hint?: string } | { kind: 'entry'; key: string; entry: LicenceEntry };

export const LICENCES_COPY = {
  section: 'Open-source licences',
  title: 'Open-source licences',
  intro: 'The open-source software and fonts inside Plate & Bar. Tap an entry to read its licence notice.',
  summary: 'Plate & Bar is built on open-source software and fonts. Each component keeps its own licence.',
  open: 'View open-source licences',
  licence: (l: string) => `Licence: ${l}`,
  noNotice: 'This package ships no separate licence file. The licence above is the one it declares.',
  loading: 'Loading licences',
  failed: 'The licences could not be loaded. Check your connection and try again.',
  retry: 'Try again',
  assets: 'Fonts, icons and model files',
  native: 'Native code inside the app',
  nativeHint: 'Third-party C and C++ code linked into the native libraries (.so files) of Hermes, React Native, the image decoders and SQLite.',
  linkedInto: (files: string[]) => `Linked into: ${files.join(', ')}`,
  npm: 'JavaScript packages',
  npmHint: 'Production dependencies of the app, from its lockfile.',
  android: 'Android libraries',
  androidHint: 'Every library in the Android release build, as Gradle resolved it, with its licence text and any NOTICE file it ships.',
  repoDocs: 'Plate & Bar licence files',
};

/** Where the repository's own licence files live. */
export const REPO_FILES = [
  { label: 'LICENSE (Apache-2.0, code)', url: 'https://github.com/shubham-bansal-jswone/plates-and-bars/blob/main/LICENSE' },
  { label: 'NOTICE', url: 'https://github.com/shubham-bansal-jswone/plates-and-bars/blob/main/NOTICE' },
  { label: 'THIRD_PARTY.md', url: 'https://github.com/shubham-bansal-jswone/plates-and-bars/blob/main/THIRD_PARTY.md' },
] as const;

/** Wraps a loader so a success is cached and a failure is not: the next call tries again (a web fetch that failed offline). */
export function cachedLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cache: Promise<T> | null = null;
  return () => {
    cache ??= load().catch((e: unknown) => {
      cache = null;
      throw e;
    });
    return cache;
  };
}

/**
 * Loads the generated JSON (about 0.5 MB) with a dynamic import, so the web export puts it in its own chunk that is fetched
 * when the list opens, and Hermes only evaluates it then.
 */
export const loadLicences = cachedLoader(() => import('./licences.json').then((m) => (m.default ?? m) as unknown as LicenceData));

/** Flat list rows (headings and entries) for a virtualised list. */
export function licenceRows(d: LicenceData): LicenceRow[] {
  const t = LICENCES_COPY;
  const group = (id: string, title: string, hint: string | undefined, list: LicenceEntry[]): LicenceRow[] => [
    { kind: 'heading', key: `h:${id}`, title, hint },
    ...list.map((entry, i): LicenceRow => ({ kind: 'entry', key: `${id}:${i}`, entry })),
  ];
  return [...group('assets', t.assets, undefined, d.assets), ...group('android', t.android, t.androidHint, d.android), ...group('native', t.native, t.nativeHint, d.native), ...group('npm', t.npm, t.npmHint, d.packages)];
}
