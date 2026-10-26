import { fireEvent, render, screen } from '@testing-library/react-native';
import { SetupScreen } from '../src/screens/SetupScreen';
import { emptyDraft, errorField, validateStep } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

describe('errorField', () => {
  it('names the field of the one error core reports, step by step', () => {
    const d = emptyDraft();
    expect(errorField(0, d)).toBe('sex');
    d.sex = 'male';
    expect(errorField(0, d)).toBe('age');
    d.age = '30';
    expect(errorField(0, d)).toBe('height');
    d.ft = '5';
    d.inch = '9';
    expect(errorField(0, d)).toBe('weight');
    d.weight = '80';
    expect(errorField(0, d)).toBeNull();
    expect(errorField(1, d)).toBe('activity');
    expect(errorField(2, d)).toBe('days');
    expect(errorField(3, d)).toBe('goal');
    expect(errorField(4, d)).toBeNull(); // the results screen always passes
  });

  it('is set exactly when validateStep has an error text', () => {
    for (const step of [0, 1, 2, 3, 4]) expect(!!errorField(step, emptyDraft())).toBe(!!validateStep(step, emptyDraft()));
  });
});

describe('setup field errors', () => {
  it('shows the age error under Age and marks only Age invalid', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Let’s work out your targets');
    await fireEvent.press(screen.getByLabelText('Male'));
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(screen.getByText('Enter your age.')).toBeTruthy();
    expect(screen.getByLabelText('Age').props['aria-invalid']).toBe(true);
    expect(screen.getByLabelText('Weight in kg').props['aria-invalid']).toBeUndefined();
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    expect(screen.queryByText('Enter your age.')).toBeNull();
    expect(screen.getByLabelText('Age').props['aria-invalid']).toBeUndefined();
  });
});
