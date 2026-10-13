// Progress photos copy (prototype `photosShellHtml`, `renderPhotos`, `openPhotoCheckin`).
export const PHOTOS_TITLE = 'Progress photos';
export const PHOTOS_HINT_DEVICE = 'Saved only on this device, encrypted. They’re never uploaded or sent anywhere.';
export const PHOTOS_HINT_WEB = 'Kept only in this browser tab. They’re never uploaded or sent anywhere.';
export const PHOTOS_NO_STORAGE = 'This browser can’t store photos, so they’ll disappear when you close the page.';
export const PHOTOS_EMPTY = 'No photos yet. Front, side and back every 2–4 weeks shows change the scale can miss.';
export const PHOTOS_STALE = (days: number): string => `Last photos were ${days} days ago. Time for a new check-in.`;
export const PHOTOS_NEW = (today: boolean): string => (today ? 'Add to today’s photos' : 'New photo check-in');
export const PHOTOS_MISSING_POSE = (pose: string): string => `One of these dates has no ${pose} photo.`;
export const PHOTOS_DELETED = 'Check-in deleted';
export const PHOTOS_SAVE_FAILED = 'Couldn’t save that photo. Try another one.';
export const PHOTOS_CAMERA_OFF = 'Camera access is off. Allow it in Settings, or choose a photo instead.';
export const PHOTOS_UNAVAILABLE = 'Couldn’t open your photos on this device. Try again.';
export const CHECKIN_TITLE = 'Photo check-in';
export const CHECKIN_HOW = 'Same spot, same light, same distance each time. Morning, before eating, phone at chest height. Fitted clothes or what you train in.';
export const CHECKIN_PRIVATE = 'Stored only on this device. Not uploaded, not analysed.';
export const POSE_LABEL = { front: 'Front', side: 'Side', back: 'Back' } as const;
/** Days since the last check-in that prompt a new one (prototype: 14). */
export const PHOTOS_STALE_DAYS = 14;
/** Check-ins shown in the grid, newest first (prototype: 12). */
export const PHOTOS_GRID = 12;
