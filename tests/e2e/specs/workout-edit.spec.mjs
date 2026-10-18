import { completeSetup, expect, label, reloadTo, saved, tab, test } from '../support/app.mjs';

// Editing today's session: Add exercise, a typed exercise with muscle tags, Remove exercise and the "Can't do" sheet.
// Offline like logging.spec.mjs; every edit is checked again after a reload online (what comes back was read from SQLite).
// The sheets are named dialogs that start with focus on their title (#661), so each is opened through openSheet below.
test.beforeEach(async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Workout');
  await start(page).click();
  await expect(cards(page).first()).toBeVisible();
  await page.context().setOffline(true);
});

// A Start button for a session: not the rest timer switch on Targets, nor a "Start the ramp for ..." button on an exercise card.
const start = (page) => page.locator('[aria-label^="Start "]:not([aria-label^="Start a rest"]):not([aria-label^="Start the ramp for"]) >> visible=true').first();
const cards = (page) => page.locator('[aria-label^="Mark "][aria-label$=" set 1 done"]');
const names = async (page) => (await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).map((l) => l.slice('Mark '.length, -' set 1 done'.length));
const dialog = (page, name) => page.locator(`[role="dialog"][aria-label=${JSON.stringify(name)}]`);
/** Presses the opener, waits for the dialog with this name and for focus to land on its title; returns the dialog. */
async function openSheet(page, opener, name) {
  await opener.click();
  const sheet = dialog(page, name);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[role=heading]').first()).toBeFocused();
  return sheet;
}
// The Workout screen has its own "Add exercise" button; the sheet is a dialog with the same name, so the opener is found by role.
const addExercise = (page) => page.getByRole('button', { name: 'Add exercise', exact: true });
const openAdd = (page) => openSheet(page, addExercise(page), 'Add exercise');
// A chip in the Add exercise sheet's library list: "Add <exercise>", not the "Add the exercise you typed" button nor the per-workout "Add <exercise> from <workout>" chips (#1005).
const sheetChip = (sheet) => sheet.locator('[aria-label^="Add "]:not([aria-label^="Add the exercise"]):not([aria-label*=" from "])').first();
// Polls: right after a reload the session is read back asynchronously.
const expectNames = (page, want) => expect.poll(() => names(page), { timeout: 20_000 }).toEqual(want);
// The toast lasts about two seconds, so it is awaited while the write settles, not after it.
async function savedWithToast(page, action, text) {
  const toast = expect(page.getByText(text)).toBeVisible();
  await saved(page, action);
  await toast;
}
// The name of an exercise card's remove chip. One place, so a rename (#800) is one line; the "Tap again to remove ..." name is separate.
const removeLabel = (name) => `Remove exercise ${name} from today`;
const mark = (name) => `Mark ${name} set 1 done`;

test('Add exercise: a library exercise goes at the end, can be removed, and both survive a reload', async ({ page }) => {
  const before = await names(page);
  const sheet = await openAdd(page);
  const chip = sheetChip(sheet);
  const name = (await chip.getAttribute('aria-label')).slice('Add '.length);
  expect(before).not.toContain(name); // the sheet leaves out what is already in the session
  await savedWithToast(page, () => chip.click(), `${name} added`);
  await expectNames(page, [...before, name]);

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  await expectNames(page, [...before, name]);

  // Remove asks twice: the first tap arms it.
  await page.context().setOffline(true);
  await label(page, removeLabel(name)).click();
  await expectNames(page, [...before, name]);
  await savedWithToast(page, () => label(page, `Tap again to remove ${name} from today`).click(), `${name} removed`);
  await expectNames(page, before);

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  await expectNames(page, before);
});

test('Add exercise: the sheet no longer offers an exercise that is in the session', async ({ page }) => {
  const [first] = await names(page);
  const sheet = await openAdd(page);
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(sheetChip(sheet)).toBeVisible(); // the list rendered, so the absence below is not an empty sheet
  await expect(sheet.locator(`[aria-label=${JSON.stringify(`Add ${first}`)}]`)).toHaveCount(0);
});

test('typed exercise: a name from the library is added as that exercise, in any case', async ({ page }) => {
  const [first] = await names(page);
  // Pick a library exercise that is not in the session, from the sheet, and type its name in upper case.
  const sheet = await openAdd(page);
  const chip = sheetChip(sheet);
  const name = (await chip.getAttribute('aria-label')).slice('Add '.length);
  await label(page, 'Your own exercise').fill(name.toUpperCase());
  await savedWithToast(page, () => label(page, 'Add the exercise you typed').click(), `${name} added`); // no tag sheet: the library knows it
  await expect(label(page, mark(name))).toBeVisible();

  // Typing the first exercise again says it is already there.
  await openAdd(page);
  await label(page, 'Your own exercise').fill(first.toLowerCase());
  await label(page, 'Add the exercise you typed').click();
  await expect(page.getByText(`${first} is already in today’s session.`)).toBeVisible();
});

