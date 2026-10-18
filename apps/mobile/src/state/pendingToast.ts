import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { storeEpoch } from '../db/storeEpoch';

// A message posted on one screen and shown on the next (setup saves, then the Food tab toasts). Only a focused
// Food screen takes it: on a redo the Food tab is already mounted but hidden under setup, and must not use it up.
// A message posted before a wipe or sign-out (the store epoch changed) is dropped, never shown to the next account.
let pending: { message: string; epoch: number } | null = null;

export function postToast(message: string): void {
  pending = { message, epoch: storeEpoch() };
}

/** Clears any posted message (tests). */
export function resetPendingToast(): void {
  pending = null;
}

/** Calls `show` with a posted message, once, whenever the screen is focused. */
export function usePendingToast(show: (message: string) => void): void {
  useFocusEffect(
    useCallback(() => {
      const p = pending;
      pending = null;
      if (p && p.epoch === storeEpoch()) show(p.message);
    }, [show]),
  );
}
