// /licenses/ (#835): the Java/Kotlin libraries of the Android build are listed on the app's About screen, built from the
// resolved release classpath, together with the third-party native code (#904, #923), so the page points there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/licenses.astro", import.meta.url), "utf8");

test("points to the About screen's list of npm packages, Java/Kotlin libraries and native code", () => {
  assert.match(page, /About screen, under Open-source licences, lists every npm package, every Java\/Kotlin library on the release build's classpath and the third-party native code linked into the app/);
  assert.doesNotMatch(page, /does not cover the Android/);
});

test("no longer says native code is unlisted", () => {
  assert.doesNotMatch(page, /not listed yet|issues\/904/);
  assert.doesNotMatch(page, /every Android library in the app's release build/);
});
