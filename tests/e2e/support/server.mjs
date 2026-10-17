// Serves apps/mobile/dist on 127.0.0.1 with the cross-origin isolation headers expo-sqlite needs on web
// (the same ones apps/mobile/public/_headers sets on Cloudflare Pages). Unknown paths fall back to index.html.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { takenMessage } from './port.mjs';

const root = process.env.E2E_DIST
  ? fileURLToPath(new URL(`../${process.env.E2E_DIST}/`, import.meta.url))
  : fileURLToPath(new URL('../../../apps/mobile/dist/', import.meta.url));
// The Content-Security-Policy is read from _headers, so the suite runs under the policy that ships (#749).
const declared = readFileSync(new URL('../../../apps/mobile/public/_headers', import.meta.url), 'utf8').match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1];
if (!declared) throw new Error('no Content-Security-Policy in apps/mobile/public/_headers');
// The sync tests serve a build compiled against their own API (E2E_API_URL, the base of EXPO_PUBLIC_API_URL). _headers
// names the production host, so allow the build's origin too: without it connect-src blocks the sign-in call and the
// suite fails with "no sign-in code mailed" (the Fastify-free stack publishes the API on 127.0.0.1:18080).
const apiOrigin = (() => {
  try {
    return process.env.E2E_API_URL ? new URL(process.env.E2E_API_URL).origin : '';
  } catch {
    return '';
  }
})();
const csp = apiOrigin && !declared.includes(apiOrigin)
  ? declared.replace(/connect-src([^;]*)/, (_match, sources) => `connect-src${sources} ${apiOrigin}`)
  : declared;
// The Playwright config resolves the port and passes it in E2E_PORT; run by hand, unset means 4173.
const port = Number(process.env.E2E_PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };

const server = createServer(async (req, res) => {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Content-Security-Policy': csp };
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
});
server.once('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(takenMessage(port));
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
