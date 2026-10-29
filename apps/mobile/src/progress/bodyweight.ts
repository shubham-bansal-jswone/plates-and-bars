import { latestWeight } from '@plate-and-bar/core';

/**
 * The bodyweight that scores assisted lifts on `date`: the latest weigh-in on or before it (core's `latestWeight`), else the profile weight, else null.
 * One lookup for the lift record, the PR toast, History's badges and the Recent PRs list, so they agree. Rules stay in core; this only supplies the number.
 */
export const bodyweightOn = (weights: Parameters<typeof latestWeight>[0], date: string, profileKg: number | null | undefined): number | null => latestWeight(weights, date) ?? profileKg ?? null;
