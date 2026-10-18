import { completeSetup, openApp, saved, tab } from '../support/app.mjs';
import { expect, label, signIn, test } from '../support/sync.mjs';

// Needs the backend stack (README.md, "Sync tests"). Part of #688. Waits are on the badge and on screen text, never fixed sleeps:
// a store write shows "Not synced" at once (SyncProvider's onStoreWrite) and the browser's `online` event starts a sync.
const newEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const badge = (page, text) => page.locator(`[aria-label^=${JSON.stringify(`${text}.`)}]`);

async function logRoti(page, meal) {
  await tab(page, 'Food');
  await label(page, `+ Add to ${meal}`).click();
  await saved(page, () => page.locator('[aria-label^="Roti / chapati"]').first().click());
  await label(page, 'Done').click();
}

async function openedOn(page, email) {
  await openApp(page);
  await signIn(page, email);
  // Consent is kept per device, so the returning user is asked again (the profile came down with the sign-in).
  await label(page, 'I understand and agree to my data being stored as described').click();
  await label(page, 'Continue').click();
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
  await expect(label(a, '204 of 1,990 kcal eaten')).toBeVisible();
  // Still queued: nothing reached the server while offline.
  await expect(badge(a, 'Not synced')).toBeVisible();

  await a.context().setOffline(false);
  await expect(badge(a, 'Synced')).toBeVisible();

  // The server has both: a second device signed in to the same account sees the total of the two meals.
  const b = await device();
  await openedOn(b, email);
  await tab(b, 'Food');
  await expect(label(b, '204 of 1,990 kcal eaten')).toBeVisible();
});

test('deleting the account on one device signs the other device out', async ({ device }) => {
  const email = newEmail();
  const a = await device();
  await completeSetup(a);
  await signIn(a, email);
  await logRoti(a, 'breakfast');
  await expect(badge(a, 'Synced')).toBeVisible();

  const b = await device();
  await openedOn(b, email);
  await tab(b, 'Food');
  await expect(label(b, '102 of 1,990 kcal eaten')).toBeVisible();

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
