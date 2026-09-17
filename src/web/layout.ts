import { html, raw, type Raw } from './html.ts';

export interface LayoutOpts {
  title: string;
  active: string;
  body: Raw;
  status?: { wsConnected: boolean; eventsPerMin: number; keyText: string; desktopAlerts: 'on' | 'muted' | 'off'; mutedUntilText?: string };
}

const NAV = [
  ['/', 'Opportunities'],
  ['/banking', 'Banking'],
  ['/keys', 'Keys'],
  ['/portfolio', 'Portfolio'],
  ['/settings', 'Settings'],
  ['/status', 'Status'],
] as const;

export function layout(o: LayoutOpts): string {
  const nav = NAV.map(([href, label]) => html`<a href="${href}" class="${o.active === href ? 'active' : ''}">${label}</a>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title} · TF2 Scout</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎯</text></svg>">
<script src="https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.4/htmx.min.js" crossorigin="anonymous"></script>
<link rel="stylesheet" href="/static/app.css">
</head>
<body hx-boost="false">
<header class="top">
  <div class="brand">🎯 TF2 Scout</div>
  <nav>${nav.map((n) => n.html).join('')}</nav>
  <div class="status" id="topstatus" hx-get="/partials/topstatus" hx-trigger="every 15s" hx-swap="innerHTML">
    ${topStatus(o.status)}
  </div>
  <div class="bell">${bellControl(o.status)}</div>
</header>
<main>
${o.body.html}
</main>
<div id="toasts"></div>
<script src="/static/app.js"></script>
</body>
</html>`;
}

/** Desktop notifications bell: enable / mute for N hours / disable. */
export function bellControl(s?: LayoutOpts['status']): string {
  if (!s) return '';
  const state = s.desktopAlerts;
  const icon = state === 'on' ? '🔔' : '🔕';
  const label = state === 'on' ? 'Desktop alerts enabled' : state === 'muted' ? `Muted until ${s.mutedUntilText ?? ''}` : 'Desktop alerts disabled';
  return html`<details class="bellmenu">
    <summary title="${label}">${icon}</summary>
    <div class="menu">
      <div class="small muted">${label}</div>
      <form method="post" action="/alerts/desktop"><input type="hidden" name="action" value="on"><button type="submit" class="secondary">🔔 Enable</button></form>
      <form method="post" action="/alerts/desktop"><input type="hidden" name="action" value="mute"><input type="hidden" name="hours" value="1"><button type="submit" class="secondary">Mute 1 h</button></form>
      <form method="post" action="/alerts/desktop"><input type="hidden" name="action" value="mute"><input type="hidden" name="hours" value="4"><button type="submit" class="secondary">Mute 4 h</button></form>
      <form method="post" action="/alerts/desktop"><input type="hidden" name="action" value="mute"><input type="hidden" name="hours" value="12"><button type="submit" class="secondary">Mute 12 h</button></form>
      <form method="post" action="/alerts/desktop"><input type="hidden" name="action" value="off"><button type="submit" class="secondary">🔕 Disable</button></form>
    </div>
  </details>`.html;
}

export function topStatus(s?: LayoutOpts['status']): string {
  if (!s) return '';
  return html`<span class="dot ${s.wsConnected ? 'ok' : 'bad'}" title="${s.wsConnected ? 'feed connected' : 'feed disconnected'}"></span>
    <span>${s.eventsPerMin} ev/min</span> <span class="sep">·</span> <span>${s.keyText}</span>`.html;
}

export { raw };
