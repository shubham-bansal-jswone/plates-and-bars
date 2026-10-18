// Held-back cards (#969): the site reads `hidden` from content/cards.json, the same flag the app reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isHeldBack } from "../src/lib/held-back.mjs";

const cardsJson = fileURLToPath(new URL("../../../content/cards.json", import.meta.url));
const cardsSrc = readFileSync(new URL("../src/lib/cards.ts", import.meta.url), "utf8");

test("only hidden: true holds a card back; a card without the field is shown", () => {
  assert.equal(isHeldBack({ id: "a", hidden: true, hidden_reason: "x" }), true);
  assert.equal(isHeldBack({ id: "b" }), false);
  assert.equal(isHeldBack({ id: "c", hidden: false }), false);
  assert.equal(isHeldBack({ id: "d", hidden: "true" }), false);
});

test("the shipped cards.json holds back ramp, ladder and formfirst, each with a reason", () => {
  const { cards } = JSON.parse(readFileSync(cardsJson, "utf8"));
  const held = cards.filter(isHeldBack);
  assert.deepEqual(held.map((c) => c.id), ["ramp", "ladder", "formfirst"]);
  for (const c of held) assert.ok(c.hidden_reason.length > 0, c.id);
});

test("the site keeps no list of its own and filters with the shared flag", () => {
  assert.ok(!/HIDDEN_CARDS/.test(cardsSrc));
  assert.ok(/all\.filter\(\(c\) => !isHeldBack\(c\)\)/.test(cardsSrc));
});
