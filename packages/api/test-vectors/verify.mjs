// Checks test-vectors/sync-ids.json against an independent UUIDv5 (RFC 9562 / RFC 4122) built on node:crypto,
// and test-vectors/content-hash.json against node:crypto's SHA-256.
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
// The spec's own /sync and /me/export examples must use the real ids for the example user.
const spec = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");
const exampleUser = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
for (const [pattern, name] of [
  [/workout_id: ([0-9a-f-]{36})/g, "workouts:2026-10-08"],
  [/weights:\s*\n\s*- id: ([0-9a-f-]{36})/g, "weights:2026-10-08"],
  [/profiles:\s*\n\s*- id: ([0-9a-f-]{36})/g, "profiles:me"],
  [/settings:\s*\n\s*- id: ([0-9a-f-]{36})/g, "settings:me"],
]) {
  const vector = vectors.cases.find((c) => c.user_id === exampleUser && c.name === name);
  if (!vector) failures.push(`no vector for ${name}`);
  const found = [...spec.matchAll(pattern)].map((m) => m[1]);
  if (found.length === 0) failures.push(`openapi.yaml: no example id for ${name}`);
  for (const id of found) if (vector && id !== vector.id) failures.push(`openapi.yaml: ${name} example id ${id}, expected ${vector.id}`);
}
// content-hash.json: sha256, size and ETag of exact bytes; two FIPS 180-2 / NIST values pin the hash itself.
const content = JSON.parse(readFileSync(new URL("./content-hash.json", import.meta.url), "utf8"));
const nist = {
  "": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
};
for (const [text, sha] of Object.entries(nist)) {
  if (!content.cases.some((c) => c.text === text && c.sha256 === sha)) failures.push(`content-hash.json: missing NIST vector for "${text}"`);
}
for (const [i, c] of content.cases.entries()) {
  const bytes = Buffer.from(c.text, "utf8");
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (bytes.toString("hex") !== c.utf8_hex) failures.push(`content-hash cases[${i}].utf8_hex`);
  if (bytes.length !== c.size_bytes) failures.push(`content-hash cases[${i}].size_bytes`);
  if (sha !== c.sha256) failures.push(`content-hash cases[${i}].sha256: expected ${sha}`);
  if (c.etag !== `"${sha}"`) failures.push(`content-hash cases[${i}].etag is not the quoted sha256`);
}
// The spec's content examples: the manifest is sorted by name, and every quoted-hash (ETag) example is the
// sha256 of the measures entry in the manifest example, the bundle the /content/{bundle} example shows.
const manifest = [...spec.matchAll(/- name: ([a-z][a-z0-9-]*)\n\s+schema_version: \d+\n\s+sha256: ([0-9a-f]{64})/g)];
const names = manifest.map((m) => m[1]);
if (names.length === 0) failures.push("openapi.yaml: no content manifest example");
if (names.join() !== [...names].sort().join()) failures.push("openapi.yaml: content manifest example is not sorted by name");
const measures = manifest.find((m) => m[1] === "measures");
if (!measures) failures.push("openapi.yaml: content manifest example has no measures entry");
const etags = [...spec.matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
if (etags.length === 0) failures.push("openapi.yaml: no ETag examples");
for (const e of etags) if (measures && e !== measures[2]) failures.push(`openapi.yaml: ETag example ${e} is not the measures sha256`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`sync-ids.json: rfc_example, ${vectors.cases.length} cases and openapi.yaml example ids verified`);
console.log(`content-hash.json: ${content.cases.length} cases and openapi.yaml content examples verified`);
