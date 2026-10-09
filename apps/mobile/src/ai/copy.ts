import type { AiFailure, AiFeature, AiQuota } from './client';

const resetTime = (q: AiQuota | null): string => (q ? new Date(q.resets_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'tomorrow');

/** What a failed AI call says, with the non-AI way to carry on (`fallback`, e.g. "The food list and Custom still work."). */
export function failureMessage(f: AiFailure, fallback: string): string {
  switch (f.kind) {
    case 'disabled':
      return `AI features are switched off right now. ${fallback}`;
    case 'quota':
      return `You’ve used today’s AI answers. They come back at ${resetTime(f.quota)}. ${fallback}`;
    case 'rate_limited':
      return 'Too many requests right now. Wait a minute and try again.';
    case 'offline':
      return `No connection. ${fallback}`;
    case 'signed_out':
      return 'Sign in again to use AI features.';
    case 'invalid':
      return 'That wasn’t accepted. Shorten it and try again.';
    case 'unavailable':
      return `Couldn’t get an answer, try again. ${fallback}`;
  }
}

export const quotaMessage = (q: AiQuota, fallback: string): string => failureMessage({ kind: 'quota', quota: q }, fallback);

export const AI_COPY = {
  consentTitle: 'AI features',
  consentLabel: 'Use AI features',
  consentOff: 'Off by default. Everything in the app works without it.',
  consentSent: 'When you use one, only this is sent to our server, which asks an AI service: for Describe a meal, the text you type; for Ask why, the card name and the question you type; for the weekly summary, this week’s averages (calories, protein, weight, training days) and lift names. Never your name, email, photos, cycle or lab data, and our server does not keep what you send or get back.',
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
  summaryFallback: 'The numbers above still tell the story.',
  aiNote: 'AI-written. Check anything that matters.',
};
