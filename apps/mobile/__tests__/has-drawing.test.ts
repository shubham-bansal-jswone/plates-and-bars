import { hasDrawing } from '../src/workout/ExerciseFigure';

const mockFlag = jest.fn();
jest.mock('../src/motion/flag', () => ({ exerciseMotionEnabled: () => mockFlag() }));
jest.mock('../src/motion/data', () => ({ getMotion: (n: string) => (n === 'Motion Only' ? {} : undefined) }));
jest.mock('../src/workout/figures', () => ({ ...jest.requireActual('../src/workout/figures'), getFigure: () => undefined }));

describe('hasDrawing', () => {
  it('is true for a motion-only exercise only when the motion flag is on', () => {
    mockFlag.mockReturnValue(false);
    expect(hasDrawing('Motion Only')).toBe(false);
    mockFlag.mockReturnValue(true);
    expect(hasDrawing('Motion Only')).toBe(true);
    expect(hasDrawing('Nothing')).toBe(false);
  });
});
