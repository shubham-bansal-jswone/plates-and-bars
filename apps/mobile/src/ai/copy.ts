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
  failureMessage(f, fallback, f.kind === 'invalid' && f.issue ? IMAGE_ISSUE_MESSAGE[f.issue] : invalid);

export const quotaMessage = (q: AiQuota, fallback: string): string => failureMessage({ kind: 'quota', quota: q }, fallback);

export const AI_COPY = {
  consentTitle: 'AI features',
  consentLabel: 'Use AI features',
  consentOff: 'Off by default. Everything in the app works without it.',
  consentSent: 'When you use one, the app sends only this to our server, which passes it to an AI service. Describe a meal: the text you type. Ask why: the card name and the question you type. Suggest muscles: when you add your own exercise, the name you typed for it, so the AI can suggest its muscles and other tags. Weekly summary: this week’s sessions, days logged, average calories and protein, average weight this and last week, the names of lifts that improved or stalled, your calorie and protein targets, your goal and your estimated burn. Meal photo: the one photo you take or pick, shrunk and re-saved without its location or other details, and the note you type. The photo is used for that one answer; the app does not keep it and our server does not save it. Never your name, email, progress photos, cycle or lab data. Our server does not save or log what you send or get back; it may keep an answer in memory, for you only, for up to 24 hours so a repeat question is quick. The AI service gets only the request, never who you are, and is set not to keep it or learn from it where it offers that.',
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
