import { answerSetup, expect, label, openApp, test } from '../support/app.mjs';

// #1200: intermittent blank page on reload at 768 px, and health-check taps in one JS tick.
const READY = '[aria-label="Continue"], [aria-label="Redo setup"]';

test('ten reloads at 768 px each show the app in under 15 s with no page error', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openApp(page);
  await expect(page.locator(READY).first()).toBeVisible({ timeout: 40_000 });
  for (let i = 0; i < 10; i += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(READY).first(), `reload ${i}`).toBeVisible({ timeout: 15_000 });
  }
});

test('health-check answers tapped one after another all register', async ({ page }) => {
  await answerSetup(page, { stop: 'screening' });
  const radios = page.locator('[role="radiogroup"] [aria-label="No"]');
  const count = await radios.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i += 1) await radios.nth(i).click(); // separate real events, as a user taps
  // "See my targets" refuses an unanswered question, so reaching the results proves every tap registered.
  await label(page, 'See my targets').click();
  await expect(label(page, 'Use these targets')).toBeVisible();
});

// Known failure (#1232): a second tab of the same origin blocks on the first tab's OPFS access handle
// ("createSyncAccessHandle ... another open Access Handle"), SQLiteProvider rethrows, and the page stays blank for good.
// When #1232 is fixed this reports "expected to fail, but passed" (red): then drop test.fail() and assert the real message.
test('a second tab opened while the first is open shows the app or a message, not a blank page', async ({ page, context }) => {
  await openApp(page);
  await expect(page.locator(READY).first()).toBeVisible({ timeout: 40_000 });
  test.fail(true, '#1232: the second tab stays blank');
  const second = await context.newPage();
  await second.goto('/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await expect(second.locator('body')).not.toHaveText('', { timeout: 10_000 });
});
