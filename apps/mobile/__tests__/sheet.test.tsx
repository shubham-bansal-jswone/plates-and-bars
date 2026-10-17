/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { Platform, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { focusSheetTitle, SheetModal } from '../src/components/Sheet';
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
    focusSheetTitle('Add exercise');
    expect(document.activeElement?.id).toBe('title');
    expect(document.getElementById('title')?.getAttribute('tabindex')).toBe('-1');
    expect(() => focusSheetTitle('No such sheet')).not.toThrow();
  });

  // Not covered here: react-native-web's real timing (its dialog role and focus trap switch on in `onShow`, after the slide animation).
  // The Playwright check in tests/e2e/specs/sheet-focus.spec.mjs covers that in a browser. Here `onShow` is called by hand.
  it('on the web it focuses the title one tick after onShow, keeps focus on a title change, and gives it back to the opener on close', async () => {
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
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="Add exercise"><button id="first">Close</button><h2 role="heading" id="title">Add exercise</h2></div>');
      (document.getElementById('first') as HTMLElement).focus();
      jest.runOnlyPendingTimers();
      expect(document.activeElement?.id).toBe('first'); // nothing happens before onShow
      screen.getByLabelText('Add exercise', { hidden: true }).props.onShow();
      jest.runOnlyPendingTimers();
      expect(document.activeElement?.id).toBe('title');
      await view.rerender(sheet('Add exercise now'));
      expect(document.activeElement?.id).toBe('title'); // a title change does not send focus back to the opener
      await view.unmount();
      expect(document.activeElement?.id).toBe('opener');
    } finally {
      jest.useRealTimers();
    }
  });
});
