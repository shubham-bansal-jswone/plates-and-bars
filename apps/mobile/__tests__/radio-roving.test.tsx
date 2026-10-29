/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { Group } from '../src/components/ui';
import { arrowSelect, syncTabStops, type GroupEl } from '../src/components/radioRoving';

const mockSync = jest.fn();
jest.mock('../src/components/radioRoving', () => {
  const actual = jest.requireActual('../src/components/radioRoving');
  return { ...actual, syncTabStops: (...a: unknown[]) => { mockSync(...a); return actual.syncTabStops(...a); } };
});

/** A radiogroup as react-native-web draws it: a div holding role=radio elements with aria-checked. */
function dom(checked: number | null, n = 3, disabled?: number) {
  const { window } = new JSDOM(`<!doctype html><body><div id="g">${Array.from({ length: n }, (_, i) => `<div role="radio" tabindex="0" aria-checked="${i === checked}"${i === disabled ? ' aria-disabled="true"' : ''}>${i}</div>`).join('')}</div></body>`);
  const group = window.document.getElementById('g')!;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role=radio]'));
  const clicked: number[] = [];
  radios.forEach((r, i) => r.addEventListener('click', () => clicked.push(i)));
  return { window, group, radios, clicked, stops: () => radios.map((r) => r.getAttribute('tabindex')) };
}

describe('radio group tab stops and arrow keys (#1409)', () => {
  it('makes the checked radio the one tab stop', () => {
    const d = dom(1);
    syncTabStops(d.group as unknown as GroupEl);
    expect(d.stops()).toEqual(['-1', '0', '-1']);
  });

  it('makes the first radio the stop when none is checked', () => {
    const d = dom(null);
    syncTabStops(d.group as unknown as GroupEl);
    expect(d.stops()).toEqual(['0', '-1', '-1']);
  });

  it('moves the stop with the selection', () => {
    const d = dom(0);
    syncTabStops(d.group as unknown as GroupEl);
    d.radios[0]!.setAttribute('aria-checked', 'false');
    d.radios[2]!.setAttribute('aria-checked', 'true');
    syncTabStops(d.group as unknown as GroupEl);
    expect(d.stops()).toEqual(['-1', '-1', '0']);
  });

  it.each([['ArrowRight', 0, 1], ['ArrowDown', 1, 2], ['ArrowLeft', 1, 0], ['ArrowUp', 2, 1]])('%s from radio %i selects radio %i, focused and clicked', (key, from, to) => {
    const d = dom(from);
    expect(arrowSelect(d.group as unknown as GroupEl, d.radios[from], key)).toBe(true);
    expect(d.clicked).toEqual([to]);
    expect(d.window.document.activeElement).toBe(d.radios[to]);
  });

  it('wraps at both ends', () => {
    const d = dom(2);
    arrowSelect(d.group as unknown as GroupEl, d.radios[2], 'ArrowRight');
    arrowSelect(d.group as unknown as GroupEl, d.radios[0], 'ArrowLeft');
    expect(d.clicked).toEqual([0, 2]);
  });

  it('skips a disabled radio', () => {
    const d = dom(0, 3, 1);
    arrowSelect(d.group as unknown as GroupEl, d.radios[0], 'ArrowRight');
    expect(d.clicked).toEqual([2]);
  });

  it('leaves other keys, modified arrows, a target outside the group and a lone radio alone', () => {
    const d = dom(0);
    const g = d.group as unknown as GroupEl;
    expect(arrowSelect(g, d.radios[0], 'Tab')).toBe(false);
    expect(arrowSelect(g, d.radios[0], 'ArrowRight', true)).toBe(false);
    expect(arrowSelect(g, d.group, 'ArrowRight')).toBe(false);
    expect(arrowSelect(dom(0, 1).group as unknown as GroupEl, null, 'ArrowRight')).toBe(false);
    expect(arrowSelect(null, d.radios[0], 'ArrowRight')).toBe(false);
    expect(d.clicked).toEqual([]);
  });

  describe('Group', () => {
    beforeEach(() => void jest.replaceProperty(Platform, 'OS', 'web'));
    afterEach(() => jest.restoreAllMocks());

    it('handles the arrow keys on web: moves the selection and stops the page scrolling', async () => {
      const d = dom(0);
      const tree = await render(<Group label="Sex">{null}</Group>);
      const group = tree.getByLabelText('Sex');
      const preventDefault = jest.fn();
      group.props.onKeyDown({ key: 'ArrowDown', target: d.radios[0], currentTarget: d.group, preventDefault });
      expect(d.clicked).toEqual([1]);
      expect(preventDefault).toHaveBeenCalled();
      preventDefault.mockClear();
      group.props.onKeyDown({ key: 'a', target: d.radios[0], currentTarget: d.group, preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('syncs the tab stops with the group element after rendering on web, and not on android', async () => {
      mockSync.mockClear();
      const tree = await render(<Group label="Sex">{null}</Group>);
      expect(mockSync).toHaveBeenCalled();
      const arg = mockSync.mock.calls.at(-1)?.[0];
      expect(arg).toBeTruthy();
      expect(typeof arg).toBe('object'); // the group's host element, not null
      await tree.unmount();
      jest.replaceProperty(Platform, 'OS', 'android');
      mockSync.mockClear();
      await render(<Group label="Sex">{null}</Group>);
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('keeps the radiogroup role and name, and adds no key handler off the web', async () => {
      const tree = await render(<Group label="Sex" error="Pick one">{null}</Group>);
      expect(tree.getByLabelText('Sex').props.accessibilityRole).toBe('radiogroup');
      jest.replaceProperty(Platform, 'OS', 'android');
      await tree.rerender(<Group label="Sex" error="Pick one">{null}</Group>);
      expect(tree.getByLabelText('Sex').props.onKeyDown).toBeUndefined();
    });
  });
});
