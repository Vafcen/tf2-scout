import { env } from '../config.ts';
import { logger } from '../log.ts';

const log = logger('discord');

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

/** Rate-limited queue for the Discord webhook (≈ 1 message/1.2 s; honors 429). */
export class DiscordAlerts {
  private queue: { content?: string; embeds?: DiscordEmbed[] }[] = [];
  private sending = false;
  private pauseUntil = 0;
  sent = 0;
  failed = 0;

  get enabled(): boolean {
    return !!env.DISCORD_WEBHOOK_URL;
  }

  send(msg: { content?: string; embeds?: DiscordEmbed[] }): void {
    if (!this.enabled) return;
    if (this.queue.length > 50) this.queue.shift();
    this.queue.push(msg);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const wait = this.pauseUntil - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const msg = this.queue.shift()!;
        try {
          const res = await fetch(env.DISCORD_WEBHOOK_URL!, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'TF2 Scout', ...msg }),
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status === 429) {
            const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
            this.pauseUntil = Date.now() + Math.max(1000, (body.retry_after ?? 2) * 1000);
            this.queue.unshift(msg);
            continue;
          }
          if (!res.ok) {
            this.failed++;
            log.warn(`webhook responded ${res.status}`);
          } else {
            this.sent++;
          }
        } catch (err) {
          this.failed++;
          log.warn('error sending to Discord', (err as Error).message);
        }
        this.pauseUntil = Date.now() + 1200;
      }
    } finally {
      this.sending = false;
    }
  }
}
