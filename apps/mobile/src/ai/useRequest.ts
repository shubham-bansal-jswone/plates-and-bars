import { useEffect, useMemo, useRef } from 'react';

/**
 * One in-flight request per component, and the rule that a reply nobody is waiting for is dropped (#946). `begin()` starts a
 * request and returns its token; `settle(token)` is called with the reply and says whether the request is still the current
 * one. `cancel()` (Cancel, close, choosing another photo) and unmounting make every earlier token stale, so a late answer or
 * error never changes the draft, the rows or the message. While a request is current, `pending()` is true, which is what
 * keeps a second tap from sending a second request. The same pattern is used by every AI image call in the app.
 */
export interface RequestGuard {
  begin(): number;
  /** True when `token` is still the current request (and then no request is pending any more). */
  settle(token: number): boolean;
  cancel(): void;
  pending(): boolean;
}

export function useRequest(): RequestGuard {
  const gen = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      gen.current++;
      busy.current = false;
    },
    [],
  );
  return useMemo<RequestGuard>(
    () => ({
      begin: () => {
        busy.current = true;
        return ++gen.current;
      },
      settle: (token) => {
        if (token !== gen.current) return false;
        busy.current = false;
        return true;
      },
      cancel: () => {
        gen.current++;
        busy.current = false;
      },
      pending: () => busy.current,
    }),
    [],
  );
}
