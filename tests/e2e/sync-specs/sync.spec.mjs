import { completeSetup, openApp, saved, tab } from '../support/app.mjs';
import { expect, label, signIn, test } from '../support/sync.mjs';

// Needs the backend stack (README.md, "Sync tests"). One account, two devices (browser contexts).
test('log a meal offline, sync it to a second device, then delete the account', async ({ device }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const badge = (page, text) => page.locator(`[aria-label^=${JSON.stringify(`${text}.`)}]`);

  // Device A: set up, sign in by emailed code.
  const a = await device();
  await completeSetup(a);
  await signIn(a, email);
  await expect(badge(a, 'Synced')).toBeVisible();

  // Offline: the meal is saved on the device and the badge says it is not synced.
  await a.context().setOffline(true);
  await tab(a, 'Food');
  await label(a, '+ Add to breakfast').click();
  await saved(a, () => a.locator('[aria-label^="Add Roti / chapati"]').first().click());
  await label(a, 'Done').click();
  await expect(label(a, '102 of 1,990 kcal eaten')).toBeVisible();
  // The badge count is only refreshed by the 30 s sync tick (a bug, filed), so allow one tick before it says so.
  await expect(badge(a, 'Not synced')).toBeVisible({ timeout: 45_000 });

  // Back online: the app syncs on the browser's online event and the badge clears.
  await a.context().setOffline(false);
  await expect(badge(a, 'Synced')).toBeVisible({ timeout: 45_000 });

  // Device B: a fresh profile signs in to the same account and gets the record.
  const b = await device();
  await openApp(b);
  await signIn(b, email);
  // Consent is kept per device, so the returning user is asked again (the profile came down with the sign-in).
  await label(b, 'I understand and agree to my data being stored as described').click();
  await label(b, 'Continue').click();
  await tab(b, 'Food');
  await expect(label(b, '102 of 1,990 kcal eaten')).toBeVisible({ timeout: 30_000 });

  // Delete the account on A (it is online, so the server deletes too).
  await tab(a, 'Targets');
  await label(a, 'Download or delete my data').click();
  await label(a, 'Delete everything').click();
  await label(a, 'Yes, delete everything').click();
  await expect(a.getByText('Everything deleted. Your account and the data on this device are gone.')).toBeVisible();

  // B is signed out the next time it syncs: ask it to sync now.
  await b.locator('[aria-label^="Synced."]').click();
  await label(b, 'Sync now').click();
  // The account screen drops to its signed-out form (and the badge is hidden on that screen).
  await expect(label(b, 'Email address')).toBeVisible({ timeout: 30_000 });
});
