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
  assert.match(section, /Step counter \(physical activity permission, off by default\)/);
  assert.match(section, /Nothing else from the sensor leaves the phone/);
});

test("reminders are local notifications with no push service", () => {
  assert.match(section, /local notifications scheduled on your phone/);
  assert.match(section, /do not run a push notification service/);
});

test("camera frames stay on the phone; barcode digits go to the server, cached and redacted", () => {
  assert.match(section, /camera frames never leave your phone and no video or picture is saved/);
  assert.match(section, /for barcode scanning and live pose tracking/);
  assert.match(section, /progress photos, which stay encrypted on this device and are never sent/);
  assert.match(section, /when the AI image features are on, to take the meal photo/);
  assert.match(section, /with no user id/);
  assert.match(section, /its barcode is kept in your own synced food list/);
  assert.match(section, /The app \(on the web, your browser\) asks/);
  assert.match(section, /only its digits are sent to our server, which asks Open Food Facts/);
  assert.match(section, /30 days \(24 hours when the product is not found\)/);
  assert.match(section, /our logs redact the code/);
  assert.match(flat, /Barcode lookup cache: a product fact is kept for 30 days/);
});

test("live pose tracking is on device only", () => {
  assert.match(section, /Live pose tracking \(off by default\)/);
  assert.match(section, /Live pose tracking.*analysed on your device only/);
  assert.match(section, /only the rep count, if you choose to use it, goes into that set of your workout log\. Depth is never stored/);
  assert.doesNotMatch(section, /rep and depth counts/);
});

test("AI image features: re-encoded, never stored or logged, off by default", () => {
  assert.match(flat, /When the AI image features are switched on \(they are off by default\)/);
  assert.match(flat, /re-encodes each image as a new picture/);
  assert.match(flat, /images are never stored or logged/);
  assert.match(flat, /The video itself never leaves your phone/);
  assert.match(flat, /three more features can send a picture/);
  assert.match(flat, /pasted as text sends no picture/);
  assert.match(flat, /for the text features it may keep an answer in memory.*Image calls are never cached/);
});

test("the page no longer claims that no photos are ever sent", () => {
  assert.doesNotMatch(flat, /No photos are sent anywhere/);
  assert.match(flat, /Your progress photos are never sent anywhere/);
});

test("the licences page credits Open Food Facts under ODbL and DbCL", () => {
  const lic = readFileSync(fileURLToPath(new URL("../src/pages/licenses.astro", import.meta.url)), "utf8");
  assert.match(lic, /href="https:\/\/world\.openfoodfacts\.org"/);
  assert.match(lic, /Open Database Licence \(ODbL\) 1\.0/);
  assert.match(lic, /Database Contents Licence \(DbCL\) 1\.0/);
  assert.match(lic, /href="https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\/"/);
  assert.match(lic, /href="https:\/\/opendatacommons\.org\/licenses\/dbcl\/1-0\/"/);
  assert.match(lic, /CC BY-SA 3\.0/);
});
