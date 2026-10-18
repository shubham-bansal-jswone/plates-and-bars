import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { BarcodeEvent, ErrorEvent, ReadyEvent, ScannerViewProps } from '../../modules/plate-barcode-scanner/types';
import { BARCODE_COPY as t } from './copy';
import { createFrameDecoder, type FrameDecoder } from './webDecoder';
import { browserDecoderDeps } from './webLoad';

/** About 7 reads a second: a held pack is read within a second or two, and a low-end phone stays cool. */
export const WEB_FRAME_MS = 150;

const openCamera = (): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });

const loadDecoder = (): Promise<FrameDecoder> => createFrameDecoder(browserDecoderDeps());

export interface WebScannerProps extends ScannerViewProps {
  /** Tests pass fakes; the defaults are the browser camera and the browser or zxing-wasm decoder. */
  getStream?: () => Promise<MediaStream>;
  createDecoder?: () => Promise<FrameDecoder>;
  frameMs?: number;
}

const denied = (e: unknown): boolean => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'SecurityError');

/**
 * The web scanner view (#944): the camera preview in a `<video>`, read about 7 times a second by the browser's BarcodeDetector or the
 * self-hosted zxing-wasm. Same props as the native view. Frames are read in memory and dropped: nothing is stored or sent. The camera
 * is released when the view goes away and when the tab is hidden, and taken again when the tab is shown. After a hit it reads
 * nothing more until `active` goes false and then true.
 */
export function WebScannerView({ style, torch = false, active = true, onBarcode, onReady, onError, getStream = openCamera, createDecoder = loadDecoder, frameMs = WEB_FRAME_MS }: WebScannerProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const activeRef = useRef(active);
  const hit = useRef(false);
  const torchRef = useRef(torch);
  const cb = useRef({ onBarcode, onReady, onError });
  useEffect(() => {
    cb.current = { onBarcode, onReady, onError };
  });

  // A new `active` true after false re-arms the reader; false pauses it (the preview keeps running).
  useEffect(() => {
    activeRef.current = active;
    if (active) hit.current = false;
  }, [active]);

  const applyTorch = (on: boolean) => {
    void track.current?.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints).catch(() => undefined);
  };
  useEffect(() => {
    torchRef.current = torch;
    applyTorch(torch);
  }, [torch]);

  useEffect(() => {
    let alive = true;
    let gen = 0;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let decoder: FrameDecoder | null = null;
    const fail = (message: string) => alive && cb.current.onError?.({ nativeEvent: { message } } as ErrorEvent);

    const release = () => {
      gen += 1;
      clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
      track.current = null;
      if (video.current) video.current.srcObject = null;
    };

    const tick = async (mine: number) => {
      const v = video.current;
      if (v && decoder && activeRef.current && !hit.current && v.readyState >= 2) {
        const r = await decoder.read(v);
        if (gen !== mine) return;
        if (r && activeRef.current && !hit.current) {
          hit.current = true;
          cb.current.onBarcode({ nativeEvent: r } as BarcodeEvent);
        }
      }
      if (gen === mine) timer = setTimeout(() => void tick(mine), frameMs);
    };

    const start = async () => {
      const mine = ++gen;
      let s: MediaStream;
      try {
        s = await getStream();
      } catch (e) {
        if (gen === mine) fail(denied(e) ? 'denied' : 'camera');
        return;
      }
      if (!alive || gen !== mine) return s.getTracks().forEach((tr) => tr.stop());
      stream = s;
      track.current = s.getVideoTracks()[0] ?? null;
      const v = video.current;
      if (v) {
        v.srcObject = s;
        void Promise.resolve(v.play()).catch(() => undefined);
      }
      const caps = track.current?.getCapabilities?.() as { torch?: boolean } | undefined;
      cb.current.onReady?.({ nativeEvent: { torch: !!caps?.torch } } as ReadyEvent);
      if (torchRef.current) applyTorch(true);
      try {
        decoder ??= await createDecoder();
      } catch {
        if (gen === mine) {
          release();
          fail('decoder');
        }
        return;
      }
      if (gen === mine) void tick(mine);
    };

    // A hidden tab must not keep the camera on: let go, and take it again when the tab is shown.
    const onVisibility = () => {
      if (document.hidden) release();
      else if (!stream) void start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', release);
    void start();
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', release);
      release();
    };
    // The camera and decoder are set up once per mount; props that change later are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={style}>
      <video ref={video} autoPlay muted playsInline aria-label={t.cameraView} style={{ width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' }} />
    </View>
  );
}
