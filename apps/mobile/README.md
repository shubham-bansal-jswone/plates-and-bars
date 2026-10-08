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

- On web the local database is skipped (expo-sqlite web needs wasm and cross-origin isolation); Android and iOS open it on start.
- Placeholder screens for Food, Workout and Progress come with later issues.
- Verified with the commands above, not on an Android emulator or device.
