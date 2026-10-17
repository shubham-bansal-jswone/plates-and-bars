import { expect, test as base } from '@playwright/test';
import { label, trackDbWrites } from './app.mjs';

/** Where `docker compose up` in tests/e2e/stack publishes the Mailpit HTTP API and the API. */
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:18025';
export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:18080/api/v1';

const OPTIONS = { viewport: { width: 390, height: 800 }, locale: 'en-US', timezoneId: 'Asia/Kolkata' };

const mailTo = async (address) => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json()).messages ?? [];

/**
 * The newest sign-in code mailed to `address` once more than `known` messages exist for it (the number before the
 * code was requested, so an earlier sign-in's mail is never taken). The dev stack sends mail to Mailpit, an SMTP sink
 * whose HTTP API lists it; the body reads "Your Plate & Bar sign-in code is 123456.". Polls: the mail is sent asynchronously.
 */
export async function codeFor(address, known = 0) {
  let code;
  await expect
    .poll(
      async () => {
        const messages = await mailTo(address);
        if (messages.length <= known) return false;
        const newest = messages.sort((x, y) => Date.parse(y.Created) - Date.parse(x.Created))[0];
        const msg = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
        code = /\b(\d{6})\b/.exec(msg.Text ?? '')?.[1];
        return !!code;
      },
      { message: `no sign-in code mailed to ${address}`, timeout: 20_000 },
    )
    .toBe(true);
  return code;
}

/**
 * Two browser contexts are two devices. Each is a fresh profile with a pinned clock; only the web server, the API and
 * nothing else is reachable (anything else is aborted and fails the test at teardown, as in support/app.mjs).
 */
export const test = base.extend({
  device: async ({ browser, baseURL }, use) => {
    const origins = new Set([new URL(baseURL).origin, new URL(API).origin]);
    const blocked = [];
    const errors = [];
    const contexts = [];
    const open = async () => {
      const context = await browser.newContext({ ...OPTIONS, baseURL });
      contexts.push(context);
      await context.route(
        (url) => url.protocol.startsWith('http') && !origins.has(url.origin),
        (route) => {
          blocked.push(route.request().url());
          return route.abort();
        },
      );
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+05:30'));
      await page.addInitScript(trackDbWrites);
      page.on('pageerror', (e) => errors.push(e.message));
      return page;
    };
    await use(open);
    await Promise.all(contexts.map((c) => c.close()));
    expect(errors, 'uncaught page errors').toEqual([]);
    expect(blocked, 'requests to anything but the web server and the API').toEqual([]);
  },
});
export { expect, label };

/** Opens the account screen from the sync badge and signs in with the code the stack mails to `email`. */
export async function signIn(page, email) {
  await page.locator('[aria-label^="Sign in to sync"]').click();
  await label(page, 'Email address').fill(email);
  const known = (await mailTo(email)).length;
  await label(page, 'Send code').click();
  await label(page, '6-digit code').fill(await codeFor(email, known));
  await label(page, 'Sign in').click();
  await expect(page.getByText('You are signed in and everything is synced.')).toBeVisible();
  await label(page, 'Done').click();
}
