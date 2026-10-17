# Play Store listing

Status: draft (#832), based on `main` on 2026-10-18. Pending the owner's and the lawyer's review; nothing here is submitted yet. The listing text describes only what v1 ships. Re-check it against the app, `docs/PLAY-DATA-SAFETY.md` and the privacy page before each submission; Google may act on a listing that does not match the app.

Check the text with `node docs/check-play-listing.mjs` after any edit. It counts characters (Unicode code points; Google counts full-width and half-width characters alike) against the limits below, checks that the full description carries the setup disclaimer word for word from `apps/mobile/src/setup/copy.ts`, that no AI vendor is named (#673), that no bracketed placeholder is left in paste-ready text, and that every placeholder in this file is in the owner steps.

## Owner steps

Placeholders are marked like the site's legal pages (`[contact email]`). Fill them in Play Console, not in the listing text.

1. `[contact email]`: the public contact email on Store settings > Contact details (required by Play). It can be the same mailbox as `[privacy contact email]` on the site.
2. `[site host]`: the website host. Privacy policy URL is `https://[site host]/privacy/`, website `https://[site host]/`, account deletion URL `https://[site host]/delete-account/` (also in `docs/PLAY-DATA-SAFETY.md`). Publish the final, lawyer-reviewed pages first.
3. App name: keep "Plate & Bar" (the app's own name in `apps/mobile/app.json`) or pick the longer option below.
4. AI paragraph: add it to the full description only if AI features are switched on in production at release (a provider and a budget are chosen and the `AI_*_ENABLED` flags are on). Today they are off, so leave it out.
5. Crash reporting sentence: keep it as written whether or not the release has a DSN; it stays true either way. Do not describe crash reports as opt-in: users have no switch for them, and they are sent whenever the build has a DSN (`docs/PLAY-DATA-SAFETY.md`). If crash reporting is on, the privacy page's crash-report section must be published first (`docs/PLAY-DATA-SAFETY.md`, Before submitting).
6. Content rating: answer the live questionnaire with the answers below, checking each against Google's current wording, which may differ from the topic names used here.
7. Target audience: "Ages 18 and over" only, and decide whether to turn on Restrict Minor Access (below).
8. Price: the app has no purchases, ads or subscriptions; set it to free unless you decide otherwise.
9. Tags: pick up to five from the list Play Console offers.
10. Lawyer review of the disclaimer and the privacy wording in the description, together with the site's privacy, terms and deletion pages.

## App details

Store listing limits are from Google's help page "Create and set up your app" (source 1): app name 30 characters, short description 80, full description 4,000. Release notes are 500 per language (source 2).

### App name (30 max)

Recommended:

<!-- play:name max=30 -->
```text
Plate & Bar
```

Longer option, if the owner wants the name to say what it does:

<!-- play:name_long max=30 -->
```text
Plate & Bar: Food and Training
```

### Short description (80 max)

<!-- play:short max=80 -->
```text
Track food and training, see your daily targets. Works offline, with no ads.
```

### Full description (4,000 max)

<!-- play:full max=4000 -->
```text
Plate & Bar helps you eat and train for your goal: log your meals and workouts, and see your daily targets in one place. It is built for everyday Indian food and for training at a gym or at home.

Works offline, no account needed
Everything is saved on your phone first, so a gym with no signal is not a problem. You can use the whole app without signing in. Your data stays on this device. If you sign in, it is also stored on our own server so it syncs between your devices.

Your targets
A short setup asks about you, your goal and how you train, and works out daily calories, protein, carbs and fat. A health check comes first: if an answer suggests you see a doctor, the app keeps your sessions light until you confirm you have been cleared. You can edit your targets at any time.

Food
- Log everyday Indian foods by grams or servings, and find them by the names you use.
- Eating out: typical North Indian, South Indian, Indo-Chinese, fast food and biryani picks, plus drinks.
- Water tracking, fibre, and copying a previous day's food.
- Meal ideas, a weekly meal plan and a grocery list.
- Recipes with nutrition per katori, your own foods, and kitchen tests: weigh a dish you cooked and log it per 100 g or per serving.

Training
- A plan for where you train: a gym, home with dumbbells, or no equipment.
- Weight suggestions, warm-up sets and a rest timer.
- Rate how each set felt, and the suggestions follow your progress.
- Swap an exercise you can't do, or avoid one that hurts.
- An exercise library: search by name, filter by equipment and muscle.

Progress
- Weigh-ins and a trend line, body measurements, and a seven-day summary.
- A weekly check-in that suggests changes for you to accept or skip.
- Progress photos, encrypted and kept only on your phone. They are never uploaded.

Why it works
Short cards explain the reasons behind your targets and your plan.

Your data
- No ads and no advertising SDKs; the only SDK that sends anything is for crash reports.
- If crash reporting is switched on for a release, crash and error reports go to an error-tracking service we run ourselves. See the privacy policy.
- Download a copy of your data, or delete everything, from "Your data" in the app. Deleting clears this device and, if you signed in, removes your account and its data from our server.

Not medical advice
This app gives general fitness and nutrition guidance. It isn’t medical advice. It’s for adults 18 and over; if you have a medical condition, are pregnant, or are unsure whether exercise is safe for you, check with a doctor first.
```

Optional paragraph, only when AI is switched on in production (owner step 4). Insert it before "Your data"; the check counts the full description with it included.

<!-- play:ai max=4000 -->
```text
Optional AI help
AI features need you to sign in, are off by default, and you switch them on yourself; the app works fully without them. When on, you can describe a meal in words to log it, ask why your plan or targets are what they are, get a weekly summary, and get muscle suggestions for your own exercises. Photos are never sent. AI answers are information, not advice, and can be wrong.
```

### What's new (release notes, 500 max)

For the first release. In Play Console, put the text between `<en-US>` and `</en-US>` tags on their own lines (source 2), or in the en-US box.

<!-- play:whatsnew max=500 -->
```text
First release of Plate & Bar.
- Daily calorie, protein, carb and fat targets from a short setup, with a health check first.
- Food logging for everyday Indian foods, eating out, water, recipes and meal plans.
- Training plans for the gym or home, with weight suggestions, warm-ups and a rest timer.
- Weigh-ins, measurements, a weekly check-in and on-device progress photos.
- Works offline. Signing in to sync is optional.
```

For later releases, keep the same shape: one line saying what the release is, then up to five lines of what changed for the user, plain words, no internal issue numbers.

## Store settings

| Field | Answer | Why |
| --- | --- | --- |
| App or game | App | |
| Category | Health & Fitness | Google's example content for it is "Personal fitness, workout tracking, diet and nutritional tips, health and safety" (source 3). Not Medical: the app gives no diagnosis or treatment (same reasoning as the Health apps declaration in `docs/PLAY-DATA-SAFETY.md`) |
| Tags (up to five, from Play Console's list) | Owner picks; look for the closest to: fitness tracking, workout, nutrition or calorie counter, diet, weight loss | Tags are picked from Play Console's suggestions (source 3) |
| Contact email | `[contact email]` | Required by Play (source 1) |
| Website | `https://[site host]/` | Recommended by Play (source 1) |
| Phone | Leave empty | Optional |
| Privacy policy URL (App content > Privacy policy) | `https://[site host]/privacy/` | `apps/site/src/pages/privacy.astro` |

## Target audience and content

| Question | Answer | Why |
| --- | --- | --- |
| Target age groups | "Ages 18 and over" only | The app is for adults 18 and over: setup disclaimer (`apps/mobile/src/setup/copy.ts`), terms (`apps/site/src/pages/terms.astro`), launch checklist in `docs/development-plan.md`. Selecting 18 and over alone keeps the app out of the Families policy (source 4) |
| Restrict Minor Access | Recommended: on. **Owner** decides | With 18 and over as the only age group, users Google has determined to be minors cannot search for, download or buy the app (source 4). It matches the terms' "do not create an account or use the app" for under-18s |
| Does the store listing appeal to children? | No | No youthful characters or animation in the listing (keep it that way in the graphics, #833) |

Note on "18+ content rating" in the launch checklist: the content rating is calculated by IARC from the questionnaire answers, and the developer cannot pick it (source 5). The answers below will most likely give a low rating, though IARC may rate the app 12+ or Teen in some regions because of the alcohol references (harmless, since the target audience is 18 and over); the adults-only limit comes from the target audience setting, the terms and the setup disclaimer, not from the rating.

## Content rating questionnaire

Topic names are from Google's ratings help (source 5); the live questionnaire wording may differ, so answer each live question against the "what the app does" column.

| Topic | Answer | What the app does |
| --- | --- | --- |
| Category | The non-game, non-social app category (for example "All other app types", or the closest listed) | A fitness and nutrition tracker; not a game, not a social network, not news |
| Violence, blood, fear | No | None |
| Sexuality, nudity | No | Progress photos are the user's own, stay on the device and are never shown to anyone else |
| Language (profanity, crude humour) | No | None |
| Controlled substances: alcohol | **Yes, references only** (owner to confirm how the live question classes it) | The eating-out list has drinks with calories (beer, wine, spirits, cocktails) and a science card explains that alcohol adds calories and slows recovery. No use is shown; the Drinks tips advise drinking less and picking lower-calorie drinks |
| Controlled substances: tobacco, drugs | No | None |
| Gambling, simulated gambling | No | None |
| Users can interact or exchange content (chat, messaging, forums) | No | No messaging, comments or public profiles; sync is only between the user's own devices |
| Shares or publishes user-generated content | No | Users' foods, recipes, notes and custom exercises stay private to their account; the export file is saved or shared by the user with the system share sheet |
| Shares the user's location with others | No | No location permission |
| Digital purchases | No | No in-app purchases, ads or subscriptions |
| Unrestricted internet access (web browser, search) | No | No in-app browser or web search; the app talks only to our API, and the source links on About open in the phone's own browser |

Re-answer the questionnaire when any of this changes (for example social features, purchases, or AI features that show generated text).

## Sources

1. Google Play Console Help, "Create and set up your app": support.google.com/googleplay/android-developer/answer/9859152 (fetched 2026-10-18): limits, contact details.
2. Google Play Console Help, "Prepare and roll out a release": support.google.com/googleplay/android-developer/answer/9859348 (fetched 2026-10-18): release notes, 500 Unicode characters per language, language tags on their own lines.
3. Google Play Console Help, "Choose a category and tags for your app or game": support.google.com/googleplay/android-developer/answer/9859673 (fetched 2026-10-18): category names, at most five tags.
4. Google Play Console Help, "Manage target audience and app content settings": support.google.com/googleplay/android-developer/answer/9867159 (fetched 2026-10-18): age groups, Restrict Minor Access.
5. Google Play Console Help, "Content ratings for apps and games": support.google.com/googleplay/android-developer/answer/188189 (fetched 2026-10-18), and the ratings questionnaire topic list in the same help topic: ratings are calculated from the answers.
