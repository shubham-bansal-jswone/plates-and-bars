import { completeSetup, expect, label, saved, tab, test } from '../support/app.mjs';

// Progress photos on the web build: no camera (only "Choose"), and photos live in memory for the tab, so there is no reload case.
// A 2x2 PNG; the app re-encodes it to JPEG, so this also runs the resize/compress path.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQIW2P8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=', 'base64');
const photo = { name: 'front.png', mimeType: 'image/png', buffer: PNG };

const checkin = (page) => page.locator('[role="dialog"][aria-label="Photo check-in"]');

test.beforeEach(async ({ page }) => {
  await completeSetup(page);
  await tab(page, 'Progress');
  await expect(page.getByRole('heading', { name: 'Progress photos' })).toBeVisible();
});

test('progress photos: the web build says photos stay in the tab and offers no camera', async ({ page }) => {
  await expect(page.getByText('Kept only in this browser tab', { exact: false })).toBeVisible();
  await expect(page.getByText('No photos yet.', { exact: false })).toBeVisible();
  await label(page, 'New photo check-in').click();
  // A named dialog that starts with focus on its title (#661).
  await expect(checkin(page)).toBeVisible();
  await expect(checkin(page).getByRole('heading', { name: 'Photo check-in' })).toBeFocused();
  await expect(label(page, 'Choose front')).toBeVisible();
  await expect(page.locator('[aria-label^="Take "]')).toHaveCount(0); // camera is device only
});

test('progress photos: choose a front photo, it shows in the check-ins, and deleting asks twice', async ({ page }) => {
  await label(page, 'New photo check-in').click();
  const chooser = page.waitForEvent('filechooser');
  await label(page, 'Choose front').click();
  await (await chooser).setFiles(photo);
  await expect(label(page, 'Front photo')).toBeVisible();
  await expect(label(page, 'Choose another front')).toBeVisible();
  await label(page, 'Done').click();
  await expect(checkin(page)).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Check-ins' })).toBeVisible();
  await expect(page.locator('[aria-label^="Check-in "]')).toHaveCount(1);
  await expect(label(page, 'Add to today’s photos')).toBeVisible();

  await page.locator('[aria-label^="Delete the "]').click();
  await expect(page.locator('[aria-label^="Check-in "]')).toHaveCount(1); // the first tap only arms it
  await page.locator('[aria-label^="Tap again to delete the "]').click();
  await expect(page.getByText('Check-in deleted')).toBeVisible();
  await expect(page.locator('[aria-label^="Check-in "]')).toHaveCount(0);
  await expect(page.getByText('No photos yet.', { exact: false })).toBeVisible();
});

test('progress photos: cancelling the file picker adds nothing and does not error', async ({ page }) => {
  await label(page, 'New photo check-in').click();
  const chooser = page.waitForEvent('filechooser');
  await label(page, 'Choose side').click();
  await (await chooser).setFiles([]);
  await expect(label(page, 'Side photo')).toHaveCount(0);
  await expect(label(page, 'Choose side')).toBeVisible();
});
