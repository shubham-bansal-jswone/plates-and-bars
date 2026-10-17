// Proves #810: a taken e2e port fails fast, E2E_REUSE=1 reuses it, and an unset or 0 port picks a free one.
// Plain node:test (no browser, no build): `npm run test:port`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort, isPortTaken, resolvePort, takenMessage } from './support/port.mjs';

const holder = () => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});
const close = (server) => new Promise((resolve) => server.close(resolve));

test('a taken port fails fast with a message that says what to do', async () => {
  const { server, port } = await holder();
  try {
    await assert.rejects(resolvePort({ env: { E2E_PORT: String(port) } }), (error) => {
      assert.match(error.message, new RegExp(`Port ${port} is already in use`));
      assert.match(error.message, /E2E_REUSE=1/);
      assert.match(error.message, /E2E_PORT=0/);
      return true;
    });
  } finally {
    await close(server);
  }
});

test('E2E_REUSE=1 reuses the taken port', async () => {
  const { server, port } = await holder();
  try {
    assert.equal(await resolvePort({ env: { E2E_PORT: String(port), E2E_REUSE: '1' } }), port);
  } finally {
    await close(server);
  }
});

test('only E2E_REUSE=1 opts in (not "true", not CI)', async () => {
  const { server, port } = await holder();
  try {
    for (const extra of [{ E2E_REUSE: 'true' }, { E2E_REUSE: '0' }, { CI: 'true' }]) {
      await assert.rejects(resolvePort({ env: { E2E_PORT: String(port), ...extra } }), /already in use/);
    }
  } finally {
    await close(server);
  }
});

test('unset or 0 picks a free port, the fallback is used when given, and the result is written back for workers', async () => {
  for (const env of [{}, { E2E_PORT: '0' }, { E2E_PORT: '' }]) {
    const port = await resolvePort({ env });
    assert.ok(port > 0);
    assert.equal(env.E2E_PORT, String(port));
    assert.equal(await resolvePort({ env }), port, 'a second load (a Playwright worker) sees the same port');
  }
  const fallback = await freePort();
  assert.equal(await resolvePort({ fallback, env: {} }), fallback);
  await assert.rejects(resolvePort({ env: { E2E_PORT: 'abc' } }), /not a port number/);
});

test('support/server.mjs exits non-zero with the message when its port is taken', async () => {
  const { server, port } = await holder();
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./support/server.mjs', import.meta.url))], { env: { ...process.env, E2E_PORT: String(port) } });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 1);
    assert.match(stderr, /already in use/);
  } finally {
    await close(server);
  }
});

test('the sync port error gives sync advice (no free-port claim) and a taken sync port fails fast', async () => {
  const { server, port } = await holder();
  try {
    await assert.rejects(resolvePort({ name: 'E2E_SYNC_PORT', fallback: port, env: {} }), (error) => {
      assert.match(error.message, new RegExp(`Port ${port} is already in use`));
      assert.match(error.message, /E2E_REUSE=1/);
      assert.match(error.message, /E2E_SYNC_PORT=<n>/);
      assert.match(error.message, /CORS_ALLOWED_ORIGINS and AUTH_COOKIE_ORIGINS/);
      assert.doesNotMatch(error.message, /=0/);
      return true;
    });
  } finally {
    await close(server);
  }
  assert.doesNotMatch(takenMessage(1, 'E2E_SYNC_PORT'), /free port/);
});

test('a wildcard listener (no host, as npx serve or Expo bind) counts as taken', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    assert.equal(await isPortTaken(port), true);
    await assert.rejects(resolvePort({ env: { E2E_PORT: String(port) } }), /already in use/);
  } finally {
    await close(server);
  }
  assert.equal(await isPortTaken(port), false);
});

test('an IPv6 wildcard listener counts as taken', async (t) => {
  const server = createServer();
  const listening = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(0, '::', () => resolve(true));
  });
  if (!listening) return t.skip('no IPv6 on this machine');
  try {
    assert.equal(await isPortTaken(server.address().port), true);
  } finally {
    await close(server);
  }
});

// Pins the one-line revert that #810 fixed: reuse must be opt-in, never `!process.env.CI`. The configs read CHROME_PATH at
// import, so point it at any file; nothing launches here.
test('both configs reuse a server only with E2E_REUSE=1 (and not because CI is unset)', async () => {
  const saved = { ...process.env };
  const configs = ['./playwright.config.mjs', './playwright.sync.config.mjs'];
  try {
    for (const [index, reuse] of [undefined, '1'].entries()) {
      for (const config of configs) {
        for (const key of ['E2E_PORT', 'E2E_PORT_RESOLVED', 'E2E_SYNC_PORT', 'E2E_SYNC_PORT_RESOLVED', 'E2E_REUSE', 'CI']) delete process.env[key];
        process.env.CHROME_PATH = process.execPath;
        process.env.E2E_PORT = '0';
        if (reuse) process.env.E2E_REUSE = reuse;
        // The sync config defaults to 4174 and refuses to load if it is taken, so give it a free port of its own.
        if (config.includes('sync')) process.env.E2E_SYNC_PORT = String(await freePort());
        const { default: loaded } = await import(`${config}?case=${index}`);
        assert.equal(loaded.webServer.reuseExistingServer, Boolean(reuse), `${config} with E2E_REUSE=${reuse}`);
      }
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
