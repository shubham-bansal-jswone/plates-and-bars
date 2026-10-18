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
// same sentence split as src/lib/cards.ts
const SPLIT = /(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs|al|approx|cf|no)\.)\s+(?=[A-Z0-9"'\u2018\u201C(])/;
const exists = (p) => access(p).then(() => true, () => false);
const read = (p) => readFile(join(dist, p), "utf8");

// The hidden list must match the app's (apps/mobile/src/why/cards.ts), so site and app show the same cards.
const appSrc = await readFile(join(root, "apps/mobile/src/why/cards.ts"), "utf8");
const appHidden = [...(/HIDDEN_CARDS[^=]*=\s*\[([^\]]*)\]/.exec(appSrc)?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
const siteSrc = await readFile(new URL("../src/lib/cards.ts", import.meta.url), "utf8");
const siteHidden = [...(/HIDDEN_CARDS[^=]*=\s*\[([^\]]*)\]/.exec(siteSrc)?.[1] ?? "").matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
if (appHidden.length === 0) fail("could not read HIDDEN_CARDS from the app");
if (appHidden.join() !== siteHidden.join()) fail(`HIDDEN_CARDS differ: app [${appHidden}] site [${siteHidden}]`);

// The evidence wording must match the app's Why sheet.
const evOf = (src, re) => Object.fromEntries([...(re.exec(src)?.[1] ?? "").matchAll(/(Strong|Moderate|Emerging):\s*['"]([^'"]+)['"]/g)].map((m) => [m[1], m[2]]));
const appEv = evOf(await readFile(join(root, "apps/mobile/src/why/WhyLink.tsx"), "utf8"), /EVIDENCE_NOTE\s*=\s*\{([^}]*)\}/);
const siteEv = evOf(siteSrc, /EVIDENCE_NOTE\s*=\s*\{([^}]*)\}/);
if (Object.keys(appEv).length !== 3) fail("could not read EVIDENCE_NOTE from the app");
if (JSON.stringify(appEv) !== JSON.stringify(siteEv)) fail(`EVIDENCE_NOTE differs: app ${JSON.stringify(appEv)} site ${JSON.stringify(siteEv)}`);

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
  const article = html.match(/<article[\s\S]*<\/article>/)?.[0] ?? "";
  if (!article) fail(`${c.id}: no <article>`);
  const h1 = (article.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/<[^>]*>/g, "").trim();
  if (h1 !== c.title) fail(`${c.id}: h1 is "${h1}", not the card title`);
  const text = article.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const paras = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
  if (!paras.includes(c.summary)) fail(`${c.id}: summary paragraph missing`);
  for (const [what, t] of [["source", c.source], ["evidence", c.evidence]]) if (!text.includes(t)) fail(`${c.id}: ${what} missing`);
  // body: every sentence of the card body that needs no personal number must be on the page
  const stripped = c.body.replace(/\{\?([a-z_]+)\}[\s\S]*?\{\/\1\}/g, "{}");
  const sentences = stripped.split(SPLIT).filter((x) => !x.includes("{"));
  if (sentences.length === 0) fail(`${c.id}: no checkable body sentence`);
  for (const x of sentences) if (!text.includes(x.replace(/\s+/g, " "))) fail(`${c.id}: body sentence missing: ${x.slice(0, 50)}`);
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
