/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /** The web app's https origin, set at build time (#830). Unset or empty: no web-app link on the site. */
  readonly PUBLIC_WEB_APP_URL?: string;
}
