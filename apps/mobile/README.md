# Plate & Bar mobile app

Expo (SDK 57) + TypeScript strict + Expo Router. Offline first: records live in expo-sqlite, tokens in expo-secure-store. M0 skeleton: four tabs matching the prototype (Food, Workout, Progress, Targets), a SQLite database opened on start with a `schema_version` table and one migration, and a Targets tab showing the daily targets that `packages/core` computes from a fixed demo profile.

## Commands (Node 22, run in `apps/mobile`)

```
npm ci
npm start            # Expo dev server (press a for Android, w for web)
npm run android      # needs an emulator or device
npm run web
npm run lint
npm run typecheck
npm test
npx expo export --platform web   # production web bundle; proves Metro resolves core
```

## How `packages/core` is resolved

`package.json` depends on `"@plate-and-bar/core": "file:../../packages/core"` (no workspaces). `npm ci` symlinks it into `node_modules/@plate-and-bar/core`; its `main` is the TypeScript source `src/index.ts`.

- Metro: `metro.config.js` adds `packages/core` to `watchFolders`, because the symlink's real path is outside the app root.
- Jest: `jest-expo` transforms TypeScript with Babel. The real path (`packages/core/src`) is not under `node_modules`, so it is transformed; no extra mapping is needed.
- Dependencies of core: only `apps/mobile` is installed in CI, so core's own `node_modules` may not exist. Babel injects `@babel/runtime` imports into core's source, which must resolve from this app: Jest uses `moduleDirectories: ['node_modules', '<rootDir>/node_modules']`, Metro uses `resolver.nodeModulesPaths`. Test this by deleting `packages/core/node_modules` first.
- TypeScript: resolves through the symlink and `types` in core's `package.json`.

## Layout

- `app/` Expo Router routes; `app/(tabs)/` the four tabs.
- `src/theme/` light/dark palettes copied from the prototype's `:root` CSS; follows the system scheme.
- `src/db/migrations.ts` ordered migrations plus the migrator (`schema_version` table). Add new schema as a new entry; never edit shipped ones.
- `src/secure/tokens.ts` token storage in the OS keystore (no auth flow yet).
- `src/screens/TargetsScreen.tsx` the screen reading `calcTargets`.

## Notes

- The local database opens on Android, iOS and web (expo-sqlite's wasm build on web, same migrations). It needs a cross-origin isolated page; see "Run it in a browser".
- Token storage on web is the documented no-op: expo-secure-store has no web backend, so `saveTokens` stores nothing and `loadTokens` returns null (web sign-in will use in-memory tokens plus the refresh flow when auth lands). Profile and consent are in SQLite, not in tokens.
- "Skip for now" leaves setup for this session; Targets then shows "Start setup". The next launch opens setup again while no profile exists.
- `Profile.id` is null locally: Profile is a natural-key table, so its UUIDv5 (`profiles:me`) is computed when the store is bound to a signed-in user (#31) or at push time. Consent rows are dated records with random ids (expo-crypto `randomUUID`, MIT); a later consent adds a row and never overwrites an earlier one.
- The app opens to `/setup` when no profile is stored (consent first, then four steps, then results) and to Targets when one is. Profile and Consent are stored as the contract's snake_case JSON in the `profiles` and `consents` tables (`src/db/records.ts`).
- Placeholder screens for Food, Workout and Progress come with later issues.
- Verified with the commands above, not on an Android emulator or device.

## Run it in a browser

Dev server (sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, set in `metro.config.js`):

```
cd apps/mobile
npm ci
npx expo start --web --port 8081     # open http://localhost:8081
```

Static export, served with the same headers (the export includes `dist/_headers` from `public/_headers`, which Cloudflare Pages applies):

```
npx expo export --platform web
cat > dist/serve.json <<'JSON'
{"headers":[{"source":"**","headers":[
  {"key":"Cross-Origin-Opener-Policy","value":"same-origin"},
  {"key":"Cross-Origin-Embedder-Policy","value":"require-corp"}]}]}
JSON
npx serve@latest dist -l 8080 --single      # open http://localhost:8080
```

Without the two headers the page is not cross-origin isolated and the database does not open on web.

Check that data survives a reload (needs a local Chrome; set `CHROME_PATH` if it is not in a standard place):

```
npx expo export --platform web && node scripts/web-reload.mjs
```

It serves `dist/` with the headers, completes setup in headless Chrome with the network switched off (all writes are local), tries a reload offline (the static export has no service worker, so the page itself cannot load offline; that is expected and only logged), goes back online, reloads, and checks the Targets screen comes back from SQLite without asking for setup again.
