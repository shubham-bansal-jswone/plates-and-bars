// Inputs for every golden fixture that is computed rather than copied from a prototype table.
// Edit this file (in a `spec-change` PR) to add a case; never edit docs/spec/golden/*.json by hand.
// Rounding of each stored value is documented next to where it is applied in generate.mjs and in
// docs/spec/PROTOTYPE_SPEC.md section 1 ("Fixture rounding").

// Fixed "today" for the plan and progression fixtures: Wednesday of the week the plan fixture shows (Mon 2026-10-05).
// The sessions in PROGRESSION are dated 2026-10-01 and `first-2-weeks-hold` started 2026-09-28, so any date from
// 2026-10-02 to 2026-10-11 gives the same numbers; the spec is dated 2026-10-07.
export const TODAY = '2026-10-07';
export const WEEK_START = '2026-10-05';

// targets.json: profiles passed to calcTargets.
export const TARGETS = [
  { id: "male-30-lose-moderate", sex: "male", age: 30, height: 165, weight: 82, activity: "sitting", days: 6, minutes: 60, goal: "lose", pace: "moderate", special: "none" },
  { id: "male-31-recomp", sex: "male", age: 31, height: 170.2, weight: 83, activity: "sitting", days: 6, minutes: 45, goal: "recomp", pace: "moderate", special: "none" },
  { id: "female-28-lose-moderate", sex: "female", age: 28, height: 158, weight: 55, activity: "light", days: 3, minutes: 45, goal: "lose", pace: "moderate", special: "none" },
  { id: "female-28-pregnant", sex: "female", age: 28, height: 158, weight: 55, activity: "light", days: 3, minutes: 45, goal: "lose", pace: "moderate", special: "pregnant" },
  { id: "male-45-gain", sex: "male", age: 45, height: 178, weight: 70, activity: "feet", days: 4, minutes: 60, goal: "gain", pace: "moderate", special: "none" },
  { id: "female-66-maintain", sex: "female", age: 66, height: 155, weight: 62, activity: "light", days: 3, minutes: 45, goal: "maintain", pace: "moderate", special: "none" },
  { id: "male-bmi35-lose", sex: "male", age: 40, height: 170, weight: 101, activity: "sitting", days: 4, minutes: 60, goal: "lose", pace: "moderate", special: "none" },
  { id: "female-small-floor", sex: "female", age: 50, height: 150, weight: 45, activity: "sitting", days: 0, minutes: 0, goal: "lose", pace: "moderate", special: "none" },
];

// progression.json: `last` is the lift record (S.lifts[name]) that suggestBase reads.
export const PROGRESSION = [
  { id: "top-of-range-up", name: "Hack Squat", last: { date: "2026-10-01", n: 5, first: "2026-08-01", form: "yes", sets: [{ w: 60, r: 12, rate: "right" }, { w: 60, r: 12, rate: "right" }, { w: 60, r: 12, rate: "right" }] } },
  { id: "in-range-hold", name: "Hack Squat", last: { date: "2026-10-01", n: 5, first: "2026-08-01", sets: [{ w: 60, r: 10 }, { w: 60, r: 9 }, { w: 60, r: 9 }] } },
  { id: "first-2-weeks-hold", name: "Hack Squat", last: { date: "2026-10-01", n: 2, first: "2026-09-28", sets: [{ w: 60, r: 12, rate: "right" }, { w: 60, r: 12, rate: "right" }] } },
  { id: "form-slipped-hold", name: "Hack Squat", last: { date: "2026-10-01", n: 5, first: "2026-08-01", form: "no", sets: [{ w: 60, r: 12 }, { w: 60, r: 12 }] } },
  { id: "failed-drop", name: "Barbell Bench Press", last: { date: "2026-10-01", n: 5, first: "2026-08-01", sets: [{ w: 50, r: 5, rate: "fail" }, { w: 50, r: 4, rate: "fail" }] } },
  { id: "dumbbell-big-jump", name: "Lateral Raise", last: { date: "2026-10-01", n: 6, first: "2026-08-01", sets: [{ w: 5, r: 15 }, { w: 5, r: 15 }, { w: 5, r: 15 }] } },
  { id: "bodyweight-reps", name: "Push-ups", last: { date: "2026-10-01", n: 6, first: "2026-08-01", sets: [{ w: 0, r: 12 }, { w: 0, r: 11 }] } },
  { id: "assisted-less-help", name: "Assisted Pull-up", last: { date: "2026-10-01", n: 6, first: "2026-08-01", sets: [{ w: 30, r: 10 }, { w: 30, r: 10 }, { w: 30, r: 10 }] } },
];

// plan.json: training days per week (profile.days) and the session lengths (profile.minutes) whose exercise cap is recorded.
export const PLAN_DAYS = [2, 3, 4, 5, 6];
export const PLAN_MINUTES = [30, 45, 60, 75, 90];

// sessions.json: the profile behind every case (#74 records it). 45 minutes is the exercise cap of 4, no stored
// sessions is rotation offset 0, and `focus` is S.settings.focus. Key format: "<where>|<template>[|focus=<muscle>]".
export const SESSION_PROFILE = { minutes: 45, exp: 'some' };
export const SESSION_WHERE = ['gym', 'dumbbells', 'bodyweight'];
export const SESSION_TEMPLATES = ['Push A', 'Legs A', 'Full body A'];
export const SESSION_FOCUS = [null, 'glutes'];

// formulas.json: inputs for the one-off formulas.
export const NAVY = [
  { id: 'male_165cm_w95_n39', sex: 'male', height: 165, waist: 95, neck: 39 },
  { id: 'female_158cm_w78_n32_h98', sex: 'female', height: 158, waist: 78, neck: 32, hips: 98 },
];
export const WEIGHT_KG = 82;
export const WEIGH_IN_DATE = '2026-10-01';
export const KCAL_TARGET = 2000;
// A 15-minute span between the first and last ticked set (t in ms; the prototype ignores t = 0), three sets, 10 minutes of cardio, 82 kg.
export const WORKOUT = { kg: 82, cardio: 10, setTimes: [1000000, 1450000, 1900000] };

// foods.json: the one text field the prototype does not hold in code (a comment on RAW).
export const FOODS_NOTES = 'Carbs are total carbohydrate including fibre. Raw values: USDA SR28 (public domain); paneer, curd, milk from FSSAI standards; no IFCT data.';
// formulas.json: the prototype has no single function for this one; the text is kept here.
export const E1RM_SCORE = 'Epley: weight * (1 + reps/30); bodyweight: total reps; assisted: max(reps*2 - assist kg)';
