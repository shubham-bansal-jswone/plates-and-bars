import { fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorText, Field, Group, Hint } from '../src/components/ui';
import { SetupScreen } from '../src/screens/SetupScreen';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// react-native-web drops accessibilityHint, so the DOM link is aria-describedby -> the text's id (nativeID renders as id).
describe('shared components link text by id', () => {
  it('Field and Group carry aria-describedby; ErrorText and Hint carry the id', async () => {
    await render(
      <>
        <Field label="Age" invalid describedBy="age-hint age-err" />
        <Group label="Sex" error="Pick one" describedBy="sex-err"><Hint>Male or female</Hint></Group>
        <Hint id="age-hint">Years</Hint>
        <ErrorText id="age-err">Enter your age.</ErrorText>
      </>,
    );
    expect(screen.getByLabelText('Age').props['aria-describedby']).toBe('age-hint age-err');
    expect(screen.getByLabelText('Sex', { exact: true }).props['aria-describedby']).toBe('sex-err');
    expect(screen.getByText('Years').props.nativeID).toBe('age-hint');
    expect(screen.getByText('Enter your age.').props.nativeID).toBe('age-err');
  });
});

describe('setup errors are described by their text', () => {
  it('each invalid field and group points at its error; a valid one points at nothing', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Let’s work out your targets');
    await fireEvent.press(screen.getByLabelText('Continue'));
    const idOf = (t: string) => screen.getByText(t).props.nativeID as string;
    expect(idOf('Enter your age.')).toMatch(/\S/);
    expect(screen.getByLabelText('Age').props['aria-describedby']).toBe(idOf('Enter your age.'));
    expect(screen.getByLabelText('Weight in kg').props['aria-describedby']).toBe(idOf('Enter your weight in kg, like 72.5.'));
    for (const l of ['Height feet', 'Height inches']) expect(screen.getByLabelText(l).props['aria-describedby']).toBe(idOf('Enter your height in feet and inches, like 5 and 7.'));
    // The group names its static hint first, then its error.
    const hint = screen.getByText('Used only for the calorie formula, which differs by sex.').props.nativeID as string;
    expect(screen.getByLabelText('Sex', { exact: true }).props['aria-describedby']).toBe(`${hint} ${idOf('Choose male or female for the calorie formula.')}`);
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    expect(screen.getByLabelText('Age').props['aria-describedby']).toBeUndefined();
  });
});

describe('the consent switch is described by its error', () => {
  it('is invalid and points at the error after Continue without agreeing, and clears on agreeing', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    const label = 'I understand and agree to my data being stored as described';
    expect(screen.getByLabelText(label).props.accessibilityHint).toBeUndefined();
    await fireEvent.press(screen.getByLabelText('Continue'));
    const err = screen.getByRole('alert');
    expect(err.props.nativeID).toMatch(/\S/);
    const sw = screen.getByLabelText(label);
    // Native reads the hint; the web aria attributes go on the DOM input (switch-web-aria.test.tsx).
    expect(sw.props.accessibilityHint).toBe(err.props.children);
    await fireEvent(screen.getByLabelText(label), 'valueChange', true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText(label).props.accessibilityHint).toBeUndefined();
  });

  it('tapping the label text clears the error like toggling the switch', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(screen.getByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByText('I understand and agree to my data being stored as described', { includeHiddenElements: true }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('I understand and agree to my data being stored as described').props.accessibilityHint).toBeUndefined();
  });
});
