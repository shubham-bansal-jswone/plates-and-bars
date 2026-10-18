# Manual release checklist

Run before each release, on the release candidate build. Automated coverage: the web journeys in `specs/` and the sync journey in `sync-specs/` (offline then sync, second device, delete account, against a real backend) run in CI; the Maestro smoke flow `maestro/smoke.yaml` (setup, a meal, a set) is written but has not run on a device yet, so the Android column is manual. Record the build, device and date; file a GitHub issue (labels `bug` plus the owning lane) for each failure.

## Journeys (every device below)

- [ ] Setup: consent shown first and required; health questions; targets match the prototype for the test profile (30 y male, 165 cm, 82 kg, sedentary, 6 days, lose fat: 1,990 kcal).
- [ ] Log a meal: add a food under breakfast, kcal and macros update, "logged everything" ticks, survives closing and reopening the app.
- [ ] Log a workout: start today's session, enter weight and reps, tick a set, survives closing the app.
- [ ] Water and weigh-in saved and shown on Food and Progress.
- [ ] Offline then sync: airplane mode, log food and a set, reconnect while signed in, data reaches the server once (no duplicates), the other device shows it.
- [ ] Export: Download my data works offline; the JSON and CSV open and hold what was logged.
- [ ] Delete account: on a signed-in device, delete everything; server data is gone (check the site's delete-account page instructions), device returns to setup; on a never-signed-in device the notice makes sense.
- [ ] Exercise library, About and sources, recipes and kitchen tests open and return.

## Devices

- [ ] Low-end Android (2 to 3 GB RAM, for example Android Go or a 2019 budget phone): cold start under a reasonable time, no out-of-memory kill during a workout or food search, scrolling the food list and exercise library stays smooth, app survives being backgrounded for 10 minutes mid-workout.
- [ ] Mid-range Android phone: all journeys above, plus rotation and back-button behaviour on every screen.
- [ ] Desktop Chrome (current stable, the web build): all journeys, window resized from 320 px to 1440 px wide, reload on every route keeps the state, browser back and forward work.

## Accessibility (also repeat on Android with TalkBack)

- [ ] Screen reader: every control has a meaningful spoken label (buttons, set ticks, steppers, tabs, chips); selected state is announced for radios and chips (see #366); headings let you jump between sections; focus order follows the visual order; dialogs and sheets trap and return focus.
- [ ] Contrast: text and controls meet 4.5:1 (3:1 for large text and icons) in light and dark mode, including disabled, selected and error states; automated axe contrast checks pass, plus a look at charts and the progress graphs by eye.
- [ ] Large text: system font size at the largest setting (Android "Largest" and display size large) and browser zoom 200 percent: no clipped or overlapping text, all buttons still reachable, setup and workout still usable.
- [ ] Touch targets at least 44 px; keyboard only (web): every control reachable with Tab, visible focus ring, Enter and Space activate.
- [ ] Reduce motion on: no essential motion.

## Release gates

- [ ] CI is green on the release commit, including `e2e (web, Playwright)`.
- [ ] No open `bug` issue with label `accessibility` or data loss on the release milestone.

## Play staged rollout and halt

Detail, thresholds and the content-only path are in `infra/RUNBOOK.md` section 8. The numbers below are starting values chosen without real traffic data (#931); the owner may change them. Play Console menu and button names change: the steps say what to look for, not where it is. Build and upload by hand, nothing uploads to Play for us.

- [ ] Before the first step: the AAB is from a `v*` tag build (a non-tag AAB must never be uploaded), release-signed, and its `versionCode` is higher than the one in production. The production API is already on that tag and healthy (`infra/RUNBOOK.md` section 4a).
- [ ] Internal testing: the build installed from Play on a real phone, setup and one meal and one set work, About shows the release version.
- [ ] Production release created with a staged rollout of 10 %. Note the date and time here: ______
- [ ] Hold at 10 % for at least 48 hours. In that time check twice a day: crash-free users and crash rate of the new version in Play Console's Android vitals (compared with the previous version), new or rising issues for this release in GlitchTip (once it is running; release name `plate-and-bar@X.Y.Z+code`), errors for `plateandbar-api@X.Y.Z`, the support mailbox, and the Uptime Kuma alerts.
- [ ] Raise to 50 % only if nothing in the halt list below has happened. Note date and time: ______
- [ ] Hold at 50 % for at least 24 hours, same checks.
- [ ] Raise to 100 %. Keep watching the same sources for a week.

Halt the rollout (stop further users getting this version) when any of these happens: a report of lost, duplicated or another person's data; a crash or ANR rate clearly above the previous version, or crash-free users below 98 %; a sign-in, sync or setup failure reported by more than one user; an error spike in GlitchTip tied to this release. In Play Console open the production release and use its halt-rollout action (it is next to the rollout percentage; the label can differ). A halt does not uninstall or roll back phones that already updated. Then follow `infra/RUNBOOK.md` section 8.2, and for a possible data leak `docs/INCIDENT-RESPONSE.md` first.
