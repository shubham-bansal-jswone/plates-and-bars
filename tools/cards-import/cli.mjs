// Usage: node cards-import/cli.mjs [prototype.html] [content-dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCards, importLabels, importMeasures, serialize } from './import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(resolve(process.argv[2] ?? `${repo}/docs/prototype/plate-and-bar.html`), 'utf8');
const dir = resolve(process.argv[3] ?? `${repo}/content`);
const cards = importCards(html);
writeFileSync(`${dir}/cards.json`, serialize(cards));
writeFileSync(`${dir}/measures.json`, serialize(importMeasures(html)));
writeFileSync(`${dir}/labels.json`, serialize(importLabels(html)));
console.log(`wrote ${cards.cards.length} cards, measures and labels to ${dir}`);
