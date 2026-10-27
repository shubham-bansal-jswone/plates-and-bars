# Plate & Bar: UI redesign audit and brief

Audit and design brief only. No application code, dependencies, skills or agents were changed. Facts are from files read or screens rendered in this session; recommendations and assumptions are labelled. Where the repo differs from `LLD.md`, the repo is treated as correct and the difference is listed in section 2.4.

Branch audited: `design-overhaul` (from `main` `a856fe0d`), web export built from it on 2026-10-27.

**Owner decision, 2026-10-27 (#1129):** the prototype (`docs/prototype/plate-and-bar.html`) wins over this audit. The muscle map (open until the first tick), quick check-in, stall/ladder cards, suggested weight and reason, warm-up, Learn mode, burn line and "Why these exercises?" stay inline. Only repeated reference material ("Guide and tools") is collapsed. On phones, set 1 therefore may not be visible without scrolling in the active session (accepted trade-off). Wherever a proposal below collapses one of the inline items, this decision overrides it.

**Implementation status:** the redesign is tracked in issues #1103-#1111 and #1120-#1129; PRs #1112-#1119, #1130 and #1131 implement it. The audit text below is the original assessment and is not rewritten per PR.

---

## 1. Current-state inventory

### 1.1 Routes and navigation (Expo Router, `apps/mobile/app/`)

| Route | File | Screen component | How a user gets there |
|---|---|---|---|
| `/` (tab **Food**) | `app/(tabs)/index.tsx` | `src/screens/FoodScreen.tsx` | Default landing after setup |
| `/workout` (tab) | `app/(tabs)/workout.tsx` | `src/screens/WorkoutScreen.tsx` | Tab bar |
| `/progress` (tab) | `app/(tabs)/progress.tsx` | `src/screens/ProgressScreen.tsx` | Tab bar |
| `/targets` (tab) | `app/(tabs)/targets.tsx` | `src/screens/TargetsScreen.tsx` | Tab bar |
| `/setup` | `app/setup.tsx` | `SetupScreen.tsx` (consent, 4 steps, results) | `Gate` redirects first-time users here (`src/state/Gate.tsx`); "Redo setup", "Recalculate targets" on Targets (`?redo=1`, `?recalc=1`) |
| `/sign-in` | `app/sign-in.tsx` | `SignInScreen.tsx` | `SyncBadge` pill; Data screen |
| `/data` | `app/data.tsx` | `DataScreen.tsx` (export, delete) | Targets > "Download or delete my data" |
| `/about` | `app/about.tsx` | `src/about/*` | Targets > "About and sources"; figure credit links |
| `/library` | `app/library.tsx` | `src/library/ExerciseLibraryScreen.tsx` + `ExerciseDetail.tsx` | **Only** Targets > "Exercise library" (`TargetsScreen.tsx:112`) |
| `/recipes`, `/kitchen-test`, `/meal-plan` | `app/*.tsx` | `RecipesScreen`, `KitchenTestScreen`, `MealPlanScreen` | Food tab buttons; Targets > "Kitchen tests" |
| `/barcode-dev` | `app/barcode-dev.tsx` | dev route for barcode scan | Not linked (flag `EXPO_PUBLIC_BARCODE_SCAN`) |

Tab bar: `app/(tabs)/_layout.tsx`: four tabs (Food, Workout, Progress, Targets), Ionicons filled/outline, 56 px plus safe area, active tint `c.focus`. A `ViewedDateProvider` wraps the tabs, so Food, Workout and Progress share one date (`DateBar`).

### 1.2 Modals, sheets, overlays
- `SheetModal` (`src/components/Sheet.tsx`): RN `Modal`, `animationType="slide"`, focus trap and title focus handled for web. Used by `HowToSheet`, `CantSheet`, `AddExerciseSheet`, `CustomTagsSheet`, `ExerciseSettingsSheet`, food `AddSheet`, AI sheets (`AskWhySheet`, `DescribeSheet`, `FormCheck`, `ImportRecipe`), pose `TrackSet`.
- Transient: `ToastBar` (`workout/parts.tsx`), `RestBar` (bottom dock above tab bar), `SyncBadge` (`sync/SyncBadge.tsx`, top-right pill, hidden when no API URL).
- Cover: `Gate` shows an `ActivityIndicator` while the profile loads.

### 1.3 Design system as implemented

| Item | Where | Observed |
|---|---|---|
| Tokens | `src/theme/tokens.ts` | One `Palette` interface, `light` and `dark` palettes, `radius {4,8,16,full}`, `space {4..48}`, `type` scale. Header says "Plate blue on black and white canvases" and cites `docs/design/DESIGN.md`, which was deleted. Brand is `#2457E6`. |
| Theme selection | `src/theme/useTheme.ts` | `useColorScheme() === 'dark' ? dark : light`. System scheme only; no in-app toggle. |
| Colour literals | whole `src/`, `app/` | **None outside `tokens.ts`** (grep for hex and `rgb(`: only issue numbers like `#503` matched). 70 files read colours through `useTheme()`. A palette change is therefore token-local. |
| Typography | `theme/fonts.tsx`, `tokens.ts` | Roboto Light (300) for display/title/heading; Inter 400-700 for the rest; bundled via `@expo-google-fonts`. **113 inline `fontSize:` literals in 47 files** bypass the `type` scale (e.g. `ExerciseCard.tsx`, `WorkoutScreen.tsx`, `parts.tsx`). |
| Components | `src/components/ui.tsx` (320 lines) | `Page` (max 560 px column), `Button` (primary/ghost/link), `Choice` (option or chip), `Field`, `Group`, `Card`, `Switch`, `Note`, `Hint`, `Label`, `Heading`/`H1`, `ErrorText`, `Press` (focus ring), `a11yState`. Plus `Sheet.tsx`, `Input.tsx`, `DateBar.tsx`, `ResultsView.tsx`, `ClearanceCard.tsx`. |
| Workout-local parts | `src/workout/parts.tsx` | A second control vocabulary: `Chip` (32 px, hitSlop 6), `RestBar`, `ToastBar`, `HowToSheet`. `Chip` duplicates `Choice chip` in `ui.tsx` (both `minHeight: 32`, same fill logic). |
| Icons | `app/(tabs)/_layout.tsx` only | Ionicons for the four tabs. Elsewhere typographic glyphs: `✓` (`ExerciseCard.tsx` set tick), `↗` (`VideoLink`), `‹` (setup back): 9 occurrences. |
| Motion | `RestBar` (500 ms interval), `TrendChart`, `MotionFigure`, `IdeasCard` use RN `Animated`; no reanimated, lottie, skia or 3D library in `package.json`. |
| Accessibility | `ui.tsx` | Strong: explicit heading levels, `a11yState` for web and native, focus ring on every `Press`, 44 px links/targets, `aria-hidden` captions, axe specs in light and dark (`tests/e2e/specs/a11y.spec.mjs`). Must be preserved. |
| Stale references | 6 files | `DESIGN.md` is still cited in comments (`tokens.ts`, `ui.tsx`, `fonts.tsx`, tab layout, others). |

### 1.4 Screens and what they contain (read in code, rendered where noted)

- **Food** (`FoodScreen.tsx`, 307 lines; rendered): date bar, big kcal-left number, protein/carbs/fat bars, "Copy previous day", "What should I eat next?" card, burn card, water, then per-meal sections (`MealSection`), recipes, meal-plan. Add flow in `food/AddSheet.tsx`; AI describe-meal behind flags.
- **Workout** (`WorkoutScreen.tsx`, 464 lines; rendered): two states in one `Page`.
  - `StartView` (no session today): re-check cards, start cards, `H1` "Pull A day", body map, numbered exercise list, optional "Quick check-in", **Start button last**, then chips to choose another day, "Pick exercises", week tools ("Fewer days this week?"), "Training away from your gym?", mode note, cardio block.
  - `SessionView` (session exists): `H1`, "Why these exercises?", "N of M sets done, X kg lifted", burn line, collapsible muscles line + `BodyMap`, one `ExerciseCard` per exercise, "Add exercise", set-rating hint, "Training again later today?", cardio. Bottom: `RestBar`, `ToastBar`.
- **Exercise card** (`workout/ExerciseCard.tsx`, 332 lines): name + settings gear, type/rep/rest text, "Why?" link, "Works:" line, links How to / Can't do / Form check / Track set, optional Learn-mode block (with `ExerciseFigure` before the first set), first-time ramp guide or "Suggested" box, warm-up line, stall/ladder cards, set rows (kg, reps, 48 px round tick), per-set rating chips (Easy / Just right / Hard / Couldn't finish), feel question, form question, Add set / Remove last set / Remove exercise.
- **Progress** (`ProgressScreen.tsx`; rendered): "Weekly check-in" (sessions / days logged / avg kcal / protein tiles, weight trend text, cardio minutes, lift-best line, calorie-burn explainer), weight and measurement charts, photos, cycle, labs, steps and sleep, seven-day card (`WeekCard`).
- **Targets** (`TargetsScreen.tsx`; rendered): setup summary, burn breakdown rows, editable daily targets, focus muscles, coverage meters, rules (avoid/replace), water and foods, plus buttons: Recalculate, Redo setup, Data, **Exercise library**, About, Kitchen tests.
- **Setup** (`SetupScreen.tsx`; rendered): consent (`Consent`), step 1 body, step 2 activity, step 3 training, step 4 goal + health check, results (`ResultsView`), "Use these targets". "Skip for now" shown until a profile exists.
- **Library** (`src/library/*`; list rendered): search, three chip filter rows (equipment, muscle, type), 71 exercises; detail shows tags, `BodyMap`, written card. Code comment: "no demo images" (`ExerciseDetail.tsx`).

