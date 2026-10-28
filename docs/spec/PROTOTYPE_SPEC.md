# Plate & Bar — Prototype Behaviour Spec

**Status:** source of truth for app behaviour, as of 2026-10-09.
**Reference implementation:** `docs/prototype/plate-and-bar.html` (single file; open it in a browser to use it).
**Golden fixtures:** `docs/spec/golden/*.json`, generated from the prototype. Ported code must reproduce them exactly.

When this spec, the fixtures and the prototype disagree, the prototype wins; file an issue so the spec is fixed.

---

## 0. Changes since the Development Plan was written

**2026-10-28 — graduated warm-up ramp and warm-ups on later compounds (deliberate differences; prototype and golden fixtures unchanged).**
- #1240 (decision), #1241 (core, PR #1246), #1242 (app). The prototype's `warmupHtml` (`docs/prototype/plate-and-bar.html:3497-3505`) stays the spec below 60 kg on the first loaded, non-assisted compound: "Warm up first: 8 reps at 50%, then 4 at 75%. Not logged.", weights snapped to the exercise step. `warmupSets` stays the prototype port.
- Deliberate differences, from `warmupRamp` in `packages/core/src/workout.ts`: (1) at a work weight of 60 kg or more the line is a three-step ramp, 40% x 8, 60% x 5, 80% x 3, e.g. "Warm up first: 8 reps at 24 kg, then 5 at 36 kg, then 3 at 48 kg. Not logged."; (2) a later compound shows a line too when none of its primary muscles is a primary muscle of an earlier compound exercise in today's session (bench after squat yes, a second chest press no; earlier isolation work does not count), also on collapsed rows; (3) a step is dropped when it snaps to 0, equals the previous step, or reaches the work weight.
- Unchanged: the line shows only before any set of that exercise is ticked, never for isolation, bodyweight or assisted exercises, keeps the `warmup` Why link, and is never logged. It has no effect on volume, set counts, progression, PRs, e1RM or the history view; there is no `kind: warmup` and no sync change. Regenerating the app from the prototype must not revert this.

**2026-10-28 — Progress "Seven days" target-line hint wording (deliberate difference; prototype and golden fixtures unchanged).**
- #1190 (wording shipped in PR #1201), #1204 (recorded here). The prototype's hint says "The dark line on each bar is your calorie target." (`docs/prototype/plate-and-bar.html:4119`); the app says "The thin vertical line on each bar is your calorie target." because the line is `ink` at half opacity, so it is light in dark mode and "dark line" would be wrong there. The prototype is not edited. Regenerating the app from the prototype must not revert this.

**2026-10-28 — no "Targets updated" toast after first setup (deliberate difference; prototype and golden fixtures unchanged).**
- #1233 (decision), #1194 (implemented in PR #1228). The prototype toasts "Targets updated" after any "Use these targets", first setup included (`docs/prototype/plate-and-bar.html:4387`, no `hadSettings` check). The app posts no toast after first setup, because nothing was updated; a redo of setup still toasts "Targets updated", or "Setup saved, targets unchanged" when the targets are kept. Regenerating the app from the prototype must not revert this.

