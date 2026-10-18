// /licenses/ (#835): the Java/Kotlin libraries of the Android build are listed on the app's About screen, built from the
// resolved release classpath, so the page points there; native code inside them is not listed yet (#904) and the page says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/licenses.astro", import.meta.url), "utf8");

test("points to the About screen's list of npm packages and Java/Kotlin libraries", () => {
  assert.match(page, /About screen, under Open-source licences, lists every npm package and every Java\/Kotlin library on the release build's classpath/);
  assert.doesNotMatch(page, /does not cover the Android/);
});

test("says native code is not listed yet and links its issue", () => {
  assert.match(page, /Native code compiled into those libraries is not listed yet; that work is tracked in <a href="https:\/\/github\.com\/shubham-bansal-jswone\/plates-and-bars\/issues\/904">issue #904<\/a>/);
  assert.doesNotMatch(page, /every Android library in the app's release build/);
});
