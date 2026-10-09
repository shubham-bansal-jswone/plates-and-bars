import type { AiFailure, AiFeature, AiQuota } from './client';

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

export const quotaMessage = (q: AiQuota, fallback: string): string => failureMessage({ kind: 'quota', quota: q }, fallback);

export const AI_COPY = {
  consentTitle: 'AI features',
  consentLabel: 'Use AI features',
  consentOff: 'Off by default. Everything in the app works without it.',
  consentSent: 'When you use one, the app sends only this to our server, which passes it to an AI service. Describe a meal: the text you type. Ask why: the card name and the question you type. Weekly summary: this week’s sessions, days logged, average calories and protein, average weight this and last week, the names of lifts that improved or stalled, your calorie and protein targets, your goal and your estimated burn. Never your name, email, photos, cycle or lab data. Our server does not save or log what you send or get back; it may keep an answer in memory, for you only, for up to 24 hours so a repeat question is quick. The AI service gets only the request, never who you are, and is set not to keep it or learn from it where it offers that.',
  consentNone: 'None of the AI features are switched on yet. They will show up here when they are.',
  consentOn: (names: string[]) => `Available now: ${names.join(', ')}.`,
  consentLeft: (q: AiQuota) => `${q.remaining} of ${q.limit} AI answers left today.`,
  names: { describe_meal: 'Describe a meal', ask_why: 'Ask why', weekly_summary: 'Weekly summary' } as Record<AiFeature, string>,
  describeButton: 'Describe it',
  describeTitle: (meal: string) => `Describe your ${meal.toLowerCase()}`,
  describeHint: 'Write what you ate with rough amounts. You check and edit the suggestions before anything is logged. They are estimates.',
  describeNone: 'Couldn’t read that meal. Try listing items with amounts.',
  describeFallback: 'The food list and Custom still work.',
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
  aiNote: 'AI-written. Check anything that matters.',
};
