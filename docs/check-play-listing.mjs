#!/usr/bin/env node
// Checks docs/PLAY-STORE-LISTING.md (#832). Run from anywhere: node docs/check-play-listing.mjs
// Each paste-ready block is a ```text fence right after a <!-- play:<key> max=<n> --> marker.
// Exits 1 with one line per problem; prints the counts either way.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const doc = readFileSync(`${root}docs/PLAY-STORE-LISTING.md`, 'utf8');
const setupCopy = readFileSync(`${root}apps/mobile/src/setup/copy.ts`, 'utf8');

const problems = [];
// Google counts characters, full-width and half-width alike: count code points, not UTF-16 units.
const len = (s) => [...s].length;

const blocks = {};
for (const m of doc.matchAll(/<!-- play:(\w+) max=(\d+) -->\n```text\n([\s\S]*?)\n```/g)) {
  const [, key, max, text] = m;
  if (blocks[key]) problems.push(`${key}: more than one block`);
  blocks[key] = { max: Number(max), text };
}
for (const key of ['name', 'short', 'full', 'whatsnew']) {
  if (!blocks[key]) problems.push(`${key}: block missing`);
}
if (Object.keys(blocks).length !== (doc.match(/<!-- play:/g) ?? []).length) {
  problems.push('a <!-- play: --> marker is not followed directly by a ```text block');
}

for (const [key, { max, text }] of Object.entries(blocks)) {
  console.log(`${key}: ${len(text)} / ${max}`);
  if (text.trim() === '') problems.push(`${key}: empty`);
  if (len(text) > max) problems.push(`${key}: ${len(text)} characters, over ${max}`);
  if (/\[[^\]\n]*\]/.test(text)) problems.push(`${key}: contains a [placeholder]; listing text must be paste-ready`);
  if (/\b(claude|anthropic|openai|chatgpt|gpt|gemini|llama|mistral|cohere|deepseek|grok|qwen|copilot|bard|perplexity)\b/i.test(text)) {
    problems.push(`${key}: names an AI vendor or model (#673)`);
  }
}

if (blocks.full && blocks.ai) {
  const withAi = `${blocks.full.text}\n\n${blocks.ai.text}`;
  console.log(`full + ai: ${len(withAi)} / 4000`);
  if (len(withAi) > 4000) problems.push(`full description with the AI paragraph: ${len(withAi)} characters, over 4000`);
}

// The medical disclaimer must be the setup copy, word for word.
const note = setupCopy.match(/^\s*note:\s*'([^'\n]*)',$/m)?.[1];
if (!note) problems.push('setup disclaimer (`note:`) not found in apps/mobile/src/setup/copy.ts');
else if (blocks.full && !blocks.full.text.includes(note)) {
  problems.push('full description does not contain the setup disclaimer word for word');
}

// Every [placeholder] in the file is listed in the owner steps. Markdown links ([text](url)) are not placeholders.
const owner = doc.match(/## Owner steps\n([\s\S]*?)\n## /)?.[1];
if (!owner) problems.push('"## Owner steps" section missing');
else {
  const found = new Set([...doc.matchAll(/\[([^\]\n]+)\](?!\()/g)].map((m) => m[0]));
  for (const p of found) if (!owner.includes(p)) problems.push(`${p} is not listed in the owner steps`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log('OK');
