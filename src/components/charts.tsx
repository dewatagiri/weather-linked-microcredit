/* Tiny dependency-free SVG charts. Colours come from CSS variables so they follow light/dark. */

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.name}><i style={{ background: i.color }} />{i.name}</span>)}</div>;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function LineChart({ labels, series, height = 200, format = (n: number) => String(n), max, w: W = 640 }: {
  w?: number; labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number; format?: (n: number) => string; max?: number;
}) {
  const pad = { l: 40, r: 8, t: 8, b: 22 };
  const top = max ?? niceMax(Math.max(...series.flatMap((s) => s.values), 1));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, labels.length - 1);
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(top * t)} y2={y(top * t)} stroke="var(--border)" /><text x={pad.l - 6} y={y(top * t) + 4} textAnchor="end">{format(top * t)}</text></g>
      ))}
      {labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 ? <text key={i} x={x(i)} y={height - 6} textAnchor="middle">{l.slice(5)}</text> : null))}
      {series.map((s) => (
        <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}>
          <title>{s.name}</title>
        </polyline>
      ))}
    </svg>
  );
}

export function BarChart({ labels, series, height = 180, stacked = false, format = (n: number) => String(n), w: W = 640 }: {
  w?: number; labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number; stacked?: boolean; format?: (n: number) => string;
}) {
  const pad = { l: 40, r: 8, t: 8, b: 22 };
  const totals = labels.map((_, i) => (stacked ? series.reduce((a, s) => a + s.values[i], 0) : Math.max(...series.map((s) => s.values[i]))));
  const top = niceMax(Math.max(...totals, 1));
  const bw = (W - pad.l - pad.r) / labels.length;
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);
  const base = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img">
      {[0, 0.5, 1].map((t) => (<g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(top * t)} y2={y(top * t)} stroke="var(--border)" /><text x={pad.l - 6} y={y(top * t) + 4} textAnchor="end">{format(top * t)}</text></g>))}
      {labels.map((l, i) => {
        let acc = 0;
        const n = series.length;
        return (
          <g key={i}>
            {series.map((s, k) => {
              const v = s.values[i];
              const h = base - y(v);
              const bx = stacked ? pad.l + i * bw + bw * 0.15 : pad.l + i * bw + bw * 0.1 + (k * bw * 0.8) / n;
              const bwid = stacked ? bw * 0.7 : (bw * 0.8) / n;
              const by = stacked ? base - ((acc += v), (acc / top) * (base - y(top))) : y(v);
              return <rect key={k} x={bx} y={by} width={Math.max(1, bwid - 1)} height={Math.max(0, h)} rx={2} fill={s.color}><title>{`${l} · ${s.name}: ${format(v)}`}</title></rect>;
            })}
            {i % Math.ceil(labels.length / 8) === 0 && <text x={pad.l + i * bw + bw / 2} y={height - 6} textAnchor="middle">{l.length > 6 ? l.slice(5) : l}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function HBars({ rows, color = 'var(--c1)', format = (n: number) => String(n) }: { rows: { label: string; value: number; sub?: string }[]; color?: string; format?: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{r.label}</span><span className="muted">{format(r.value)}{r.sub ? ` · ${r.sub}` : ''}</span></div>
          <div className="bar"><span style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}
