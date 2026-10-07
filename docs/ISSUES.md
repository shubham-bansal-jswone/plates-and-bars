# Issues to open from this spec change

Each block is one GitHub issue: title, label, owner, acceptance criteria.

### 1. Port targets calculation to packages/core
`core` · Core logic agent
- [ ] `calcTargets(profile)` matches every case in `golden/targets.json` (tdee, bmr, kcal, protein, carbs, fat, floored, capped)
- [ ] Health-check `needsClearance(profile)` implemented with tests

### 2. Port plan engine (split, cap, rotation, sets)
`core` · Core logic agent
- [ ] `planned(date)` matches `golden/plan.json` for 0, 2, 3, 4, 5 and 6 days
- [ ] `trimSession`, `applyFocus`, home mapping reproduce `golden/sessions.json`
- [ ] Beginner 2-set ramp, calf 4 sets, focus +1 set, 60+ balance exercise covered by tests

### 3. Port weight guidance and stalls
`core` · Core logic agent
- [ ] `suggestBase` reproduces all 8 cases in `golden/progression.json`
- [ ] In-session rating adjustments, ramp, modifiers (return, bridge, deload, re-entry) tested

### 4. Load exercise content
`content` · Content agent
- [ ] `content/exercises.json` built from `golden/exercises.json` (tags, ladders, away map, cards, library)
- [ ] Validator: every exercise in a template, ladder or away map has tags and a card

### 5. Load food content (no IFCT)
`content` · Content agent
- [ ] `content/foods.json` from `golden/foods.json`, carbs including fibre, with source per row
- [ ] Aliases searchable; grams logging where the unit is in grams
- [ ] CI check: no IFCT/INDB source names anywhere in `content/`

### 6. Setup flow v2
`app` · App agent
- [ ] Consent screen first; "Where do you train?"; experience; 6 health-check questions required
- [ ] Results screen notes: health check, home plan, 60+, floors and caps

### 7. Workout screen v2
`app` · App agent
- [ ] Preview shows the exact session with a Start button beside it
- [ ] Rest timer bar, warm-up line, focus badges, second-session option, personal-best toast

### 8. Food screen v2
`app` · App agent
- [ ] Fibre, fruit & veg, added sugar row; "I've logged everything" tick; grams input; drinks in eating out

### 9. Targets screen v2
`app` · App agent
- [ ] Focus muscles (max 3), coverage planned vs done, rest timer toggle, export and delete everything

### 10. Sync model additions
`backend` · Backend agent (contract PR first)
- [ ] Profile fields: `where`, `exp`, `created`, `screen`, `cleared`; settings: `focus`, `restOff`, `customTags`, `kitchen`
- [ ] Day fields: `complete`, `steps`, `sleep`, `water`; set timestamp `t`
- [ ] `DELETE /me` removes every user row; `GET /me/export` returns all user data

### 11. Golden-test CI gate
`ci` · QA agent
- [ ] CI runs all golden tests on every PR and blocks merge on any mismatch
