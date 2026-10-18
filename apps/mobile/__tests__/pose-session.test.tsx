import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PoseSession, type PoseSessionProps } from '../src/pose/pose-session';
import { fakeStream, repH, scriptedDetector, type ScriptedDetector } from './pose-fixtures';
import type { PoseDetector } from '../src/pose/types';
import { DEPTH_CUES } from '@plate-and-bar/core';

// The clock moves 50 ms each time it is read; the loop reads it twice a frame (frame start, after the model), so frames are 100 ms apart.
function clock() {
  let t = 0;
  return () => (t += 50);
}

async function mount(over: Partial<PoseSessionProps> & { detector?: PoseDetector | ScriptedDetector } = {}) {
  const { stream, track } = fakeStream();
  const detector = over.detector ?? scriptedDetector([...repH(-0.2), ...repH(-0.2)]);
  const onApply = jest.fn();
  const onClose = jest.fn();
  const props: PoseSessionProps = {
    exercise: 'Goblet Squat',
    setNumber: 2,
    onApply,
    onClose,
    getStream: async () => stream,
    load: async () => detector,
    now: clock(),
    frameMs: 0,
    countdownSeconds: 0,
    ...over,
  };
  const view = await render(<PoseSession {...props} />);
  return { view, detector: detector as ScriptedDetector, track, onApply, onClose };
}

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

