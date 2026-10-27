import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SetRow } from '../src/workout/SetRow';
import * as useThemeModule from '../src/theme/useTheme';
import { dark } from '../src/theme/tokens';

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
