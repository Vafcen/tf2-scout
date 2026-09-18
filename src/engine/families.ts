/**
 * Bot "families" derived from the backpack.tf user-agent string.
 * Auto-accept families are real trading bots: they accept a matching offer in seconds.
 * Everything else that pulses (backpack.tf automatic, generic "User Agent", "-", none) is usually a human-managed
 * listing helper: the offer may sit for hours, so it is a weaker exit.
 */
export type Family = 'gladiator' | 'tf2autobot' | 'cobra' | 'quicksell' | 'sentry' | 'junker' | 'tf2-trading-bot' | 'dolphin' | 'scrapyard' | 'other-bot' | 'human-managed' | 'human';

const AUTO_ACCEPT: [RegExp, Family][] = [
  [/gladiator/i, 'gladiator'],
  [/tf2autobot/i, 'tf2autobot'],
  [/cobra\.tf/i, 'cobra'],
  [/quicksell/i, 'quicksell'],
  [/sentry/i, 'sentry'],
  [/junker/i, 'junker'],
  [/tf2-trading-bot/i, 'tf2-trading-bot'],
  [/dolphin/i, 'dolphin'],
];

const HUMAN_MANAGED = [/^backpack\.tf automatic$/i, /^user agent$/i, /^-$/];

export function familyOf(isBot: boolean, uaClient: string | null, userName: string | null): Family {
  if (!isBot) return 'human';
  const ua = uaClient?.trim() ?? '';
  for (const [re, fam] of AUTO_ACCEPT) if (re.test(ua)) return fam;
  if (/scrapyardbot/i.test(userName ?? '')) return 'scrapyard';
  if (!ua || HUMAN_MANAGED.some((re) => re.test(ua))) return 'human-managed';
  return 'other-bot';
}

/** Whether a listing owner accepts matching offers automatically (within seconds). Unknown bot user agents are assumed to. */
export function isAutoAccept(fam: Family): boolean {
  return fam !== 'human' && fam !== 'human-managed';
}

export function familyLabel(fam: Family): string {
  switch (fam) {
    case 'human': return 'human';
    case 'human-managed': return 'human-managed listing';
    case 'other-bot': return 'unknown bot';
    default: return fam;
  }
}
