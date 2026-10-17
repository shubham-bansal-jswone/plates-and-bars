/**
 * Counts the wipes of the local store in this app run. A settings save remembers the count its provider started with and checks
 * it inside its transaction: after a wipe the account is another one (or none), so a save queued before it must not write (#645).
 */
let epoch = 0;

export const storeEpoch = (): number => epoch;

/** Called inside the wipe transaction, after the deletes, so every save that takes the lock afterwards sees it. */
export const bumpStoreEpoch = (): void => void (epoch += 1);
