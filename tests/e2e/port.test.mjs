// Proves #810: a taken e2e port fails fast, E2E_REUSE=1 reuses it, and an unset or 0 port picks a free one.
// Plain node:test (no browser, no build): `npm run test:port`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort, resolvePort } from './support/port.mjs';

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
