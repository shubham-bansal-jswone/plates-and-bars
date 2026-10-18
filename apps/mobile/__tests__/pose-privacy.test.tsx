import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PoseSession } from '../src/pose/pose-session';
import { fakeStream, repH, scriptedDetector } from './pose-fixtures';

// #947: frames are never stored or sent. A whole set, from "Start camera" to "Use 2 reps", with every way out of the page stubbed
// to record the call: nothing may use the network, create a file or a URL for a file, or write to storage.
const g = globalThis as unknown as Record<string, unknown>;

describe('live tracking keeps frames on the device', () => {
  const calls: string[] = [];
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const trap = (name: string, owner: object = g) => {
    saved[name] = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(owner, name, {
      configurable: true,
      writable: true,
      value: new Proxy(function () {}, {
        apply: () => {
          calls.push(name);
          throw new Error(`${name} must not be used while tracking`);
        },
        construct: () => {
          calls.push(name);
          throw new Error(`${name} must not be used while tracking`);
        },
      }),
    });
  };
  const nav = globalThis.navigator as unknown as object;
  beforeEach(() => {
    calls.length = 0;
    for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Blob', 'FileReader', 'MediaRecorder', 'indexedDB', 'localStorage', 'sessionStorage']) trap(n);
    trap('sendBeacon', nav);
    trap('createObjectURL', URL);
  });
  afterEach(() => {
    for (const [name, d] of Object.entries(saved)) {
      const owner = name === 'sendBeacon' ? nav : name === 'createObjectURL' ? URL : g;
      if (d) Object.defineProperty(owner, name, d);
      else delete (owner as Record<string, unknown>)[name];
    }
  });

  it('makes no network request, file, URL or storage write during a whole set', async () => {
    const { stream } = fakeStream();
    const onApply = jest.fn();
    await render(
      <PoseSession exercise="Bodyweight Squat" setNumber={1} onApply={onApply} onClose={jest.fn()} getStream={async () => stream} load={async () => scriptedDetector([...repH(-0.2), ...repH(-0.2)])} frameMs={0} countdownSeconds={0} now={(() => { let t = 0; return () => (t += 50); })()} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText('Rep 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Finish set' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Use 2 reps for set 1' }));
    expect(onApply).toHaveBeenCalledWith(2);
    expect(calls).toEqual([]);
  });

  it('the trap works: a fetch is recorded', () => {
    expect(() => (g.fetch as () => void)()).toThrow('fetch must not be used');
    expect(calls).toEqual(['fetch']);
  });

  // The model loads its weights through TensorFlow.js (same-origin files, tested in the browser spec); no source of ours that
  // touches camera frames may talk to the network, draw them to a canvas, record them or store anything.
  it('no tracking source mentions a way to send, record or store a frame', () => {
    const dir = join(__dirname, '../src/pose');
    const banned = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|toDataURL|toBlob|getImageData|MediaRecorder|createObjectURL|FileReader|localStorage|sessionStorage|indexedDB|expo-file-system|expo-sqlite|expo-secure-store|\.\.\/db\/|\.\.\/sync\/|captureStream|ImageCapture|console\.|Sentry|addBreadcrumb/;
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files).toEqual(expect.arrayContaining(['pose-session.tsx', 'pose-detector.ts', 'TrackSet.tsx']));
    for (const f of files) expect({ f, hit: banned.exec(readFileSync(join(dir, f), 'utf8'))?.[0] }).toEqual({ f, hit: undefined });
  });
});
