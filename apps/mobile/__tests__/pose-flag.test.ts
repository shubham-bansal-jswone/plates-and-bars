import { hasCamera, poseAvailable, poseExercise } from '../src/pose/flag';

describe('live pose tracking flag', () => {
  it('is off by default: no env value, or anything but 1, hides it', () => {
    expect(poseAvailable(undefined, 'web', true)).toBe(false);
    expect(poseAvailable('', 'web', true)).toBe(false);
    expect(poseAvailable('0', 'web', true)).toBe(false);
    expect(poseAvailable('true', 'web', true)).toBe(false);
  });
  it('needs the flag, the web, and a camera', () => {
    expect(poseAvailable('1', 'web', true)).toBe(true);
    expect(poseAvailable('1', 'web', false)).toBe(false);
    expect(poseAvailable('1', 'android', true)).toBe(false);
    expect(poseAvailable('1', 'ios', true)).toBe(false);
  });
  it('reads the build env and the platform when not told (jest runs as ios, so it is off)', () => {
    expect(poseAvailable()).toBe(false);
  });
  it('sees a camera only when getUserMedia exists', () => {
    const nav = globalThis.navigator as unknown as { mediaDevices?: unknown };
    const before = nav.mediaDevices;
    try {
      Object.defineProperty(nav, 'mediaDevices', { value: undefined, configurable: true });
      expect(hasCamera()).toBe(false);
      Object.defineProperty(nav, 'mediaDevices', { value: { getUserMedia: () => Promise.resolve() }, configurable: true });
      expect(hasCamera()).toBe(true);
    } finally {
      Object.defineProperty(nav, 'mediaDevices', { value: before, configurable: true });
    }
  });
  it('tracks the bodyweight and goblet squat only', () => {
    expect(poseExercise('Bodyweight Squat')).toBe('Bodyweight Squat');
    expect(poseExercise('Goblet Squat')).toBe('Goblet Squat');
    for (const n of ['Hack Squat', 'Leg Press', 'Barbell Back Squat', 'Push-up', '']) expect(poseExercise(n)).toBeNull();
  });
});
