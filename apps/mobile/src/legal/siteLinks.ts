/** The website's legal pages (#825). The origin is a build-time variable; unset or not https means no links. */
export const LEGAL_PAGES = [
  { path: '/privacy/', label: 'Privacy policy' },
  { path: '/terms/', label: 'Terms' },
  { path: '/delete-account/', label: 'Delete your account' },
] as const;

/** Normalises the site origin: https only, no query or fragment, no trailing slash. Returns null when unusable. */
export function siteBase(raw: string | undefined = process.env.EXPO_PUBLIC_SITE_URL): string | null {
  const v = raw?.trim();
  if (!v || !/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(v)) return null;
  return v.replace(/\/+$/, '');
}

export interface LegalLink {
  label: string;
  url: string;
}

/** The three links with absolute URLs (never a double slash), or an empty list when the site URL is not set. */
export function legalLinks(raw?: string): LegalLink[] {
  const base = siteBase(raw);
  return base ? LEGAL_PAGES.map((p) => ({ label: p.label, url: `${base}${p.path}` })) : [];
}
