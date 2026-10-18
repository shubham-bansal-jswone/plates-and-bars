// The privacy page says the cycle log stays on the device (#625). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("../src/pages/privacy.astro", import.meta.url)), "utf8");
const flat = page.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

test("the cycle log is named as device-only in the short version and in its own paragraph", () => {
  assert.match(flat, /Progress photos, cycle logs and lab reports stay only on this device\./);
  assert.match(flat, /The cycle log is optional and off until you turn it on\./);
  assert.match(flat, /never synced, never sent to our server and never sent to an AI service/);
});

test("the cycle log is covered by the device download and by delete", () => {
  assert.match(flat, /included in the copy you download from your device \(not in the copy from our server\)/);
  assert.match(flat, /"Delete everything" and "Turn off and delete" in the log itself remove it/);
});

test("the server list does not mention the cycle log as stored", () => {
  const stored = flat.slice(flat.indexOf("What we store on our server"), flat.indexOf("Who else handles your data"));
  assert.doesNotMatch(stored, /cycle/i);
});
