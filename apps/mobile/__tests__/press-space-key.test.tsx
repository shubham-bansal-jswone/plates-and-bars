import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SetRow } from '../src/workout/SetRow';

const row = { w: '', r: '', done: false } as never;
async function tick(onTick: () => void) {
  await render(<SetRow n="1" label="Squat set 1" row={row} wHead="kg" repsHead="reps" ph={{ w: '', r: '' }} onEdit={() => {}} onTick={onTick} />);
  return screen.getByRole('checkbox', { name: 'Mark Squat set 1 done' });
}

describe('set tick keyboard (#1139)', () => {
  const os = Platform.OS;
  afterEach(() => { Platform.OS = os; });

  it('on web, Space toggles once and does not scroll the page', async () => {
    Platform.OS = 'web';
    const onTick = jest.fn();
    const preventDefault = jest.fn();
    await fireEvent(await tick(onTick), 'keyDown', { key: ' ', preventDefault });
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('on web, Enter is left to the browser/Pressable (no double toggle)', async () => {
    Platform.OS = 'web';
    const onTick = jest.fn();
    await fireEvent(await tick(onTick), 'keyDown', { key: 'Enter', preventDefault: jest.fn() });
    expect(onTick).not.toHaveBeenCalled();
  });

  it('ignores Space auto-repeat', async () => {
    Platform.OS = 'web';
    const onTick = jest.fn();
    await fireEvent(await tick(onTick), 'keyDown', { key: ' ', repeat: true, preventDefault: jest.fn() });
    expect(onTick).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'])('ignores Space with %s', async (mod) => {
    Platform.OS = 'web';
    const onTick = jest.fn();
    const preventDefault = jest.fn();
    await fireEvent(await tick(onTick), 'keyDown', { key: ' ', [mod]: true, preventDefault });
    expect(onTick).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does not hijack Space from a focusable child', async () => {
    Platform.OS = 'web';
    const onTick = jest.fn();
    const preventDefault = jest.fn();
    await fireEvent(await tick(onTick), 'keyDown', { key: ' ', target: {}, currentTarget: {}, preventDefault });
    expect(onTick).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('leaves native alone', async () => {
    const onTick = jest.fn();
    await fireEvent(await tick(onTick), 'keyDown', { key: ' ', preventDefault: jest.fn() });
    expect(onTick).not.toHaveBeenCalled();
  });
});
