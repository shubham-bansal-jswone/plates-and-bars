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
| Helpers | `num` | `num` | none |

`calcTargets` returns the same fields as the prototype, unrounded where the prototype leaves them
unrounded (bmr, movement, training, digestion, tdee, weekly). Display them with `Math.round`, as the
prototype's `fmt` does. `kcal`, `protein`, `fat` and `carbs` come back already rounded.

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
