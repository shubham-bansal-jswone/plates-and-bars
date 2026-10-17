/** How long an account call (export, delete, and the refresh it uses) may take before it is given up as unavailable. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long one refresh request may take (#762). Below the server's 60 s lost-response grace window (ADR 003, contract 0.1.12):
 * a tab that waited for the lock and then presents the same cookie again, after this request was given up while the server
 * may still have been rotating, is still inside the window, so it is not read as reuse of a rotated token.
 */
export const REFRESH_TIMEOUT_MS = 20_000;

/** Runs `f` with an AbortSignal that fires after `ms`. `timedOut` true: the call was aborted by the timer (not a network or other error). */
export async function withTimeout<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  const c = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    c.abort();
  }, ms);
  try {
    return { timedOut: false, value: await f(c.signal) };
  } catch (e) {
    if (fired) return { timedOut: true };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
