import { isBlank, num } from '@plate-and-bar/core';

/** Cardio minutes from the field's text, as the prototype: blank is none, else core's `num` (a comma decimal counts) rounded to a whole
 * minute, kept to 0 to 9999 (contract `cardio_min`, an integer of 0 or more). */
export const parseCardio = (text: string): number | null => (isBlank(text) ? null : Math.min(9999, Math.max(0, Math.round(num(text)))));
