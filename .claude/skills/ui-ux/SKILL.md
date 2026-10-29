---
name: ui-ux
description: Orchestrates any UI/UX task (new screen, redesign, component, layout, visual polish, responsive or accessibility fix) in apps/mobile or apps/site. Runs discover, define, design, implement, inspect, critique, iterate, verify, with browser-based visual QA. Skip for logic-only or backend changes.
---

# UI/UX workflow

No fixed visual style is imposed. Visual direction is decided per product and task from its users, context and goals. Existing tokens and components (`apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/components/`) are the current implementation: reuse them where that serves the task, change or extend them when the design calls for it, keeping app and site consistent with whatever system results. Lane rules in `docs/AGENTS.md` still apply: app work stays in `apps/mobile/`, site work in `apps/site/`.

## Who does what

| Phase | Owner | Agent |
|---|---|---|
| 1 Discover, 2 Define, 3 Design | you, or for a new screen or redesign | `ui-designer` (read-only, returns a brief) |
| 4 Implement | lane agent | `app` (apps/mobile) or `website` (apps/site) |
| 5 Inspect, 6 Critique | evidence gatherer | `ui-qa` (browser, read-only, returns a defect list) |
| 7 Iterate, 8 Verify | lane agent, then you | `app` / `website`, then `ui-qa` re-check |

Small tweak (one component, spacing, copy): do all phases inline, spawn nothing. Spawn a specialist only when its output is worth a cold start.

## Phases

1. **Discover.** Read the screen, its components in `apps/mobile/src/components/`, tokens in `apps/mobile/src/theme/tokens.ts`, and the matching section of `docs/spec/PROTOTYPE_SPEC.md` (the HTML prototype is at git tag `prototype-final`). Port flows and copy; do not redesign rules (`docs/AGENTS.md`).
2. **Define.** One sentence each: who is using this, what they must do in under 10 seconds, what the top element on the screen is. Name success criteria you can check in a browser.
3. **Design.** Hierarchy (one primary action per view), layout per breakpoint, component reuse before new components, every state: loading, empty, error, success, disabled, long text, offline. Pick type, colour, spacing, surfaces, radii, shadows, gradients and motion deliberately, each with a reason. Put the choices in shared tokens, not per-screen literals.
4. **Implement.** Existing stack and components. Labels on every control, 44px targets, respects system text size, reduced motion honoured.
5. **Inspect.** Run the web build and look at it (see below). Reading code is not inspection.
6. **Critique.** Write a defect list: `id, viewport, what, why it matters, severity (blocker | major | minor)`. Specific only ("kcal figure 12px from card edge, grid is 16"), no taste verdicts.
7. **Iterate.** Fix blockers and majors, re-inspect the same viewports. Stop when no blocker or major remains with evidence, not after N rounds.
8. **Verify.** `npm run typecheck`, `npm run lint`, `npm test` in the app; keyboard pass; console clean; relevant e2e in `tests/e2e` if the flow is covered.

## Reject

Generic AI-SaaS look (default card grids, stock gradients, uniform rounded containers), decoration with no job, trend-following without a product reason, colour as the only carrier of meaning, text below accessible contrast.

## Running and inspecting

- Launch (web). Inspect the production bundle: `expo start --web` also works for quick looks (`metro.config.js` adds the COOP/COEP headers expo-sqlite needs), but it does not apply the CSP from `apps/mobile/public/_headers` or serve the exported bundle, so a CSP or bundling fault would not show. Use the e2e static server, which sets COOP/COEP and that CSP:
  1. `cd apps/mobile && npm ci` (if `node_modules` is stale, e.g. `Unable to resolve "tesseract.js"`), then `EXPO_NO_TELEMETRY=1 npx expo export --platform web`. Never in a PR worktree (`HANDOFF.md` watchpoints); use the main checkout or a scratch worktree.
  2. `cd tests/e2e && E2E_PORT=4190 node support/server.mjs &` serves `apps/mobile/dist` at `http://127.0.0.1:4190/`. Stop it when done.
  3. First load redirects to `/setup` (consent, then 4 setup steps). Reach other screens by completing setup or via seeded state, not by guessing URLs.
- Browser tools, in order of preference: `mcp__playwright__*`, then `mcp__claude-in-chrome__*`. Load via ToolSearch first. Not available or failing: say so and stop; do not substitute `about:blank` or read code instead.
- Viewports: 375x812, 768x1024, 1280x800 (`browser_resize`). The app follows the system scheme (`userInterfaceStyle: automatic`), so test light and dark with `browser_emulate_media`.
- Interact for real (click, type, press keys) and check `browser_console_messages` and `browser_network_requests`. A screen you never reached is not inspected.
- Artifacts: the Playwright MCP may only write inside the repo root, so screenshots go to `.playwright-mcp/ui-qa/<screen>-<w>x<h>-<light|dark>.png` (the directory is gitignored; snapshots land in `.playwright-mcp/` too). Never commit them; delete the folder when the task is done.
- Fallback without a working live browser: `tests/e2e` Playwright specs/screenshots, and disclose that visual QA was partial.
- Never report visual QA done without screenshots actually viewed.

## Playwright MCP setup (once per machine)

Registered per user, not in the repo, so a fresh clone has none: `claude mcp add playwright -s local -- npx @playwright/mcp@0.0.83` (0.0.83 is the latest published as of 2026-10-27 and is what the current registration, `@latest`, resolves to; re-pin deliberately). Check with `claude mcp list`. No credentials are involved. A repo `.mcp.json` was not added: it would duplicate this registration and prompt every contributor to approve a browser-driving server.
