/** Last "pulse" (heartbeat) seen per bot (steamid) across any listing in the feed. */
class BotPulse {
  private pulses = new Map<string, number>();
  observe(steamid: string, lastPulse: number | null | undefined): void {
    if (!lastPulse) return;
    const prev = this.pulses.get(steamid) ?? 0;
    if (lastPulse > prev) this.pulses.set(steamid, lastPulse);
  }
  get(steamid: string): number | null {
    return this.pulses.get(steamid) ?? null;
  }
  size(): number {
    return this.pulses.size;
  }
}
export const botPulse = new BotPulse();
