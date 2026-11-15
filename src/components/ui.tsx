import type { ReactNode } from 'react';

export const fmt = {
  myr: (n: number, d = 0) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d }),
  int: (n: number) => n.toLocaleString('en-MY'),
  pct: (n: number, d = 1) => n.toFixed(d) + '%',
  date: (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }),
};

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Pill({ tone = 'mute', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'mute'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Card({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || right) && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><h2>{title}</h2><span className="muted" style={{ fontSize: 12 }}>{right}</span></div>}
      {children}
    </section>
  );
}

export const statusTone = (s: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' =>
  ({ DISBURSED: 'ok', HEALTHY: 'ok', ACTIVE: 'info', CLOSED: 'mute', TRIGGERED: 'ok', DECLINED: 'bad', DEFAULTED: 'bad', DOWN: 'bad', FAILED: 'bad', DEGRADED: 'warn', REFERRED: 'warn', REVIEW: 'warn', NOT_TRIGGERED: 'mute', EXHAUSTED: 'warn', EXPIRED: 'mute', FAST_24H: 'ok', WITHIN_48H: 'info', BREACH: 'bad' } as const)[s as 'ACTIVE'] ?? 'mute';
