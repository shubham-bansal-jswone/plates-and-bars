# Plate & Bar — Prototype Behaviour Spec

**Status:** source of truth for app behaviour, as of 2026-10-08.
**Reference implementation:** `docs/prototype/plate-and-bar.html` (single file; open it in a browser to use it).
**Golden fixtures:** `docs/spec/golden/*.json`, generated from the prototype. Ported code must reproduce them exactly.

When this spec, the fixtures and the prototype disagree, the prototype wins; file an issue so the spec is fixed.

---

## 0. Changes since the Development Plan was written

**2026-10-08 — prototype fixes (spec-change; golden fixtures unchanged).**
- #101: "Below the range two sessions running → drop" reads sessions before today only (`prevOf`), so ticking today's first set no longer flips the advice from drop to hold. To keep that session, `updateLift` now stores the earlier session's own `prev` (one level, as `{date, sets, form}`) inside the new record's `prev` when a new day starts.
- #102: the bodyweight "+kg" value carried to the next set is parsed with `num()` (`setTarget`), so "2,5" gives 2.5 instead of "NaN"; an empty field stays empty.
- #121: `updateLift` keeps `pbToast` when the existing record is from the same date, so the personal-best toast shows at most once a day per lift.
- #129: at 0 training days, setup (`validateStep` step 2) saves `exp` and `minutes` as null and `where` as `gym` when not picked; it still does not ask where you train. A stale "New to lifting" no longer triggers the beginner ramp on hand-picked sessions.

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
2. Exclusions and swaps resolve each name (`resolveSession`); ladder "bridge" exercises appended with 2 sets for 2 weeks.
3. Trim to the exercise cap (30 min → 3, 45 → 4, 60 → 5, 75 → 6, 90 → 7). The first 2 lifts always stay; the extras **rotate** by how many times this template was done (`trimSession`).
4. Focus muscles (`applyFocus`), then the check-in "short session" cut.
5. Sets: 3 default; 2 for `exp=new` in the first 14 days from profile creation; calf raises at least 4; +1 on focus exercises (max 5). Deload: ~60% of sets. Light day: −1 set.
6. Age 60+: append "Single-Leg Balance (seconds)", 2 sets.

Weekly coverage meter: planned (from templates) and done (last 7 days of logged sets). Primary muscle = 1 per set, secondary = 0.5. Under 6 is flagged; ~10 is the target, 12–16 for focus muscles.

**Missing training days (decided on #72).** `splitFor` treats `days === 0` as no plan but a missing or null `days` as the full 6-day plan, while `calcTargets` treats null as 0 training days. Kept as is: setup makes days (0 to 7) a required answer, so a set-up profile always has it; the case only arises before setup or with damaged data.

**Rotation counting (decided on #73).** `trimSession` counts every stored session entry for the template, whatever its date. Entries are stored only while at least one work set (not warm-up) is done (`saveDay` deletes the entry when sets return to 0), so empty entries never occur. Today's preview is shown only while today has no exercises, so today's own entry never shifts it; a started workout's exercises are fixed when built on Start. Because counting ignores dates, a past day's preview also counts later sessions, and a second session of the same template counts today's entry. Kept as is.

---

## 3. Weight guidance  → fixture `progression.json`

- Per exercise metadata: type, rep range, step (`EX_META`, `DEFAULT_STEP`). Home dumbbells raise dumbbell ranges to at least 10–20.
- Double progression (`suggestBase`): top of range on every set with no Hard/Fail → +1 step (assisted: −1 step of assistance). Below range twice running, or a failed set → drop ~7.5% (≥ 1 step). Else same weight, +1 rep target.
- Holds: first 14 days on an exercise (unless all sets rated Easy); last session's form = "no".
- Jumps over 10% (5% for age 60+) carry a "go back and add reps" fallback.
- Modifiers (`applyMods`): returning after an exclusion → 55% of old top for 2 weeks; bridge → 85%; deload −10%; re-entry after a break −15% or −30%.
- In-session: Easy → next set +1 step; Couldn't finish → −10%; ticking an empty set uses the placeholder.
- Find-your-weight ramp for first-time loaded exercises: Easy → add a step and another ramp set; Just right → working weight; Hard → one step lighter; Fail → previous ramp weight.
- Stall: best session score (Epley `w·(1+r/30)`; bodyweight = total reps; assisted = `max(r·2 − assist)`) not beating the earlier best by >1% for 3 sessions. 3+ stalled lifts → recovery-week card.
- Personal best: new session score > previous best × 1.005 → toast once a day per lift.

---

## 4. Exclusions, swaps, ladders  → fixture `exercises.json`

- Exclusion scope: exercise, family, movement pattern, or joint; duration: today, 2 weeks, 4 weeks, permanent. Re-check card when a timed rule ends.
- Replacement scoring (`candidates`): shared primary muscles ×10, shared secondary ×2, same pattern +6, joint-stress and difficulty penalties, history +2, equipment filter by `where`.
- Ladders (`LADDERS`): step-up card after ≥4 sessions at the top of the range with good ratings and solid form; 2-week bridge; step-down after two bad sessions; "stay" re-asks after 6 weeks.
- Custom exercises: Claude suggests tags (pattern, equipment, muscles, joints); user confirms on a body map; stored per user.

---

## 5. Food  → fixture `foods.json`

- All values per serving; carbs include fibre. Grams entry works for foods whose unit is in grams.
- Search matches name or alias (`ALIAS`: chawal, anda, dahi, daru…).
- Fibre target: max(25 g, 15 g per 1,000 kcal of today's target). Fruit & veg servings out of 5. Added sugar shown when ≥10 g.
- Meal ideas (`combos`): protein shortfall weighted 3× calorie error; caps per food (`MAXQ`), minimum portions (`MINQ`); age 60+ ≥25 g protein per main meal; diet filter any/egg/veg; fasting-day pool.
- Day complete: user tick, or for older days ≥3 meals and ≥75% of target. Only complete days feed the real-burn estimate.
- Recipes: raw ingredients per 100 g (`RAW`, `RAW_FIB`), cooked yield by katoris (150 g) or pot weight.
- Kitchen tests: pot weights → cooked weight; per 100 g and per serving; "use for my logging" writes a personal food.

---

## 6. Progress and coaching  → fixture `formulas.json`

- Real burn: average intake on complete days − (weight trend slope × 7,700 kcal/kg); needs ≥10 complete days in 14 and ≥6 weigh-ins in 21; smoothed 60/40 with last week. Suggest a calorie change only if the new target differs by ≥100 kcal.
- Rapid loss: weekly average down >1% for 2 weeks (or 1 week plus 2+ stalls) → suggest +150 kcal.
- Navy body fat, water target (33 ml/kg + 600 on training days), workout burn (session time × 5 METs; extra over resting at 4), steps target (recent average + 1,000, 5k–12k).
- Habits: on-track weeks = consecutive weeks with ≥ (plan days − 1, min 2) sessions.

---

## 7. Privacy rules (non-negotiable)

- Progress photos, cycle log, lab reports: device only, never sent to the server or Claude.
- Meal photos, recipe imports, form-check frames: sent to Claude for analysis only, never stored.
- Lab reports, if ever shipped, stay out of v1 public (medical and legal review first).
- No health data in logs. Export and delete must cover everything.