**2026-10-28 — Workout and Targets copy and rows (deliberate differences; prototype and golden fixtures unchanged).**
- #1198 (PR #1223). Empty-tick hint: the prototype says "Tap ✓ with a field empty to use the suggested number."; the app says "Tap the tick to log a set. An empty field uses the suggested number when there is one; on a first-time exercise, enter it yourself." because on a first-time exercise an empty field has no suggestion and the tick refuses. A refused tick also focuses the first empty field and marks it invalid, besides the toast.
- Targets coverage: a one-line legend after the planned-coverage "Why?" link, "Bars: grey is planned, coloured is done. A low count (under 6 sets) shows in orange." (the number is core's `COVER_LOW`). The prototype has no legend; colour alone carried the meaning.
- Targets "Why it works": each row is one whole-row control (named "Open <title>") with the evidence level as a separate "<level> evidence" label, instead of the prototype's `.ev` pill beside the title and a separate Open button per row.

**2026-10-27 — the active session expands one exercise at a time (deliberate difference; prototype and golden fixtures unchanged).**
- #1138 (owner decision; see `docs/ui-redesign-audit.md` and PR #1133). The prototype expands every exercise in the session. The app expands one and collapses the others to a row that still shows the suggestion, reason, warm-up, Learn mode and stall/ladder cards. Inside an exercise only "Guide and tools" is collapsed. Regenerating the app from the prototype must not revert this.

**2026-10-19 — picks seeded from a workout preview keep its base and adjustments (deliberate difference; prototype and golden fixtures unchanged).**
- #1020 (follow-up to #1017; core in PR #1028, app wiring in this PR). The prototype's `exPick` starts a hand-picked session with `mods: {}` and no `base`, so a session begun from "Pick exercises" inside a previewed workout is not counted by the rotation and sequence and ignores the check-in, re-entry and deload adjustments.
- When the picks were seeded from a previewed workout, the session now stores that workout as `base` (the template is its name, with the where suffix) and keeps its `mods`: the exercises that remain get the Lighter-session, re-entry and recovery-week set counts, and the time answer is kept as the short-session flag (the short cut already happened in the preview list). A seeded balance exercise gets 2 sets, and added exercises get plain default sets. Removed exercises are simply absent. Core `seededSession` does this.
- The base applies only while at least one seeded exercise remains picked, whatever the order of taps; if none does, the session is plain hand-picked. While picks are seeded the "Training away" toggle is hidden so `where` cannot change under the list; Back to workouts brings it back.
- Fully hand-picked sessions (no preview) are unchanged: a "Session" with `base` null and `mods: {}`, as in `exPick`.

**2026-10-19 — in sequence mode, hand-picked sessions do not reset the workout order (deliberate difference; prototype and golden fixtures unchanged).**
- #1019 (implemented in PR #1029). In sequence mode the next workout follows the most recent day that has a real template:
- Hand-picked days (no template, or "Session", core's `HAND_PICKED`) are skipped, so a one-off session does not send the sequence back to the start.
- A template that is no longer in the plan (for example after a split change) restarts at the first entry.
- Prototype difference: `docs/prototype/plate-and-bar.html:1552` takes the last session as is and restarts at the first entry on any template not found in the plan, which includes a hand-picked "Session".

**2026-10-19 — v1.1 form check accepts photos and sends frames (spec-change; prototype and golden fixtures unchanged).**
- #1012 (from PR #1003, the v1.1 form check port under #946; decided by the coordinator under the owner's delegation). Two deliberate differences from the prototype, recorded here instead of kept silently.
- Photos as well as video: the prototype's form check takes only a video and cuts frames in the browser with `<video>` and canvas. The app also accepts 2 to 4 photos (picked or taken), and cuts video frames on the phone with `expo-video-thumbnails`, which has no web implementation, so on web only the photos path is offered. Decision: keep both, because photos make the feature usable on web and on phones where a video pick fails. Web video (porting the prototype's canvas cut) is a nice-to-have and can wait.
- Frames are sent: the lines in this section and in section 7 that say frames are not sent and no form-check photos are sent are now marked v1 only. In v1.1 the AI form check (ADR 008, behind a server flag and consent) sends 2 to 4 frames and the exercise name only; the video never leaves the device. The prototype already sends frames, so there is no prototype change.

**2026-10-19 — choosing a workout opens a preview until Start; exercises from any workout can be mixed (spec-change; prototype and golden fixtures unchanged).**
- #1017 (owner request in #1005, implemented in PR #1016; the owner filed #1005 directly, so the deviation is authorised). The prototype's workout template chips (`chipList`, the `tpl` chip, around line 1660 of `docs/prototype/plate-and-bar.html`) and the exercise picker (`exPick`) start a session on tap. The app instead:
- Choosing a workout opens an in-memory preview with Start, Pick exercises and Back to workouts. Nothing is stored or synced until Start.
- Hand-picked exercises collect in a "Your exercises" preview before Start.
- The exercise picker and the in-session Add exercise sheet list this week's workouts first ("From <workout>"), then the library, so a session can mix exercises from any workout.
- Weekly muscle volume counts every ticked set by its exercise's muscles, whichever workout it came from. This was already true and is now covered by tests. No calculation changes.
- New copy: "Choose <workout>", "Back to workouts", "Your exercises", "Start these exercises" / "Start this exercise", "Pick more exercises", "From <workout>", and the hint "Nothing is saved until you start."
- Follow-up: #1020.

**2026-10-19 — the Why? sheet's Close button sits below the content (spec-change; prototype and golden fixtures unchanged).**
- #1018 (owner request in #1006, implemented in PR #1015; the owner filed #1006 directly, so the deviation is authorised). The prototype's Why sheet puts the Close button (×) next to the title at the top (`docs/prototype/plate-and-bar.html:2874-2875`), with Evidence, Source and "Ask a follow-up" after it (2876-2880). In the app Close comes last: title, summary and body, Evidence, Source, the follow-up, then Close. Android back, web Escape and the accessibility escape gesture still close the sheet. This applies to every Why? link, the daily read and the Why library, since they share one sheet.

**2026-10-18 — Bodyweight Squat and Goblet Squat cards get a depth cue (spec-change; golden `exercises.json` changed).**
- #981 (part of #947): the depth line "Lower until your thighs are about parallel" (the wording the Hack Squat card already uses) replaces one `key_cues` line on each card in `docs/prototype/plate-and-bar.html`, so every card keeps exactly 3 key cues. Bodyweight Squat: replaces "Sit back and down between your heels" (now the first line). Goblet Squat: replaces "Stand up by pushing through your whole foot" (now the third line). `docs/spec/golden/exercises.json` and `content/exercises.json` are regenerated; no calculation changes. Core's `DEPTH_CUES` (live pose tracking) points at this line.

**2026-10-18 — cycle log: "Turn off and delete" takes a second tap (spec-change; prototype and golden fixtures unchanged).**
- Prototype `cyc-off` (line 3369) deletes the cycle log on one tap with no confirmation. The app deliberately differs: the first tap arms the button ("Tap again to delete the cycle log", disarms after 4 seconds), the second deletes. The data is sensitive and the deletion cannot be undone; the app already uses this pattern for deleting a photo check-in. No calculation changes (#625).

**2026-10-18 — the prototype no longer embeds exercise demo photos (spec-change; golden fixtures unchanged).**
- #653: `DEMO` in `docs/prototype/plate-and-bar.html` held 126 JPEGs (63 exercises, two photos each) labelled Free Exercise DB and claimed to be Unlicense, but their provenance is unknown. They are removed, so `DEMO` is empty and `demoHtml` returns nothing. The 32 of those 63 exercises with no movement diagram now show no visual in the how-to sheet and Learn mode; the other 31 show their diagram. The caption "Photos: Free Exercise DB (public domain)." is gone too.
- The app never ported these photos. Do not add visuals in the prototype: #653 replaces them with our own figures. No calculation changes, so no fixture changes.

**2026-10-18 — the session's "Muscles today" map keeps a tap for its own date only (deliberate difference; prototype and golden fixtures unchanged).**
- #769 (from #666 and PR #765, decided): the prototype's `sessionMapHtml` opens the map while no set is ticked, or when `S.ui.mapOpen` is set. Nothing writes `S.ui.mapOpen`, so a tap on the map lasts only until the next render, which sets it back to that default (a ticked set closes a map the user reopened). The flag also sits in the global `S.ui`, not per date. The app (`SessionView` in `apps/mobile/src/screens/WorkoutScreen.tsx`) starts from the same default (open until a set is ticked, then closed). Once the user taps, it keeps that choice through later ticks, and it keeps it only for the date on screen. `SessionView` is keyed by the workout date (`key={w.date}`), so moving to another date with the date bar, or a sync that loads another day's session, starts that date from the default again rather than carrying the tap over. A return to the first date also starts from the default. Tested in `apps/mobile/__tests__/workout-body-map.test.tsx` ("does not carry a tap choice to another day").

**2026-10-17 — custom exercise names match case-insensitively (deliberate difference; prototype and golden fixtures unchanged).**
- #665 (from #450, decided): the prototype checks a typed exercise name with exact case (`!TAGS[name]`), so "bench press" opens the tag sheet and makes a custom exercise. The app compares the typed name with every known exercise, built-in and custom, ignoring letter case (`exerciseNamed` in `apps/mobile/src/workout/catalog.ts`): typing "bench press" adds the built-in "Bench Press", and a custom exercise whose name is a known exercise in another letter case is refused at save. This avoids near-duplicate custom exercises. Only case is ignored: spaces and spelling still count, and when two known names differ only by case the first in catalog order wins.

**2026-10-17 — prototype copy: the health-check questions in our own words (spec-change; golden fixtures unchanged).**
- #716: `SCREEN_Q` in `docs/prototype/plate-and-bar.html` and `apps/mobile/src/setup/copy.ts` no longer paraphrase the PAR-Q+ (copyright of the PAR-Q+ Collaboration). Still six yes/no answers in the same slots, so the stored answers, `screenFlag`, the light-sessions rule and every result are identical. Old slot to new question: (1) heart condition or high blood pressure -> "Have you ever been diagnosed with a heart problem or high blood pressure?"; (2) chest pain -> "Does your chest hurt when you are resting or being active?"; (3) dizziness or loss of consciousness -> "In the last year, have you fainted, or felt so dizzy that you fell or nearly fell?"; (4) long-term condition or medicine for one -> "Do you live with a long-term health condition, or take regular medication for one?"; (5) bone, joint or muscle problem that more activity could make worse -> "Do you have a back, knee, shoulder or other bone, joint or muscle problem that being more active could make worse?"; (6) supervised exercise only -> "Has a doctor or other health professional said you should only exercise with supervision?".
- Pregnancy is not a seventh question: it stays the separate "Are you pregnant or breastfeeding?" field (`special`), which already triggers the same clearance rule.
- For v1 only, do not port the prototype's photo, form-check and lab copy that says frames or photos are sent for analysis when AI is on (`plate-and-bar.html` around lines 601, 2220 and 3192): v1 sends no photos (see the consent bullet), so that copy has no v1 counterpart. In v1.1 the three AI image calls (ADR 008) do send images: the meal photo (#997) sends the chosen photo, import recipe (#1002) can send a photo of a page (a text-only import sends none), and form check (#1003) sends 2 to 4 frames. Each sends nothing while it is switched off or without consent. See the 2026-10-19 entry on form check.
- The "Why a health check before training?" card says the questions are our own wording of the topics screening tools such as the PAR-Q+ cover; the PAR-Q+ stays only as the cited reference. The prototype body is updated, and `tools/cards-import` (`CARD_OVERRIDES.screening.from`) with it. The app's version of the card (`CARD_OVERRIDES.screening.set.body`, and so `content/cards.json`) also changed: it adds that the PAR-Q+ is our reference, that these questions are not taken from it, and that the official form is free at eparmedx.com, because the card prints the PAR-Q+ source line right under the body.

**2026-10-17 — prototype copy: no vendor name in user-facing text (spec-change; golden fixtures unchanged).**
- #673: v1 AI is text-only, provider-neutral and opt-in; it has no meal-photo estimation, camera form check or lab-report reading. Every user-facing "Claude" string in `docs/prototype/plate-and-bar.html` is reworded: "AI estimates", "AI suggestion", "Saved privately to your account", "never uploaded or sent anywhere", and the not-granted messages now say "needs you to turn on AI features". Behaviour is unchanged. The prototype's photo, form-check and lab-report paths stay as reference behaviour, but their copy is not ported to v1. The `window.claude` runtime hook in the prototype is code, not copy, and is unchanged. `apps/mobile` and `apps/site` already had no such wording.

**2026-10-17 — prototype fix: grams too small to log, and the custom-food, recipe and kitchen-test checks (spec-change; golden fixtures unchanged).**
- #150, the parts left after the day-complete fix. Each check stops the log or save and shows a toast; nothing is logged or saved. The toasts are the wording the app already shows for core's results (`apps/mobile/src/food/copy.ts`, `recipes/copy.ts`, `kitchen/copy.ts`; decided 2026-10-17, decisions delegated to Claude Code). Core already does each check (PRs #156, #211), and its prototype tests now compare exactly.
- `case 'pick'`: grams that round to 0 servings (such as 4 g paneer) are not logged: "That amount is too small to log. Enter more grams or use servings." Before, the prototype logged quantity 0, which the contract rejects (core `too-small`).
- `case 'addcustom'`, after the empty-name check: a trimmed name longer than 200 characters (the contract limit) gives "That name is too long. Shorten it." (core `name-too-long`). Then a negative calorie or macro value, or a quantity at or below 0, gives "Calories, macros and servings can’t be negative, and servings must be more than 0." (core `invalid`). Both come before "Enter calories or at least one macro.".
- `case 'rb-save'`, after the empty-name check: a name over 200 characters gives "That name is too long. Keep it under 200 characters.", then an ingredient amount below 0 gives "An amount can’t be below 0." (core `recipeFood`).
- `ktSave` (both "Save test" and "Save and use for my logging"), after the empty-name check: a name over 200 characters gives "That name is too long. Keep it under 200 characters.", then an ingredient amount, empty-pot, pot-with-food, cooked or serving weight below 0 gives "An amount or weight can’t be below 0." (core `kitchenTestFood`).
- No golden fixture covers these steps; `node golden-gen/cli.mjs` gives no diff. "Save as meal prep" (`case 'rb-prep'`) still saves the prep after `rb-save` refuses, as it already did for its other checks; it is not ported, so it is left as is.

**2026-10-17 — setup consent text matches the real design (spec-change; prototype behaviour and golden fixtures unchanged).**
- #361: the first-run consent said data is "saved privately to your Claude account" and that meal photos, recipe imports and form-check frames "are sent to Claude". Both were wrong (ADR 004, privacy page). New bullets: data stays on this device, and if you sign in it is also stored on our own server (upload needs sign-in plus a `data_storage` consent record, given by the setup tick or via "Agree and sync"); AI features are off by default and need their own opt-in, and no photos are sent anywhere. The prototype also gains the "Withdrawing your consent means deleting your account." bullet the app already had (#507). Section 7 reworded to match. The app is unreleased, so no re-consent flow is built; pre-launch test consent records should be wiped. The app's `CONSENT_TEXT_VERSION` is now `2026-10-17`; it applies to new consent records only, existing records keep their version.

**2026-10-17 — kept behaviours recorded (spec-change; prototype and golden fixtures unchanged).**
- Decisions to keep the prototype's behaviour, now written into the sections they belong to; nothing in `docs/prototype/plate-and-bar.html`, `docs/spec/golden/` or core changes. Section 1: setup limits checked before rounding (#131). Section 2: coverage meter simplifications (#155). Section 3: personal-best edge cases (#123), bodyweight rep targets, big-jump wording and returning plus deload stacking (#104). Section 5: food lookups by name, alias joining, `unitGrams` decimals, the unrounded added-sugar check, items counted as meals, Cola's sugar only in the eat-out table (#151), and grams logging by the bracketed weight (#97). Core already pins each one in its tests.

**2026-10-17 — prototype fix: a swap target or stored pick already in the session takes the next-best candidate (spec-change; golden fixtures unchanged).**
- #143 (extends #110): in `resolveSession`, a swap target (mapped for `where`) or a stored replacement pick that ends on a name already in the session is passed over. It is checked after mapping and following swaps. The names the template holds as they are always win, then earlier slots. An excluded exercise goes on to its stored pick, then its best candidate not in the session. A swapped exercise that is not excluded takes the best candidate from its own list (with chained swaps that list comes from the intermediate exercise, so the exercise swapped away from can come back at a lower rank; accepted). If no candidate is left, the slot goes into `lost` and the preview shows the "fewer sets" note. A stored skip still skips with no note. A swap whose ladder bridge is still running is not passed over: its target shows once and the old exercise stays as its 2-set bridge; once the bridge has ended the swap is passed over like any other. Example: Push A at the gym with Incline Dumbbell Press picked for Machine Chest Press now keeps 5 exercises (Push-ups takes the slot), where it dropped to 4 with no note. The settings sheet still offers every candidate. `resolveName` returns `false` (not `null`) when no candidate is left, so a skip and a lost slot are told apart. Core already does this (PR #595).

**2026-10-17 — prototype fix: "I know my weight" hides the find-your-weight guide (spec-change; golden fixtures unchanged).**
- #139: on a first-time loaded exercise, tapping "I know my weight" (`case 'ramp-skip'`) set `ex.skipRamp` but `exerciseCard` never read it, so the "First time: find your weight" guide came straight back. `exerciseCard` now shows the guide (and the ramp sets) only while `sug.mode === 'new'`, no working set is ticked and `!ex.skipRamp`. After the tap the card shows just the working sets, as the app already does (`ExerciseCard`, `skip_ramp`).

**2026-10-17 — prototype fix: a learn start after today counts as today (spec-change; golden fixtures regenerated).**
- #584: the daily read (`learnCardHtml`) counts the days since `learn.start` as `max(0, daysBetween(start, TODAY()))`, so a start after today (device clock moved back, or a start synced from a later time zone) gives 1 card due, as on the first day. Before, 1 to 3 days ahead showed nothing (0 due) and further ahead `slice(0, due)` with a negative due dropped cards off the end, so the next unread card showed at once. Core already does this (`dailyRead`, PR #605), and the app reads core's `dailyRead`.
- `learn.json` regenerated with `tools/golden-gen` (`node golden-gen/cli.mjs`): the cases now also cover starts 4 days and 1 day after today (`days` -4 and -1) for each profile and read set, all with 1 card due. This replaces the note in the learn-fixture entry below that future starts are left out.

**2026-10-17 — prototype fix: the day-complete fallback reads days before today only (spec-change; golden fixtures unchanged).**
- #150: `dayComplete(d, date)` now takes the day's date. A day the user has not ticked counts as complete by the fallback (3 or more items and at least 75% of the settings calorie target) only when it is before today (`TODAY()`); today, or a later day, is complete only by the tick, as section 5 says. `adaptiveBurn` passes each day's date, so the real-burn estimate no longer counts a half-logged today. Core already does this (`dayComplete(..., date, today)`, PR #594). No golden fixture covers `dayComplete`. The rest of #150 (grams that round to 0 servings, and the custom-food checks) is not in this change.

**2026-10-17 — golden fixtures: learn cases, sessions inputs recorded, wider plan cases (spec-change; prototype unchanged).**
- Regenerated with `tools/golden-gen` (`node golden-gen/cli.mjs`); `docs/prototype/plate-and-bar.html` is not changed in this entry.
- #552: new `docs/spec/golden/learn.json`, run through the prototype's own `LEARN` and `learnCardHtml`. `order` is the daily-read list for a male profile, a female profile (the card `bulky` inserted at index 6) and no profile. `cases` give, for each of those, the days since the learn start (0, 2, 3, 6, 12, 30) and eight read sets (none, one or three cards, only the female card, ids not in the list, all but the last, all), the number of cards due (`min(n, 1 + floor(days / 3))`: 1, 1, 2, 3, 5, 11 for a male profile), the card offered (`null` when every due card is read) and the "N of M done" numbers. Hidden cards (#212) are an app filter and are not in the fixture. Future starts are not in it either: #584 (a start after today counts as today) is a decided exception to the prototype.
- #74: every `sessions.json` case now records its input (where, template, minutes, experience, focus, and how many sessions of that template are stored, which sets the rotation offset). The fixture is a list of `{ id, input, output }`, no longer an object keyed by case name. New cases: a focus muscle the trimmed session lacks (abs on Pull A adds an exercise), non-zero rotation, 30, 60, 75 and 90 minutes on Legs A (3 and 5 exercises; 75 and 90 minutes give the same 6, because Legs A has only 6), a new lifter's focus pick, and 60+ profiles (ages 59, 60, 65 and 72: from 60 the Single-Leg Balance exercise is added at the end, as `buildSession` does). `plan.json` now has 0, 1 and 7 training days, and `cases`: sequence mode (no history, after a session, wrapping the list, 0 days) and a week plan (nothing done, one done, list used up, a plan for next week only), each over 8 dates. In sequence mode every day except Sunday shows the same template, Monday included, until a session is logged: that is the prototype's plain output.
- #74: all three acceptance items are covered; nothing is left open. Not recorded: set counts, the check-in "short session" cut and exclusions, which come after the exercise list.

**2026-10-17 — prototype fix (a11y; spec-change; golden fixtures unchanged).**
- #503: the Seven-days bar's `aria-label` (`renderProgress`) named no day and read "0 kcal, 0 g protein" on a day with nothing logged, as if the user had eaten nothing. It now names the day and says "not logged" for a blank day: "Thu, 2,400 kcal, 90 g protein", "Wed, not logged", "Thu, trained, not logged" (a session-only day). The app already announces this (`WeekCard`).

**2026-10-09 — prototype fix, batch 10 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #267: in the "can't do" flow (`applyCant`'s `replaceAt`), the replacement takes the part of the exercise it replaces (`nx.part = ex.part`), whether it takes its place or goes after its ticked sets. A pick for a second-session exercise stays in the second session, so the "Second session" heading no longer moves below it or shows twice. Exercises added in other ways are unchanged.
- #272: `candidates` with no `o.where` uses where the user trains today (`whereNow()`: the day's override, else the profile's, else gym) instead of the day's override, else gym. Its two callers without a `where`, the "can't do" sheet's pick list (`renderCant`) and `applyCant`'s "caught by a wider rule" loop, no longer offer or insert gym-only exercises for a user whose profile says dumbbells or bodyweight. Session building (`resolveName`) already passed `where`; unchanged.

**2026-10-09 — prototype fix (spec-change; golden fixtures unchanged).**
- #275: the `balance` exercise family had no entry in `FAMILY`, so a replacement rule scoped to it would read "All undefined". `FAMILY.balance` is now 'balance variations' (so the scope reads "All balance variations"). The family and pattern labels are exported to `content/labels.json` (`families`, `patterns`) by the cards/labels importer.

**2026-10-09 — prototype fix, batch 9 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #262: the stall card's "Or switch to …" swap (`sidewaysOf`) offers only exercises the equipment where the user trains today can do (`whereNow()`: the day's override, else the profile's), with the same rule as `candidates`: at the gym anything; with dumbbells, dumbbell and bodyweight exercises; bodyweight, bodyweight only. Both steps are filtered: another exercise on the same ladder step, else the first catalogue exercise of the same family and difficulty; excluded exercises are still skipped. A swap that resolves back to the same exercise is no longer offered: with dumbbells, Lateral Raise, Crunch and Dumbbell Fly get no button (they offered Cable Lateral Raise, Cable Crunch and Cable Crossover), Rear Delt Fly offers Prone Y-T-W Raise instead of Face Pull, and Goblet Squat offers Bodyweight Squat instead of Leg Press.

**2026-10-09 — prototype fix, batch 8 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #239: the weekly meal plan (`buildPlan`) applies the 60+ rule as the next-meal ideas (`nextMealInfo`) do. At age 60 and over, breakfast, lunch and dinner aim for `max(25, protein × PROT_W[meal])` g protein when the day's protein target is 25 g or more; snacks keep their share. A 65-year-old on 80 g now gets plan ideas aimed at 25 g for each main meal, where the shares are 20, 24 and 24 g.
- #240: "Copy as text" on the grocery list (`grocerySheet`, `S.ui.grocText`) lists the items in the same sorted order as the list on screen, not in the order they first appear in the plan.

**2026-10-09 — prototype fix, batch 7 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #246: on saving a weigh-in (`case 'saveW'`), the scale-jump note compares the saved value (`r1` of what was typed) with the latest weigh-in in the 3 days before, with the rise rounded to 0.1 kg: `r1(saved − previous) >= 0.8`. 80.8 after 80.0 (0.7999999999999972 in floating point) now shows "The scale went up 0.8 kg", and 80.76 (saved as 80.8) does too; 80.74 (saved as 80.7) does not. The note stores the rounded rise. As before, a later save that is not a jump does not clear an earlier note for the day; it stays until "Got it". When the rounded change is 0, the weight chart (`weightChart`) reads "No change since 1 Oct." instead of "Down 0 kg since 1 Oct.", and the waist line (`measuresHtml`) reads "No change in waist since 1 Oct." instead of "Waist down 0 cm since 1 Oct.".
- #247: a weigh-in is saved only when the rounded value is above 20 and below 400 kg (the contract's `Weight.weight_kg` exclusive bounds), so 20.01–20.04 and 399.95–399.99, which round to 20.0 and 400.0, get "Enter your weight in kg, like 81.6". The hours-slept box (`enSleep`) saves the hours as a number (`num`) when they are 0 to 24 (the contract's `DayNote.sleep`). A blank box clears the hours. Text that is not a number (`parseFloat` gives NaN, after a comma becomes a decimal point) or hours outside 0–24 are not saved, and the stored value stays. Text that starts with a number reads as `parseFloat` does: "7 h" saves 7.

**2026-10-09 — prototype fix, batch 6 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #209: the Targets screen's "Recalculate" note (`setupSummaryHtml`) compares the gap between the latest weigh-in and the setup weight rounded to 0.1 kg, as the note shows it: `Math.round(|latest − setup| × 10) / 10 >= 2`. A 2.0 kg gap such as 64.1 vs 62.1 kg (1.999999999999993 in floating point) now offers Recalculate; 81.95 vs 80 counts (shown as 2 kg) and 81.94 does not.
- #215: in the weekly check-in (`renderCheckin`), the planned count is this week's plan length, else the profile's plan length (`planList()`: the profile's training days, 6 with no profile, 0 at 0 days), not a fixed 6. A 3-day user who trains 3 times sees "3 / 3" and no shorter-week card. The "A shorter week might fit better" card, which offers a 4-day plan next week, needs a planned count above 4 (so a user on 4 days or fewer, including 0, never gets it), and is blocked only by a week plan for this week or a later one (`weekPlan.start >= mondayOf(S.date)`); a past week plan, which is never deleted, no longer blocks it for good.

**2026-10-09 — prototype fix, batch 5 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #213: `unitGrams` reads a gram weight written with en-US or en-IN digit grouping ("1 plate (1,250 g)" is 1250, "1,00,000 g" is 100000), so a kitchen-test food of 1,000 g or more logs by grams correctly (it read 250). Only real grouping counts: a comma that is not ("1,5 g", "1,25 g", "0,500 g") reads the digits after it, as before, and decimals still lose their whole part ("1.5 g" is 5).
- #214: `ktCalc` takes cooked weight = pot with food − empty pot when pot with food is non-zero and the empty pot is a number, so an empty pot of 0 g (a tared scale) gives cooked weight = pot with food. A blank or non-numeric empty pot still gives no cooked weight.

**2026-10-09 — prototype fix, batch 4 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #178: the flex note and its Undo on a day use the most recent plan whose extra (its positive entry) is on that day (`flexPlanFor`; plans are added at the end of `settings.flex`, so it is the last such entry). The note shows that plan's extra ("Today's target includes +300 kcal for a bigger meal, ..."), not the day's net sum, and Undo removes that plan. A day with no plan's extra on it (only cuts) shows "Today's target is 160 kcal lower to balance an earlier bigger day." with no Undo; its cuts are undone from the day that got the extra.
- #176: Undo (`undoFlex`) removes the plan's entries, then checks each of that plan's days with the `planFlex` floor rule (`calcTargets` floor, or 1200 with no profile; the target is the lower of `kcalTarget(day)` and the saved target plus that day's flex entries, so other plans and the lab hold count). On a day below the floor the shortfall, rounded up to 10, is taken off the cuts left on that day, the most recent cut first; a cut trimmed to 0 is removed. The trimmed calories are simply not cut. If the saved target alone is below the floor, every cut on that day goes.

**2026-10-08 — prototype fix, batch 3 (spec-change; golden fixtures unchanged, hand-worked cases in core's tests until the generator lands, #99).**
- #167: `planFlex` never takes a day below the minimum (`calcTargets` floor, or 1200 with no profile). Entries dated before `TODAY()` - 7 are dropped first (unchanged: counted from today, not the planned day). Each of the next 6 days has room = its target minus the floor, rounded down to 10, never below 0; the target is the lower of `kcalTarget(day)` and the saved target plus that day's flex entries, so other flex plans count and a cut made during a lab hold stays safe when the hold ends. The spread is the first of 3 to 6 days where each of those days has room for `extra / days` rounded down to 10; each takes that cut, so the cuts never total more than the extra (+800 is 3 × 260). If no even spread fits, the 6 days are filled level, in steps of 10, each up to its room, never more than the extra in total; a day with no room gets no entry. Whatever does not fit with all 6 days at their room is not cut, today still gets the whole extra, and the toast says so: "Today +800 kcal; the next 6 days 100 lower; 200 kcal could not be spread without going below your minimum". Uneven cuts read "the next 6 days up to 220 lower".

**2026-10-08 — prototype fixes, batch 2 (spec-change; golden fixtures unchanged).**
- #103: on assisted machines (effective load = bodyweight − assistance, bodyweight = the profile's weight), `applyMods` gives a bridge exercise one assistance step more than its old top, and a returning exercise 55% of its old effective load: assistance = bodyweight − 0.55 × (bodyweight − old top assistance), snapped to the machine's step. With no profile weight, returning keeps the old rule (suggestion + 45% of it).
- #109: swap targets and stored replacement picks are mapped for the current `where` (`homeName`): at the gym unchanged; away from it, the away-map version (dumbbells or bodyweight column), else the exercise itself when its equipment is there (untagged exercises pass, as in `mapForWhere`), else none, and then the original stays (a swap is not followed; a pick falls back to the best candidate for `where`). A stored pick is followed through swaps. When several active rules cover an exercise, the pick comes from the most specific rule holding one for it, narrowest scope first: exercise, family, pattern, joint (`SCOPE_RANK`; list order breaks ties). Candidate weighting (joint, pain) still uses the first matching rule. No bridge once the swap target is itself swapped or replaced: unchanged.
- #110: `resolveSession` first resolves every name that needs no candidate; a candidate for an excluded exercise then leaves out every name already in the session (those names, their bridges, and candidates picked for earlier slots), so the next-best one is used. If none is left the slot stays empty and the session preview says "<name> is left out with no replacement, so your <muscles> get fewer sets each week." A skip the user chose shows no note.
- #122: assisted session scores are `reps × max(0, bodyweight − assistance)` with the profile's weight (higher is better, never negative); with no profile weight, the old `reps × 2 − assistance`. Old history entries are not rescored. When no counted sets remain today, `updateLift` removes today's record: it restores the session before from `prev` (date, sets, form and its one-level `prev`; `n` one less; `first` and `pbToast` kept; today's score dropped from `hist`), or deletes the record if there was none. A record whose `pbToast` is today keeps it, so re-ticking does not toast twice. When the history already held 8 entries, today's first tick dropped the oldest and unticking does not bring it back (accepted).

**2026-10-08 — prototype fixes (spec-change; golden fixtures unchanged).**
- #101: "Below the range two sessions running → drop" reads sessions before today only (`prevOf`), so ticking today's first set no longer flips the advice from drop to hold. To keep that session, `updateLift` now stores the earlier session's own `prev` (one level, as `{date, sets, form}`) inside the new record's `prev` when a new day starts.
- #102: the bodyweight "+kg" value carried to the next set is parsed with `num()` (`setTarget`), so "2,5" gives 2.5 instead of "NaN"; an empty field stays empty.
- #121: `updateLift` keeps `pbToast` when the existing record is from the same date, so the personal-best toast shows at most once a day per lift.
- #129: at 0 training days, setup (`validateStep` step 2) saves `exp` and `minutes` as null and `where` as `gym` when not picked; it still does not ask where you train. A stale "New to lifting" no longer triggers the beginner ramp on hand-picked sessions or changes which focus exercises are picked (`focusPick`).

These change the scope table in the Development Plan. Treat them as v1 unless marked otherwise.

| Change | Area | Agents affected |
| --- | --- | --- |
| Food data: USDA SR28 (public domain) + own recipes + FSSAI standards. **No IFCT or INDB data anywhere.** Carbs are **total carbs including fibre**. | Food | Content, Core |
| Plan engine picks the split from training days; session length caps exercises; experience sets beginner volume | Training | Core, App |
| "Where do you train?" (gym / home dumbbells / home bodyweight) with home exercise mapping and bodyweight ladders | Training | Core, Content, App |
| Focus muscles (max 3): +1 set, earlier in session, added exercise on matching days | Training | Core, App |
| Session preview shows the exact session (after trim, focus, exclusions, home mapping) with a Start button beside it | Training | App |
| Rest timer (2–3 min compounds, 60–90 s isolation), warm-up line on first compound | Training | Core, App |
| Health check (PAR-Q+ topics) in setup; any "yes" or pregnancy → light sessions until "doctor cleared" | Setup | Core, App |
| First-run consent screen; export and delete everything | Platform | App, Backend |
| Offline-first saving with a pending queue and "not synced" badge | Platform | App |
| Grams logging, Hindi/everyday food names, drinks (alcohol) | Food | Content, App |
| Fibre, fruit & veg servings, added sugar; "day complete" flag (only complete days feed the real-burn estimate) | Food | Core, App |
| Kitchen tests (weighed dishes) | Food | App, Backend |
| Steps target, sleep log, cardio vs WHO 150 min in weekly check-in | Progress | Core, App |
| Gentle habits (weeks on track, not streaks), personal-best toast, second session in a day | Training/Progress | App |
| Adults 60+: balance exercise, 5% max jumps, ≥25 g protein per main meal | Core | Core |
| "No training yet" (0 days) means no plan; sessions are picked by hand | Training | Core |
| Ticking or rating a set must not move the screen: keep the tapped set row at the same position after the list re-renders | Training | App |

---

## 1. Setup and targets  → fixture `targets.json`

**Inputs:** sex, age (18–90), height (cm or ft/in), weight, activity (`sitting|light|feet|physical`), where (`gym|dumbbells|bodyweight`), days (0–7), experience (`new|some|exp`), minutes (30/45/60/75/90), goal (`lose|recomp|maintain|gain`), pace (`gentle|moderate`), pregnancy/breastfeeding (women), 6 health-check answers.

**Calculation (`calcTargets`)**
- BMR: Mifflin-St Jeor `10·kg + 6.25·cm − 5·age + (male ? 5 : −161)`.
- Movement: `BMR × {sitting .15, light .30, feet .45, physical .60}`.
- Training/day: `days × (minutes/60) × 4 × kg / 7` (≈5 METs lifting, net of resting 1).
- TDEE = (BMR + movement + training) / 0.9 (digestion ≈ 10%).
- Goal adjustment: lose gentle −15%, lose moderate −20%, recomp −10%, maintain 0, gain +7%. Pregnant/breastfeeding: never a deficit.
- Deficit capped at 750 kcal; floor 1,500 (men) / 1,200 (women), never above TDEE before rounding. Round to 10.
- Protein: 2.0 g/kg (lose, recomp) else 1.8 g/kg, on a reference weight at BMI 27 when BMI > 30; rounded to 5.
- Fat: max(25% of kcal, 0.6 g/kg). Carbs: the rest.

**Fixture rounding.** The golden fixtures store some values rounded; ports compare after applying the same rounding. Inferred from the data and the prototype, since the generator that wrote them is not in the repo.

`targets.json` (prototype keys `refW` and `weekly` are stored as `refWeight` and `weeklyKg`):
- `tdee`, `bmr`, `movement`, `training`, `digestion`: `calcTargets` returns them unrounded; the fixture stores whole kcal, `Math.round` (the prototype's `fmt`, as the screen shows them).
- `kcal`: rounded to 10 and `protein` to 5 by `calcTargets` itself; `carbs` and `fat` come out whole from `calcTargets`.
- `refWeight`: whole in every current case because every fixture weight is whole; `calcTargets` returns the body weight unchanged when BMI is 30 or below, so ports round it with `Math.round` before comparing.
- `weeklyKg`: 2 decimals, `Math.round(x * 100) / 100` (`toFixed(2)` agrees on every current case). The screen shows 1 decimal; the fixture keeps 2.
- Negative zero is stored as `0` (two current cases produce `-0`); normalise before comparing with `Object.is`.

`formulas.json`: `navyBodyFat` is rounded to 1 decimal (`navyBF` returns 25.2156 and 32.3715; the fixture stores 25.2 and 32.4), although the screen shows a whole percentage. Water, fibre and workout burn come out whole from the prototype.

Other fixtures: `plan.json`, `sessions.json` and `exercises.json` hold no fractional numbers; `foods.json` and `progression.json` hold at most one decimal, as the prototype holds them.

**Floor and rounding (decided on #41).** A floored target is `min(floor, TDEE)`, then rounded to 10. When TDEE is at or above the floor the target is exactly the floor. When TDEE is below the floor the target is TDEE rounded to the nearest 10: up to 5 kcal above TDEE (TDEE 1,195 gives 1,200) or below it, and below the floor itself (TDEE 1,150 gives 1,150). Kept: such users eat at maintenance, and the rounding gap is at most 5 kcal.

**Limits before rounding (decided on #131).** Setup (`validateStep` step 0) checks height (120–230 cm, from cm or ft/in) and weight (30–300 kg) on the values as typed, then saves height rounded to 0.1 cm and weight to 0.1 kg. So 29.96 kg and 119.96 cm are rejected although they would save as 30.0 kg and 120.0 cm. Kept: the values sit at the edge of the range and the user can type the rounded value.

**Health check:** any "yes" or pregnancy → `needsClearance` until the user taps "My doctor has cleared me": sessions are light (one fewer set, no weight increases) and a card explains why.

---

## 2. Plan engine  → fixtures `plan.json`, `sessions.json`

| Days | Split | Weekdays (Mon=1) |
| --- | --- | --- |
| 0 | No plan | — |
| 2 | Full body A, B | 1, 4 |
| 3 | Full body A, B, C | 1, 3, 5 |
| 4 | Upper A, Lower A, Upper B, Lower B | 1, 2, 4, 5 |
| 5 | Push A, Pull A, Legs A, Upper B, Lower B | 1, 2, 3, 5, 6 |
| 6 or 7 | Push/Pull/Legs A and B | 1–6 |

Session build order (`buildSession`):
1. Template → home mapping (`AWAY` table) if `where` is not gym (day override beats profile).
2. Exclusions and swaps resolve each name (`resolveSession`; swap targets and picks mapped for `where`; replacements, swap targets and picks not already in the session, else the next-best candidate, else a "fewer sets" note, #110, #143; a swap with a running bridge is kept, its old exercise staying as the 2-set bridge; a stored skip still skips with no note); ladder "bridge" exercises appended with 2 sets for 2 weeks.
3. Trim to the exercise cap (30 min → 3, 45 → 4, 60 → 5, 75 → 6, 90 → 7). The first 2 lifts always stay; the extras **rotate** by how many times this template was done (`trimSession`).
4. Focus muscles (`applyFocus`), then the check-in "short session" cut.
5. Sets: 3 default; 2 for `exp=new` in the first 14 days from profile creation; calf raises at least 4; +1 on focus exercises (max 5). Deload: ~60% of sets. Light day: −1 set.
6. Age 60+: append "Single-Leg Balance (seconds)", 2 sets.

Weekly coverage meter: planned (from templates) and done (last 7 days of logged sets). Primary muscle = 1 per set, secondary = 0.5. Under 6 is flagged; ~10 is the target, 12–16 for focus muscles.

**Coverage meter simplifications (decided on #155: kept for M0).** The meter is a weekly guide, so the prototype's shortcuts stay:
- The planned meter (`weeklyCoverage`) counts every exercise of each template at 3 sets (a bridge at 2). It ignores the session-length cap, focus additions, the beginner 2-set fortnight, calf raises at 4, the 60+ balance exercise, and deload or light days, so short sessions are overstated.
- It maps templates for the profile's `where` (`homeWhere()`), not a day's override.
- Untagged exercises count nothing.
- Focus toggling (`focusAction`) checks the whole stored focus list against the limit of 3, while the picker shows its first 3 (`focusList`). The contract caps focus at 3.
- Front shoulders, forearms and lower back are counted but never shown (`COVER_SHOW`) or offered as focus muscles.

Still open (#155): after M0, the planned count may move to the built session's real set counts. That would be a prototype spec change first.

**Missing training days (decided on #72).** `splitFor` treats `days === 0` as no plan but a missing or null `days` as the full 6-day plan, while `calcTargets` treats null as 0 training days. Kept as is: setup makes days (0 to 7) a required answer, so a set-up profile always has it; the case only arises before setup or with damaged data.

**Rotation counting (decided on #73).** `trimSession` counts every stored session entry for the template, whatever its date. Entries are stored only while at least one work set (not warm-up) is done (`saveDay` deletes the entry when sets return to 0), so empty entries never occur. Today's preview is shown only while today has no exercises, so today's own entry never shifts it; a started workout's exercises are fixed when built on Start. Because counting ignores dates, a past day's preview also counts later sessions, and a second session of the same template counts today's entry. Kept as is (and again on #104).

---

## 3. Weight guidance  → fixture `progression.json`

- Per exercise metadata: type, rep range, step (`EX_META`, `DEFAULT_STEP`). Home dumbbells raise dumbbell ranges to at least 10–20.
- Double progression (`suggestBase`): top of range on every set with no Hard/Fail → +1 step (assisted: −1 step of assistance). Below range twice running, or a failed set → drop ~7.5% (≥ 1 step). Else same weight, +1 rep target.
- Holds: first 14 days on an exercise (unless all sets rated Easy); last session's form = "no".
- Jumps over 10% (5% for age 60+) carry a "go back and add reps" fallback.
- Modifiers (`applyMods`): returning after an exclusion → 55% of old top for 2 weeks; bridge → 85% (assisted: see section 0, #103); deload −10%; re-entry after a break −15% or −30%.
- In-session: Easy → next set +1 step; Couldn't finish → −10%; ticking an empty set uses the placeholder.
- Find-your-weight ramp for first-time loaded exercises: Easy → add a step and another ramp set; Just right → working weight; Hard → one step lighter; Fail → previous ramp weight.
- Stall: best session score (Epley `w·(1+r/30)`; bodyweight = total reps; assisted = `max(r·max(0, bodyweight − assist))`, or `max(r·2 − assist)` with no profile weight) not beating the earlier best by >1% for 3 sessions. 3+ stalled lifts → recovery-week card.
- Personal best: new session score > previous best × 1.005 → toast once a day per lift.

**Personal-best edge cases (decided on #123: kept).**
- A lift whose earlier scores are all 0 never records a best: the check needs a non-zero earlier best.
- Exactly 0.5% better counts as a best, because `100 × 1.005` is `100.49999…` in floating point.
- Bodyweight scores are total reps, so one extra easy set counts as a best.

**Kept on #104.**
- Bodyweight rep targets go up by one rep from last time and are not raised to the bottom of the range (3 reps last time gives a target of 4 on an 8–20 range). Loaded lifts are raised to the bottom of the range.
- The big-jump fallback says "go back to X kg and add reps instead" with plain "kg", without "each" (dumbbells) or "assist" (assisted machines).
- Returning (55% of the old top) and deload (−10%) stack, to about 50% of the old top. This errs light.

---

## 4. Exclusions, swaps, ladders  → fixture `exercises.json`

- Exclusion scope: exercise, family, movement pattern, or joint; duration: today, 2 weeks, 4 weeks, permanent. Re-check card when a timed rule ends.
- Replacement scoring (`candidates`): shared primary muscles ×10, shared secondary ×2, same pattern +6, joint-stress and difficulty penalties, history +2, equipment filter by `where`.
- Ladders (`LADDERS`): step-up card after ≥4 sessions at the top of the range with good ratings and solid form; 2-week bridge; step-down after two bad sessions; "stay" re-asks after 6 weeks.
- Custom exercises: Claude suggests tags (pattern, equipment, muscles, joints); user confirms on a body map; stored per user. A typed name that matches a known exercise in any letter case is that exercise, not a new custom one (differs from the prototype's exact-case check, #665).

---

## 5. Food  → fixture `foods.json`

- All values per serving; carbs include fibre. Grams entry works for foods whose unit is in grams.
- Grams logging (decided on #97: kept) reads the grams from the serving label, including a bracketed ingredient or dry weight (`unitGrams`): "1 medium (30 g atta)" is 30 g, rice 50 g raw, dal 35 g, rajma/chole 40 g dry. So typed grams mean that weight, and 60 g of cooked rice logs 1.2 servings. The app says so in the hint under the grams input ("Grams are the weight in the brackets on the serving (the dry or ingredient weight, such as "50 g raw"), not the cooked weight.") and shows each food's own label on its row, such as "1 cup (50 g raw)". No per-food toast: the "Added Rice, cooked (60 g)" toast stays as the prototype has it. No content change.
- Search matches name or alias (`ALIAS`: chawal, anda, dahi, daru…).
- Fibre target: max(25 g, 15 g per 1,000 kcal of today's target). Fruit & veg servings out of 5. Added sugar shown when ≥10 g.
- Meal ideas (`combos`): protein shortfall weighted 3× calorie error; caps per food (`MAXQ`), minimum portions (`MINQ`); age 60+ ≥25 g protein per main meal; diet filter any/egg/veg; fasting-day pool.
- Day complete: user tick, or for older days ≥3 meals and ≥75% of target. Only complete days feed the real-burn estimate.
- Recipes: raw ingredients per 100 g (`RAW`, `RAW_FIB`), cooked yield by katoris (150 g) or pot weight.
- Kitchen tests: pot weights → cooked weight; per 100 g and per serving; "use for my logging" writes a personal food.
- Logging and saving checks (#150): grams that round to 0 servings are not logged; a custom food, recipe or kitchen test with a trimmed name over 200 characters, or a negative amount or value (a custom-food quantity at or below 0), is not saved.

**Kept on #151.**
- Fibre, added sugar and fruit and veg are looked up by the logged item's name, not a food id, so a custom log named like a shared food gets the shared food's values. For fibre and added sugar a shared food's entry wins over a user food of the same name (`fibOf`); for fruit and veg the shared value wins only when it is not 0, so a shared 0 lets the user food's value count (`produceOf`). Revisiting `food_id` lookups when the sync client lands is tracked in #648.
- Search matches a food's aliases as one string joined with spaces, so a query can span two aliases ("fulka rotli" finds Roti / chapati).
- `unitGrams` reads whole numbers only: a decimal loses its whole part ("1.5 g" reads 5). No content label has a decimal gram weight.
- The added-sugar line checks the unrounded total, so 9.6 g is hidden although it would show as 10 g.
- "≥3 meals" for a complete day counts logged items, not meal slots: three items in one meal count as three.
- Cola's added sugar (35 g for "Cola (330 ml)") is in the eat-out table only. The eat-out dishes carry fibre and added sugar from the prototype's `FIB` (#858), and the Food totals count them by logged name, as the prototype's `fibOf` does (#866), so a logged Cola counts 35 g.

---

## 6. Progress and coaching  → fixture `formulas.json`

- Real burn: average intake on complete days − (weight trend slope × 7,700 kcal/kg); needs ≥10 complete days in 14 and ≥6 weigh-ins in 21; smoothed 60/40 with last week. Suggest a calorie change only if the new target differs by ≥100 kcal.
- Rapid loss: weekly average down >1% for 2 weeks (or 1 week plus 2+ stalls) → suggest +150 kcal.
- Navy body fat, water target (33 ml/kg + 600 on training days), workout burn (session time × 5 METs; extra over resting at 4), steps target (recent average + 1,000, 5k–12k).
- Habits: on-track weeks = consecutive weeks with ≥ (plan days − 1, min 2) sessions.

---

## 7. Privacy rules (non-negotiable)

- Progress photos, cycle log, lab reports: device only, never sent to the server or Claude.
- Data stays on the device. Upload needs sign-in plus a `data_storage` consent record, given at setup or via "Agree and sync"; then it is stored on our own server. AI features are off by default and need their own opt-in. In v1 no photos (meal, progress or form-check) are sent anywhere. In v1.1 the three AI image calls (ADR 008) send images, each behind its own server flag and AI consent, and nothing while it is switched off or without consent: the meal photo (#997) sends the chosen photo; import recipe (#1002) can send a photo of a page, and a text-only import sends none; form check (#1003) sends 2 to 4 frames and the exercise name only, never the video (see the 2026-10-19 entry on form check). Progress photos stay on the device.
- Lab reports, if ever shipped, stay out of v1 public (medical and legal review first).
- No health data in logs. Export and delete must cover everything.
