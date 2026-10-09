/** How long an account call (export, delete, and the refresh it uses) may take before it is given up as unavailable. */
export const REQUEST_TIMEOUT_MS = 30_000;

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
