// The one place the camera view is imported on demand (a separate web chunk, named pose-session), so the main bundle does
// not carry it and tests can stand in for it (jest cannot run `import()`).
export const loadPoseSession = () => import('./pose-session');
