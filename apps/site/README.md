# Plate & Bar site

Astro static site (TypeScript strict) for Cloudflare Pages. Pages: landing, `/privacy` and `/terms` (both drafts pending lawyer review under India's DPDP Act 2023). `/delete-account` describes in-app deletion and a code-verified email fallback. The attributions page comes later.

Fonts: Roboto 300 (display) and Inter 400/500/700 (body), self-hosted through `@fontsource/roboto` and `@fontsource/inter` (both SIL OFL 1.1 per their package metadata), latin subset, `font-display: swap`, system font stack as fallback; no external requests. Theme: tokens in `src/styles/global.css` follow `docs/design/DESIGN.md` (light on `:root`, dark via `prefers-color-scheme`).

## Commands (run in `apps/site`)

| Command | What it does |
| --- | --- |
| `npm ci` | Install exact dependencies (Node 22.12 or newer) |
| `npm run dev` | Dev server on localhost:4321 |
| `npm run check` | `astro check` type and template checks, then `npm test` |
| `npm test` | `scripts/*.test.mjs`: the `PUBLIC_WEB_APP_URL` check and a real build without it, with it and with a bad value (temporary output directories, `dist/` untouched) |
| `npm run build` | Static build into `dist/` |
| `npm run placeholders` | Lists `[bracket]` placeholders still in the pages (facts waiting on an owner decision). Never fails; the list must be empty before launch. |
| `npm run a11y` | Build, serve `dist/` locally with the headers from `public/_headers` (a CSP violation fails the run), run axe-core in headless Chrome on every page (light and dark, 1280px, 360px and 320px, plus horizontal-scroll and empty-custom-property checks). Needs a local Chrome or Chromium; set `CHROME_PATH` if it is not in a standard location. |

## Web app link (`PUBLIC_WEB_APP_URL`)

Optional build-time variable: the web app's https origin, for example `https://app.example.com` (a trailing `/` is allowed; nothing else after the host). When it is set, the landing page shows "Open the web app" and the badge "Use it on the web, coming to Android", and the deletion page lists "Delete on the web" before the email request. When it is unset or empty, none of that appears and the badge stays "Coming to Android and web". Any other value (http, a path, a query, credentials, an uppercase host) fails the build (`src/lib/web-app-url.mjs`).

## Deploy to Cloudflare Pages

Connect the repository in Cloudflare Pages with:

- Root directory: `apps/site`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION=22`, and `PUBLIC_WEB_APP_URL` once the web app is hosted

No server runtime or adapter is needed. The privacy and terms pages are drafts; remove the draft notice only when Shubham says so.
