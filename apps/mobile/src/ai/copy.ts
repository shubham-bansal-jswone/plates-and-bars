import type { AiFailure, AiFeature, AiQuota, ImageIssue } from './client';

const resetTime = (q: AiQuota | null): string => (q ? new Date(q.resets_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'tomorrow');

/** What a failed AI call says, with the non-AI way to carry on (`fallback`, e.g. "The food list and Custom still work."). */
export function failureMessage(f: AiFailure, fallback: string, invalid = 'That wasn’t accepted. Shorten it and try again.'): string {
  switch (f.kind) {
    case 'disabled':
      return `AI features are switched off right now. ${fallback}`;
    case 'quota':
      return `You’ve used today’s AI answers. They come back at ${resetTime(f.quota)}. ${fallback}`;
    case 'rate_limited':
      return `Too many requests right now. Wait ${f.retryAfterSec <= 60 ? 'a minute' : `${Math.ceil(f.retryAfterSec / 60)} minutes`} and try again.`;
    case 'offline':
      return `No connection. ${fallback}`;
    case 'signed_out':
      return 'Sign in again to use AI features.';
    case 'invalid':
      return invalid;
    case 'unavailable':
      return `Couldn’t get an answer, try again. ${fallback}`;
  }
}

/** What each 400 `issue` of an image call says to the user (the contract's values; never the image or a value). */
export const IMAGE_ISSUE_MESSAGE: Record<ImageIssue, string> = {
  too_large: 'That photo is too big. Take a new one or choose a smaller one.',
  invalid_base64: 'That photo couldn’t be read. Take a new one or choose another.',
  unreadable_image: 'That photo couldn’t be read. Take a new one or choose another.',
  unsupported_type: 'Only JPEG and PNG photos work. Take a new one or choose another.',
  type_mismatch: 'That file isn’t the kind of photo it says it is. Choose a different photo.',
  dimensions: 'That photo is too large to send. Take a new one or choose a smaller one.',
};

/** An image call's failure: a named image fault gets its own message, any other 400 the generic `invalid`. */
export const imageFailureMessage = (f: AiFailure, fallback: string, invalid = 'That photo wasn’t accepted. Try another one.'): string =>
  failureMessage(f, fallback, f.kind === 'invalid' && f.issue && (!f.field || /^(image|frames)\b/.test(f.field)) ? IMAGE_ISSUE_MESSAGE[f.issue] : invalid);

/** What each 400 `issue` says about a form-check frame (`frames[n].data`); the frame is named when the server says which. */
export const FRAME_ISSUE_MESSAGE: Record<ImageIssue, string> = {
  too_large: 'That frame is too big. Try a shorter clip or different photos.',
  invalid_base64: 'That frame couldn’t be read. Try a different clip or photos.',
  unreadable_image: 'That frame couldn’t be read. Try a different clip or photos.',
  unsupported_type: 'Only JPEG and PNG frames work. Try a different clip or photos.',
  type_mismatch: 'That file isn’t the kind of image it says it is. Choose different photos.',
  dimensions: 'That frame is too large to send. Try a different clip or photos.',
};

/** A form check's failure: `exercise` the check is not offered for, a named frame fault (with its number), or the generic 400. */
export function formCheckFailureMessage(f: AiFailure, fallback: string): string {
  if (f.kind !== 'invalid') return failureMessage(f, fallback);
  if (f.field === 'exercise') return AI_COPY.formNotCatalogue;
  if (f.issue) {
    const n = /^frames\[(\d+)\]/.exec(f.field ?? '');
    return `${n ? `Frame ${Number(n[1]) + 1}: ` : ''}${FRAME_ISSUE_MESSAGE[f.issue]}`;
  }
  return AI_COPY.formInvalid;
}

export const quotaMessage = (q: AiQuota, fallback: string): string => failureMessage({ kind: 'quota', quota: q }, fallback);

export const AI_COPY = {
  consentTitle: 'AI features',
  consentLabel: 'Use AI features',
  consentOff: 'Off by default. Everything in the app works without it.',
  consentSent: 'When you use one, the app sends only this to our server, which passes it to an AI service. Describe a meal: the text you type. Ask why: the card name and the question you type. Suggest muscles: when you add your own exercise, the name you typed for it, so the AI can suggest its muscles and other tags. Weekly summary: this week’s sessions, days logged, average calories and protein, average weight this and last week, the names of lifts that improved or stalled, your calorie and protein targets, your goal and your estimated burn. Meal photo: the one photo you take or pick, shrunk and re-saved without its location or other details, and the note you type. Import recipe: the recipe text you paste and, if you add one, one photo of the recipe. Form check: the exercise name and 2 to 4 still frames cut on your phone from your own video or photos; the video itself never leaves your phone. A photo or frame is used for that one answer; the app does not keep it and our server does not save it. Never your name, email, progress photos, cycle or lab data. Our server does not save or log what you send or get back; it may keep an answer in memory, for you only, for up to 24 hours so a repeat question is quick. The AI service gets only the request, never who you are, and is set not to keep it or learn from it where it offers that.',
  consentNone: 'None of the AI features are switched on yet. They will show up here when they are.',
  consentOn: (names: string[]) => `Available now: ${names.join(', ')}.`,
  consentLeft: (q: AiQuota) => `${q.remaining} of ${q.limit} AI answers left today.`,
  names: { describe_meal: 'Describe a meal', ask_why: 'Ask why', weekly_summary: 'Weekly summary', suggest_tags: 'Suggest muscles', meal_photo: 'Meal photo', import_recipe: 'Import recipe', form_check: 'Form check' } as Record<AiFeature, string>,
  describeButton: 'Describe it',
  describeTitle: (meal: string) => `Describe your ${meal.toLowerCase()}`,
  describeHint: 'Write what you ate with rough amounts. You check and edit the suggestions before anything is logged. They are estimates.',
  describeNone: 'Couldn’t read that meal. Try listing items with amounts.',
  describeFallback: 'The food list and Custom still work.',
  photoTab: 'Photo',
  photoSnap: 'Snap a meal',
  photoSnapHint: 'Photo → AI estimates → you check and add',
  photoTitle: (meal: string) => `Photo of your ${meal.toLowerCase()}`,
  photoHint: 'Take a photo from above with the whole plate in view, or pick one from your gallery.',
  photoTake: 'Take a photo',
  photoChoose: 'Choose a photo',
  photoAnother: 'Use a different photo',
  photoNoteLabel: 'Anything the photo can’t show? Optional',
  photoNotePlaceholder: 'e.g. cooked in 2 tsp ghee, there are 3 rotis, sugar in the chai',
  photoAnalyse: 'Analyse photo',
  photoBusy: 'Looking at your meal…',
  photoNone: 'Couldn’t spot food in this photo. Try again closer, from above, with good light.',
  photoCameraOff: 'Camera access is off. Allow it in Settings, or choose a photo instead.',
  photoUnreadable: 'Couldn’t use that photo. Try another one.',
  photoFallback: 'Describe it, the food list and Custom still work.',
  photoReview: 'Check each item',
  photoReviewHint: 'Use − and + to match your portion. Items marked “estimate” weren’t in the food list.',
  photoOilHint: 'Photos can’t see oil, ghee or sugar, so totals may run a little low. Use the note above if you know what went in.',
  photoSave: 'Save estimated or adjusted items to my foods',
  photoServerBusy: (s: number) => `The server is busy. You can try again in ${s} second${s === 1 ? '' : 's'}.`,
  photoAdded: (n: number) => `Added ${n} item${n > 1 ? 's' : ''} from your photo`,
  photoPrivacy: 'The photo is used for this one answer. The app does not keep it.',
  importOpen: 'Import a recipe from text or a photo',
  importTitle: 'Import a recipe',
  importPlaceholder: 'Paste a recipe, or add a photo of a cookbook page',
  importTextLabel: 'Recipe text',
  importAddPhoto: 'Add a photo',
  importPhotoAdded: 'Photo added',
  importRemovePhoto: 'Remove photo',
  importGo: 'Import',
  importBusy: 'Reading…',
  importCancel: 'Cancel',
  importEmpty: 'Paste a recipe or add a photo of one.',
  importNone: 'Couldn’t read that recipe. Try pasting the ingredient list.',
  importDone: 'Recipe imported. Check the amounts before saving.',
  importFallback: 'The recipe builder still works.',
  importInvalid: 'That recipe wasn’t accepted. Shorten the text and try again.',
  importPhotoInvalid: 'That photo wasn’t accepted. Try another one.',
  importUnmatched: (names: readonly string[]) => `Not matched, so left out: ${names.join(', ')}. Add them by hand if they matter.`,
  formOpen: 'Check my form',
  formTitle: (ex: string) => `Check my form: ${ex}`,
  formHowWeb: 'Prop your phone about 2–3 metres away, side view, whole body in frame, and take 2 to 4 photos of one set in the order they happened. Only those few still frames are sent for analysis, and only if you have turned on AI features.',
  formHow: 'Prop your phone on the floor about 2–3 metres away, side view, whole body in frame. Record one set with your camera app, then choose the video here. The video stays on your phone; only a few still frames are sent for analysis, and only if you have turned on AI features.',
  formVideo: 'Choose a video',
  formVideoAnother: 'Use a different video',
  formPhotos: 'Choose 2 to 4 photos',
  formTake: 'Take a photo',
  formFrame: (n: number) => `Frame ${n} from your set`,
  formClear: 'Clear frames',
  formFrames: (n: number) => `${n} frame${n === 1 ? '' : 's'} ready. Only these are sent.`,
  formNeedTwo: 'Choose a video, or 2 to 4 photos in the order they happened.',
  formRun: 'Get a second opinion',
  formBusy: 'Looking at your set…',
  formCutting: 'Cutting frames…',
  formVideoFailed: 'Couldn’t read frames from that video. Try a shorter clip (under a minute) in MP4.',
  formOneFrame: 'One frame is ready. Add at least one more, up to 4: take another photo, or choose a video or photos.',
  formMax: 'That’s 4 frames, the most that can be sent. Clear frames to start over.',
  formCancel: 'Cancel',
  formCues: 'Check yourself against the cues',
  formSecond: 'Second opinion',
  formNotVisible: 'Your body wasn’t clearly in view. Try a side view with your whole body in frame.',
  formStatus: { good: 'Looks good', watch: 'Watch this', unclear: 'Can’t tell' } as Record<string, string>,
  formDisclaimer: 'Second opinion, not a coach. It can spot obvious things like depth or a rounded back from a few frames, and will miss subtle ones. Anything painful: stop and see a physio.',
  formFallback: 'The cue checklist still works.',
  formNotCatalogue: 'Form check isn’t available for this exercise. The cue checklist still works.',
  formInvalid: 'That wasn’t accepted. Try a different clip or photos.',
  reviewHint: 'Estimates for the whole amount. Fix anything that looks off; nothing is logged until you add.',
  askButton: 'Ask why',
  askTitle: 'Ask why',
  askHint: 'Pick a card and ask a follow-up. Only the card name and your question are sent. Answers use only the app’s cards.',
  askFallback: 'The cards in the app still explain it.',
  summaryTitle: 'Your week in words',
  summaryButton: 'Write my week in words',
  summaryHint: 'Sends this week’s averages, not your name or logs. Optional; the numbers above are all yours.',
  summaryNeedsPlan: 'Plan at least one training day to use this.',
  summaryInvalid: 'Couldn’t send this week’s summary. Try again later.',
  summaryFallback: 'The numbers above still tell the story.',
  suggestWorking: 'Working out which muscles this trains…',
  suggestDone: 'AI’s suggestion. Tap muscles to correct it.',
  suggestNoRetry: 'Couldn’t get a suggestion right now.',
  suggestFallback: 'Tap the muscles this exercise trains.',
  aiNote: 'AI-written. Check anything that matters.',
};
