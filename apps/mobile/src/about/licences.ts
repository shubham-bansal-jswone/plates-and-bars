// Reads the generated src/about/licences.json (scripts/licences.mjs). The file is large, so it is required on first use only.

export interface LicenceEntry {
  name: string;
  version: string | null;
  licence: string;
  url?: string | null;
  from?: string[];
  /** Id into `texts`; null when the package ships no licence file. */
  text?: string | null;
}
export interface LicenceData {
  packages: LicenceEntry[];
  android: LicenceEntry[];
  assets: LicenceEntry[];
  texts: Record<string, string>;
}
export type LicenceRow = { kind: 'heading'; key: string; title: string; hint?: string } | { kind: 'entry'; key: string; entry: LicenceEntry };

export const LICENCES_COPY = {
  section: 'Open-source licences',
  title: 'Open-source licences',
  intro: 'The open-source software and fonts inside Plate & Bar. Tap an entry to read its licence notice.',
  summary: (n: number) => `Plate & Bar is built on ${n} open-source components. Each keeps its own licence.`,
  open: 'View open-source licences',
  licence: (l: string) => `Licence: ${l}`,
  noNotice: 'This package ships no separate licence file. The licence above is the one it declares.',
  assets: 'Fonts and icons',
  npm: 'JavaScript packages',
  npmHint: 'Production dependencies of the app, from its lockfile.',
  android: 'Android libraries',
  androidHint: 'Libraries declared by React Native and the Expo modules. Libraries they pull in further down are not listed.',
  repoDocs: 'Plate & Bar licence files',
};

/** Where the repository's own licence files live. */
export const REPO_FILES = [
  { label: 'LICENSE (Apache-2.0, code)', url: 'https://github.com/shubham-bansal-jswone/plates-and-bars/blob/main/LICENSE' },
  { label: 'NOTICE', url: 'https://github.com/shubham-bansal-jswone/plates-and-bars/blob/main/NOTICE' },
  { label: 'THIRD_PARTY.md', url: 'https://github.com/shubham-bansal-jswone/plates-and-bars/blob/main/THIRD_PARTY.md' },
] as const;

let cache: LicenceData | null = null;
export function getLicences(): LicenceData {
  return (cache ??= require('./licences.json') as LicenceData);
}

export function licenceCount(): number {
  const d = getLicences();
  return d.packages.length + d.android.length + d.assets.length;
}

/** Flat list rows (headings and entries) for a virtualised list. */
export function licenceRows(): { rows: LicenceRow[]; texts: Record<string, string> } {
  const d = getLicences();
  const t = LICENCES_COPY;
  const group = (id: string, title: string, hint: string | undefined, list: LicenceEntry[]): LicenceRow[] => [
    { kind: 'heading', key: `h:${id}`, title, hint },
    ...list.map((entry, i): LicenceRow => ({ kind: 'entry', key: `${id}:${i}`, entry })),
  ];
  return {
    rows: [...group('assets', t.assets, undefined, d.assets), ...group('android', t.android, t.androidHint, d.android), ...group('npm', t.npm, t.npmHint, d.packages)],
    texts: d.texts,
  };
}
