// PUBLIC_WEB_APP_URL (#830): the parser, and a real build without it, with it and with a bad value.
// Run with `npm test` (part of `npm run check`). Each build goes to its own temporary directory, so dist/ is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webAppUrl } from "../src/lib/web-app-url.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const astro = join(site, "node_modules", ".bin", "astro");
const URL_SET = "https://app.example.test";

test("unset or empty means no link", () => {
  assert.equal(webAppUrl(undefined), null);
  assert.equal(webAppUrl(""), null);
});

test("an https origin is accepted, with or without a trailing slash", () => {
  assert.equal(webAppUrl("https://app.example.test"), "https://app.example.test/");
  assert.equal(webAppUrl("https://app.example.test/"), "https://app.example.test/");
  assert.equal(webAppUrl("https://app.example.test:8443"), "https://app.example.test:8443/");
});

test("anything else fails the build", () => {
  for (const bad of [
    "http://app.example.test",
    "app.example.test",
    "javascript:alert(1)",
    "https://app.example.test/app",
    "https://app.example.test/?x=1",
    "https://app.example.test/#top",
    "https://user:pass@app.example.test",
    "https://App.example.test",
    " https://app.example.test",
    "https://app.example.test//",
  ]) {
    assert.throws(() => webAppUrl(bad), /PUBLIC_WEB_APP_URL must be an https origin/, bad);
  }
});

/** Builds the site with PUBLIC_WEB_APP_URL set to `value` (undefined: unset) and returns the two pages, or the failure. */
function build(value) {
  const out = mkdtempSync(join(tmpdir(), "site-web-app-"));
  const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };
  delete env.PUBLIC_WEB_APP_URL;
  if (value !== undefined) env.PUBLIC_WEB_APP_URL = value;
  try {
    const r = spawnSync(astro, ["build", "--outDir", out], { cwd: site, env, encoding: "utf8" });
    if (r.status !== 0) return { ok: false, log: `${r.stdout}\n${r.stderr}` };
    const page = (p) => readFileSync(join(out, p, "index.html"), "utf8");
    return { ok: true, landing: page("."), deletion: page("delete-account") };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test("build without PUBLIC_WEB_APP_URL: no link, today's badge, no web deletion path", () => {
  const b = build(undefined);
  assert.ok(b.ok, b.log);
  assert.ok(b.landing.includes("Coming to Android and web"));
  assert.ok(!b.landing.includes("Open the web app"));
  assert.ok(!b.landing.includes("Use it on the web"));
  assert.ok(!b.deletion.includes("Delete on the web"));
  assert.ok(b.deletion.includes("If you cannot use the app"));
  assert.ok(b.deletion.includes("This is the way to delete your account."));
  assert.ok(b.deletion.includes("DRAFT. Pending lawyer review"));
});

test("build with PUBLIC_WEB_APP_URL: the call to action, the new badge, and the web deletion path before the email path", () => {
  const b = build(URL_SET);
  assert.ok(b.ok, b.log);
  assert.match(b.landing, /<a class="btn btn-primary" href="https:\/\/app\.example\.test\/"[^>]*>Open the web app<\/a>/);
  assert.ok(b.landing.includes("Use it on the web, coming to Android"));
  assert.ok(!b.landing.includes("Coming to Android and web"));
  const web = b.deletion.indexOf("Delete on the web");
  const email = b.deletion.indexOf("If you cannot use the app");
  assert.ok(web > 0 && email > web, "web path is listed before the email path");
  assert.match(b.deletion.slice(web, email), /href="https:\/\/app\.example\.test\/"/);
  // The app's own labels: the SyncBadge, the Targets button and the account screen.
  for (const step of ['"Sign in to sync"', "6-digit code", "On Targets", '"Download or delete my data"', '"Your data"', '"Delete everything"']) {
    assert.ok(b.deletion.slice(web, email).includes(step), step);
  }
  // With a second self-service path the app is no longer "the way" to delete.
  assert.ok(!b.deletion.includes("This is the way to delete your account."));
  assert.ok(b.deletion.includes("DRAFT. Pending lawyer review"));
});

test("build with a bad PUBLIC_WEB_APP_URL fails", () => {
  const b = build("http://app.example.test");
  assert.equal(b.ok, false);
  assert.match(b.log, /PUBLIC_WEB_APP_URL must be an https origin/);
});
