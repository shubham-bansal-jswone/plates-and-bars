# @plate-and-bar/core

The app's rules (targets, plan engine, progression, burn, food maths) ported from the prototype
(`docs/prototype/plate-and-bar.html`) into pure TypeScript. No DOM, no storage, no I/O, no clock:
anything that depends on the date takes `now` as an argument. The app and backend import rules from
here instead of re-typing numbers.

Each export in `src/index.ts` names the prototype function it mirrors. The port keeps the prototype's
behaviour exactly, rounding included. Where the prototype looks wrong, the behaviour is kept, pinned
by a test marked `PINNED QUIRK`, and raised as a `spec-question` issue.

## What's here

| Area | Exports | Prototype | Fixture |
| --- | --- | --- | --- |
| Setup targets | `calcTargets`, `bmrOf`, `ACTIVITY_MULTIPLIER`, `PACE_ADJ`, `TRAIN_NET_MET` | `calcTargets`, `bmrOf`, `ACTIVITY`, `PACE`, `TRAIN_NET_MET` | `targets.json` |
| Health check | `needsClearance`, `screenFlag` | `needsClearance`, `screenFlag` | none (unit tests) |
| Plan engine | `planned`, `splitFor`, `planList`, `dayTemplate`, `exerciseCap`, `beginnerRamp`, `older`, `TEMPLATES`, `ORDER`, `SPLITS` | same names (`beginnerRamp` is inline in `setsFor`) | `plan.json` |
| Session building | `mapForWhere` (home mapping), `trimSession`, `applyFocus`, `focusPick`, `isFocus`, `muscleAllowed`, `shortSession`, `setsFor`, `sessionSets`, `COMPOUND`, `BALANCE_EXERCISE` | same names; `shortSession` and `sessionSets` are the inline steps of `buildSession` | `sessions.json` |
| Exclusions and swaps | `resolveSession`, `resolveName`, `candidates`, `ruleMatches`, `activeRules`, `isExcluded`, `replFromSwaps` | same names; `replFromSwaps` builds `settings.repl` from contract swaps | `exercises.json` (catalogue only; differential tests) |
| Weight guidance | `suggestBase`, `applyMods`, `setTarget`, `tickFill`, `rampRate`, `rampTickFill`, `exInfo`, `lastFor`, `snap`, `harder`, `easier`, `kgLabel`, `noLoad`, `repWord`, `DEFAULT_STEP` | same names; `tickFill`, `rampRate`, `rampTickFill` are the `tick`, ramp `rate` and `ramp-tick` steps of `workoutAction` | `progression.json` |
| Stalls and personal bests | `sessionScore`, `stalled`, `stalledList`, `inRange`, `recoveryCard`, `recoveryWeek`, `stallCard`, `stallRange`, `checkBest`, `updateLift` | same names; `recoveryCard` is the stall step of `renderStart`, `recoveryWeek` and `stallRange` the `adj-deload` and `adj-range` steps of `adjAction` | none (differential tests) |
| Helpers | `num`, `mondayOf`, `daysBetween`, `weekdayOf`, `addDays` | `num`, `mondayOf`, `daysBetween`, `parseYmd(d).getDay()`, `addDays` | none |

`calcTargets` returns the same fields as the prototype, unrounded where the prototype leaves them
unrounded (bmr, movement, training, digestion, tdee, weekly). Display them with `Math.round`, as the
prototype's `fmt` does. `kcal`, `protein`, `fat` and `carbs` come back already rounded.

The session rules read exercise content (prototype `TAGS`, `CARDS`, `AWAY`) through an
`ExerciseCatalog` argument instead of copying it: that data belongs to `content/` (spec item 4). Pass
`content/exercises.json` as is: tags use content's names (`pattern`, `family`, `equipment`,
`difficulty`, `primary`, `secondary`, `joints`) and the away map is read from
`away_map.dumbbells_bodyweight`; of `cards`, only whether a name has one is read. Tests build the
catalogue from `golden/exercises.json`, renaming the prototype's short tag names in
`test/prototype-plan.ts`, and a test checks that content/exercises.json matches it. `resolveSession` takes exclusions and swaps in the
contract's `Exclusion` and `Swap` shapes (records with `deleted_at` set are ignored; `until` is not read,
as in the prototype) and returns the items `trimSession` expects; pass `replFromSwaps(swaps)` as
`trimSession`'s `repl`. `candidates` returns the facts behind the prototype's `why` text, not the text. Merge custom-exercise
tags into `catalog.tags` first, as prototype `applyCustomTags` does. `candidates` leaves out only the
names passed in `inSession` (the prototype leaves out today's workout by default).

The weight guidance reads prototype `EX_META` (`name → [type, lo, hi]`) through a `meta` argument.
content/exercises.json does not carry it yet, so tests pass golden/progression.json's `exerciseMeta`,
and a test checks it equals the prototype's `EX_META`.

Stalls and personal bests read each lift's `hist` (scores rounded to 0.1, last 8) and `pbToast`
(contract `LiftStat.history` with `score`, and `pb_toast_date`). `updateLift` writes both, as the
prototype does after every tick, rating or form change, except that a same-day record keeps its
`pbToast` so the best toast shows at most once a day (#121; the prototype follows in a spec-change PR). Cards come back as facts (key, names, rep
range), not HTML; the stall card's "Or switch to …" button (`sidewaysOf`) waits for the ladder port.

## Running

Node 20 or later.

```sh
npm ci
npm run lint          # tsc --noEmit (no eslint yet)
npm run typecheck     # tsc --noEmit
npm test              # jest
npm run test:coverage # jest with a 90% line-coverage threshold
```

## How the golden tests work

`docs/spec/golden/<area>.json` holds input/output pairs generated from the prototype. Tests load them
from the repo root (`test/helpers.ts`, `loadGolden`) and check every case. Never edit or regenerate
these files here; a prototype change lands them in a `spec-change` PR, and this package follows.

The fixtures store display-rounded numbers, so the test projects the port's result onto the fixture
shape before comparing (`toGolden` in `test/targets.test.ts`): energy values with `Math.round`,
`weeklyKg` to 2 decimals, `refWeight` from `refW`.
The fixture does not say how `weeklyKg` was rounded. The test uses `Math.round(x * 100) / 100`.
`Number(x.toFixed(2))` gives the same result for every current fixture value, because none of them
sits at a half cent. The two would only differ on a future value at a half, such as -0.125.

Alongside the fixtures, differential tests slice the prototype's own functions out of the HTML, run
them, and compare them field by field with the port over a grid of inputs (20,160 profiles for
`calcTargets`, every combination for `needsClearance`). If the prototype changes shape, these tests
fail loudly at the slice step rather than passing silently.
