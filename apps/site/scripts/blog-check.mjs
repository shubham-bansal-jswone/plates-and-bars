// Checks the built blog in dist/: every card in content/cards.json (except the ones the app holds back) has a page with its
// title, summary, source and evidence; the index lists them; no leftover {placeholders}; every internal link resolves.
// Run after `npm run build` (the a11y script does both). Exits 1 on any failure.
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const failures = [];
const fail = (m) => failures.push(m);
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const exists = (p) => access(p).then(() => true, () => false);
const read = (p) => readFile(join(dist, p), "utf8");

// The hidden list must match the app's (apps/mobile/src/why/cards.ts), so site and app show the same cards.
const appSrc = await readFile(join(root, "apps/mobile/src/why/cards.ts"), "utf8");
const appHidden = [...(/HIDDEN_CARDS[^=]*=\s*\[([^\]]*)\]/.exec(appSrc)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const siteSrc = await readFile(new URL("../src/lib/cards.ts", import.meta.url), "utf8");
const siteHidden = [...(/HIDDEN_CARDS[^=]*=\s*\[([^\]]*)\]/.exec(siteSrc)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
if (appHidden.length === 0) fail("could not read HIDDEN_CARDS from the app");
if (appHidden.join() !== siteHidden.join()) fail(`HIDDEN_CARDS differ: app [${appHidden}] site [${siteHidden}]`);

const { cards } = JSON.parse(await readFile(join(root, "content/cards.json"), "utf8"));
const shown = cards.filter((c) => !appHidden.includes(c.id));
const index = decode(await read("blog/index.html"));

for (const c of cards) {
  const page = `blog/${c.id}/index.html`;
  if (appHidden.includes(c.id)) {
    if (await exists(join(dist, page))) fail(`${c.id}: held-back card has a page`);
    if (index.includes(`/blog/${c.id}/`)) fail(`${c.id}: held-back card is linked from the index`);
    continue;
  }
  if (!(await exists(join(dist, page)))) {
    fail(`${c.id}: no page`);
    continue;
  }
  const html = decode(await read(page));
  for (const [what, text] of [["title", c.title], ["summary", c.summary], ["source", c.source], ["evidence", c.evidence]])
    if (!html.includes(text)) fail(`${c.id}: ${what} missing`);
  if (!c.source.trim()) fail(`${c.id}: empty source in content`);
  if (!/<html lang="en"/.test(html)) fail(`${c.id}: no lang`);
  if ((html.match(/<h1[ >]/g) ?? []).length !== 1) fail(`${c.id}: need exactly one h1`);
  if (!new RegExp(`<meta name="description" content="[^"]+"`).test(html)) fail(`${c.id}: no meta description`);
  if (/\{[?/:a-z_]*\}/.test(html.replace(/<style[\s\S]*?<\/style>/g, ""))) fail(`${c.id}: unresolved {placeholder}`);
  if (!index.includes(`/blog/${c.id}/`)) fail(`${c.id}: not linked from the index`);
}
if (shown.length === 0) fail("no cards shown");

// Links: landing and footer reach the blog; every internal href in the blog and landing resolves to a built file.
const landing = await read("index.html");
if (!landing.includes('href="/blog/"')) fail("landing has no blog link");
if ((landing.match(/<footer[\s\S]*<\/footer>/)?.[0] ?? "").includes('href="/blog/"') === false) fail("footer has no blog link");
for (const p of ["index.html", "blog/index.html", ...shown.map((c) => `blog/${c.id}/index.html`)]) {
  for (const m of (await read(p)).matchAll(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) {
    const target = m[1];
    const file = target.endsWith("/") ? `${target}index.html` : target;
    if (!(await exists(join(dist, file)))) fail(`${p}: broken link ${target}`);
  }
}

if (failures.length) {
  console.error(failures.map((f) => `blog-check: ${f}`).join("\n"));
  process.exit(1);
}
console.log(`blog-check: ${shown.length} cards shown, ${cards.length - shown.length} held back, all pages and links ok`);
