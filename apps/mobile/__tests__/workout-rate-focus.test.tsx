import { fireEvent, render, screen } from '@testing-library/react-native';
import { exInfo } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { blankRow, type ExState } from '../src/workout/model';
import { getCatalog } from '../src/workout/catalog';
import { focusNode } from '../src/labelscan/focus';

// A rating asked for by a press takes focus once; a flag left over from a press that changed nothing must not take it on a later change (#1408).
jest.mock('../src/labelscan/focus', () => ({ ...jest.requireActual('../src/labelscan/focus'), focusNode: jest.fn() }));

const NAME = 'Barbell Bench Press';
const act = new Proxy({}, { get: () => jest.fn() }) as unknown as Actions;
const ui = (rate: 'easy' | 'hard' | null) => {
  const ex: ExState = { name: NAME, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets: [{ ...blankRow(), id: 'a', w: '40', r: '8', done: true, rate }] };
  return <ExerciseCard ex={ex} info={exInfo(NAME, getCatalog())} sug={{ mode: 'hold', reps: 8, w: 40, text: '40 kg', reason: '' }} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} expanded />;
};

describe('rating focus: a stale request', () => {
  beforeEach(() => jest.mocked(focusNode).mockClear());

  it('does not take focus when the rating later changes for another reason', async () => {
    const { rerender } = await render(ui(null));
    await fireEvent.press(screen.getByLabelText(`${NAME} set 1: Hard`)); // the stored rating does not change (the write failed or is pending)
    await rerender(ui('easy')); // a sync brings a different rating: not what was asked for
    await rerender(ui(null));
    await rerender(ui('hard')); // a later sync brings the rating the old press asked for
    expect(focusNode).not.toHaveBeenCalled();
  });

  it('takes focus once when the rating asked for arrives', async () => {
    const { rerender } = await render(ui(null));
    await fireEvent.press(screen.getByLabelText(`${NAME} set 1: Hard`));
    await rerender(ui('hard'));
    expect(focusNode).toHaveBeenCalledTimes(1);
    expect((jest.mocked(focusNode).mock.calls[0]![0] as unknown as { props: { accessibilityLabel: string } }).props.accessibilityLabel).toBe(`${NAME} set 1 rated Hard. Change rating`);
  });
});
