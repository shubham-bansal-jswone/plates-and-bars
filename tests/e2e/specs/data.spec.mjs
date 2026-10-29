import { completeSetup, expect, label, saved, settled, tab, test } from '../support/app.mjs';

async function logRoti(page) {
  await tab(page, 'Food');
  await settled(label(page, '+ Add to breakfast'));
  await label(page, '+ Add to breakfast').click();
  // The sheet slides in; a tap while it moves is dropped on a slow runner (#1315, #1411), so wait until the row is still.
  const roti = page.locator('[aria-label^="Roti / chapati"]').first();
  await settled(roti);
  await saved(page, () => roti.click());
  await label(page, 'Done').click();
  await expect(label(page, '102 of 1,990 kcal eaten')).toBeVisible();
}

const openData = async (page) => {
  await tab(page, 'Targets');
  await label(page, 'Download or delete my data').click();
  await expect(page.getByText('Your data', { exact: true })).toBeVisible();
};

test('export: the device download works offline and holds what was logged', async ({ page }) => {
  await completeSetup(page);
  await logRoti(page);
  await page.context().setOffline(true);
  await openData(page);

  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await label(page, 'Download my data').click();
  await expect.poll(() => downloads.length).toBe(2);
  const byName = Object.fromEntries(downloads.map((d) => [d.suggestedFilename(), d]));
  const json = Object.keys(byName).find((n) => /^plate-and-bar-export-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  const csv = Object.keys(byName).find((n) => /^plate-and-bar-food-log-\d{4}-\d{2}-\d{2}\.csv$/.test(n));
  expect(json, `files: ${Object.keys(byName)}`).toBeTruthy();
  expect(csv, `files: ${Object.keys(byName)}`).toBeTruthy();

  const read = async (d) => (await import('node:fs/promises')).readFile(await d.path(), 'utf8');
  const file = JSON.parse(await read(byName[json]));
  expect(file).toMatchObject({ format_version: 1, source: 'device', user_id: null });
  expect(file.tables.food_logs.filter((l) => !l.deleted_at)).toHaveLength(1);
  expect(file.tables.food_logs[0]).toMatchObject({ name: 'Roti / chapati', meal: 'Breakfast' });
  const rows = (await read(byName[csv])).split('\n');
  expect(rows[0]).toBe('date,meal,food,servings,kcal,protein_g,carbs_g,fat_g');
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatch(/,Breakfast,"Roti \/ chapati",1,102,/);
  await expect(page.getByText(`Saved ${json}.`)).toBeVisible();
});

test('delete everything: cancel keeps the data, confirming clears this device and setup starts again', async ({ page }) => {
  await completeSetup(page);
  await logRoti(page);
  await openData(page);

  // Cancel changes nothing.
  await label(page, 'Delete everything').click();
  await expect(page.getByText('Delete everything?', { exact: true })).toBeVisible();
  await expect(page.getByText('This device is not linked to an account, so this deletes the data on this device only.')).toBeVisible();
  await label(page, 'Cancel').click();
  await expect(page.getByText('Your data', { exact: true })).toBeVisible();

  await label(page, 'Delete everything').click();
  await label(page, 'Yes, delete everything').click();
  // The wipe removes the profile, so the app lands at the start of setup with a one-time notice that is true for a device
  // that never had an account (#368), and stays there after a reload.
  await expect(page.getByText('Everything deleted. The data on this device is gone.')).toBeVisible();
  await expect(page.getByText(/Your account still exists/)).toHaveCount(0);
  await expect(label(page, 'I understand and agree to my data being stored as described')).toBeVisible();
  await page.reload({ waitUntil: 'load' });
  await expect(label(page, 'I understand and agree to my data being stored as described')).toBeVisible({ timeout: 40_000 });
});

// The confirm text must name what the wipe clears (consents, day notes, lift stats, kitchen tests, exclusions, swaps, the sync queue) (#370).
test('delete everything: the confirmation names what the wipe clears', async ({ page }) => {
  await completeSetup(page);
  await openData(page);
  await label(page, 'Delete everything').click();
  const text = await page.getByText(/This permanently deletes /).innerText();
  expect(text).toMatch(/kitchen tests/i);
  expect(text).toMatch(/consent/i);
  expect(text).toMatch(/lift|workout sets/i);
});
