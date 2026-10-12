import type { CandidateWhy } from '@plate-and-bar/core';
import { getLabels, listJoin, muscleName } from './copy';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The line under a replacement ("Works your chest, same movement, doesn’t load the shoulder"), built from core's facts and
 * content/labels.json in the order tools/README.md gives (the prototype's `candidates()` text).
 */
export function reasonText(why: CandidateWhy): string {
  const { replacement_reasons: r } = getLabels();
  const parts = [r.works.replace('{muscles}', listJoin(why.muscles.map(muscleName)))];
  if (why.sameMovement) parts.push(r.same_movement);
  if (why.sparesJoint) parts.push(r.spares_joint.replace('{joint}', jointLabel(why.sparesJoint)));
  else if (why.easierOnJoints) parts.push(r.easier_on_joints);
  if (why.easierToLearn) parts.push(r.easier_to_learn);
  if (why.doneBefore) parts.push(r.done_before);
  return cap(parts.join(', '));
}

/** Prototype `JOINT` label. */
export const jointLabel = (j: string): string => getLabels().joints[j] ?? j;
