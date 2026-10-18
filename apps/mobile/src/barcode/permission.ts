import { PermissionsAndroid, Platform } from 'react-native';
import { BARCODE_COPY as t } from './copy';

/**
 * unavailable: no scanner here (not Android). denied: can still be asked. blocked: the system will not ask again (Settings only).
 */
export type CameraPermission = 'granted' | 'denied' | 'blocked' | 'unavailable';

// Read when used: on the web `PermissionsAndroid.PERMISSIONS` does not exist, so a top-level read would throw when the module loads, and
// the Add sheet imports this module, so it would take the whole web app down.
const camera = () => PermissionsAndroid.PERMISSIONS.CAMERA;

/** Whether the camera may be used now. Never asks. `denied` also covers "blocked", which only a request can tell apart. */
export async function checkCamera(): Promise<CameraPermission> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    return (await PermissionsAndroid.check(camera())) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** The text of the system dialog Android shows when the user refused once before. */
export type Rationale = { title: string; message: string; buttonPositive: string; buttonNegative: string };
const BARCODE_RATIONALE: Rationale = { title: t.rationaleTitle, message: t.rationale, buttonPositive: t.allow, buttonNegative: t.cancel };

/** Asks for the camera with the rationale (Android shows it when the user refused once before). The default is the barcode text; other features pass their own. */
export async function requestCamera(rationale: Rationale = BARCODE_RATIONALE): Promise<CameraPermission> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    const r = await PermissionsAndroid.request(camera(), rationale);
    return r === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  } catch {
    return 'denied';
  }
}
