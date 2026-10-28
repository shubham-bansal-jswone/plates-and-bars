import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { SetRow } from '../src/workout/SetRow';
import * as useThemeModule from '../src/theme/useTheme';
import { dark, light } from '../src/theme/tokens';

afterEach(() => jest.restoreAllMocks());

const border = (label: string) => (StyleSheet.flatten(screen.getByLabelText(label).props.style) as { borderColor?: string }).borderColor;
const row = (done: boolean) => ({ id: 'r', w: '', r: '', done }) as never;
const ph = { w: '–', r: '8' };

describe('set tick emphasis', () => {
  it('draws the lime ring only on the next set to do, a quiet outline on later ones, and fills a done set', async () => {
    jest.spyOn(useThemeModule, 'useTheme').mockReturnValue(dark);
    await render(
      <>
        <SetRow n="1" label="Bench set 1" row={row(true)} wHead="kg" repsHead="reps" ph={ph} onEdit={() => {}} onTick={() => {}} />
        <SetRow n="2" label="Bench set 2" row={row(false)} wHead="kg" repsHead="reps" ph={ph} onEdit={() => {}} onTick={() => {}} current />
        <SetRow n="3" label="Bench set 3" row={row(false)} wHead="kg" repsHead="reps" ph={ph} onEdit={() => {}} onTick={() => {}} />
      </>,
    );
    expect(border('Mark Bench set 1 done')).toBe(dark.brand);
    expect(border('Mark Bench set 2 done')).toBe(dark.brand);
    expect(border('Mark Bench set 3 done')).toBe(dark.outline);
  });
});

describe('refused tick on web (#1253)', () => {
  it('marks the empty field invalid and, once focused, draws a focus-colour outline over the danger border', async () => {
    const os = Object.getOwnPropertyDescriptor(Platform, 'OS');
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
    try {
      await render(<SetRow n="1" label="Bench set 1" row={row(false)} wHead="kg" repsHead="reps" ph={ph} onEdit={() => {}} onTick={() => 'w'} />);
      await fireEvent.press(screen.getByLabelText('Mark Bench set 1 done'));
      const f = () => StyleSheet.flatten(screen.getByLabelText('Bench set 1 kg').props.style);
      expect(f()).toMatchObject({ borderColor: light.danger, borderWidth: 2, outlineStyle: 'none' });
      await fireEvent(screen.getByLabelText('Bench set 1 kg'), 'focus');
      expect(f()).toMatchObject({ borderColor: light.danger, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2, outlineColor: light.focus });
    } finally {
      if (os) Object.defineProperty(Platform, 'OS', os);
    }
  });
});
