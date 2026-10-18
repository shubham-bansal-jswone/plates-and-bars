import { PermissionsAndroid, Platform } from 'react-native';
import { BARCODE_COPY as t } from './copy';

/**
 * unavailable: no scanner here (not Android, and a browser with no camera API: not a secure page, or no getUserMedia). denied: can still be asked. blocked: the system will not ask again (Settings only).
 */
export type CameraPermission = 'granted' | 'denied' | 'blocked' | 'unavailable';

// Read when used: on the web `PermissionsAndroid.PERMISSIONS` does not exist, so a top-level read would throw when the module loads, and
// the Add sheet imports this module, so it would take the whole web app down.
const camera = () => PermissionsAndroid.PERMISSIONS.CAMERA;

/** Whether the camera may be used now. Never asks. `denied` also covers "blocked", which only a request can tell apart. */
export async function checkCamera(): Promise<CameraPermission> {
  // A browser asks when the camera is opened, so the view starts and the answer comes back as its `denied` error.
  if (Platform.OS === 'web') return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'granted' : 'unavailable';
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    return (await PermissionsAndroid.check(camera())) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Asks for the camera with the rationale (Android shows it when the user refused once before). */
export async function requestCamera(): Promise<CameraPermission> {
  if (Platform.OS === 'web') return checkCamera();
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    const r = await PermissionsAndroid.request(camera(), { title: t.rationaleTitle, message: t.rationale, buttonPositive: t.allow, buttonNegative: t.cancel });
    return r === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  } catch {
    return 'denied';
  }
}
