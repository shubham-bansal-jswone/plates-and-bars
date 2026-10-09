import { candidates, type CandidateWhy } from '@plate-and-bar/core';
import { catalog } from '../src/workout/catalog';
import { reasonText } from '../src/workout/reasons';
import { FAMILY, PATTERN } from '../src/workout/rulesCopy';

const why = (o: Partial<CandidateWhy>): CandidateWhy => ({ muscles: ['chest'], sameMovement: false, sparesJoint: null, easierOnJoints: false, easierToLearn: false, doneBefore: false, ...o });

describe('reasonText (content/labels.json and the prototype’s candidates() text)', () => {
  it('builds the clauses in the prototype’s order and capitalises the first', () => {
    expect(reasonText(why({ muscles: ['chest', 'front-delt', 'triceps'], sameMovement: true, sparesJoint: 'shoulder', easierToLearn: true, doneBefore: true }))).toBe(
      'Works your chest, front shoulders and triceps, same movement, doesn’t load the shoulder, easier to learn, you’ve done it before',
    );
  });
  it('says easier on the joints only when no joint was asked to be spared', () => {
    expect(reasonText(why({ muscles: ['hams', 'glutes'], easierOnJoints: true }))).toBe('Works your hamstrings and glutes, easier on the joints');
    expect(reasonText(why({ sparesJoint: 'lower-back', easierOnJoints: true }))).toBe('Works your chest, doesn’t load the lower back');
  });
  it('reads core’s real candidates', () => {
    const [first] = candidates('Barbell Bench Press', { where: 'gym', joint: 'shoulder', pain: true }, [], {}, catalog);
    expect(first && reasonText(first.why)).toBe('Works your chest, same movement, doesn’t load the shoulder');
  });
});

describe('rule labels (content/labels.json)', () => {
  it('has a label for every family and pattern the catalogue uses', () => {
    for (const t of Object.values(catalog.tags)) {
      expect(FAMILY[t.family]).toBeTruthy();
      expect(PATTERN[t.pattern]).toBeTruthy();
    }
    expect(FAMILY.balance).toBe('balance variations');
  });
});
