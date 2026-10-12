// Lists the [square bracket] placeholders still in the pages (facts that wait on a decision by the owner).
// Prints them and exits 0: it never fails the build. Run before launch; the list must be empty by then.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../src/pages/", import.meta.url));
const found = new Map(); // placeholder -> files
for (const f of (await readdir(dir)).filter((n) => n.endsWith(".astro"))) {
  const text = (await readFile(join(dir, f), "utf8")).replace(/^---[\s\S]*?---/, "");
  for (const m of text.matchAll(/\[([A-Za-z][^\][<>]{2,60})\]/g)) found.set(m[0], [...(found.get(m[0]) ?? []), f]);
}
if (found.size === 0) console.log("No placeholders left.");
else {
  console.log(`${found.size} placeholder(s) left:`);
  for (const [p, files] of found) console.log(`  ${p}  (${[...new Set(files)].join(", ")})`);
}
