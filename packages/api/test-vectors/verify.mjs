// Checks test-vectors/sync-ids.json against an independent UUIDv5 (RFC 9562 / RFC 4122) built on node:crypto,
// and test-vectors/content-hash.json against node:crypto's SHA-256.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

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
if (new Set(names).size !== names.length) failures.push("openapi.yaml: content manifest example repeats a bundle name");
const measures = manifest.find((m) => m[1] === "measures");
if (!measures) failures.push("openapi.yaml: content manifest example has no measures entry");
const etags = [...spec.matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
if (etags.length === 0) failures.push("openapi.yaml: no ETag examples");
for (const e of etags) if (measures && e !== measures[2]) failures.push(`openapi.yaml: ETag example ${e} is not the measures sha256`);
// Every tag an operation uses is declared once in the top-level `tags` list (Redocly's recommended
// rules do not check this).
const tagBlock = spec.match(/^tags:\n([\s\S]*?)^\S/m);
const declared = tagBlock ? [...tagBlock[1].matchAll(/^  - name: (\S+)$/gm)].map((m) => m[1]) : [];
if (declared.length === 0) failures.push("openapi.yaml: no top-level tags");
if (new Set(declared).size !== declared.length) failures.push("openapi.yaml: a top-level tag is declared twice");
const used = new Set([...spec.matchAll(/^ {6}tags: \[([^\]]*)\]$/gm)].flatMap((m) => m[1].split(",").map((t) => t.trim())));
if (used.size === 0) failures.push("openapi.yaml: no operation tags found");
for (const t of used) if (!declared.includes(t)) failures.push(`openapi.yaml: operation tag ${t} is not declared under tags`);
// Every string, array and open object reachable from a sync record schema or a POST /ai/* request body is
// bounded (maxLength, maxItems, maxProperties), so the server can cap what one account stores (#353) and what
// one AI call sends to the provider (#469). Enums, formats and consts count as bounds for strings; a pattern
// counts only when it is anchored at both ends and has no `*`, `+` or open `{n,}` repeat (`\S` bounds
// nothing). "Open object" means one that declares `additionalProperties`; objects without it, and the
// contents of `additionalProperties: true` objects, are not checked (see the wire conventions).
const parsed = load(spec);
const boundedPattern = (p) => typeof p === "string" && p.startsWith("^") && p.endsWith("$") && !/[*+]|\{\d+,\}/.test(p);
function checkAllBounds(doc) {
  const schemas = doc.components.schemas;
  const found = [];
  const seenRefs = new Set();
  let count = 0;
  function walk(node, path) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (typeof node.$ref === "string") {
      const name = node.$ref.split("/").pop();
      if (!seenRefs.has(name)) {
        seenRefs.add(name);
        walk(schemas[name], name);
      }
    }
    const types = [].concat(node.type ?? []);
    const isString = types.includes("string") && !node.enum && !node.format && !boundedPattern(node.pattern) && node.const === undefined;
    const isArray = types.includes("array");
    const isOpen = types.includes("object") && node.additionalProperties !== undefined && node.additionalProperties !== false;
    if (isString && node.maxLength == null) found.push(`openapi.yaml: unbounded string at ${path}`);
    if (isArray && node.maxItems == null) found.push(`openapi.yaml: unbounded array at ${path}`);
    if (isOpen && node.maxProperties == null) found.push(`openapi.yaml: unbounded object at ${path}`);
    if (isString || isArray || isOpen) count++;
    for (const [k, v] of Object.entries(node)) if (k !== "examples" && k !== "description") walk(v, `${path}.${k}`);
  }
  for (const [table, prop] of Object.entries(schemas.SyncChanges.properties)) walk(prop.items, `SyncChanges.${table}`);
  const aiBodies = Object.entries(doc.paths)
    .filter(([p, ops]) => p.startsWith("/ai/") && ops.post?.requestBody)
    .map(([p, ops]) => [p, ops.post.requestBody.content["application/json"].schema]);
  const syncRefs = new Set(seenRefs);
  for (const [p, schema] of aiBodies) walk(schema, `POST ${p}`);
  const aiRefs = [...seenRefs].filter((n) => !syncRefs.has(n));
  return { found, count, aiBodies: aiBodies.length, aiRefs };
}
const bounds = checkAllBounds(parsed);
failures.push(...bounds.found);
const bounded = bounds.count;
if (bounded === 0) failures.push("openapi.yaml: no record fields found for the bounds check");
if (bounds.aiBodies === 0) failures.push("openapi.yaml: no POST /ai/* request bodies found for the bounds check");
// Must-fail vectors: dropping any one bound from an AI request schema (for example maxLength 200 from
// SuggestTagsRequest.name, or maxItems from WeeklySummaryRequest.stalled) must make the check above fail.
// The schemas are every component reached by $ref from a POST /ai/* request body, so a new AI schema gets vectors too.
const aiRequests = new Set();
const collectRefs = (node) => {
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop();
    if (aiRequests.has(name)) return;
    aiRequests.add(name);
    collectRefs(parsed.components.schemas[name]);
  }
  for (const [k, v] of Object.entries(node)) if (k !== "examples" && k !== "description") collectRefs(v);
};
for (const [p, ops] of Object.entries(parsed.paths)) if (p.startsWith("/ai/")) collectRefs(ops.post?.requestBody);
for (const name of bounds.aiRefs) if (!aiRequests.has(name)) failures.push(`must-fail vectors skip AI request schema ${name}`);
let mutants = 0;
for (const name of aiRequests) {
  const visit = (node, path) => {
    if (!node || typeof node !== "object") return;
    for (const key of ["maxLength", "maxItems", "maxProperties"]) {
      if (node[key] === undefined) continue;
      const copy = structuredClone(parsed);
      let target = copy.components.schemas[name];
      for (const step of path) target = target[step];
      delete target[key];
      mutants++;
      if (checkAllBounds(copy).found.length === 0) failures.push(`bounds check misses ${name}${path.map((s) => `.${s}`).join("")} without ${key}`);
    }
    for (const [k, v] of Object.entries(node)) if (k !== "examples" && k !== "description") visit(v, [...path, k]);
  };
  if (!parsed.components.schemas[name]) failures.push(`openapi.yaml: no ${name} schema`);
  visit(parsed.components.schemas[name], []);
}
if (mutants === 0) failures.push("openapi.yaml: no AI request bounds to mutate");
// blank-text.json: every "not blank" field uses the one shared pattern (#421); no pattern anywhere in the spec uses
// an escape that ECMA-262 and java.util.regex read differently (`\s`, `\S`, `\v`, `\h`, `\H`, `\R`, `\p{}`, `\P{}`)
// or a lookbehind; and the pattern rejects every must_fail text and accepts every must_pass text, with and
// without the `u` flag.
const blank = JSON.parse(readFileSync(new URL("./blank-text.json", import.meta.url), "utf8"));
if (!parsed.info.description.includes(`\`${blank.pattern}\``)) failures.push("openapi.yaml: wire conventions do not show the blank-text pattern");
for (const field of blank.fields) {
  const [schema, prop] = field.split(".");
  if (parsed.components.schemas[schema]?.properties?.[prop]?.pattern !== blank.pattern) failures.push(`openapi.yaml: ${field} does not use the blank-text pattern`);
}
const patterns = [];
const collectPatterns = (node, path) => {
  if (!node || typeof node !== "object") return;
  if (typeof node.pattern === "string") patterns.push([path, node.pattern]);
  for (const [k, v] of Object.entries(node)) if (k !== "examples" && k !== "description") collectPatterns(v, `${path}.${k}`);
};
collectPatterns(parsed.components, "components");
collectPatterns(parsed.paths, "paths");
if (patterns.length === 0) failures.push("openapi.yaml: no patterns found");
const lookbehind = /\(\?<[=!]/;
const engineSpecific = /\\[sSvhHRpP]/;
if (lookbehind.test(blank.pattern)) failures.push("blank-text.json: pattern uses lookbehind");
for (const [path, p] of patterns) {
  if (engineSpecific.test(p)) failures.push(`openapi.yaml: ${path}.pattern uses \\s, \\S, \\v, \\h, \\H, \\R, \\p or \\P; spell the characters out (see blank-text.json)`);
  if (lookbehind.test(p)) failures.push(`openapi.yaml: ${path}.pattern uses lookbehind`);
}
for (const flags of ["", "u"]) {
  const re = new RegExp(blank.pattern, flags);
  for (const t of blank.must_fail) if (re.test(t)) failures.push(`blank-text.json (flags "${flags}"): must_fail ${JSON.stringify(t)} passes`);
  for (const t of blank.must_pass) if (!re.test(t)) failures.push(`blank-text.json (flags "${flags}"): must_pass ${JSON.stringify(t)} fails`);
}
// YAML 1.1 readers (SnakeYAML under the backend's Jackson YAMLMapper) read bare y/n/yes/no/on/off (any case) as
// booleans and a leading-zero integer such as 010 as octal. Jackson keeps mapping keys as text but converts values,
// including flow and block list items, so `required: [..., on]` became `true` on the server (#418). Quote them all.
const word = "(?:y|n|yes|no|on|off)";
const end = "\\s*(?:#.*)?$";
const yaml11 = [
  new RegExp(`^\\s*(?:- )?${word}\\s*:(?:\\s|$)`, "i"), // mapping key
  new RegExp(`[\\[,]\\s*${word}\\s*(?=[,\\]])`, "i"), // flow list item (octal not checked here: prose has 2,097,152)
  new RegExp(`^\\s*-\\s+(?:${word}|0[0-9]+)${end}`, "i"), // block list item
  new RegExp(`^\\s*[\\w$'"-]+:\\s+(?:${word}|0[0-9]+)${end}`, "i"), // plain mapping value
];
for (const [i, line] of spec.split("\n").entries()) {
  if (yaml11.some((re) => re.test(line))) failures.push(`openapi.yaml:${i + 1}: quote the YAML 1.1 boolean or octal in: ${line.trim()}`);
}
// WorkoutExercise.feel (#485): which answers the pattern takes.
const feelPattern = new RegExp(parsed.components.schemas.WorkoutExercise.properties.feel.pattern);
for (const [v, ok] of [["target", true], ["pain", true], ["0", true], ["12", true], ["", false], ["123", false], ["Pain", false], ["-1", false], ["target\n", false]]) {
  if (feelPattern.test(v) !== ok) failures.push(`WorkoutExercise.feel pattern: ${JSON.stringify(v)} should ${ok ? "match" : "not match"}`);
}
// Health (#352): liveness only, no build version or other build detail in the public body.
const health = parsed.components.schemas.Health;
if (JSON.stringify(Object.keys(health.properties)) !== '["status"]' || JSON.stringify(health.required) !== '["status"]') {
  failures.push(`Health schema: only "status" may be defined and required, found ${JSON.stringify(Object.keys(health.properties))}`);
}
for (const [name, ex] of Object.entries(parsed.paths["/health"].get.responses["200"].content["application/json"].examples)) {
  if (JSON.stringify(Object.keys(ex.value)) !== '["status"]') failures.push(`/health 200 example ${name}: only "status" allowed, found ${JSON.stringify(Object.keys(ex.value))}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`sync-ids.json: rfc_example, ${vectors.cases.length} cases and openapi.yaml example ids verified`);
console.log(`content-hash.json: ${content.cases.length} cases and openapi.yaml content examples verified`);
console.log(`blank-text.json: ${blank.must_fail.length} must-fail and ${blank.must_pass.length} must-pass texts on ${blank.fields.length} fields, ${patterns.length} spec patterns without engine-specific escapes or lookbehind`);
console.log(`openapi.yaml: ${used.size} operation tags, all declared`);
console.log(`openapi.yaml: ${bounded} record and AI request strings, arrays and open objects, all bounded`);
console.log(`openapi.yaml: ${mutants} bounds in ${aiRequests.size} AI request schemas (${[...aiRequests].join(", ")}), each one caught when removed`);