test('typed exercise: a blank or over-long name is refused before any tags are asked', async ({ page }) => {
  const sheet = await openAdd(page);
  await label(page, 'Your own exercise').fill('   ');
  await label(page, 'Add the exercise you typed').click();
  await expect(page.getByText('Type an exercise name.')).toBeVisible();
  await label(page, 'Your own exercise').fill('x'.repeat(201));
  await label(page, 'Add the exercise you typed').click();
  await expect(page.getByText('That exercise name is too long. Shorten it.')).toBeVisible();
  // Still on the Add exercise sheet: the tag sheet would be a second dialog, named after the typed text.
  await expect(sheet).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
});

test('typed exercise: a new name needs a main muscle, then it is added and survives a reload', async ({ page }) => {
  const before = await names(page);
  const name = 'Zercher carry';
  await openAdd(page);
  await label(page, 'Your own exercise').fill(`  ${name}  `);
  await label(page, 'Add the exercise you typed').click();

  // Tag sheet: the dialog and its heading are the trimmed name, and focus starts on the heading.
  const tags = dialog(page, name);
  await expect(tags).toBeVisible();
  await expect(tags.getByRole('heading', { name })).toBeFocused();
  await label(page, `Add ${name} with these muscles`).click();
  await expect(page.getByText('Pick at least one main muscle.')).toBeVisible();

  const mainChip = tags.locator('[aria-label^="Main muscle: "]').first();
  const alsoChip = tags.locator('[aria-label^="Also working: "]').nth(1);
  await mainChip.click();
  await expect(mainChip).toHaveAttribute('aria-pressed', 'true');
  await alsoChip.click();
  await savedWithToast(page, () => label(page, `Add ${name} with these muscles`).click(), `${name} added`);
  await expectNames(page, [...before, name]);

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  await expectNames(page, [...before, name]);

  // Typing it again later is now a known exercise: no tag sheet, just "already in".
  await openAdd(page);
  await label(page, 'Your own exercise').fill(name.toUpperCase());
  await label(page, 'Add the exercise you typed').click();
  await expect(page.getByText(`${name} is already in today’s session.`)).toBeVisible();
});

test('typed exercise: Cancel on the tag sheet adds nothing', async ({ page }) => {
  const before = await names(page);
  await openAdd(page);
  await label(page, 'Your own exercise').fill('Zercher carry');
  await label(page, 'Add the exercise you typed').click();
  const tags = dialog(page, 'Zercher carry');
  await expect(tags).toBeVisible();
  await tags.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tags).toHaveCount(0);
  await expectNames(page, before);
});

test('can’t do: "Just today" with a replacement swaps the exercise and survives a reload', async ({ page }) => {
  const before = await names(page);
  const [victim] = before;
  const sheet = await openSheet(page, label(page, `Can’t do ${victim}`), `Can’t do ${victim}?`);
  await label(page, 'Equipment isn’t available').click();
  await label(page, 'Just today').click();
  // On the pick step every button but "Skip it" and "Close" is a replacement; its first line is the exercise name, then why it fits.
  const first = sheet.getByRole('button', { name: /^(?!Skip it|Close)/ }).first();
  await expect(first).toBeVisible();
  const replacement = (await first.innerText()).split('\n')[0];
  expect(replacement).not.toBe(victim);
  await saved(page, () => first.click());
  await expect(label(page, mark(replacement))).toBeVisible();

  const after = await names(page);
  expect(after).not.toContain(victim);
  expect(after).toEqual([replacement, ...before.slice(1)]); // it takes the same slot (#443 / prototype)

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  await expectNames(page, after);
});

test('can’t do: "Skip it" removes the exercise with no replacement', async ({ page }) => {
  const before = await names(page);
  const [victim] = before;
  await openSheet(page, label(page, `Can’t do ${victim}`), `Can’t do ${victim}?`);
  await label(page, 'I don’t like it').click();
  await label(page, 'Just today').click();
  await saved(page, () => page.locator('[aria-label^="Skip it, no replacement"] >> visible=true').click());
  await expectNames(page, before.slice(1));

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  await expectNames(page, before.slice(1));
});

test('can’t do: closing the sheet changes nothing', async ({ page }) => {
  const before = await names(page);
  const sheet = await openSheet(page, label(page, `Can’t do ${before[0]}`), `Can’t do ${before[0]}?`);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expectNames(page, before);
});

test('Remove exercise: removing every exercise ends the session, and a new one can be started', async ({ page }) => {
  for (const name of await names(page)) {
    await label(page, removeLabel(name)).click();
    await saved(page, () => label(page, `Tap again to remove ${name} from today`).click());
  }
  await expect(start(page)).toBeVisible();
  await expectNames(page, []);

  await page.context().setOffline(false);
  await reloadTo(page, 'Workout');
  // The planned view ("Exercise 1: ...") is what shows when no session was stored; waiting for it keeps this from passing
  // on the empty moment before the day has been read back.
  await expect(page.locator('[aria-label^="Exercise 1: "] >> visible=true')).toBeVisible();
  await expectNames(page, []);
  await start(page).click();
  await expect(cards(page).first()).toBeVisible();
});
