# Plate & Bar site

Astro static site (TypeScript strict) for Cloudflare Pages. Pages: landing, `/privacy` and `/terms` (both drafts pending lawyer review under India's DPDP Act 2023). The account deletion and attributions pages come later.

Fonts: Bricolage Grotesque (SIL OFL 1.1) self-hosted in `public/fonts/` with its licence, `font-display: swap`, system font stack as fallback; no external requests. Colours: the prototype's `:root` tokens (light, and dark via `prefers-color-scheme`).

## Commands (run in `apps/site`)

| Command | What it does |
| --- | --- |
| `npm ci` | Install exact dependencies (Node 22.12 or newer) |
| `npm run dev` | Dev server on localhost:4321 |
| `npm run check` | `astro check` type and template checks |
| `npm run build` | Static build into `dist/` |
| `npm run a11y` | Build, serve `dist/` locally, run axe-core in headless Chrome on every page (light and dark, 1280px and 360px). Needs a local Chrome or Chromium; set `CHROME_PATH` if it is not in a standard location. |

## Deploy to Cloudflare Pages

Connect the repository in Cloudflare Pages with:

- Root directory: `apps/site`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION=22`

No server runtime or adapter is needed. The privacy and terms pages are drafts; remove the draft notice only when Shubham says so.
