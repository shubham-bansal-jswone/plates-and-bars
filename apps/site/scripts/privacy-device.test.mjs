// The privacy page covers the v1.1 device permissions and image features (#975). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("../src/pages/privacy.astro", import.meta.url)), "utf8");
const flat = page.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const start = flat.indexOf("Device features and permissions");
const section = flat.slice(start, flat.indexOf("Crash and error reports", start));

test("the draft marker stays", () => {
  assert.match(flat, /DRAFT\. Pending lawyer review/);
});

test("the step counter is an on-device count whose day total syncs like typed steps", () => {
  assert.match(section, /reads your phone's step sensor on the device/);
  assert.match(section, /syncs like steps you type yourself/);
});

test("reminders are local notifications with no push service", () => {
  assert.match(section, /local notifications scheduled on your phone/);
  assert.match(section, /do not run a push notification service/);
});

test("camera frames stay on the phone; barcode digits go to the server, cached and redacted", () => {
  assert.match(section, /camera frames never leave your phone/);
  assert.match(section, /only its digits are sent to our server, which asks Open Food Facts/);
  assert.match(section, /30 days \(24 hours when the product is not found\)/);
  assert.match(section, /our logs redact the code/);
  assert.match(flat, /Barcode lookup cache: a product fact is kept for 30 days/);
});

test("live pose tracking is on device only", () => {
  assert.match(section, /Live pose tracking.*analysed on your device only/);
});

test("AI image features: re-encoded, never stored or logged, off by default", () => {
  assert.match(flat, /When the AI image features are switched on \(they are off by default\)/);
  assert.match(flat, /re-encodes each image as a new picture/);
  assert.match(flat, /images are never stored or logged/);
  assert.match(flat, /The video itself never leaves your phone/);
});

test("the page no longer claims that no photos are ever sent", () => {
  assert.doesNotMatch(flat, /No photos are sent anywhere/);
  assert.match(flat, /Your progress photos are never sent anywhere/);
});
