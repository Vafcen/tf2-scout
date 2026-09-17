/** Minimal HTML template utilities (no dependencies). */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Template tag: interpolated values are escaped unless they are `raw(...)`. */
export class Raw {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
  toString(): string {
    return this.html;
  }
}
export const raw = (s: string): Raw => new Raw(s);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Raw) out += v.html;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.html : esc(x))).join('');
      else if (v === null || v === undefined || v === false) out += '';
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export function fmtAgo(ts: number | null | undefined, nowTs = Math.floor(Date.now() / 1000)): string {
  if (!ts) return '—';
  const d = Math.max(0, nowTs - ts);
  if (d < 60) return `${d} s`;
  if (d < 3600) return `${Math.floor(d / 60)} min`;
  if (d < 86400) return `${Math.floor(d / 3600)} h`;
  return `${Math.floor(d / 86400)} d`;
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', { hour12: false });
}

export function pctText(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v.toFixed(1)} %`;
}
