// Words for live pose tracking (#947). From the design on the issue: the safety text, the permission reason, and the
// "numbers, never grades" rule (no "good form" or "bad form"; depth is "about parallel" or "above parallel").

export const POSE_COPY = {
  intro: 'Prop your phone 2-3 metres away, side-on, whole body in frame, on a stable surface, with clear floor around it.',
  guide: 'Tracking is a guide, not a coach. It can miss things. Stop if anything hurts, and see a physio if the pain stays.',
  lighting: 'It works best with a plain, well-lit background and fitted clothes. It can be less accurate for some body shapes, wheelchairs and prosthetics. Your set works the same without it.',
  privacy: 'The camera view stays on this phone. Nothing is recorded or sent.',
  start: 'Start camera',
  starting: 'Starting the camera and loading the model. The first time this downloads about 5 MB.',
  startingApp: 'Starting the camera and loading the model.',
  countdown: (s: number) => `Get in position. Starting in ${s}.`,
  tracking: 'Tracking. Do your set.',
  noReps: 'No reps yet',
  rep: (n: number) => `Rep ${n}`,
  parallel: 'Depth: about parallel',
  above: 'Depth: above parallel',
  tempo: (down: number, pause: number, up: number) => `Down ${secs(down)} s${pause > 0 ? `, pause ${secs(pause)} s` : ''}, up ${secs(up)} s`,
  outOfView: 'Not tracked: your hips and legs were out of view. Step back so your whole body is in the frame.',
  finish: 'Finish set',
  autoStopped: 'Tracking stopped: no movement for a while.',
  capped: 'Tracking stopped after 3 minutes to save battery.',
  summary: (count: number, parallel: number) =>
    count === 0 ? 'No reps counted.' : `Counted ${count} ${count === 1 ? 'rep' : 'reps'}. ${parallel} reached about parallel.`,
  partial: 'You were mid-rep when it stopped; that one is not counted.',
  none: 'You can type the reps yourself. The set works the same.',
  cue: (text: string) => `From the exercise card: ${text}`,
  apply: (count: number, set: number) => `Use ${count} ${count === 1 ? 'rep' : 'reps'} for set ${set}`,
  discard: 'Do not use this',
  close: 'Close',
  retry: 'Try again',
  denied: 'The camera is blocked. Allow it for this site in your browser settings to track a set. Your set works the same without it.',
  deniedApp: 'The camera is blocked. Allow it for Plate & Bar in your phone settings to track a set. Your set works the same without it.',
  noCamera: 'No camera was found on this device.',
  cameraFailed: 'The camera could not start. Close other apps that use it and try again.',
  modelFailed: 'The tracking model could not load. Check your connection and try again. Your set works the same without it.',
  modelFailedApp: 'The tracking model could not load. Your set works the same without it.',
  camera: 'Camera view',
} as const;

function secs(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}
