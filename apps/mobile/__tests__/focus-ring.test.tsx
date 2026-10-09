import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as useThemeModule from '../src/theme/useTheme';
import { Button, Choice, Switch } from '../src/components/ui';
import { dark, light } from '../src/theme/tokens';

const ring = (el: { props: { style?: unknown } }) => {
  const s = StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
  return s.outlineWidth ? { width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor } : null;
};

afterEach(() => jest.restoreAllMocks());

describe('focus ring', () => {
  it('shows a 2px ring, 2px offset, on a focused button and removes it on blur', async () => {
    await render(<Button label="Save" onPress={() => {}} />);
    const b = screen.getByLabelText('Save');
    expect(ring(b)).toBeNull();
    await fireEvent(b, 'focus', { target: 1 });
    expect(ring(screen.getByLabelText('Save'))).toEqual({ width: 2, offset: 2, color: light.focus });
    await fireEvent(b, 'blur');
    expect(ring(screen.getByLabelText('Save'))).toBeNull();
  });

  it('uses brand on light and link-dark on dark', async () => {
    jest.spyOn(useThemeModule, 'useTheme').mockReturnValue(dark);
    await render(<Button label="Save" kind="ghost" onPress={() => {}} />);
    await fireEvent(screen.getByLabelText('Save'), 'focus', { target: 1 });
    expect(ring(screen.getByLabelText('Save'))?.color).toBe(dark.focus);
    expect(dark.focus).toBe('#8AB0FF');
    expect(light.focus).toBe('#2457E6');
  });

  it('follows the surface the control sits on: link-dark on a dark surface, white on a brand fill', async () => {
    await render(
      <>
        <Button label="On dark" surface="dark" onPress={() => {}} />
        <Button label="On brand" surface="brand" onPress={() => {}} />
      </>,
    );
    await fireEvent(screen.getByLabelText('On dark'), 'focus', { target: 1 });
    await fireEvent(screen.getByLabelText('On brand'), 'focus', { target: 1 });
    expect(ring(screen.getByLabelText('On dark'))?.color).toBe(dark.focus);
    expect(ring(screen.getByLabelText('On brand'))?.color).toBe('#FFFFFF');
  });

  it('does not show the ring for a mouse click on web (focus without :focus-visible)', async () => {
    await render(<Button label="Save" onPress={() => {}} />);
    await fireEvent(screen.getByLabelText('Save'), 'focus', { target: { matches: () => false } });
    expect(ring(screen.getByLabelText('Save'))).toBeNull();
    await fireEvent(screen.getByLabelText('Save'), 'focus', { target: { matches: () => true } });
    expect(ring(screen.getByLabelText('Save'))).not.toBeNull();
  });

  it('rings chips and options', async () => {
    await render(
      <>
        <Choice chip label="Easy" selected={false} onPress={() => {}} />
        <Choice label="Male" selected onPress={() => {}} />
      </>,
    );
    await fireEvent(screen.getByLabelText('Easy'), 'focus', { target: 1 });
    await fireEvent(screen.getByLabelText('Male'), 'focus', { target: 1 });
    expect(ring(screen.getByLabelText('Easy'))?.width).toBe(2);
    expect(ring(screen.getByLabelText('Male'))?.width).toBe(2);
  });

  it('rings a focused switch', async () => {
    await render(<Switch accessibilityLabel="Rest timer" value onValueChange={() => {}} />);
    const sw = screen.getByLabelText('Rest timer');
    expect(ring(sw.parent as never)).toBeNull();
    // The switch's own handler drives the ring on its wrapper.
    expect(screen.getByLabelText('Rest timer').props.onFocus).toEqual(expect.any(Function));
    await fireEvent(sw, 'focus', { target: 1 });
    expect(ring(screen.getByLabelText('Rest timer').parent as never)).toMatchObject({ width: 2, color: light.focus });
  });
});
