// /licenses/ (#835): the Android libraries are listed on the app's About screen, built from the resolved release classpath,
// so the page points there instead of saying they are not covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/licenses.astro", import.meta.url), "utf8");

test("points to the About screen's list of npm packages and Android libraries", () => {
  assert.match(page, /About screen, under Open-source licences, lists every npm package and every Android library in the app's release build/);
  assert.doesNotMatch(page, /does not cover the Android/);
});
