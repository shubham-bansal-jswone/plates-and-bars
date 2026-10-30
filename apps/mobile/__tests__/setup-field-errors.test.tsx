import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { View } from 'react-native';
import { SetupScreen } from '../src/screens/SetupScreen';
import { SCREEN_Q } from '../src/setup/copy';
import { emptyDraft, stepErrors, validateStep } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

describe('stepErrors', () => {
  it('lists every invalid field of the step at once, in form order', () => {
    const fields = (step: number, d = emptyDraft()) => stepErrors(step, d).map(([f]) => f);
    expect(fields(0)).toEqual(['sex', 'age', 'height', 'weight']);
    expect(fields(1)).toEqual(['activity']);
    expect(fields(2)).toEqual(['days']);
    expect(fields(3)).toEqual(['goal', 'screen']);
    expect(fields(4)).toEqual([]); // the results screen always passes
    const d = { ...emptyDraft(), sex: 'male' as const, age: '30', ft: '5', inch: '9' };
    expect(fields(0, d)).toEqual(['weight']);
    expect(fields(2, { ...emptyDraft(), days: 3 })).toEqual(['where', 'exp', 'minutes']);
  });

  it('is empty exactly when validateStep has no error text', () => {
    for (const step of [0, 1, 2, 3, 4]) expect(stepErrors(step, emptyDraft()).length > 0).toBe(!!validateStep(step, emptyDraft()));
  });
});

describe('setup field errors', () => {
  it('shows each error under its field; typing in one field clears the errors', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Let’s work out your targets');
    await fireEvent.press(screen.getByLabelText('Male'));
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(screen.getByText('Enter your age.')).toBeTruthy();
    expect(screen.getByLabelText('Age').props['aria-invalid']).toBe(true);
    expect(screen.getByLabelText('Weight in kg').props['aria-invalid']).toBe(true);
    // The error is also the invalid field's hint, so refocusing the field reads why it is wrong; other fields have none.
    expect(screen.getByLabelText('Age').props.accessibilityHint).toBe('Enter your age.');
    expect(screen.getByLabelText('Weight in kg').props.accessibilityHint).toBe('Enter your weight in kg, like 72.5.');
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    expect(screen.queryByText('Enter your age.')).toBeNull();
    expect(screen.getByLabelText('Age').props['aria-invalid']).toBeUndefined();
  });
});

describe('setup all errors at once', () => {
  it('Continue on an empty body step flags Sex, Age, Height and Weight together and focuses the first', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Let’s work out your targets');
    const focus = jest.spyOn(View.prototype as never, 'focus' as never);
    await fireEvent.press(screen.getByLabelText('Continue'));
    for (const t of ['Choose male or female for the calorie formula.', 'Enter your age.', 'Enter your height in feet and inches, like 5 and 7.', 'Enter your weight in kg, like 72.5.'])
      expect(screen.getByText(t)).toBeTruthy();
    // The first invalid field's control (the Male chip) was focused.
    expect(focus.mock.contexts.some((c) => (c as { props?: { accessibilityLabel?: string } }).props?.accessibilityLabel === 'Male')).toBe(true);
    expect(screen.getByLabelText('Sex', { exact: true }).props['aria-invalid']).toBe(true);
    expect(screen.getByLabelText('Sex', { exact: true }).props.accessibilityHint).toBe('Choose male or female for the calorie formula.');
    for (const l of ['Age', 'Height feet', 'Height inches', 'Weight in kg']) expect(screen.getByLabelText(l).props['aria-invalid']).toBe(true);
  });
});

describe('setup health check focus', () => {
  it('focuses the "No" of the first unanswered question, not an answered one', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    const press = async (l: string) => fireEvent.press(screen.getByLabelText(l));
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await press('Continue');
    await screen.findByText('Let’s work out your targets');
    await press('Male');
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    await press('Use cm');
    await fireEvent.changeText(screen.getByLabelText('Height in cm'), '165');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '82');
    await press('Continue');
    await press('Mostly sitting. Desk job, little walking (under ~5,000 steps)');
    await press('Continue');
    await press('6');
    await press('At a gym. Machines, cables, barbells and dumbbells');
    await press('Some experience. 6 months to 2 years of regular training');
    await press('60 min');
    await press('Continue');
    await press('Lose fat. Steady fat loss while keeping muscle');
    for (const q of SCREEN_Q.slice(0, SCREEN_Q.length - 1)) await fireEvent.press(within(screen.getByLabelText(q)).getByLabelText('No'));
    const focus = jest.spyOn(View.prototype as never, 'focus' as never);
    focus.mockClear();
    await press('See my targets');
    // Exactly one control was focused, a "No" that is still unchecked. Q1-Q4 are answered, so it can only be Q5's.
    const focused = focus.mock.contexts.map((c) => c as { props: { accessibilityLabel?: string; accessibilityState?: { checked?: boolean } } });
    expect(focused.map((c) => c.props.accessibilityLabel)).toEqual(['No']);
    expect(focused[0]?.props.accessibilityState?.checked).toBe(false);
    focus.mockRestore();
  });
});

describe('setup progress bar', () => {
  it('says step 1 of 4 to a screen reader, matching "Step N of 4"', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Let’s work out your targets');
    expect(screen.getByText(/Step 1 of 4/)).toBeTruthy();
    expect(screen.getByLabelText('Setup progress').props.accessibilityValue).toEqual({ min: 0, max: 4, now: 1 });
  });
});
