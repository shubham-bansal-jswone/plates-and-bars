import type { CandidateWhy } from '@plate-and-bar/core';
import labels from '../../../../content/labels.json';
import { listJoin } from './copy';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The line under a replacement ("Works your chest, same movement, doesn’t load the shoulder"), built from core's facts and
 * content/labels.json in the order tools/README.md gives (the prototype's `candidates()` text).
 */
export function reasonText(why: CandidateWhy): string {
  const r = labels.replacement_reasons;
  const muscle = (m: string): string => (labels.muscles as Record<string, string>)[m] ?? m;
  const parts = [r.works.replace('{muscles}', listJoin(why.muscles.map(muscle)))];
  if (why.sameMovement) parts.push(r.same_movement);
  if (why.sparesJoint) parts.push(r.spares_joint.replace('{joint}', (labels.joints as Record<string, string>)[why.sparesJoint] ?? why.sparesJoint));
  else if (why.easierOnJoints) parts.push(r.easier_on_joints);
  if (why.easierToLearn) parts.push(r.easier_to_learn);
  if (why.doneBefore) parts.push(r.done_before);
  return cap(parts.join(', '));
}

/** Prototype `JOINT` label. */
export const jointLabel = (j: string): string => (labels.joints as Record<string, string>)[j] ?? j;
