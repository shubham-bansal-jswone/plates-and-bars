/** Copy for the account screen. No health data and no addresses appear in any message. */
/** "1 change" / "3 changes". */
export const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

export const SIGN_IN_COPY = {
  title: 'Sync',
  unavailable: 'Sync is not available in this build. Everything stays on this device.',
  optional: 'Signing in is optional. Without an account everything stays on this device. With one, your food, training and body records sync to your account, and any records already on this device are uploaded to the account you sign in with. Progress photos, cycle logs and lab reports always stay only on this device.',
  emailLabel: 'Email address',
  codeLabel: '6-digit code',
  sendCode: 'Send code',
  sending: 'Sending…',
  codeSent: 'We emailed you a 6-digit code. It expires in a few minutes.',
  verify: 'Sign in',
  verifying: 'Signing in…',
  useAnotherEmail: 'Use another email',
  done: 'Done',
  syncNow: 'Sync now',
  signOut: 'Sign out',
  syncThenSignOut: 'Sync now, then sign out',
  discardAndSignOut: 'Discard and sign out',
  signInAsPrevious: 'Sign in as the previous user to sync',
  cancel: 'Cancel',
  allSynced: 'You are signed in and everything is synced.',
  unsynced: (n: number) => `You are signed in. ${changes(n)} ${n === 1 ? 'is' : 'are'} not synced yet.`,
  consentNeeded: 'To sync, agree that Plate & Bar stores your records on its server. Progress photos, cycle logs and lab reports are never uploaded.',
  agree: 'Agree and sync',
  rejected: 'The server refused the last sync. Update the app, or try again later.',
  failed: 'Sync stopped because of a problem on this device. Your records are safe; try again, and update the app if it keeps happening.',
  retrying: 'We could not reach the server. Your changes are safe on this device and we will try again.',
  conflicts: (n: number) => `${n} ${n === 1 ? 'record was' : 'records were'} changed on another device more recently, so that version was kept.`,
  stillUnsynced: (n: number) => `${changes(n)} ${n === 1 ? 'is' : 'are'} still not synced, so you are still signed in. Try again when you are online, or discard them.`,
  confirmDiscard: (n: number) => `This deletes ${n} unsynced ${n === 1 ? 'change' : 'changes'} and all data on this device. It cannot be undone.`,
  refused: (n: number) => `This device has ${n} unsynced ${n === 1 ? 'change' : 'changes'} from a different account, so that sign-in was not kept. Sign in as the previous user to sync them, or discard them.`,
  startError: (r: 'invalid_email' | 'rate_limited' | 'unavailable') =>
    r === 'invalid_email' ? 'Check the email address.' : r === 'rate_limited' ? 'Too many tries. Wait a minute and try again.' : 'We could not reach the server. Try again when you are online.',
  verifyError: (r: 'invalid_code' | 'rate_limited' | 'unavailable' | 'offline') =>
    r === 'invalid_code' ? 'That code is wrong or has expired. Request a new one.' : r === 'rate_limited' ? 'Too many tries. Wait a minute and try again.' : 'We could not reach the server. Try again when you are online.',
};
