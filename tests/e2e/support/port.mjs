import { createServer } from 'node:net';

// One place that decides which port the e2e web server uses, so the Playwright config, support/server.mjs and the sync
// config never disagree (#810). A server already on the port is never reused silently: it may be a stale build from
// another session or another run's server. Set E2E_REUSE=1 to reuse one on purpose.

export const reuseRequested = (env = process.env) => env.E2E_REUSE === '1';

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      const { port: bound } = probe.address();
      probe.close(() => resolve(bound));
    });
  });
}

export const freePort = () => listenOn(0);

export async function isPortTaken(port) {
  try {
    await listenOn(port);
    return false;
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') return true;
    throw error;
  }
}

export const takenMessage = (port, name = 'E2E_PORT') =>
  `Port ${port} is already in use, so the e2e web server cannot start. Something else (a stale server from another session, ` +
  `or another run) is listening there and could serve an old build. Stop it, set ${name}=0 to pick a free port, ` +
  `or set E2E_REUSE=1 to reuse that server on purpose.`;

/**
 * Resolve the port for `name` (E2E_PORT or E2E_SYNC_PORT). Unset or 0 means `fallback`, or a free port when there is no
 * fallback. Unless E2E_REUSE=1, throws if the port is taken. The result is written back to env[name]: Playwright re-reads
 * the config in every worker process, and they must see the same port, not pick another one.
 */
export async function resolvePort({ name = 'E2E_PORT', fallback, env = process.env } = {}) {
  const done = `${name}_RESOLVED`;
  if (env[done] === '1') return Number(env[name]);
  const raw = env[name];
  let port = raw === undefined || raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`${name}=${raw} is not a port number (0 picks a free port).`);
  if (port === 0 && fallback) port = fallback;
  if (port === 0) port = await freePort();
  else if (!reuseRequested(env) && (await isPortTaken(port))) throw new Error(takenMessage(port, name));
  env[name] = String(port);
  env[done] = '1';
  return port;
}