### 1.5 Workout flows traced through code

| Flow | Path in code | Result |
|---|---|---|
| First open | `Gate` -> `/setup` -> `SetupFlow.saveSetup` -> `router.replace('/')` | Lands on **Food**, toast "Targets updated" |
| See today's plan | `WorkoutScreen` -> `StartView`; plan from core `planned()` + `nextInList` | Fixed weekdays by default; "run in order" mode after misses (`ModeNote`) |
| Preview another day / hand-pick | `previewT`, `picked`, `AddExerciseFlow` (`workout/AddExerciseFlow.tsx`) | Nothing stored until Start (comment cites #1005) |
| Start | `w.start(template, ci, choice, override)` / `w.startPicked` in `workout/useWorkoutDay.ts` (803 lines) | Builds session with `buildSession` (core rules), saves a `workouts` record |
| Log a set | `SetRow` inputs -> `act.edit`; tick -> `act.tick` -> `startRest(name,label)` | Tick with empty fields uses the suggested number; on a first-time exercise it shows toast "Enter the weight and reps first." (observed) |
| Rest | `startRest` -> `RestBar` (`restFor(name, tags)` from core); +30 s, Skip; background notification via `useRestNotification` | Observed: "Rest 2:29, Next: set 2 of Lat Pulldown" docked above tab bar |
| Rate set / feel / form | `RateRow`, `FeelStep`, form chips | Feeds core progression |
| Add / remove / "can't do" | `AddExerciseFlow`, `CantSheet`, `w.cant` | Replacement choices from core |
| Second session | "Training again later today?" -> `w.addSecond` | |
| **Finish** | **No finish/complete action or summary found.** A search of `src/` and `app/` for finish, complete, summary and history strings found none in the workout UI (only `labs/LabsSection.tsx` mentions history). The session is the day's `workouts` record; "N of M sets done" is the only status. | Completion is implicit |
| **History** | **No workout-history or per-exercise performance view found** in `progress/`, `library/` or `screens/`. Core has `LiftRecord` and `priorSessions`; the UI uses them only for suggestions and the Learn-mode first-session test. | Verified by search, not by exhaustive trace |

### 1.6 Content, media and tooling relevant to exercise visuals

| Asset | Path | Facts |
|---|---|---|
| Written how-to cards | `content/exercises.json` (`cards`) | Setup steps, key cues, common mistakes, breathing, easier/harder, where-to-feel, `misplaced_feel` |
| Start/end drawings | `content/exercise-images.json` | 67 entries when audited (64 pairs, 3 single frames), SVG inline, 253,621 bytes; now 68 drawings (the Dumbbell Fly drawing was dropped, #1114; Dead Bug was added). All `source: own_drawing`, licence **CC-BY-4.0**, author "Plate & Bar authors". 3 of 71 exercises have none: Prone Y-T-W Raise, Archer Push-ups, Dumbbell Fly (tracked in #1120) |
| Drawing pipeline | `tools/exercise-figures/` (`rig.mjs`, `generate.mjs`), validators in `tools/validate/` | Parametric rig; frames 320x240, 1-2 KB; colours via `currentColor` and `var(--fig-*)` so the app themes them (`workout/figures.ts` `themedSvg`); allowlist SVG parser (`svgAllowlist.ts`) |
| Muscle map | `workout/BodyMap.tsx`, `bodyMapData.ts` | Front/back polygons; main = `c.fat` (amber), also = `c.carbs` (teal) |
| Motion player | `src/motion/*`, `content/exercise-motion.json`, `tools/exercise-motion/` | Player exists behind `EXPO_PUBLIC_EXERCISE_MOTION=1`; **bundle has 0 entries** (361 bytes); no clips; pipeline is MediaPipe-based and was never run end to end (its README says so) |
| 3D assets | none found | The motion player projects 19-joint keyframes to 2D (`motion/project.ts`) |
| Demo video | none | `VideoLink.tsx` opens a YouTube search outside the app |
| Pose tracking | `src/pose/*`, `modules/plate-pose` | On-device rep counting behind a flag (#947), not a demonstration asset |

Where figures render: only `ExerciseCard.tsx:153` (Learn mode, `done === 0`). **Not** in `HowToSheet`, **not** in `ExerciseDetail`, **not** on the start preview.

### 1.7 Loading, empty, error, offline and sync states
- Loading: plain `<Hint>Loading…</Hint>` text (Workout, Progress); `Gate` spinner; no skeletons.
- Empty: informative copy per card (e.g. Food "Nothing logged for this day yet", Progress "Log a few weigh-ins to see them here"). Observed.
- Error: `ErrorText` (`role="alert"`) beneath forms; setup validation shows one message at the foot of the form (observed).
- Offline/sync: `SyncBadge` ("Sign in to sync" / "Not synced" / "Synced" / "Account full"), sync statuses in `sync/engine.ts`, web sign-in-unavailable handling. **The local build has no API URL, so `SyncBadge` did not render and these states were not seen visually.**

### 1.8 Existing tests and tooling
- Jest: 195 files in `apps/mobile/__tests__` (e.g. `workout-*.test.tsx`, `exercise-card-*.test.tsx`, `exercise-figure.test.tsx`, `exercise-library.test.tsx`); queries use accessible names.
- Playwright: `tests/e2e/specs/` (a11y light+dark axe per screen, setup, food-plan, workout-*, offline, photos, screens, sheet-focus); `tests/e2e/support/server.mjs` serves the export with COOP/COEP and the CSP.
- Maestro: `tests/e2e/maestro/01-setup.yaml`, `02-food.yaml`, `03-workout.yaml`.
- Screenshot tooling: Playwright MCP (verified working here), `tests/e2e/store/screenshots.mjs` (Play Store images, seeded demo data), `apps/mobile/scripts/screenshots.mjs`.

### 1.9 Screenshots captured in this audit
All from the web export of the current branch, served by `tests/e2e/support/server.mjs` at `http://127.0.0.1:4190`, stored in `.playwright-mcp/ui-qa/` (gitignored, not committed). The Playwright browser profile was reused from earlier sessions; setup was completed with the e2e answers (male, 30, 165 cm, 82 kg, 6 sessions, gym, goal lose fat).

| File | Route | Viewport / scheme |
|---|---|---|
| `audit-setup1-375x812-light.png`, `audit-setup2-…`, `audit-setup3-…`, `audit-setup-results-…` | `/setup` | 375x812 light |
| `audit-food-375x812-light.png` | `/` | 375x812 light |
| `audit-workout-start-375x812-light.png` | `/workout` (start view, "Pull A day") | 375x812 light |
| `audit-workout-session-375x812-light.png` | `/workout` (session started) | 375x812 light |
| `audit-workout-after-tick-375x812-light.png` | `/workout` (tick with empty fields, toast) | 375x812 light |
| `audit-workout-rest-375x812-light.png`, `…-dark.png` | `/workout` (set logged, rest bar) | 375x812 light and dark |
| `audit-progress-375x812-light.png` | `/progress` | 375x812 light |
| `audit-targets-375x812-light.png` | `/targets` | 375x812 light |
| `audit-library-375x812-dark.png` | `/library` | 375x812 dark |
| `audit-workout-1280x800-light.png`, `audit-food-1280x800-light.png` | `/workout`, `/` | 1280x800 light |

`audit-library-detail-…` is the list again: the click on the row did not open the detail, so **the library detail was not rendered**.

---

## 2. Architecture constraints

### 2.1 Must be preserved
1. **Rules live in `packages/core`.** Screens call core (`planned`, `restFor`, `suggestBase`, `setTarget`, `feelResult`, `weekSummary`, ...). UI must not reimplement rounding, progression, plan or target logic. Inline copy that explains rules lives in `src/workout/copy.ts`, `src/progress/copy.ts`, `src/setup/copy.ts`.
2. **Offline-first write path.** Stores write through `lockedDb`/`WriteLock`; SQLite triggers feed `sync_outbox`; `SyncProvider` runs the engine (LLD sections 7.3, 20.2). A redesign changes presentation only; do not add a second write path or direct `db` calls from new components.
3. **Sync, auth, API contract.** `packages/api/openapi.yaml` (0.1.26) and the 16 sync tables are fixed; custom UI state that must persist across devices needs a contract change (see Open questions).
4. **Accessible names and roles.** Jest and Playwright locate controls by `accessibilityLabel` (`label(page, 'Continue')`, `Mark … set 1 done`, `Rest timer`). Keep names stable or update tests in the same change.
5. **Web constraints.** expo-sqlite wasm needs COOP/COEP; the production CSP (`apps/mobile/public/_headers`) forbids remote fonts/images (`default-src 'self'`; `font-src 'self'`; `img-src 'self' data: blob:`). New fonts/images must be bundled.
6. **Content provenance.** Drawings must be own work under CC-BY-4.0/CC0 (`tools/validate/exercise-images.mjs`); third-party media needs an ADR.
7. **Flags and privacy features** (AI, pose, barcode, label scan, motion) stay behind their build flags; do not surface them as capabilities.
8. **Truthfulness.** Never render invented history, PRs or achievements; every number comes from stored records.
9. **Lane rules** (`docs/AGENTS.md`): app work in `apps/mobile`; content in `content/` and `tools/`.

### 2.2 UI implementation patterns to follow
- Colour only via `useTheme()` palette keys; type via `type.*` tokens (reduce the 113 inline sizes as screens are touched, not in one sweep).
- Controls built from `Press` (focus ring) with `a11yState`.
- Page layout: `Page` + 560 px column; sheets via `SheetModal`.
- Tests per component with React Native Testing Library; screens take `db` and `now` props for tests.

### 2.3 Agent and skill setup (inspected, not modified)
- `.claude/skills/ui-ux/SKILL.md`: eight-phase workflow, launch instructions (export + e2e server), screenshot conventions (`.playwright-mcp/ui-qa/`), says "No fixed visual style is imposed".
- `.claude/agents/ui-designer.md` (read-only brief writer; "do not prescribe a house palette") and `ui-qa.md` (Playwright MCP inspection; verified to navigate and screenshot via delegation).
- **Reuse plan:** treat this document as the *input brief* for `ui-designer` (it carries the owner-mandated identity, which the designer instructions otherwise do not impose) and use `ui-qa` after each implementation phase. No new skill or agent is needed. Open item: whether to add a one-line pointer from the skill to this document (a docs-only edit; not done here).

### 2.4 Repo vs `LLD.md` discrepancies
- `LLD.md` section 3.2 lists routes correctly, but does not say that the **Exercise library is reachable only from Targets** and that **no history or finish UI exists**. These are code facts, recorded here.
- `tokens.ts`, `ui.tsx`, `fonts.tsx` and the tab layout cite `docs/design/DESIGN.md`, deleted in `19ec4dee`; the LLD does not mention it.
- The LLD says the app "follows the system colour scheme"; confirmed (`useTheme.ts`) and also means **there is no user-selectable theme**, relevant to a dark-first identity.

---

## 3. UX findings

Severity: **High** blocks the core job (start, log, understand), **Med** adds friction, **Low** polish. Evidence is a file or a captured screenshot.

| # | Finding | Evidence | Recommendation | Sev |
|---|---|---|---|---|
| U1 | **The primary action is buried.** On the start view the Start button comes after the body map, a numbered list, a hint paragraph and the optional check-in. At 375x812 "Start Pull A" is not on screen. | `WorkoutScreen.tsx` `StartView` (Button after the check-in `View`); `audit-workout-start-375x812-light.png` | Make Start a sticky or first-fold primary action; collapse the map and check-in behind "Adjust" (superseded 2026-10-27: map and check-in stay inline, see the owner decision above) | High |
| U2 | **Active session shows chrome before sets.** The body map is open until the first set is ticked (`mapShown = mapOpen ?? done === 0`), then each card stacks meta text, "Why?" links, four text links, Learn mode, guide boxes and warm-up lines before the first set row. At 375x812 no set input is visible on first entry. | `WorkoutScreen.tsx` `SessionView`; `ExerciseCard.tsx`; `audit-workout-session-375x812-light.png` | One expanded exercise at a time with its sets first; everything else behind a "Guide" disclosure; collapsed rows for the rest (superseded 2026-10-27: only "Guide and tools" is collapsed, the other items stay inline) | High |
| U3 | **No finish, summary or reward moment.** Session status is the text "0 of 15 sets done, 0 kg lifted". Nothing marks a finished session or shows what it added. | Section 1.5 search | Add a completion state that reads existing session data (sets, volume, per-exercise results, rest taken); no new rules | High |
| U4 | **No history.** Users cannot see past sessions or an exercise's trend, though lift records exist. Progress is weight, photos, labs, steps and a weekly calorie card. | Section 1.5; `ProgressScreen.tsx` | Add a read-only history and per-exercise view built from existing `workouts`/`lift_stats` via core selectors | High |
| U5 | **First-time logging stops beginners.** Tick with empty kg/reps on a first-time exercise shows a toast, "Enter the weight and reps first"; the screen also explains a 3-step ramp. | `audit-workout-after-tick-375x812-light.png`; `ExerciseCard.tsx` ramp block | Keep core's ramp rules; improve presentation: one clear "Find your weight" path, a visible "I know my weight" option, inline hint on the field instead of a transient toast | Med |
| U6 | **In-workout controls are small.** Rating, "Add set", form answers and "Remove exercise" are `Chip`s: 32 px high (hitSlop 6 gives 44 on native; on web the box is 32). Set tick is 48 px and fine. "Remove exercise" sits beside "Add set". | `parts.tsx` `Chip`; `ui.tsx` `chip`; measured 32 px in the earlier audit | Minimum 44 px visible targets for in-workout controls; separate destructive actions from "Add set" | Med |
| U7 | **Link overload.** About 6 blue underlined links per exercise ("Why?", "How to do", "Can't do", "Form check", "Track set", "Setup"), all the same weight as primary content. | `ExerciseCard.tsx`; `audit-workout-1280x800-light.png` | Demote to an overflow/guide pattern; keep one visible "How to" affordance | Med |
| U8 | **Exercise demonstrations are hard to reach.** The drawings (67 when audited, now 68) appear only in Learn mode before the first set. The how-to sheet and library detail show the muscle map and text but no figure. The fallback is a YouTube search that leaves the app. | `ExerciseCard.tsx:153`; `parts.tsx` `HowToSheet`; `ExerciseDetail.tsx` | Show the existing figure in the how-to sheet, library detail and the session header | High |
| U9 | **Library is buried.** Reachable only via Targets > "Exercise library" (a ghost button among account buttons). | `TargetsScreen.tsx:112` | Surface it from the Workout tab and from "Add exercise" | Med |
| U10 | **Custom workouts are per-session only.** Users can hand-pick exercises for one start (`startPicked`) or condense the week ("Fewer days this week?"); there is no saved, named routine. Custom exercises exist (`CustomTagsSheet`). | `WorkoutScreen.tsx`; `ScheduleTools.tsx`; `core/plan.ts` `SPLITS` fixed by days | Product decision first (Open questions); a saved routine needs a synced record | Med |
| U11 | **Landing and navigation are nutrition-first.** Setup ends on Food; no "Today" overview ties food, workout and progress together. Targets mixes settings (targets, rules) with account/data/library/about. | `SetupFlow.save` -> `router.replace('/')`; `TargetsScreen.tsx` | Evolve the four tabs rather than replace: see 5.1 | Med |
| U12 | **Progress opens with explainer text.** First content is weekly counters ("0 / 6 sessions") then paragraphs about weight trend and the calorie-burn formula. A "N weeks in a row" habit message exists (`progress/copy.ts:76`). | `audit-progress-375x812-light.png`; `CheckinCard.tsx:124` | Lead with real recent activity; keep counters honest and non-punitive; review the streak wording against the "no expiring streak" principle (Open question) | Med |
| U13 | **Missed-session recovery is already good.** Core and cards cover missed days, "Welcome back", recovery week, fewer days this week and run-in-order mode. It is surfaced as stacked cards above the plan. | `ExerciseCards.tsx` `StartCards`, `RecheckCards`; `ScheduleTools.tsx` | Keep behaviour; restyle as one calm "Pick up where you left off" block | Low |
| U14 | **Setup validation is one message at the foot of the form** (single core error code). Observed on step 1: error at y=738, far from Sex. | `SetupScreen.tsx`; earlier measured screenshot | Show the error beside the field it names (map core error code to field in UI only); keep core's single-error rule | Med |
| U15 | **Desktop/web wastes width.** All screens use one 560 px centred column; the tab bar spans 1280 px with four distant items. | `ui.tsx` `column`; `audit-workout-1280x800-light.png` | Responsive shell: side rail or two-pane workout (plan + active exercise) at wide widths | Low-Med |
| U16 | **State feedback is text-only.** "Loading…" plain text, no skeletons; sync state is a small pill that appears only when signed in or a server is configured (not seen here). | `WorkoutScreen.tsx` `<Hint>Loading…</Hint>`; `SyncBadge.tsx` | Skeleton cards for Workout and Progress; keep the pill but verify offline/sync states visually (Verification status) | Low |

Not verified: behaviour on a real phone, Learn-mode figure rendering, sheet appearance, sync/offline UI, `Maestro` flows.

---

## 4. Visual system proposal

Principle: black canvas, lime as the single high-energy signal. Lime is for primary actions, the active tab, workout progress and the one key metric per screen. Everything else is neutral.

### 4.1 Colour tokens (mapped to the existing `Palette` keys, `tokens.ts`)

Contrast was computed (WCAG relative luminance) for the mandated values.

| Token (`Palette` key) | Value | Source | Contrast / note |
|---|---|---|---|
| `bg` | `#090B09` | mandated | canvas |
| `surface` | `#151915` | mandated | cards, inputs (`field`) |
| `surfaceElevated` | `#1C211C` | **derived, proposal** | sheets, rest dock; verify on device |
| `surfaceSoft` | `#232923` | **derived, proposal** | unselected chips, disabled fill |
| `ink` | `#F5F7F2` | mandated | 18.31 on bg, 16.47 on surface |
| `body` / `muted` | `#8E968D` | **derived** | 6.49 on bg, **5.84 on surface** |
| mandated secondary | `#777F76` | mandated | 4.78 on bg (passes AA); **4.30 on `#151915` fails AA for body text** |
| `brand` / `bar` | `#B7FF00` | mandated | 16.28 on bg, 14.65 on surface |
| `onBrand` | `#090B09` | derived | 16.28 on lime; never white on lime |
| `brandPressed` | `#9EE000` | **derived, proposal** | check ≥ 3:1 vs bg (pressed state) |
| `link`, `focus` | `#B7FF00` | mandated lime | focus ring 2 px lime, 2 px offset (keeps `useFocusRing`) |
| `line` | `#2E342E` | derived | decorative divider, 1.55:1 (not a control) |
| `outline` | `#6B736A` | derived | **control borders ≥ 3:1**: 4.03 on bg, 3.63 on surface |
| `danger` | `#FF5252` | mandated | 6.19 on bg, 5.57 on surface |
| `tint` | `#1B2A00` | **derived, proposal** | lime-tinted selected/guide backgrounds (replaces blue tint); verify text on it |
| `caution` | `#FFB020` | **derived** | warnings and over-target; amber, distinct from lime |
| macros `protein/carbs/fat` | lime-tint / `#2DD4BF` / `#F5B53D` | partly existing | `carbs` and `fat` already ship in `dark`; protein colour is an Open question |
| `toastBg` / `toastFg` | `#F5F7F2` / `#090B09` | inverted | |

Rules: (a) the mandated secondary `#777F76` may be used for large text and on `bg` only; body-size secondary text on surfaces uses `#8E968D`. (b) Lime text and lime fills never sit on lime. (c) Lime appears at most once per screen as a large filled element (the primary action or the key progress ring), plus small active indicators.

Light theme: the app currently ships both palettes and axe-tests both. The mandated identity is black. Recommendation: make the new dark palette the default and the only designed theme for this redesign, keep `light` compiling but unreviewed until decided (Open question 1).

### 4.2 Typography
- Replace Roboto Light 300 for display/title/heading (reads thin against a bold identity) with **Inter 800 ExtraBold** for titles and large numbers and **Inter 700** for labels. `@expo-google-fonts/inter` is already installed and includes `800ExtraBold` and `900Black` (licence `MIT AND OFL-1.1`), so no new dependency; add per-weight imports in `theme/fonts.tsx` and entries in `FAMILY` and `toWeight`. A condensed athletic display face would be a new dependency and bundle-size/CSP check: Open question 3.
- Metrics (kg, reps, kcal, rest timer) use tabular numerals (`fontVariant: ['tabular-nums']`) at display sizes so values do not jitter.
- Proposed scale (replaces `type`): display 40/800, title 28/800, heading 20/700, metric-lg 48/800, metric 24/800, label 16/700, body 16/400, caption 14/400, small 12/600, button 16/800 uppercase optional. Migrate inline `fontSize` literals to these tokens screen by screen.

### 4.3 Spacing, surfaces, borders, glow
- Keep `space` scale. Cards: `surface`, radius 16, no border by default; 1 px `line` only to separate stacked cards on `bg`.
- Selected state = lime 2 px border + `tint` fill (replaces the blue border/tint of `Choice`).
- **Restrained glow**: one `shadow` token for the single primary action, lime at ~25% opacity, radius 12, no glow on text. No gradients, no glassmorphism.

### 4.4 Components (changes to existing ones, not new libraries)
- `Button` primary: lime fill, `#090B09` label, 800 weight, min height 56 in workout contexts (48 elsewhere); ghost: `outline` border, `ink` label; link: lime text with 44 px height.
- `Choice`/`Chip`: unify `workout/parts.tsx` `Chip` into `ui.tsx` `Choice chip` (one component); 44 px visible height for in-workout use; selected = lime fill with black text.
- `Field`: `surface` fill, `outline` border, lime 2 px focus ring, 56 px height for set entry.
- Tabs: black bar, active icon and label lime with a 3 px top indicator; inactive `muted`.
- Sheets: `surfaceElevated`, 16 px top radius, drag handle.
- Feedback: toasts inverted; errors `danger` with an icon glyph from the icon set, never colour alone.
- Icons: replace `✓ ↗ ‹` glyphs with `@expo/vector-icons` (already installed, Ionicons) at consistent sizes. No emoji.

### 4.5 Workout metrics and progress
- Rest timer: large lime tabular countdown, thin lime progress along the dock top.
- Set rows: weight and reps in `metric` size, the tick a 56 px lime circle when done.
- Session progress: a lime bar or ring for sets done / total (real counts only).
- Charts (`TrendChart`): lime line, `line` grid, no filled gradient.
- Achievement states: only from data that exists (a lift beat its previous best: `checkBest`/`updateLift` in core). Lime badge with text, no confetti, no invented milestones.

### 4.6 Exercise media
- Figures keep `currentColor`/`var(--fig-*)`; map `--fig-hl` to lime and body to `ink`; `themedSvg` already takes the palette.
- `BodyMap`: main muscles lime, also-working a 35% lime tint (replaces amber/teal), non-targeted `surfaceSoft`.

### 4.7 Motion
Short (120-200 ms) press and state transitions with RN `Animated`; respect reduced motion; no new animation library. Rest-end uses the existing haptic (`restDoneBuzz`).

### 4.8 Responsive
- <600 px: current single column with bottom tabs.
- ≥900 px: left rail navigation; Workout becomes two panes (day plan / active exercise); content max width 1100 px instead of 560.

---

## 5. Screen-by-screen redesign brief

### 5.1 Navigation (evolve, not replace)
Keep four destinations; rename and reorder only if validated: **Today** (new landing combining next workout, food remaining and one recent-progress line, all from existing hooks), **Workout**, **Food**, **Progress** (with a history sub-view), and move Targets' account/data/about/library links into a **Profile/Settings** sheet reached from a header icon, leaving "Targets" content inside Food or a Settings screen. This is a recommendation resting on U9, U11; a lower-risk first step is to keep the four current tabs, add the library to Workout, and add history to Progress. Decide before phase 5.

### 5.2 Workout: start view
- **Current:** map, list, hint, check-in, Start last.
- **Proposed:** header (day name, estimated duration from `buildSession` data), compact exercise list with figure thumbnails where available, **sticky lime "Start <day>"**, secondary row: Preview muscles, Adjust (where today / lighter session / check-in), Pick exercises, Choose another day. (Superseded 2026-10-27: the muscle map and the quick check-in stay inline as in the prototype; only "Choose another day" and "Training away" are disclosures, see the owner decision above.)
- **Components:** extend `Card`, new `StickyAction` (built on `Button`), thumbnail `ExerciseFigure` (small variant).
- **Edge cases:** rest day (copy exists), labs hold note, clearance card, hand-picked list, preview mode, no profile, offline.
- **Acceptance:** Start is visible without scrolling at 375x812 and 1280x800; all current start paths (preview, pick, check-in choice, where override) still reach `w.start`/`w.startPicked` with identical arguments (Jest `workout-chooser`, `workout-leftovers`); axe passes.

### 5.3 Workout: active session
- **Current:** map + cards with many links.
- **Proposed:** progress header (sets done/total, volume, elapsed derived from stored times only if they exist: otherwise omit); current exercise expanded with **sets first**: set rows (kg, reps, 56 px tick), rating chips after a tick, Rest dock; other exercises collapsed to one line with status; "Guide" disclosure holds figure, cues, Why links, Can't do, Form check, Track set, Learn mode. **Decision 2026-10-27:** only "Guide and tools" is collapsed; the muscle map, check-in, stall/ladder cards, suggested weight and reason, warm-up, Learn mode, burn line and "Why these exercises?" stay inline.
- **Components:** `SetRow` extraction from `ExerciseCard.tsx`, `ExerciseHeader`, `GuideDisclosure`, unified `Chip`.
- **Edge cases:** first-time ramp (core `sug.mode === 'new'`), assisted/dumbbell/bodyweight kinds (`wHead`), cardio-only day, second session, ladder cards, pain flow (`FeelStep` pain branch must stay prominent), keyboard open on mobile.
- **Acceptance:** first set input visible on entry without scrolling at 375x812 (relaxed 2026-10-27: on phones set 1 may need scrolling, accepted trade-off); ticking a set starts the rest bar exactly as today (`startRest`); all `Mark … set N done` and `… set N kg/reps` labels unchanged; the pain path still offers "Find an alternative" and "Skip remaining sets".

### 5.4 Workout: completion
- **Current:** none.
- **Proposed:** when every set is done (or user taps "Finish"), a summary card: sets, volume, exercises with a personal best (core `checkBest`), estimated burn already computed by `BurnLine`, next planned day. No streaks or deadlines.
- **Needs:** whether "Finish" should write anything (it need not: the day record already exists). Prefer display-only.
- **Acceptance:** numbers equal those on the session screen and the stored records; hidden when nothing was done.

### 5.5 Progress and history
- **Current:** weekly check-in, body sections.
- **Proposed:** top "Recent sessions" list (date, template, sets, volume) from stored `workouts`; tap opens day detail; per-exercise sparkline and best from `LiftRecord` (core helpers, no new maths in components); weight and measurement sections keep current behaviour with new chart styling.
- **Acceptance:** history entries match records one-to-one; empty state invites logging without a counter; sync pull (`useDataVersion`) refreshes it.

### 5.6 Food
- **Current:** big kcal-left, three bars, cards, meals.
- **Proposed:** kcal remaining as the single lime metric; macro bars neutral tracks with macro colours; meal sections as `Card`s with a 56 px "Add" action; keep date bar, copy previous day, prep, plan, AI describe (flagged).
- **Acceptance:** no change to `useFoodDay` data flow; Playwright `food-plan`, `logging` specs pass.

### 5.7 Targets / settings
- **Proposed:** split into "Daily targets" (editable fields as they are) and "Training rules"; move account/data/about/library out of the button stack.
- **Acceptance:** `TargetsEditor` behaviour and `Redo setup` access unchanged.

### 5.8 Setup and onboarding
- **Current:** consent, 4 steps, results, skip.
- **Proposed:** same steps and copy; progress bar in lime; Sex as chips; inline field errors; results screen with one lime primary "Use these targets"; first workout prompt after save ("Start your first session" on Today/Workout) instead of landing on Food only.
- **Acceptance:** `setup-flow.test.tsx` Jest suite (28 `it` blocks) and e2e `setup.spec.mjs` unchanged in outcome; no extra mandatory fields.

### 5.9 Exercise library and detail
- **Proposed:** list rows with figure thumbnail (68/71 have drawings; show a neutral placeholder for 3), filter chips as one collapsible row, detail with figure pair, muscle map, written card, "Add to today's session".
- **Acceptance:** works offline; filter logic untouched (`filterLibrary`); `exercise-library.test.tsx` passes.

### 5.10 Cross-cutting
Skeleton loading for Workout and Progress; reusable `EmptyState`; consistent offline strip when sync is pending (reuse `SyncBadge` data); reduced-motion respected.

---

## 6. Exercise-media audit

| Question | Finding |
|---|---|
| What exists? | 68 own SVG start/end drawings (CC-BY-4.0), written cards for form, a muscle map, a MediaPipe-based motion pipeline and player with **no clips**, no video, no 3D. |
| Licensing | Drawings own work, CC-BY-4.0, enforced by validator and `isFigureBundle`; credit link to About in `ExerciseFigure`. Motion pipeline licences (MediaPipe Apache-2.0) are documented in `tools/exercise-motion/README.md`. |
| Suitable for the redesign? | Yes for static start/end frames: tiny (1-2 KB), themeable via CSS variables, offline, CSP-safe. Not a substitute for motion demos. |
| Gaps | (1) Figures not shown in how-to sheet, library or session header. (2) 3 exercises without drawings (Prone Y-T-W Raise, Archer Push-ups, Dumbbell Fly; #1120). (3) Motion bundle empty; flagged off. (4) "Targeted muscle highlighting" exists (`BodyMap`) but uses amber/teal and sits above every session. |
| Do not recommend yet | New animation systems, Lottie, 3D engines, or third-party clips: no clips exist, the pipeline was never run end to end, and any third party asset needs an ADR. |
| Most practical next step | Surface existing figures and muscle map consistently (how-to, library detail, session guide, start thumbnails) using the lime-themed `themedSvg` mapping; then add the 3 missing drawings through `tools/exercise-figures`. Re-evaluate motion only after real clips and coach sign-off (#1069). |

---

## 7. Implementation roadmap

| Phase | Scope | Likely files | Depends on | Tests |
|---|---|---|---|---|
| 0 | Decisions in section 8; remove stale `DESIGN.md` comments; add this brief as `ui-designer` input | `tokens.ts`, `ui.tsx`, `fonts.tsx`, tab layout comments | owner answers | none |
| 1 | Tokens, fonts, base components, tab bar, sheets (identity lands everywhere at once because colours are token-only) | `theme/tokens.ts`, `theme/fonts.tsx`, `components/ui.tsx`, `Input.tsx`, `Sheet.tsx`, `app/(tabs)/_layout.tsx` | phase 0 | Jest for `Button`/`Choice`/`Field`; axe light+dark Playwright (`a11y.spec.mjs`); `ui-qa` pass at 375/768/1280 |
| 2 | Workout start + active session redesign; unify `Chip`; `SetRow`, `GuideDisclosure`, sticky Start, rest dock | `screens/WorkoutScreen.tsx`, `workout/ExerciseCard.tsx`, `workout/parts.tsx`, new small components | phase 1 | existing `workout-*`, `exercise-card-*` Jest; `workout-*.spec.mjs`; Maestro `03-workout.yaml`; new tests for sticky Start and first-set-visible layout |
| 3 | Exercise media surfacing; 3 missing drawings | `workout/ExerciseFigure.tsx`, `HowToSheet`, `library/*`, `tools/exercise-figures`, `content/exercise-images.json` | phase 1 | `exercise-figure.test.tsx`, validator CLIs, library tests |
| 4 | Completion summary and workout history | new `workout/Summary`, `progress/History`, core selectors if needed (`packages/core`) | phase 2 | core unit tests with fixtures; screen tests; verify against stored records |
| 5 | Navigation/Today and library entry; Targets split | `app/(tabs)/*`, `TargetsScreen.tsx`, `FoodScreen.tsx` | owner decision on IA | `screens.spec.mjs`, `setup.spec.mjs`, Maestro |
| 6 | Progress and Food restyle, setup polish (inline errors, chips), empty/loading/offline states, responsive wide layout | `ProgressScreen`, `FoodScreen`, `SetupScreen`, `progress/*`, shell | phases 1-2 | specs for each; `ui-qa` checklist |
| 7 | Cleanup: remaining inline `fontSize` literals, light theme decision, docs | various | all | full Jest + e2e + axe |

Process: each phase is its own PR into `design-overhaul`, preceded by a `ui-designer` brief and followed by `ui-qa` screenshots at 375x812, 768x1024 and 1280x800; `npm run typecheck`, `lint`, `test` in `apps/mobile` per the skill. GitNexus impact analysis before editing shared components (`Button`, `Choice`, `Card`, `Press` have wide fan-out through 70 files).

---

## 8. Open questions

1. **Theme:** is the redesign dark-only (retire `light` or leave unmaintained), or must a light theme remain? Today both ship and both are axe-tested.
2. **Saved custom workouts / programs:** is a saved, named routine (and guided multi-week programs) in scope? It needs a synced record and so a contract/backend change (the 16 sync tables are fixed; additive `Settings` field is the lightest route). The repository cannot decide this.
3. **Display font:** stay with bundled Inter 800/900 (no new dependency), or add a condensed athletic face (new bundled font, CSP-safe but a dependency and size change)?
4. **Habit streak copy:** `progress/copy.ts:76` ("N weeks in a row with G+ sessions") is a weekly, non-expiring message. Keep, soften or remove given the "no expiring streak" principle?
5. **Landing tab:** keep Food first, or introduce Today? (Affects Gate redirect and e2e specs.)
6. **Protein colour:** lime-tinted protein competes with the primary-action signal; confirm the macro palette.
7. **Motion/3D:** commission real demonstration clips (coach sign-off) or defer; the repository has none.

---

## 9. Verification status

**Run / inspected in this session**
- Read: `LLD.md`; `theme/{tokens,useTheme,fonts}`; `components/{ui,Sheet,Input,Text}`; `app/(tabs)/_layout.tsx`; `screens/{Workout,Progress,Targets,Food,Setup}Screen` (Food/Progress/Targets headings and structure by grep, Workout and Setup in full); `workout/{ExerciseCard,parts,ExerciseFigure,BodyMap,ScheduleTools,VideoLink,figures}`; `library/*`; `sync/SyncBadge`; `state/Gate`; core `plan.ts` splits; content files and `tools/exercise-motion` README.
- Computed: WCAG contrast for the mandated palette and candidate derived colours.
- Built `npx expo export --platform web` from `apps/mobile` (after `npm ci` earlier in the session), served with `tests/e2e/support/server.mjs`, drove the real app with the Playwright MCP, and viewed the screenshots in section 1.9. The browser console was not re-read in this task's flows (earlier setup flows showed 0 errors).
- Quantified: 113 inline `fontSize` literals in 47 files; 0 colour literals outside `tokens.ts`; 70 files using `useTheme`; 195 Jest files; 4 of 71 exercises without a figure when audited (now 3 of 71, see section 1).

**Not verified**
- Jest, Playwright specs and Maestro were **not run** for this audit.
- Real device/Android rendering; iOS.
- Sync, offline and `SyncBadge` states (no API URL in this build).
- Learn-mode figure rendering, how-to sheet, library detail (click did not open), food add sheet, recipes, meal plan, data, about, sign-in screens.
- Dark theme beyond Workout rest bar and Library list; 768 px viewport.
- That no history/finish UI exists anywhere: established by string search and reading the Progress and Workout screens, not an exhaustive trace.
- Derived colours (`surfaceElevated`, `surfaceSoft`, `tint`, `brandPressed`, `caution`) are proposals and need contrast and visual checks on device.
- No code, dependency, skill or agent was changed for this document.
