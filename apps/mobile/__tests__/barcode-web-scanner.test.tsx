import { act, render, screen, waitFor } from '@testing-library/react-native';
import { BARCODE_COPY as t } from '../src/barcode/copy';
import { WebScannerView, type WebScannerProps } from '../src/barcode/WebScannerView';
import type { FrameDecoder, Reading } from '../src/barcode/webDecoder';

// The web camera loop (#944) with a fake camera and a fake decoder: no browser needed.
function fakeStream(torch = false) {
  const track = { stop: jest.fn(), getCapabilities: () => (torch ? { torch: true } : {}), applyConstraints: jest.fn(async () => undefined) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}
function decoder(script: (Reading | null)[]): FrameDecoder & { reads: number } {
  const d = {
    kind: 'zxing' as const,
    reads: 0,
    async read() {
      d.reads += 1;
      return script.length ? (script.shift() as Reading | null) : null;
    },
  };
  return d;
}
const GOOD: Reading = { code: '5000112637922', format: 'EAN_13' };

// A document and window the view can listen on (the test runs without a DOM).
function fakeDom() {
  const handlers = new Map<string, Set<() => void>>();
  const doc = {
    hidden: false,
    addEventListener: (n: string, h: () => void) => void (handlers.get(n) ?? handlers.set(n, new Set()).get(n)!).add(h),
    removeEventListener: (n: string, h: () => void) => void handlers.get(n)?.delete(h),
  };
  const win = { addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener };
  const g = globalThis as unknown as { document?: unknown; window?: unknown };
  const saved = { document: g.document, window: g.window };
  g.document = doc;
  g.window = win;
  return {
    doc,
    emit: (n: string) => handlers.get(n)?.forEach((h) => h()),
    listeners: () => [...handlers.values()].reduce((a, s) => a + s.size, 0),
    restore: () => Object.assign(g, saved),
  };
}

let dom: ReturnType<typeof fakeDom>;
beforeEach(() => { dom = fakeDom(); });
afterEach(() => dom.restore());

/**
 * The test renderer hands the component its `<video>` host element: the test gives it a ready state and `play` before the camera answers
 * (getStream waits on a gate), so the loop sees a playing video.
 */
async function mount(over: Partial<WebScannerProps> = {}, camera = fakeStream()) {
  const { stream, track } = camera;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => { open = r; });
  const getStream = jest.fn(async () => { await gate; return stream; });
  const props = { onBarcode: jest.fn(), onReady: jest.fn(), onError: jest.fn(), getStream, createDecoder: jest.fn(async () => decoder([GOOD])), frameMs: 1, ...over } as WebScannerProps & { onBarcode: jest.Mock; onReady: jest.Mock; onError: jest.Mock };
  const view = await render(<WebScannerView {...props} />);
  const video = screen.getByLabelText(t.cameraView) as unknown as { srcObject: unknown; readyState: number; play: jest.Mock };
  video.readyState = 4;
  video.play = jest.fn(async () => undefined);
  open();
  return { video, stream, track, props, view };
}

describe('the web scanner view', () => {
  it('opens the camera into the video, tells whether there is a torch, and reports one hit as the native view does', async () => {
    const { video, props } = await mount();
    await waitFor(() => expect(props.onBarcode).toHaveBeenCalledTimes(1));
    expect(video.srcObject).toBeTruthy();
    expect(video.play).toHaveBeenCalled();
    expect(props.onBarcode).toHaveBeenCalledWith({ nativeEvent: GOOD });
    expect(props.onReady).toHaveBeenCalledWith({ nativeEvent: { torch: false } });
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('asks for the back camera, video only', async () => {
    const { props } = await mount();
    await waitFor(() => expect(props.getStream).toHaveBeenCalled());
  });

  it('reads nothing more after a hit until active goes false and then true, and never while paused', async () => {
    const d = decoder([GOOD, GOOD, GOOD]);
    const { props, view } = await mount({ createDecoder: async () => d });
    await waitFor(() => expect(props.onBarcode).toHaveBeenCalledTimes(1));
    const readsAfterHit = d.reads;
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(d.reads).toBe(readsAfterHit); // the loop keeps running but does not read
    expect(props.onBarcode).toHaveBeenCalledTimes(1);
    await view.rerender(<WebScannerView {...props} active={false} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(props.onBarcode).toHaveBeenCalledTimes(1);
    await view.rerender(<WebScannerView {...props} active />);
    await waitFor(() => expect(props.onBarcode).toHaveBeenCalledTimes(2));
  });

  it('while paused from the start it reads nothing', async () => {
    const d = decoder([GOOD]);
    const { props } = await mount({ createDecoder: async () => d, active: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(d.reads).toBe(0);
    expect(props.onBarcode).not.toHaveBeenCalled();
  });

  it('a user who refuses the camera gets "denied"; any other failure is "camera"; neither starts the decoder', async () => {
    const denied = await mount({ getStream: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } });
    await waitFor(() => expect(denied.props.onError).toHaveBeenCalledWith({ nativeEvent: { message: 'denied' } }));
    expect(denied.props.createDecoder).not.toHaveBeenCalled();
    const other = await mount({ getStream: async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); } });
    await waitFor(() => expect(other.props.onError).toHaveBeenCalledWith({ nativeEvent: { message: 'camera' } }));
  });

  it('a decoder that fails to load lets go of the camera and says "decoder"', async () => {
    const { props, track } = await mount({ createDecoder: async () => { throw new Error('chunk'); } });
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith({ nativeEvent: { message: 'decoder' } }));
    expect(track.stop).toHaveBeenCalled();
  });

  it('lets go of the camera when the view goes away, and removes its listeners', async () => {
    const { track, view } = await mount();
    await waitFor(() => expect(dom.listeners()).toBeGreaterThan(0));
    await view.unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(dom.listeners()).toBe(0);
  });

  it('a hidden tab releases the camera, and showing it again takes the camera again', async () => {
    const { props, track } = await mount({ createDecoder: async () => decoder([]) });
    await waitFor(() => expect(props.onReady).toHaveBeenCalledTimes(1));
    await act(async () => { dom.doc.hidden = true; dom.emit('visibilitychange'); });
    expect(track.stop).toHaveBeenCalled();
    await act(async () => { dom.doc.hidden = false; dom.emit('visibilitychange'); });
    await waitFor(() => expect(props.getStream).toHaveBeenCalledTimes(2));
  });

  it('a camera that arrives after the view is gone is stopped at once', async () => {
    let give: (s: MediaStream) => void = () => undefined;
    const { stream, track } = fakeStream();
    const { view, props } = await mount({ getStream: () => new Promise<MediaStream>((r) => { give = r; }) });
    await view.unmount();
    await act(async () => give(stream));
    expect(track.stop).toHaveBeenCalled();
    expect(props.onReady).not.toHaveBeenCalled();
  });

  it('reports a torch when the camera has one and applies it, and turns it off again', async () => {
    const { props, view, track } = await mount({ torch: true }, fakeStream(true));
    await waitFor(() => expect(props.onReady).toHaveBeenCalledWith({ nativeEvent: { torch: true } }));
    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] }));
    await view.rerender(<WebScannerView {...props} torch={false} />);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });
});
