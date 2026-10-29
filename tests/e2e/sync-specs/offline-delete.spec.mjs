import { completeSetup, saved, settled, tab } from '../support/app.mjs';
import { badge, expect, label, newEmail, openedOn, signIn, test } from '../support/sync.mjs';

// Needs the backend stack (README.md, "Sync tests"). Part of #688. Waits are on the badge and on screen text, never fixed sleeps:
// a store write shows "Not synced" at once (SyncProvider's onStoreWrite) and the browser's `online` event starts a sync.
// One serving of Roti / chapati is 102 kcal (content/foods.json).
const ROTI = 102;

async function logRoti(page, meal) {
  await tab(page, 'Food');
  await settled(label(page, `+ Add to ${meal}`));
  await label(page, `+ Add to ${meal}`).click();
  // The sheet slides in; a tap while it moves is dropped on a slow runner (#1315, #1411), so wait until the row is still.
  const roti = page.locator('[aria-label^="Roti / chapati"]').first();
  await settled(roti);
  await saved(page, () => roti.click());
  await label(page, 'Done').click();
}

test('two meals logged offline are queued, then sync when the browser is back online', async ({ device }) => {
  const email = newEmail();
  const a = await device();
  await completeSetup(a);
  await signIn(a, email);
  await expect(badge(a, 'Synced')).toBeVisible();

  await a.context().setOffline(true);
  await logRoti(a, 'breakfast');
  await expect(badge(a, 'Not synced')).toBeVisible();
  await logRoti(a, 'lunch');
  await expect(label(a, `${2 * ROTI} of 1,990 kcal eaten`)).toBeVisible();
  // Still queued: nothing reached the server while offline.
  await expect(badge(a, 'Not synced')).toBeVisible();

  await a.context().setOffline(false);
  await expect(badge(a, 'Synced')).toBeVisible();

  // The server has both: a second device signed in to the same account sees the total of the two meals.
  const b = await device();
  await openedOn(b, email);
  await tab(b, 'Food');
  await expect(label(b, `${2 * ROTI} of 1,990 kcal eaten`)).toBeVisible();
});

test('deleting the account on one device signs the other device out', async ({ device }) => {
  const email = newEmail();
  const a = await device();
  await completeSetup(a);
  await signIn(a, email);
  await logRoti(a, 'breakfast');
  // A store write only queues the change; a push needs the 30 s tick, an online event or Sync now. Press Sync now.
  await expect(badge(a, 'Not synced')).toBeVisible();
  await badge(a, 'Not synced').click();
  await label(a, 'Sync now').click();
  await label(a, 'Done').click();
  await expect(badge(a, 'Synced')).toBeVisible();

  const b = await device();
  await openedOn(b, email);
  await tab(b, 'Food');
  await expect(label(b, `${ROTI} of 1,990 kcal eaten`)).toBeVisible();

  // Delete on A (online, so the server deletes too).
  await tab(a, 'Targets');
  await label(a, 'Download or delete my data').click();
  // Click only once the storage line is there: it shifts the buttons down (#986, #1034).
  await expect(a.getByText('Saved privately to your account.')).toBeVisible();
  await label(a, 'Delete everything').click();
  await label(a, 'Yes, delete everything').click();
  await expect(a.getByText('Everything deleted. Your account and the data on this device are gone.')).toBeVisible();

  // B finds out on its next sync: the account is gone on the server, so B drops to the signed-out form.
  await badge(b, 'Synced').click();
  await label(b, 'Sync now').click();
  await expect(label(b, 'Email address')).toBeVisible();
});
