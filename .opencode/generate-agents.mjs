#!/usr/bin/env node
// Generates OpenCode subagents from the Claude Code lane definitions.
//
// Source of truth: .claude/agents/*.md  (name, description, tools, body)
// Output:          .opencode/agents/<name>.md  (mode: subagent + translated permissions)
//
// Run:  node .opencode/generate-agents.mjs
// It is idempotent: running it twice produces byte-identical output.
//
// Lane -> folders the agent may write to. `edit` is denied everywhere else, so the
// "write only in <folder>" rule in each prompt becomes a harness guardrail.
// An empty list means the agent is read-only (the reviewer).
const LANES = {
  app: ["apps/mobile/**"],
  core: ["packages/core/**"],
  backend: ["backend/**"],
  contract: ["packages/api/**", "docs/adr/**"],
  content: ["content/**", "tools/**"],
  website: ["apps/site/**"],
  infra: ["infra/**", ".github/**", ".gitleaks.toml"],
  qa: ["tests/e2e/**"],
  reviewer: [],
};

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(repoRoot, ".claude", "agents");
const outDir = join(repoRoot, ".opencode", "agents");

/** Split a Markdown file into its YAML frontmatter fields and body. */
function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("no frontmatter");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return { fields, body: match[2].trimEnd() };
}

/** Build the ordered permission list for one lane. Last matching rule wins. */
function permissionsFor(name, tools) {
  const list = [
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ];
  if (tools.has("WebFetch")) {
    list.push({ action: "webfetch", resource: "*", effect: "allow" });
  }
  // Leaf workers: no spawning further subagents.
  list.push({ action: "subagent", resource: "*", effect: "deny" });
  // Edits: deny by default, then re-allow only the lane's own folders.
  // Both forms are emitted: the plain glob matches the canonical checkout's
  // relative path, and the `**/`-prefixed glob also matches absolute paths
  // into a sibling git worktree (the matcher is unanchored), so a lane agent
  // can work in a worktree without losing its scope.
  list.push({ action: "edit", resource: "*", effect: "deny" });
  const globs = LANES[name] ?? [];
  for (const resource of globs) {
    list.push({ action: "edit", resource, effect: "allow" });
    list.push({ action: "edit", resource: `**/${resource}`, effect: "allow" });
  }
  return list;
}

function render(name, { fields, body }, tools) {
  const perms = permissionsFor(name, tools)
    .map(
      (p) =>
        `  - action: ${p.action}\n    resource: "${p.resource}"\n    effect: ${p.effect}`,
    )
    .join("\n");
  return (
    "---\n" +
    `description: ${fields.description}\n` +
    "mode: subagent\n" +
    "permissions:\n" +
    perms +
    "\n---\n" +
    body +
    "\n"
  );
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".md")).sort();
  const written = [];
  for (const file of files) {
    const name = file.replace(/\.md$/, "");
    const text = readFileSync(join(srcDir, file), "utf8");
    const parsed = splitFrontmatter(text);
    const tools = new Set(
      (parsed.fields.tools ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
    const out = render(name, parsed, tools);
    writeFileSync(join(outDir, file), out, "utf8");
    written.push(name);
  }
  console.log(`Wrote ${written.length} agents to .opencode/agents: ${written.join(", ")}`);
}

main();
