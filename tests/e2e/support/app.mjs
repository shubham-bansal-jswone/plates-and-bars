import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test as base } from '@playwright/test';

const require = createRequire(import.meta.url);
export const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * Locator for the visible element with an exact accessibility label (aria-label), the selector the whole suite uses.
 * Visible only: screens lower in the navigation stack stay mounted (hidden), so labels like "Back" can repeat.
 */
export const label = (page, text) => page.locator(`[aria-label=${JSON.stringify(text)}] >> visible=true`);

/**
 * Every test gets a fresh browser context (empty origin storage, so a fresh database) with only localhost reachable:
 * any other request is aborted and recorded, and every test fails at teardown if there was one.
 * AI and sync stay off because nothing is signed in and no server is configured.
 */
export const test = base.extend({
  page: async ({ page, context, baseURL }, use) => {
    const host = new URL(baseURL).host;
    const blocked = [];
    // On the context, so requests from workers are caught too.
    await context.route(
      (url) => url.host !== host && url.protocol.startsWith('http'),
      (route) => {
        blocked.push(route.request().url());
        return route.abort();
      },
    );
    // The app's day, next-meal card and planned session depend on the clock: pin it (a Monday morning in India) so runs do not vary.
    await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+05:30'));
    await page.addInitScript(trackDbWrites);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // The server sends the shipped Content-Security-Policy (#749); a blocked load or script shows up as a console error.
    const csp = [];
    page.on('console', (m) => /Content Security Policy|Content-Security-Policy/i.test(m.text()) && csp.push(m.text()));
    await use(page);
    expect(csp, 'Content-Security-Policy violations').toEqual([]);
    expect(errors, 'uncaught page errors').toEqual([]);
    // Checked for every test: an app that calls out and swallows the failure must not pass.
    expect(blocked, 'requests to anything but localhost').toEqual([]);
  },
});
export { expect };

/** Opens the app. The app redirects to /setup while loading, which Chrome reports as an aborted first navigation. */
export async function openApp(page, path = '/') {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
}

/**
 * Answers the setup steps (the same answers as apps/mobile/scripts/web-reload.mjs) and stops where asked:
 * `stop: 'screening'` on the goal step (it carries the "Quick health check" Why link), `stop: 'results'` on the results
 * ("Use these targets" is still to press), or never (lands on the results too, so completeSetup can finish).
 * `days` is the accessible label of the days-a-week choice ('6' by default, 'None yet' for none). `age` and `where` (the exact accessible label of the training-place choice) change the results notes: 60 or older
 * adds the older-lifter note, and a home choice adds the home-plan note, each with its Why link.
 */
export async function answerSetup(page, { age = '30', where = 'At a gym. Machines, cables, barbells and dumbbells', stop = 'results', days = '6' } = {}) {
  await openApp(page);
  await expect(label(page, 'Continue')).toBeVisible({ timeout: 40_000 });
  await label(page, 'I understand and agree to my data being stored as described').click();
  await label(page, 'Continue').click();
  await label(page, 'Male').click();
  await label(page, 'Age').fill(age);
  await label(page, 'Use cm').click();
  await label(page, 'Height in cm').fill('165');
  await label(page, 'Weight in kg').fill('82');
  await label(page, 'Continue').click();
  await label(page, 'Mostly sitting. Desk job, little walking (under ~5,000 steps)').click();
  await label(page, 'Continue').click();
  await label(page, days).click(); // '6', or 'None yet' for no training days
  await label(page, where).click();
  await label(page, 'Some experience. 6 months to 2 years of regular training').click();
  await label(page, '60 min').click();
  await label(page, 'Continue').click();
  await label(page, 'Lose fat. Steady fat loss while keeping muscle').click();
  await expect(page.getByText('Quick health check', { exact: true })).toBeVisible();
  if (stop === 'screening') return;
  for (const no of await page.locator('[role="radiogroup"] [aria-label="No"]').all()) await no.click();
  await label(page, 'See my targets').click();
  await expect(label(page, 'Use these targets')).toBeVisible();
}

/** Runs the whole setup flow and lands on Targets. */
export async function completeSetup(page, answers) {
  await answerSetup(page, answers);
  await label(page, 'Use these targets').click();
  await expect(label(page, 'Redo setup')).toBeVisible(); // only Targets has it
  // Targets shows the editable "Daily targets" fields, not the read-only tiles (#483), so read the field's value.
  await expect(label(page, 'Calories (kcal)')).toHaveValue('1990');
}

/** Switches to a bottom tab (Food, Workout, Progress, Targets). */
export const tab = (page, name) => label(page, name).click();

/** Reloads the page and goes to the given tab (a no-op when the route came back to it), so the caller can assert on it. */
export async function reloadTo(page, tabName) {
  await page.reload({ waitUntil: 'load' });
  await expect(label(page, tabName)).toBeVisible({ timeout: 40_000 });
  await tab(page, tabName);
}

/**
 * expo-sqlite on web runs SQLite in a Worker. This init script counts the write statements sent to it and tracks its
 * unanswered async requests, so a test can tell when an edit has been written (see `saved`).
 */
export const trackDbWrites = () => {
  const state = { writes: 0, pending: new Set() };
  window.__db = state;
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => {
        const d = e.data;
        if (d && d.id !== undefined) state.pending.delete(d.id);
      });
    }
    postMessage(m, ...rest) {
      if (m && m.isSync === false) state.pending.add(m.id);
      if (m && m.type === 'prepare' && /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(m.data.source)) state.writes++;
      return super.postMessage(m, ...rest);
    }
  };
};

/**
 * Runs `action` (an edit in the UI) and resolves once a write statement was sent and every request to it is answered,
 * and has stayed that way for a few frames (queued writes issue the next statement right after the last answer).
 * Call it before a reload, so the reload reads back what the user saw. Event based; there is no fixed delay.
 */
export async function saved(page, action) {
  const before = await page.evaluate(() => window.__db.writes);
  await action();
  await page
    .waitForFunction(
      (before) =>
        new Promise((resolve) => {
          let quiet = 0;
          const tick = () => {
            const { writes, pending } = window.__db;
            quiet = writes > before && pending.size === 0 ? quiet + 1 : 0;
            if (quiet >= 5) resolve(true);
            else requestAnimationFrame(tick);
          };
          tick();
        }),
      before,
      { timeout: 15_000 },
    )
    .catch(() => {
      throw new Error('saved(): no SQLite write was sent and answered within 15 s after the action');
    });
}
