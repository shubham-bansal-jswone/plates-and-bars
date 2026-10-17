// Serves apps/mobile/dist on 127.0.0.1 with the cross-origin isolation headers expo-sqlite needs on web
// (the same ones apps/mobile/public/_headers sets on Cloudflare Pages). Unknown paths fall back to index.html.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// E2E_DIST: another export to serve (the sync tests serve a build that has the API URL compiled in), relative to tests/e2e.
const root = process.env.E2E_DIST
  ? fileURLToPath(new URL(`../${process.env.E2E_DIST}/`, import.meta.url))
  : fileURLToPath(new URL('../../../apps/mobile/dist/', import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };

createServer(async (req, res) => {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  const p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = p === sep || p === '/' ? 'index.html' : p.replace(/^[/\\]+/, '');
  let body;
  let type;
  try {
    if (file.split(/[/\\]/).includes('..')) throw new Error('outside root');
    body = await readFile(join(root, file));
    type = types[extname(file)] ?? 'application/octet-stream';
  } catch {
    body = await readFile(join(root, 'index.html')); // single-page fallback, as Cloudflare Pages does
    type = types['.html'];
  }
  res.writeHead(200, { ...headers, 'content-type': type }).end(body);
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
