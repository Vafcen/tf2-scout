import { execFile } from 'node:child_process';
import { env } from '../config.ts';
import { logger } from '../log.ts';

const log = logger('desktop');
let available: boolean | null = null;

export function desktopNotify(title: string, body: string, urgency: 'low' | 'normal' | 'critical' = 'normal'): void {
  if (!env.DESKTOP_NOTIFY || available === false) return;
  execFile('notify-send', ['-a', 'TF2 Scout', '-u', urgency, '-i', 'dialog-information', title, body], (err) => {
    if (err) {
      if (available === null) log.warn('notify-send not available; disabling desktop notifications');
      available = false;
    } else {
      available = true;
    }
  });
}