describe('PoseSession: permission flow and copy', () => {
  it('starts with the safety text and the privacy line, and asks for the camera only when the user taps Start camera', async () => {
    const getStream = jest.fn(async () => fakeStream().stream);
    await mount({ getStream });
    expect(screen.getByText(/Prop your phone 2-3 metres away, side-on, whole body in frame/)).toBeTruthy();
    expect(screen.getByText(/Tracking is a guide, not a coach\. It can miss things\. Stop if anything hurts, and see a physio if the pain stays\./)).toBeTruthy();
    expect(screen.getByText('The camera view stays on this phone. Nothing is recorded or sent.')).toBeTruthy();
    expect(getStream).not.toHaveBeenCalled();
    await press('Start camera');
    expect(getStream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NotAllowedError', /camera is blocked/],
    ['NotFoundError', /No camera was found/],
    ['NotReadableError', /camera could not start/],
  ])('says what happened when the camera fails with %s, and the user can try again or close', async (name, text) => {
    const err = Object.assign(new Error('x'), { name });
    const { onClose } = await mount({ getStream: async () => Promise.reject(err) });
    await press('Start camera');
    expect(await screen.findByText(text)).toBeTruthy();
    await press('Try again');
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
    await press('Close');
    expect(onClose).toHaveBeenCalled();
  });

  it('releases the camera and says so when the model cannot load', async () => {
    const { stream, track } = fakeStream();
    await mount({ getStream: async () => stream, load: async () => Promise.reject(new Error('offline')) });
    await press('Start camera');
    expect(await screen.findByText(/tracking model could not load/)).toBeTruthy();
    expect(track.stop).toHaveBeenCalled();
  });
});

describe('PoseSession: live count, depth and tempo, then confirm', () => {
  // Each script ends with the person still on camera (the model waits), so what is on screen stays put while a test reads it.
  const ONE = () => ({ detector: scriptedDetector(repH(-0.2)) });

  it('counts reps from core, announces the count politely, and shows depth and tempo of the last rep', async () => {
    await mount(ONE());
    await press('Start camera');
    expect(await screen.findByText('Rep 1')).toBeTruthy();
    // the live region is the element that holds the count
    const live = screen.getByText('Rep 1').parent!;
    expect(live.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByText(/Depth: about parallel/)).toBeTruthy();
    expect(screen.getByText(/Down \d\.\d s.*, up \d\.\d s/)).toBeTruthy();
  });

  it('counts a second rep', async () => {
    await mount();
    await press('Start camera');
    expect(await screen.findByText('Rep 2')).toBeTruthy();
  });

  it('does not touch the set until the user confirms: Finish shows the summary, and only "Use ... reps" applies it', async () => {
    const { onApply, onClose, track } = await mount();
    await press('Start camera');
    await screen.findByText('Rep 2');
    await press('Finish set');
    expect(screen.getByText('Counted 2 reps. 2 reached about parallel.')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled(); // the camera is off as soon as the set ends
    await press('Use 2 reps for set 2');
    expect(onApply).toHaveBeenCalledWith(2);
    expect(onClose).not.toHaveBeenCalled(); // the sheet closes in TrackSet; the session only reports
  });

  it('can be discarded without applying anything', async () => {
    const { onApply, onClose } = await mount(ONE());
    await press('Start camera');
    await screen.findByText('Rep 1');
    await press('Finish set');
    await press('Do not use this');
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a rep that stops above parallel is counted, said so, and shows the exercise card cue (no grade)', async () => {
    const { onApply } = await mount({ detector: scriptedDetector(repH(0.2)) });
    await press('Start camera');
    await screen.findByText('Rep 1');
    expect(screen.getByText(/Depth: above parallel/)).toBeTruthy();
    await press('Finish set');
    expect(screen.getByText('Counted 1 rep. 0 reached about parallel.')).toBeTruthy();
    expect(screen.getByText(`From the exercise card: ${DEPTH_CUES['Goblet Squat'].text}`)).toBeTruthy();
    expect(screen.queryByText(/good form|bad form/i)).toBeNull();
    await press('Use 1 rep for set 2');
    expect(onApply).toHaveBeenCalledWith(1);
  });

  it('a set ended mid-rep leaves that rep out and says so', async () => {
    const values = [...repH(-0.2), ...repH(-0.2).slice(0, 12)]; // a full rep, then down and at the bottom, never back up
    const { detector } = await mount({ detector: scriptedDetector(values) });
    await press('Start camera');
    await waitFor(() => expect(detector.calls).toBeGreaterThan(values.length)); // every frame has been read
    await press('Finish set');
    expect(screen.getByText('Counted 1 rep. 1 reached about parallel.')).toBeTruthy();
    expect(screen.getByText(/mid-rep when it stopped/)).toBeTruthy();
  });

  it('with no reps there is nothing to apply', async () => {
    const { onApply } = await mount({ detector: scriptedDetector([1, 1, 1]) });
    await press('Start camera');
    await waitFor(() => expect(screen.getByText('No reps yet')).toBeTruthy());
    await press('Finish set');
    expect(screen.getByText('No reps counted.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('says "not tracked" when the legs are out of view', async () => {
    await mount({ detector: scriptedDetector([1, 1, null, null, null, null, null, null, null, null, null, null, null, null]) });
    await press('Start camera');
    expect(await screen.findByText(/Not tracked: your hips and legs were out of view/)).toBeTruthy();
  });

  it('stops by itself after 20 seconds without movement and says why', async () => {
    // 250 standing frames at 100 ms is 25 s
    await mount({ detector: scriptedDetector(Array.from({ length: 250 }, () => 1)) });
    await press('Start camera');
    expect(await screen.findByText('Tracking stopped: no movement for a while.')).toBeTruthy();
    expect(screen.getByText('No reps counted.')).toBeTruthy();
  });

  it('counts down before tracking starts', async () => {
    await mount({ countdownSeconds: 2 });
    await press('Start camera');
    expect(await screen.findByText('Get in position. Starting in 2.')).toBeTruthy();
    expect(await screen.findByText(/^Rep \d$/, {}, { timeout: 4000 })).toBeTruthy(); // frames run fast: it may already be on rep 2
  });

  it('stops the camera and the model when the sheet closes mid-set', async () => {
    const { view, detector, track } = await mount(ONE());
    await press('Start camera');
    await screen.findByText('Rep 1');
    await view.unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(detector.disposed).toBe(true);
  });

  it('keeps counting when a frame fails to analyse', async () => {
    let n = 0;
    const base = scriptedDetector(repH(-0.2));
    const flaky: PoseDetector = {
      estimate: (v) => (++n === 4 ? Promise.reject(new Error('gl lost')) : base.estimate(v)),
      dispose: () => base.dispose(),
    };
    await mount({ detector: flaky });
    await press('Start camera');
    expect(await screen.findByText('Rep 1')).toBeTruthy();
  });
});
