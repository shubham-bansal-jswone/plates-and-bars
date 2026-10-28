/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { Platform, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { focusSheetTitle, refuseScrollerFocus, SheetModal } from '../src/components/Sheet';
import { AddExerciseSheet } from '../src/workout/AddExerciseSheet';

/** Sheets are named dialogs with initial focus on the title on the web, and give focus back on close (#661). */
// jest-expo's jsdom environment cannot run under the React Native preset (it redefines `window`), so the node environment
// gets a jsdom document for just these tests.
describe('SheetModal', () => {
  const g = globalThis as Record<string, unknown>;
  beforeAll(() => {
    const { window } = new JSDOM('<!doctype html><body></body>');
    g.document = window.document;
    g.HTMLElement = window.HTMLElement;
  });
  afterAll(() => {
    delete g.document;
    delete g.HTMLElement;
  });
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'web'));
  afterEach(() => jest.restoreAllMocks());

  it('names the dialog by its title on the web', async () => {
    await render(
      <SheetModal title="Add exercise" onClose={() => {}}>
        <Text>body</Text>
      </SheetModal>,
    );
    expect(screen.getByLabelText('Add exercise', { hidden: true })).toBeTruthy();
  });

  it('is used by the real sheets, with the title text of their heading', async () => {
    await render(<AddExerciseSheet inSession={[]} onClose={() => {}} onPick={() => {}} onCustom={() => {}} />);
    expect(screen.getByLabelText('Add exercise', { hidden: true })).toBeTruthy();
  });

  it('focusSheetTitle puts focus on the named dialog’s heading, not the first button or another dialog’s', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Other"><h2 role="heading">Other</h2></div>
      <div role="dialog" aria-label="Add exercise"><button id="first">Close</button><h2 role="heading" id="title">Add exercise</h2></div>`;
    document.getElementById('first')?.focus(); // what the web focus trap does first
    focusSheetTitle('Add exercise', '#000');
    expect(document.activeElement?.id).toBe('title');
    expect(document.getElementById('title')?.getAttribute('tabindex')).toBe('-1');
    jest.useFakeTimers();
    try {
      // Focus leaves and comes back before the timer fires (a fast wrap): the title keeps its tabindex.
      document.getElementById('first')?.focus();
      document.getElementById('title')?.focus();
      jest.runOnlyPendingTimers();
      expect(document.getElementById('title')?.getAttribute('tabindex')).toBe('-1');
      // The next blur still removes it: the title is not a stop any more, once the blur is handled.
      document.getElementById('first')?.focus();
      expect(document.getElementById('title')?.getAttribute('tabindex')).toBe('-1');
      jest.runOnlyPendingTimers();
      expect(document.getElementById('title')?.hasAttribute('tabindex')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
    expect(() => focusSheetTitle('No such sheet', '#000')).not.toThrow();
  });

  it('each open sheet keeps its own focus guard when a sheet above it closes', async () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    const sheet = (title: string) => (
      <SheetModal title={title} onClose={() => {}}>
        <Text>body</Text>
      </SheetModal>
    );
    const lower = await render(sheet('Lower'));
    const upper = await render(sheet('Upper'));
    const guards = add.mock.calls.filter(([type]) => type === 'focus').map(([, fn]) => fn);
    expect(guards).toHaveLength(2);
    expect(guards[0]).not.toBe(guards[1]); // the same function twice would be one registration in a browser
    await upper.unmount();
    const removed = remove.mock.calls.filter(([type]) => type === 'focus').map(([, fn]) => fn);
    expect(removed).toEqual([guards[1]]); // only the top sheet's guard went; the lower one's is still registered
    document.body.innerHTML = '<div id="scroller">text</div>';
    const el = document.getElementById('scroller') as HTMLElement;
    const blur = jest.spyOn(el, 'blur');
    (guards[0] as (e: Event) => void)({ target: el } as unknown as Event);
    expect(blur).toHaveBeenCalledTimes(1);
    await lower.unmount();
  });

  it('refuseScrollerFocus drops focus from a scrolling container but not from a control or the title (#1275)', () => {
    document.body.innerHTML = '<div id="scroller">text</div><button id="b">Close</button><h2 id="t" tabindex="-1">Title</h2><div id="p" tabindex="0" role="link">link</div>';
    for (const [id, kept] of [['scroller', false], ['b', true], ['t', true], ['p', true]] as const) {
      const el = document.getElementById(id) as HTMLElement;
      const blur = jest.spyOn(el, 'blur');
      refuseScrollerFocus({ target: el });
      expect(blur).toHaveBeenCalledTimes(kept ? 0 : 1);
    }
    expect(() => refuseScrollerFocus({ target: null })).not.toThrow();
  });

  // Not covered here: react-native-web's real timing (its dialog role and focus trap switch on after `onShow`, which follows the slide animation).
  // The Playwright check in tests/e2e/specs/sheet-focus.spec.mjs covers that in a browser. Here `onShow` is called by hand.
  it('on the web it focuses the title once the dialog is on and the trap has moved focus in, keeps focus on a title change, and gives it back to the opener on close', async () => {
    jest.useFakeTimers();
    try {
      document.body.innerHTML = '<button id="opener">Open</button>';
      const opener = document.getElementById('opener') as HTMLElement;
      opener.focus();
      const sheet = (title: string) => (
        <SheetModal title={title} onClose={() => {}}>
          <Text>body</Text>
        </SheetModal>
      );
      const view = await render(sheet('Add exercise'));
      // onShow comes first, then React switches the dialog on (a little later) and the trap focuses the first button.
      screen.getByLabelText('Add exercise', { hidden: true }).props.onShow();
      jest.advanceTimersByTime(48);
      expect(document.activeElement?.id).toBe('opener'); // no dialog yet: keeps waiting
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="Add exercise"><button id="first">Close</button><h2 role="heading" id="title">Add exercise</h2></div>');
      jest.advanceTimersByTime(16);
      expect(document.activeElement?.id).toBe('opener'); // dialog there but the trap has not moved focus in yet: still waiting
      (document.getElementById('first') as HTMLElement).focus();
      jest.advanceTimersByTime(16);
      expect(document.activeElement?.id).toBe('title');
      await view.rerender(sheet('Add exercise now'));
      expect(document.activeElement?.id).toBe('title'); // a title change does not send focus back to the opener
      await view.unmount();
      expect(document.activeElement?.id).toBe('opener');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the title it focuses shows the app focus ring on a keyboard open, and none on a mouse open (#1302)', () => {
    document.body.innerHTML = '<div role="dialog" aria-label="T"><button id="first">x</button><h2 role="heading" id="title">T</h2></div>';
    const title = document.getElementById('title') as HTMLElement;
    const visible = jest.spyOn(title, 'matches').mockReturnValue(true);
    (document.getElementById('first') as HTMLElement).focus();
    expect(focusSheetTitle('T', '#abcdef')).toBe(true);
    expect(title.style.getPropertyValue('outline')).toBe('2px solid #abcdef');
    expect(title.style.getPropertyValue('outline-offset')).toBe('2px');
    title.blur();
    expect(title.style.getPropertyValue('outline')).toBe('');
    visible.mockReturnValue(false);
    (document.getElementById('first') as HTMLElement).focus();
    expect(focusSheetTitle('T', '#abcdef')).toBe(true);
    expect(title.style.getPropertyValue('outline')).toBe('');
  });
});
