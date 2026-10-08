// Checks test-vectors/sync-ids.json against an independent UUIDv5 (RFC 9562 / RFC 4122) built on node:crypto.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const vectors = JSON.parse(readFileSync(new URL("./sync-ids.json", import.meta.url), "utf8"));

function uuidv5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const failures = [];
const rfc = vectors.rfc_example;
if (uuidv5(rfc.namespace, rfc.name) !== rfc.id) failures.push(`rfc_example: expected ${rfc.id}`);
for (const [i, c] of vectors.cases.entries()) {
  const name = `${c.table}:${c.key}`;
  if (c.name !== name) failures.push(`cases[${i}].name is not <table>:<key>`);
  if (Buffer.from(name, "utf8").toString("hex") !== c.name_utf8_hex) failures.push(`cases[${i}].name_utf8_hex`);
  if (uuidv5(c.user_id, name) !== c.id) failures.push(`cases[${i}] (${name}): expected ${c.id}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`sync-ids.json: rfc_example and ${vectors.cases.length} cases verified`);
