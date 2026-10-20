import type { Engine } from './tesseract-engine';

// The one place the tesseract.js chunk is imported on demand (a separate web chunk named tesseract-engine, which the service worker does
// not precache), so the main bundle does not carry it and tests can stand in for it (jest cannot run `import()`).
export const loadEngine = (): Promise<() => Promise<Engine>> => import('./tesseract-engine').then((m) => m.createEngine);
