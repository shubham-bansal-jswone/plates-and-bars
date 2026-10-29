// Checks test-vectors/sync-ids.json against an independent UUIDv5 (RFC 9562 / RFC 4122) built on node:crypto,
// and test-vectors/content-hash.json against node:crypto's SHA-256.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
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
  [/table: workouts\s*\n\s*id: ([0-9a-f-]{36})/g, "workouts:2026-10-08"],
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
// Each manifest example entry's sha256 and size_bytes equal the bytes of the matching content/<name>.json
// (the files the server serves and the app bundles). Only entries the example lists are compared; a name with
// no content file fails, a content file the example omits (import-aliases) is not required.
const manifestExamples = load(spec).paths["/content/manifest"].get.responses["200"].content["application/json"].examples;
let manifestEntries = 0;
for (const [exName, ex] of Object.entries(manifestExamples)) {
  for (const b of ex.value.bundles) {
    let bytes;
    try {
      bytes = readFileSync(new URL(`../../../content/${b.name}.json`, import.meta.url));
    } catch {
      failures.push(`openapi.yaml: manifest example ${exName} lists ${b.name}, but content/${b.name}.json does not exist`);
      continue;
    }
    manifestEntries++;
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (b.sha256 !== sha) failures.push(`openapi.yaml: manifest example ${exName} ${b.name} sha256 is ${b.sha256}, content/${b.name}.json is ${sha}`);
    if (b.size_bytes !== bytes.length) failures.push(`openapi.yaml: manifest example ${exName} ${b.name} size_bytes is ${b.size_bytes}, content/${b.name}.json is ${bytes.length}`);
  }
}
if (manifestEntries === 0) failures.push("openapi.yaml: no manifest example entry compared with content/");
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
// Closed record shapes (#646): every object a sync record nests whose fields the contract lists is closed, by
// `additionalProperties` (false, or a schema for a typed map) or by `unevaluatedProperties: false` on the `allOf` that
// builds it. The record's own top level is exempt (unlisted keys are ignored there). An `additionalProperties: true`
// object (shape owned by packages/core) must carry a positive integer `x-max-json-bytes`. Dropping any one closing
// keyword on a record path must make the check fail.
function checkClosed(doc) {
  const schemas = doc.components.schemas;
  const found = [];
  const seen = new Set();
  const closers = new Set();
  function walk(node, path, closedByAllOf) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, closedByAllOf));
    const closed = closedByAllOf || node.unevaluatedProperties === false;
    if (node.additionalProperties === false || node.unevaluatedProperties === false) closers.add(node);
    if (typeof node.$ref === "string") {
      const name = node.$ref.split("/").pop();
      if (!seen.has(`${name}/${closed}`)) {
        seen.add(`${name}/${closed}`);
        walk(schemas[name], name, closed);
      }
    }
    if (node.properties && node.additionalProperties === undefined && !closed) found.push(`openapi.yaml: open record object at ${path} (set additionalProperties: false)`);
    const xBytes = node["x-max-json-bytes"];
    if (node.additionalProperties === true && !(Number.isInteger(xBytes) && xBytes > 0)) found.push(`openapi.yaml: ${path} is open (additionalProperties: true) without x-max-json-bytes`);
    for (const [k, v] of Object.entries(node)) if (k !== "examples" && k !== "description") walk(v, `${path}.${k}`, k === "allOf" && closed);
  }
  for (const prop of Object.values(schemas.SyncChanges.properties)) {
    const name = prop.items.$ref.split("/").pop();
    for (const part of schemas[name].allOf) {
      if (part.$ref) continue; // SyncMeta: id, version and timestamps only
      for (const [field, sub] of Object.entries(part.properties)) walk(sub, `${name}.${field}`, false);
    }
  }
  return { found, closers };
}
const closedCheck = checkClosed(parsed);
failures.push(...closedCheck.found);
if (closedCheck.closers.size === 0) failures.push("openapi.yaml: no closed record objects found");
let closedMutants = 0;
const dropClosers = (node, path) => {
  if (!node || typeof node !== "object") return;
  if (closedCheck.closers.has(node)) {
    for (const key of ["additionalProperties", "unevaluatedProperties"]) {
      if (node[key] !== false) continue;
      const copy = structuredClone(parsed);
      let target = copy.components.schemas;
      for (const step of path) target = target[step];
      delete target[key];
      closedMutants++;
      if (checkClosed(copy).found.length === 0) failures.push(`closed-shape check misses components.schemas.${path.join(".")} without ${key}`);
    }
  }
  for (const [k, v] of Object.entries(node)) if (k !== "examples" && k !== "description") dropClosers(v, [...path, k]);
};
dropClosers(parsed.components.schemas, []);
if (closedMutants < closedCheck.closers.size) failures.push("closed-shape check: some closers were not mutated");
// strict-json.json (#652): what "exactly one JSON value" means, checked with a small strict reader: trailing content,
// a repeated key (compared after unescaping) and nesting past max_nesting_depth are each their own fault.
const strict = JSON.parse(readFileSync(new URL("./strict-json.json", import.meta.url), "utf8"));
function strictFault(text, maxDepth) {
  let i = 0;
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const fail = (fault) => { throw Object.assign(new Error(fault), { fault, at: i }); };
  const token = (re) => {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) fail("syntax");
    i += m[0].length;
    return m[0];
  };
  const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const SCALAR = /true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const value = (depth) => {
    ws();
    const open = text[i];
    if (open !== "{" && open !== "[") return void token(open === '"' ? STRING : SCALAR);
    if (depth + 1 > maxDepth) fail("depth");
    i++;
    ws();
    const close = open === "{" ? "}" : "]";
    if (text[i] === close) return void i++;
    const keys = new Set();
    for (;;) {
      if (open === "{") {
        ws();
        const key = JSON.parse(token(STRING));
        if (keys.has(key)) fail("duplicate_key");
        keys.add(key);
        ws();
        if (text[i++] !== ":") fail("syntax");
      }
      value(depth + 1);
      ws();
      const c = text[i++];
      if (c === close) return;
      if (c !== ",") fail("syntax");
    }
  };
  try {
    value(0);
    ws();
    if (i < text.length) fail("trailing");
    return { fault: null };
  } catch (e) {
    if (!e.fault) throw e;
    return { fault: e.fault, at: e.at };
  }
}
const deep = (n) => "[".repeat(n) + "]".repeat(n);
if (strict.max_nesting_depth !== 1000 || !parsed.info.description.includes("nested more than 1,000")) failures.push("strict-json.json: max_nesting_depth must be the 1,000 the wire conventions name");
if (strictFault(deep(strict.max_nesting_depth), strict.max_nesting_depth).fault !== null) failures.push("strict-json.json: nesting at max_nesting_depth must parse");
if (strictFault(deep(strict.max_nesting_depth + 1), strict.max_nesting_depth).fault !== "depth") failures.push("strict-json.json: nesting past max_nesting_depth must be refused");
if (!parsed.info.description.includes("`test-vectors/strict-json.json`")) failures.push("openapi.yaml: wire conventions do not point to strict-json.json");
for (const v of [...strict.must_refuse, ...strict.must_accept]) {
  if (!parsed.paths[v.path]?.post?.requestBody) failures.push(`strict-json.json "${v.name}": ${v.path} takes no request body`);
}
for (const v of strict.must_accept) {
  const got = strictFault(v.body, strict.max_nesting_depth);
  if (got.fault !== null) failures.push(`strict-json.json must_accept "${v.name}": refused (${got.fault})`);
}
for (const v of strict.must_refuse) {
  const got = strictFault(v.body, strict.max_nesting_depth);
  if (got.fault !== v.fault) failures.push(`strict-json.json must_refuse "${v.name}": fault ${got.fault}, expected ${v.fault}`);
  // Exactly one fault: the body without its trailing part, or a duplicate-key body read by JSON.parse, is fine.
  if (v.fault === "trailing" && strictFault(v.body.slice(0, got.at), strict.max_nesting_depth).fault !== null) failures.push(`strict-json.json must_refuse "${v.name}": wrong before the trailing content`);
  if (v.fault === "duplicate_key") {
    try {
      JSON.parse(v.body);
    } catch {
      failures.push(`strict-json.json must_refuse "${v.name}": not JSON apart from the duplicate key`);
    }
  }
}
for (const fault of ["trailing", "duplicate_key"]) if (!strict.must_refuse.some((v) => v.fault === fault)) failures.push(`strict-json.json: no ${fault} vector`);
// Every operation that takes a JSON body lists 400 invalid_request (malformed, strict-JSON and schema failures).
for (const [p, ops] of Object.entries(parsed.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (op?.requestBody && !op.responses?.["400"]) failures.push(`openapi.yaml: ${method.toUpperCase()} ${p} takes a body but lists no 400`);
  }
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
// Account record cap (#353): /sync answers 413 with code account_full and a record_cap body, and every example is
// a real refusal (stored + new_records over limit).
const syncFull = parsed.paths["/sync"].post.responses["413"];
const fullExamples = syncFull?.$ref ? parsed.components.responses[syncFull.$ref.split("/").pop()]?.content?.["application/json"]?.examples : undefined;
if (!fullExamples || Object.keys(fullExamples).length === 0) failures.push("/sync: no 413 account_full response with examples");
if (!parsed.components.schemas.Error.properties.code.enum.includes("account_full")) failures.push("Error.code: account_full missing");
for (const [name, ex] of Object.entries(fullExamples ?? {})) {
  const v = ex.value;
  if (v.code !== "account_full") failures.push(`/sync 413 example ${name}: code must be account_full`);
  const cap = v.record_cap;
  if (!cap || !(cap.stored + cap.new_records > cap.limit)) failures.push(`/sync 413 example ${name}: record_cap.stored + new_records must exceed limit`);
}
// Replaced record on client_won (#792, ADR 007): an optional SyncRecord (so the record bounds apply), and in every
// /sync conflict example it is present exactly on client_won, as the stored copy one version below server_version.
const syncConflict = parsed.components.schemas.SyncConflict;
if (syncConflict.properties.replaced_record?.$ref !== "#/components/schemas/SyncRecord") failures.push("SyncConflict.replaced_record must be a $ref to SyncRecord");
if (syncConflict.required.includes("replaced_record")) failures.push("SyncConflict.replaced_record must stay optional (older servers never send it)");
function conflictFaults(c) {
  const out = [];
  const r = c.replaced_record;
  if (c.server_record?.id !== c.id || c.server_record?.version !== c.server_version) out.push("server_record is not the stored record (id, version = server_version)");
  if (c.resolution !== "client_won" && r !== undefined) out.push("replaced_record on a conflict that is not client_won");
  if (r !== undefined && (r.id !== c.id || r.version !== c.server_version - 1)) out.push("replaced_record is not the stored copy (id, version = server_version - 1)");
  return out;
}
const syncExamples = Object.entries(parsed.paths["/sync"].post.responses["200"].content["application/json"].examples);
let replacedSeen = 0;
for (const [name, ex] of syncExamples) {
  for (const [i, c] of ex.value.conflicts.entries()) {
    for (const f of conflictFaults(c)) failures.push(`/sync 200 example ${name} conflicts[${i}]: ${f}`);
    if (c.resolution === "client_won" && c.replaced_record) replacedSeen++;
  }
}
if (replacedSeen === 0) failures.push("/sync 200 examples: no client_won conflict with replaced_record");
// Must-fail vectors for the check itself: each broken conflict must be caught.
const goodConflict = syncExamples.flatMap(([, ex]) => ex.value.conflicts).find((c) => c.replaced_record);
for (const [what, broken] of [
  ["on server_won", { ...goodConflict, resolution: "server_won" }],
  ["wrong version", { ...goodConflict, replaced_record: { ...goodConflict?.replaced_record, version: goodConflict?.server_version } }],
  ["wrong id", { ...goodConflict, replaced_record: { ...goodConflict?.replaced_record, id: "00000000-0000-4000-8000-000000000000" } }],
]) {
  if (goodConflict && conflictFaults(broken).length === 0) failures.push(`replaced_record check misses a conflict with it ${what}`);
}
// Web refresh cookie (#250, ADR 006): one cookie name everywhere, every Set-Cookie example and the auth tag carry the
// required attributes and no Domain, the cookie path covers refresh and revoke, and the cookie-mode body token is empty.
const cookieName = parsed.components.parameters.RefreshCookie.name;
const cookiePath = "/api/v1/auth/refresh";
if (!cookieName.startsWith("__Secure-")) failures.push(`RefreshCookie: ${cookieName} lacks the __Secure- prefix`);
for (const p of ["/auth/refresh", "/auth/refresh/revoke"]) if (!parsed.paths[p]) failures.push(`openapi.yaml: no ${p}`);
const authTag = parsed.tags.find((t) => t.name === "auth").description;
const cookieLines = [
  ["auth tag", (authTag.match(/__Secure-[\w-]+=[^`]*/) ?? [""])[0]],
  ...["SetRefreshCookie", "ClearRefreshCookie"].map((h) => [h, parsed.components.headers[h].example]),
];
for (const [where, line] of cookieLines) {
  const attrs = line.split(";").map((a) => a.trim());
  if (attrs[0].split("=")[0] !== cookieName) failures.push(`${where}: cookie name is not ${cookieName}`);
  for (const a of [`Path=${cookiePath}`, "HttpOnly", "Secure", "SameSite=Strict"]) if (!attrs.includes(a)) failures.push(`${where}: Set-Cookie lacks ${a}`);
  if (attrs.some((a) => /^domain=/i.test(a))) failures.push(`${where}: Set-Cookie must not set Domain`);
}
if (!/Max-Age=0(;|$)/.test(parsed.components.headers.ClearRefreshCookie.example)) failures.push("ClearRefreshCookie: Max-Age=0 missing");
// The cookie that sets the token lives exactly as long as the refresh token: 90 days (refresh_token_expires_at).
for (const [where, line] of cookieLines.filter(([w]) => w !== "ClearRefreshCookie")) {
  if (!line.split(";").map((a) => a.trim()).includes(`Max-Age=${90 * 24 * 3600}`)) failures.push(`${where}: Set-Cookie must carry Max-Age=${90 * 24 * 3600} (90 days)`);
}
if (parsed.components.responses.TokenPair.content["application/json"].examples.cookie?.value.refresh_token !== "") failures.push("TokenPair cookie example: refresh_token must be empty");

// barcode-gs1.json (#944): GS1 mod-10 recomputed here, UPC-E expansion, and the spec's barcode pattern, examples and error codes.
const barcode = JSON.parse(readFileSync(new URL("./barcode-gs1.json", import.meta.url), "utf8"));
const gs1Ok = (code) => {
  if (!/^([0-9]{8}|[0-9]{12,13})$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < code.length - 1; i++) sum += Number(code[code.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
};
const upcEToA = (e) => {
  const [ns, d1, d2, d3, d4, d5, d6, chk] = e;
  const body = d6 <= "2" ? `${d1}${d2}${d6}00` + `00${d3}${d4}${d5}` : d6 === "3" ? `${d1}${d2}${d3}00` + `000${d4}${d5}` : d6 === "4" ? `${d1}${d2}${d3}${d4}0` + `0000${d5}` : `${d1}${d2}${d3}${d4}${d5}` + `0000${d6}`;
  return `${ns}${body}${chk}`;
};
for (const v of barcode.valid) if (!gs1Ok(v.code)) failures.push(`barcode-gs1.json: valid ${v.code} fails the check`);
for (const v of barcode.invalid) if (gs1Ok(v.code)) failures.push(`barcode-gs1.json: invalid ${JSON.stringify(v.code)} (${v.reason}) passes`);
for (const e of barcode.upc_e_expansion) if (upcEToA(e.upc_e) !== e.upc_a || !gs1Ok(e.upc_a)) failures.push(`barcode-gs1.json: UPC-E ${e.upc_e} does not expand to a valid ${e.upc_a}`);
const barcodeSchema = parsed.components.schemas.Barcode;
const barcodeRe = new RegExp(barcodeSchema.pattern);
if (barcodeSchema.pattern !== "^([0-9]{8}|[0-9]{12,13})$") failures.push("Barcode.pattern changed; update barcode-gs1.json and this check");
for (const v of [...barcode.valid, ...barcode.invalid]) {
  const lengthOk = /^([0-9]{8}|[0-9]{12,13})$/.test(v.code);
  if (barcodeRe.test(v.code) !== lengthOk) failures.push(`Barcode.pattern disagrees with the vector rule on ${JSON.stringify(v.code)}`);
}
const barcodeOp = parsed.paths["/foods/barcode/{code}"].get;
if (barcodeOp.security?.length !== 0) failures.push("GET /foods/barcode/{code} must be public (security: [])");
for (const k of ["200", "400", "404", "429", "503"]) if (!barcodeOp.responses[k]) failures.push(`GET /foods/barcode/{code} lacks ${k}`);
for (const [name, ex] of Object.entries(barcodeOp.responses["200"].content["application/json"].examples)) {
  if (!gs1Ok(ex.value.code)) failures.push(`barcode example ${name}: code fails the GS1 check`);
  if (!ex.value.source.url.endsWith(`/product/${ex.value.code}`) || ex.value.source.code !== "open_food_facts") failures.push(`barcode example ${name}: source must be open_food_facts linking to the product page`);
}
if (!parsed.components.schemas.FoodSource.properties.code.enum.includes("open_food_facts")) failures.push("FoodSource.code lacks open_food_facts");
for (const c of ["invalid_barcode", "upstream_unavailable", "upstream_busy"]) if (!parsed.components.schemas.Error.properties.code.enum.includes(c)) failures.push(`Error.code lacks ${c}`);
if (parsed.components.schemas.UserFood.allOf[1].properties.barcode?.pattern !== "^([0-9]{8}|[0-9]{12,13})$") failures.push("UserFood.barcode pattern missing");
if (parsed.components.schemas.UserFood.allOf[1].required.includes("barcode")) failures.push("UserFood.barcode must stay optional (older clients do not send it)");

// OffProduct and OffNutriments are responses, so the record bound checks above do not reach them (#944): pin them closed, the exact
// nutriment key set and a bound on every string and array, then mutate each pin and require the check to notice.
const OFF_NUTRIMENT_KEYS = ["energy-kcal", "energy-kj", "proteins", "carbohydrates", "fat", "fiber", "added-sugars"].flatMap((k) => [`${k}_100g`, `${k}_serving`]).sort();
const checkOff = (schemas) => {
  const out = [];
  const nut = schemas.OffNutriments;
  const prod = schemas.OffProduct;
  if (nut?.additionalProperties !== false) out.push("OffNutriments must be closed (additionalProperties: false)");
  if (prod?.additionalProperties !== false) out.push("OffProduct must be closed (additionalProperties: false)");
  if (JSON.stringify(Object.keys(nut?.properties ?? {}).sort()) !== JSON.stringify(OFF_NUTRIMENT_KEYS)) out.push("OffNutriments keys differ from the whitelist");
  for (const [k, v] of Object.entries(nut?.properties ?? {})) if (v.type !== "number" || v.minimum !== 0) out.push(`OffNutriments.${k} must be a number with minimum 0`);
  const required = new Set(prod?.required ?? []);
  for (const k of Object.keys(prod?.properties ?? {})) if (!required.has(k)) out.push(`OffProduct.${k} must be required`);
  for (const [k, v] of Object.entries(prod?.properties ?? {})) {
    const types = [v.type].flat();
    if (types.includes("string") && !v.format && !v.enum && !v.$ref && v.maxLength === undefined) out.push(`OffProduct.${k} string needs maxLength`);
    if (types.includes("array")) {
      if (v.maxItems === undefined) out.push(`OffProduct.${k} array needs maxItems`);
      if (v.items?.type === "string" && v.items.maxLength === undefined) out.push(`OffProduct.${k} items need maxLength`);
    }
  }
  return out;
};
failures.push(...checkOff(parsed.components.schemas));
const offMutants = [
  ["open OffNutriments", (c) => delete c.OffNutriments.additionalProperties],
  ["open OffProduct", (c) => delete c.OffProduct.additionalProperties],
  ["add sugars_100g", (c) => (c.OffNutriments.properties.sugars_100g = { type: "number", minimum: 0 })],
  ["drop a nutriment key", (c) => delete c.OffNutriments.properties.fat_100g],
  ["drop name maxLength", (c) => delete c.OffProduct.properties.name.maxLength],
  ["drop states_tags maxItems", (c) => delete c.OffProduct.properties.states_tags.maxItems],
  ["drop tag item maxLength", (c) => delete c.OffProduct.properties.countries_tags.items.maxLength],
  ["unrequire name", (c) => c.OffProduct.required.splice(c.OffProduct.required.indexOf("name"), 1)],
];
for (const [name, mutate] of offMutants) {
  const copy = structuredClone(parsed.components.schemas);
  mutate(copy);
  if (checkOff(copy).length === 0) failures.push(`OffProduct check did not notice: ${name}`);
}
for (const [name, ex] of Object.entries(barcodeOp.responses["200"].content["application/json"].examples)) {
  if (ex.value.code !== ex.value.source.reference) failures.push(`barcode example ${name}: code must equal source.reference`);
}
// ai-images.json (#946, ADR 008): the image rules of POST /ai/meal-photo, /ai/import-recipe and /ai/form-check. The
// limits equal the schemas' (base64 maxLength = 4 * ceil(bytes / 3)), four frames and the longest recipe text fit the
// 2 MB body limit, every case gets the issue its first fault names from a small reference checker, and every image in
// an example of the three operations passes the checker.
const imgv = JSON.parse(readFileSync(new URL("./ai-images.json", import.meta.url), "utf8"));
const b64len = (bytes) => 4 * Math.ceil(bytes / 3);
const aiImageOps = ["/ai/meal-photo", "/ai/import-recipe", "/ai/form-check"];
for (const p of aiImageOps) if (!parsed.paths[p]?.post) failures.push(`openapi.yaml: no POST ${p}`);
const schemasAi = parsed.components.schemas;
for (const [name, kind] of [["AiImage", "photo"], ["AiFrame", "frame"]]) {
  const s = schemasAi[name];
  if (s.properties.data.maxLength !== b64len(imgv.max_decoded_bytes[kind])) failures.push(`${name}.data.maxLength must be ${b64len(imgv.max_decoded_bytes[kind])} (${imgv.max_decoded_bytes[kind]} bytes as base64)`);
  if (JSON.stringify(s.properties.media_type.enum) !== JSON.stringify(imgv.media_types)) failures.push(`${name}.media_type must be ${imgv.media_types.join(", ")}`);
}
const fcFrames = schemasAi.FormCheckRequest.properties.frames;
if (fcFrames.minItems !== imgv.frames.min || fcFrames.maxItems !== imgv.frames.max) failures.push("FormCheckRequest.frames bounds differ from ai-images.json");
if (imgv.max_side_px.frame !== 640) failures.push("frame side limit must be the prototype's 640 px");
if (imgv.frames.max * (b64len(imgv.max_decoded_bytes.frame) + 100) > imgv.body_limit_bytes) failures.push("four form-check frames do not fit the body limit");
const recipeTextBytes = schemasAi.ImportRecipeRequest.properties.text.maxLength * 12; // worst case: every character a \uXXXX escape
if (b64len(imgv.max_decoded_bytes.photo) + recipeTextBytes + 200 > imgv.body_limit_bytes) failures.push("a recipe photo plus the longest text does not fit the body limit");
// The figures in the ai tag and ADR 008 come from the vectors, so prose cannot drift from the limits.
const fmt = (n) => n.toLocaleString("en-US");
const aiTag = parsed.tags.find((t) => t.name === "ai").description;
const adr008 = readFileSync(new URL("../../../docs/adr/008-ai-image-calls-and-privacy.md", import.meta.url), "utf8");
for (const [where, text] of [["ai tag", aiTag], ["ADR 008", adr008]]) {
  for (const [what, figure] of [
    ["photo decoded bytes", fmt(imgv.max_decoded_bytes.photo)],
    ["frame decoded bytes", fmt(imgv.max_decoded_bytes.frame)],
    ["photo side px", fmt(imgv.max_side_px.photo)],
    ["frame side px", String(imgv.max_side_px.frame)],
    ["re-encode side px", fmt(imgv.reencode.max_long_side_px)],
    ["metadata inflation bytes", fmt(imgv.max_metadata_inflated_bytes)],
  ]) if (!text.includes(figure)) failures.push(`${where} does not state the ${what} (${figure}) from ai-images.json`);
  if (!new RegExp(`${imgv.max_megapixels} megapixels`).test(text)) failures.push(`${where} does not state ${imgv.max_megapixels} megapixels`);
  if (/\b(\d[\d,]*) megapixels/.test(text) && [...text.matchAll(/(\d[\d,]*) megapixels/g)].some((m) => m[1] !== String(imgv.max_megapixels))) failures.push(`${where} states a megapixel figure other than ${imgv.max_megapixels}`);
  if (/(\d[\d,]*) decoded bytes/.test(text) && [...text.matchAll(/(\d[\d,]*) decoded bytes/g)].some((m) => ![fmt(imgv.max_decoded_bytes.photo), fmt(imgv.max_decoded_bytes.frame)].includes(m[1]))) failures.push(`${where} states a decoded-byte figure that is not in ai-images.json`);
}
// Request shapes: closed, and what must be sent.
const reqSchemas = { MealPhotoRequest: ["image"], FormCheckRequest: ["exercise", "frames"], ImportRecipeRequest: undefined };
for (const [n, req] of Object.entries(reqSchemas)) {
  const s = parsed.components.schemas[n];
  if (s.additionalProperties !== false) failures.push(`${n} must be closed (additionalProperties: false)`);
  if (req && JSON.stringify(s.required) !== JSON.stringify(req)) failures.push(`${n}.required must be ${JSON.stringify(req)}`);
}
// ImportRecipeRequest: at least one of text and image, written as minProperties (a generated client reads anyOf of
// bare `required` branches as `unknown`, #953), with only those two properties allowed.
const imp = parsed.components.schemas.ImportRecipeRequest;
if (imp.minProperties !== 1 || imp.anyOf || imp.required) failures.push("ImportRecipeRequest must use minProperties: 1, with no anyOf or required");
if (JSON.stringify(Object.keys(imp.properties)) !== '["text","image"]') failures.push("ImportRecipeRequest must have exactly text and image");
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
const pngBytes = (w, h, depth = 8) => {
  const b = Buffer.alloc(8 + 25 + 12);
  PNG_SIG.copy(b);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = depth; b[25] = 2;
  b.writeUInt32BE(0, 33); b.write("IEND", 37);
  return b;
};
// The first case's 8x8 PNG with a zTXt, iTXt or iCCP chunk (keyword "k", valid zlib) that inflates to n zero bytes, before IDAT.
const withText = (png, type, n) => {
  const body = deflateSync(Buffer.alloc(n));
  const head = { zTXt: "k\0\0", iCCP: "k\0\0", iTXt: "k\0\x01\0\0\0" }[type]; // iTXt: keyword, flag 1, method 0, language, translated keyword
  const z = pngChunk(type, Buffer.concat([Buffer.from(head, "latin1"), body]));
  const at = png.indexOf("IDAT") - 4;
  return Buffer.concat([png.subarray(0, at), z, png.subarray(at)]);
};
// Walk PNG chunks; a zTXt, compressed iTXt or iCCP chunk that inflates past max_metadata_inflated_bytes is refused,
// found by an inflate that stops at max + 1 bytes (whether or not the decoder would skip the chunk).
function pngMetadataBomb(buf) {
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString("latin1", i + 4, i + 8);
    if (type === "zTXt" || type === "iCCP" || type === "iTXt") {
      const d = buf.subarray(i + 8, i + 8 + len);
      let z = d.indexOf(0) + 2; // after the keyword, its NUL and the compression method (zTXt, iCCP)
      if (type === "iTXt") {
        if (d[d.indexOf(0) + 1] !== 1) { i += 12 + len; continue; } // uncompressed text: bounded by the 2 MB body
        z = d.indexOf(0, d.indexOf(0, d.indexOf(0) + 3) + 1) + 1; // skip language and translated keyword
      }
      try {
        if (inflateSync(d.subarray(z), { maxOutputLength: imgv.max_metadata_inflated_bytes + 1 }).length > imgv.max_metadata_inflated_bytes) return true;
      } catch { return true; }
    }
    i += 12 + len;
  }
  return false;
}
function jpegSof(buf) {
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    if (m === 0xda) return null;
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
const b64pattern = new RegExp(schemasAi.AiImage.properties.data.pattern);
function imageFault(media_type, data, kind) {
  if (!imgv.media_types.includes(media_type)) return "unsupported_type";
  if (!b64pattern.test(data) || data.length < schemasAi.AiImage.properties.data.minLength) return "invalid_base64";
  const buf = Buffer.from(data, "base64");
  if (buf.length > imgv.max_decoded_bytes[kind]) return "too_large";
  const isPng = buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIG);
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if ((media_type === "image/png" && !isPng) || (media_type === "image/jpeg" && !isJpeg)) return "type_mismatch";
  const dims = isPng ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : jpegSof(buf);
  if (dims === null) return "unreadable_image";
  const [w, h] = dims;
  if (w > imgv.max_side_px[kind] || h > imgv.max_side_px[kind] || w * h > imgv.max_megapixels * 1e6) return "dimensions";
  if (isPng) {
    if (buf[24] > 8) return "unreadable_image"; // IHDR bit depth above 8: refused on the header, before any decode
    if (!buf.includes("IEND") || pngMetadataBomb(buf)) return "unreadable_image";
  } else if (buf.at(-2) !== 0xff || buf.at(-1) !== 0xd9) return "unreadable_image";
  return null;
}
// A JPEG's EXIF APP1: does IFD0 point to a GPS IFD (tag 0x8825)?
function jpegHasGps(buf) {
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff && buf[i + 1] !== 0xda) {
    const len = buf.readUInt16BE(i + 2);
    if (buf[i + 1] === 0xe1 && buf.toString("latin1", i + 4, i + 8) === "Exif") {
      const t = i + 10, le = buf.toString("latin1", t, t + 2) === "II";
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      for (let e = 0; e < u16(ifd); e++) if (u16(ifd + 2 + 12 * e) === 0x8825) return true;
    }
    i += 2 + len;
  }
  return false;
}
for (const c of imgv.cases) {
  let data = c.data;
  if (c.build?.pad_to_bytes) data = Buffer.concat([Buffer.from(imgv.cases[0].data, "base64"), Buffer.alloc(c.build.pad_to_bytes)]).subarray(0, c.build.pad_to_bytes).toString("base64");
  if (c.build?.png_dims) data = pngBytes(...c.build.png_dims, c.build.png_bit_depth).toString("base64");
  if (c.build?.png_text_chunk) data = withText(Buffer.from(imgv.cases[0].data, "base64"), c.build.png_text_chunk.type, c.build.png_text_chunk.inflated_bytes).toString("base64");
  const got = imageFault(c.media_type, data, c.kind);
  if (got !== c.issue) failures.push(`ai-images.json "${c.name}": checker says ${got}, vector says ${c.issue}`);
  if (c.issue !== null && !imgv.order.includes(c.issue)) failures.push(`ai-images.json "${c.name}": issue ${c.issue} is not in order`);
  if (c.exif_marker && !Buffer.from(c.data, "base64").includes(c.exif_marker)) failures.push(`ai-images.json "${c.name}": no ${c.exif_marker} marker to strip`);
  if (c.exif_gps && !jpegHasGps(Buffer.from(c.data, "base64"))) failures.push(`ai-images.json "${c.name}": no GPS IFD (tag 0x8825) to strip`);
  if (c.jpeg_dims && JSON.stringify(jpegSof(Buffer.from(c.data, "base64"))) !== JSON.stringify(c.jpeg_dims)) failures.push(`ai-images.json "${c.name}": SOF does not say ${c.jpeg_dims}`);
}
for (const issue of imgv.order) if (!imgv.cases.some((c) => c.issue === issue)) failures.push(`ai-images.json: no case for ${issue}`);
if (!imgv.cases.some((c) => c.exif_gps) || !imgv.cases.some((c) => c.jpeg_dims) || !["zTXt", "iTXt", "iCCP"].every((t) => imgv.cases.some((c) => c.build?.png_text_chunk?.type === t && c.build.png_text_chunk.inflated_bytes > imgv.max_metadata_inflated_bytes))) failures.push("ai-images.json: needs a GPS EXIF, a JPEG dimensions and a zTXt, iTXt and iCCP bomb vector");
if (!imgv.cases.some((c) => c.exif_marker)) failures.push("ai-images.json: no case with EXIF to strip");
for (const issue of imgv.order) if (!JSON.stringify(parsed.components.responses.InvalidRequest).includes(issue) && !parsed.tags.find((t) => t.name === "ai").description.includes(`\`${issue}\``)) failures.push(`ai tag does not name the image issue ${issue}`);
let imageExamples = 0;
for (const p of aiImageOps) {
  for (const [name, ex] of Object.entries(parsed.paths[p].post.requestBody.content["application/json"].examples ?? {})) {
    for (const [img, kind] of [[ex.value.image, "photo"], ...(ex.value.frames ?? []).map((f) => [f, "frame"])]) {
      if (!img) continue;
      imageExamples++;
      const got = imageFault(img.media_type, img.data, kind);
      if (got !== null) failures.push(`${p} example ${name}: image fails the image rules (${got})`);
    }
  }
  const ex200 = Object.values(parsed.paths[p].post.responses["200"].content["application/json"].examples ?? {});
  if (ex200.length === 0) failures.push(`${p}: no 200 example`);
  for (const code of ["400", "401", "429", "500", "503"]) if (!parsed.paths[p].post.responses[code]) failures.push(`${p}: no ${code}`);
}
if (imageExamples === 0) failures.push("no image request examples found");
// Meal photo (#946): every `match` in an example is a built-in food name in content/foods.json (the server turns any
// other into null), `servings` stays within the prototype's clamp of 0.25 to 6, and an example's `servings` is inside it.
const foodNames = new Set(JSON.parse(readFileSync(new URL("../../../content/foods.json", import.meta.url), "utf8")).foods.map((f) => f.name));
const servingsSchema = parsed.components.schemas.MealPhotoItem.allOf[1].properties.servings;
if (servingsSchema.minimum !== 0.25 || servingsSchema.maximum !== 6) failures.push(`MealPhotoItem.servings must be 0.25 to 6 (the prototype's clamp), found ${servingsSchema.minimum} to ${servingsSchema.maximum}`);
if (!aiTag.includes("0.25 to 6") || !servingsSchema.description.includes("0.25 to 6")) failures.push("ai tag and servings description must state 0.25 to 6");
let matchExamples = 0;
for (const ex of Object.values(parsed.paths["/ai/meal-photo"].post.responses["200"].content["application/json"].examples)) {
  for (const it of ex.value.items) {
    if (it.match !== undefined && it.match !== null) { matchExamples++; if (!foodNames.has(it.match)) failures.push(`/ai/meal-photo example: match ${JSON.stringify(it.match)} is not a name in content/foods.json`); }
    if (it.servings !== undefined && !(it.servings >= servingsSchema.minimum && it.servings <= servingsSchema.maximum)) failures.push(`/ai/meal-photo example: servings ${it.servings} out of range`);
  }
}
if (matchExamples === 0) failures.push("/ai/meal-photo: no example with a matched food");
// Must-fail vectors for the checker: a wrong expectation must be noticed.
if (imageFault("image/png", Buffer.from("x").toString("base64"), "photo") === null) failures.push("image checker accepts a one-byte png");
if (imageFault("image/png", Buffer.from("QUJD", "base64").toString("base64").slice(0, 3), "photo") !== "invalid_base64") failures.push("image checker accepts a base64 length that is not a multiple of 4");
for (const f of ["meal_photo", "import_recipe", "form_check"]) if (schemasAi.AiStatus.properties.features.properties[f]?.type !== "boolean") failures.push(`AiStatus.features.${f} must be a boolean`);
if (schemasAi.AiStatus.properties.features.required.some((f) => ["meal_photo", "import_recipe", "form_check"].includes(f))) failures.push("AiStatus.features: the image flags must stay optional (older servers never send them)");

// routines.json (#1184): the Routine record's bounds, the cap and the vectors a backend and an app must agree on.
const routinesVec = JSON.parse(readFileSync(new URL("./routines.json", import.meta.url), "utf8"));
{
  const sch = parsed.components.schemas;
  const rt = sch.Routine.allOf[1].properties, rex = sch.RoutineExercise, we = sch.WorkoutExercise;
  const blankRe = new RegExp(blank.pattern, "u");
  const L = routinesVec.limits;
  if (rt.name.minLength !== 1 || rt.name.maxLength !== L.name_max || rt.name.pattern !== blank.pattern) failures.push("Routine.name: bounds or blank pattern differ from routines.json");
  if (rt.exercises.minItems !== L.exercises_min || rt.exercises.maxItems !== L.exercises_max) failures.push("Routine.exercises: bounds differ from routines.json");
  if (rt.exercises.maxItems !== sch.Workout.allOf[1].properties.exercises.maxItems) failures.push("Routine.exercises.maxItems must equal Workout.exercises.maxItems (any session can be saved)");
  if (rex.properties.name.minLength !== 1 || rex.properties.name.maxLength !== L.exercise_name_max || rex.properties.name.pattern !== blank.pattern) failures.push("RoutineExercise.name: bounds or blank pattern differ from routines.json");
  if (rex.properties.sets.minimum !== L.sets_min || rex.properties.sets.maximum !== L.sets_max || rex.properties.sets.type !== "integer") failures.push("RoutineExercise.sets: bounds differ from routines.json");
  if ("part" in rex.properties) failures.push("RoutineExercise must not have part (a routine starts a fresh session)");
  if (rex.maxProperties !== L.max_exercise_keys || rex.propertyNames?.maxLength !== we.propertyNames?.maxLength || JSON.stringify(rex.additionalProperties) !== JSON.stringify(we.additionalProperties)) failures.push("RoutineExercise must be bounded-open exactly as WorkoutExercise");
  if (sch.Routine["x-max-live-records"] !== L.max_live_routines) failures.push("Routine.x-max-live-records differs from routines.json limits.max_live_routines");
  if (!sch.SyncTable.enum.includes("routines") || !("routines" in sch.SyncChanges.properties) || !("routines" in sch.ExportTables.properties)) failures.push("routines is missing from SyncTable, SyncChanges or ExportTables");
  if (sch.ExportTables.required.includes("routines")) failures.push("ExportTables.routines must stay optional (a server built against 0.1.26 omits it; missing means empty)");
  if (!spec.includes(`\`${L.cap_issue}\``)) failures.push("/sync description does not name the too_many_routines issue");
  const len = (x) => [...x].length;
  const check = (r) => {
    if (typeof r.name !== "string" || len(r.name) < 1 || len(r.name) > L.name_max || !blankRe.test(r.name)) return "name";
    if (!Array.isArray(r.exercises) || r.exercises.length < L.exercises_min || r.exercises.length > L.exercises_max) return "exercises";
    for (const e of r.exercises) {
      if (typeof e.name !== "string" || len(e.name) < 1 || len(e.name) > L.exercise_name_max || !blankRe.test(e.name)) return "exercises.name";
      if (!Number.isInteger(e.sets) || e.sets < L.sets_min || e.sets > L.sets_max) return "exercises.sets";
      if (e.group !== undefined && e.group !== null && !(typeof e.group === "string" && /^[A-Za-z0-9_-]{1,36}$/u.test(e.group))) return "exercises.group";
      const keys = Object.keys(e);
      if (keys.length > L.max_exercise_keys) return "exercises.unknown_key";
      for (const k of keys) {
        if (k === "name" || k === "sets") continue;
        const x = e[k];
        if (k.length > 50 || !(x === null || ["boolean", "number", "string"].includes(typeof x)) || (typeof x === "string" && len(x) > 200)) return "exercises.unknown_key";
      }
    }
    return null;
  };
  for (const c of routinesVec.valid) if (check(c.record)) failures.push(`routines.json valid "${c.note}": refused at ${check(c.record)}`);
  for (const c of routinesVec.invalid) if (check(c.record) !== c.field) failures.push(`routines.json invalid "${c.note}": expected ${c.field}, got ${check(c.record)}`);
  // Reference counter for the cap: refuse only when a new or revived routine is pushed and the live count after the apply is over the limit.
  const cap = (c) => {
    let live = c.live;
    for (const op of c.push) if (op === "delete") live--;
    const refused = [];
    c.push.forEach((op, i) => { if (op === "new" || op === "revive") { live++; if (live > L.max_live_routines) refused.push(i); } });
    return refused;
  };
  for (const c of routinesVec.cap.cases) if (JSON.stringify(cap(c)) !== JSON.stringify(c.refused)) failures.push(`routines.json cap "${c.note}": expected ${JSON.stringify(c.refused)}, got ${JSON.stringify(cap(c))}`);
}

// exercise-group.json (#1182): WorkoutExercise.group and RoutineExercise.group share one shape; the vectors are checked against the schema's type, bounds and pattern.
{
  const gv = JSON.parse(readFileSync(new URL("./exercise-group.json", import.meta.url), "utf8"));
  const sch = parsed.components.schemas;
  for (const [name, node] of [["WorkoutExercise", sch.WorkoutExercise], ["RoutineExercise", sch.RoutineExercise]]) {
    const g = node.properties.group;
    if (!g) { failures.push(`${name}.group is missing`); continue; }
    if (node.required.includes("group")) failures.push(`${name}.group must stay optional (older clients omit it)`);
    if (JSON.stringify(g.type) !== JSON.stringify(["string", "null"])) failures.push(`${name}.group must be a nullable string`);
    if (g.minLength !== 1 || g.maxLength !== 36 || g.pattern !== "^[A-Za-z0-9_-]{1,36}$") failures.push(`${name}.group: bounds or pattern differ from exercise-group.json`);
    const re = new RegExp(g.pattern, "u");
    const accepts = (v) => (v === null ? g.type.includes("null") : typeof v === "string" && [...v].length >= g.minLength && [...v].length <= g.maxLength && re.test(v));
    for (const v of gv.valid) if (!accepts(v)) failures.push(`${name}.group refuses valid ${JSON.stringify(v)}`);
    for (const v of gv.invalid) if (accepts(v)) failures.push(`${name}.group accepts invalid ${JSON.stringify(v)}`);
    if (node.maxProperties !== 20) failures.push(`${name}.maxProperties must stay 20`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`sync-ids.json: rfc_example, ${vectors.cases.length} cases and openapi.yaml example ids verified`);
console.log(`content-hash.json: ${content.cases.length} cases and openapi.yaml content examples verified`);
console.log(`openapi.yaml: ${manifestEntries} manifest example entries match the bytes of content/*.json`);
console.log(`blank-text.json: ${blank.must_fail.length} must-fail and ${blank.must_pass.length} must-pass texts on ${blank.fields.length} fields, ${patterns.length} spec patterns without engine-specific escapes or lookbehind`);
console.log(`openapi.yaml: ${used.size} operation tags, all declared`);
console.log(`openapi.yaml: ${bounded} record and AI request strings, arrays and open objects, all bounded`);
console.log(`openapi.yaml: ${mutants} bounds in ${aiRequests.size} AI request schemas (${[...aiRequests].join(", ")}), each one caught when removed`);
console.log(`openapi.yaml: ${closedCheck.closers.size} closed record objects, each one caught when opened; open core-owned objects carry x-max-json-bytes`);
console.log(`openapi.yaml: ${syncExamples.length} /sync 200 examples, replaced_record only on client_won as the stored copy (${replacedSeen} shown); 3 broken conflicts caught`);
console.log(`ai-images.json: ${imgv.cases.length} cases, limits equal the schemas, ${imageExamples} example images pass the rules`);
console.log(`strict-json.json: ${strict.must_refuse.length} must-refuse and ${strict.must_accept.length} must-accept bodies, nesting limit ${strict.max_nesting_depth}`);
console.log(`routines.json: ${routinesVec.valid.length} valid and ${routinesVec.invalid.length} invalid routines, ${routinesVec.cap.cases.length} cap scenarios, bounds and x-max-live-records equal the schemas`);
console.log(`barcode-gs1.json: ${barcode.valid.length} valid and ${barcode.invalid.length} invalid codes, ${barcode.upc_e_expansion.length} UPC-E expansions, /foods/barcode examples and error codes verified`);
console.log(`openapi.yaml: OffProduct and OffNutriments closed, ${OFF_NUTRIMENT_KEYS.length} nutriment keys pinned, strings and arrays bounded, ${offMutants.length} mutations caught`);
