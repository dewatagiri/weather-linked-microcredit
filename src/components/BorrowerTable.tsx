'use client';
import { Fragment, useMemo, useState } from 'react';
import { Pill, Card, fmt, statusTone } from './ui';

type Row = ReturnType<typeof import('@/server/metrics').borrowerRows>[number];
const FILTERS = [['ALL', 'All'], ['GRADUATED', 'Graduated'], ['ON_TRACK', 'Active · on track'], ['AT_RISK', 'At risk (DPD>0)'], ['CLAIMED', 'Weather-assisted'], ['NOT_ELIGIBLE', 'Closed · not graduated']] as const;

export function BorrowerTable({ rows }: { rows: Row[] }) {
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('ALL');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => rows.filter((r) => {
    if (q && !(r.borrower + r.partner).toLowerCase().includes(q.toLowerCase())) return false;
    switch (f) {
      case 'GRADUATED': return r.graduation?.eligible;
      case 'ON_TRACK': return r.status === 'ACTIVE' && r.dpd === 0;
      case 'AT_RISK': return r.status === 'ACTIVE' && r.dpd > 0;
      case 'CLAIMED': return r.claims > 0;
      case 'NOT_ELIGIBLE': return r.graduation && !r.graduation.eligible;
      default: return true;
    }
  }), [rows, f, q]);
  const count = (k: string) => rows.filter((r) => (k === 'ALL' ? true : k === 'GRADUATED' ? r.graduation?.eligible : k === 'ON_TRACK' ? r.status === 'ACTIVE' && r.dpd === 0 : k === 'AT_RISK' ? r.status === 'ACTIVE' && r.dpd > 0 : k === 'CLAIMED' ? r.claims > 0 : r.graduation && !r.graduation.eligible)).length;
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {FILTERS.map(([k, l]) => <button key={k} className="ghost" aria-pressed={f === k} style={f === k ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => setF(k)}>{l} · {count(k)}</button>)}
        <input type="text" placeholder="Search borrower / partner" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} aria-label="Search" />
      </div>
      <div className="scroll"><table>
        <thead><tr><th>Borrower</th><th>Partner</th><th>Loan</th><th>Status</th><th>Repayment progress</th><th className="num">DPD</th><th className="num">Claims</th><th>Stage</th><th>Graduation</th></tr></thead>
        <tbody>{shown.slice(0, 150).map((r) => (
          <Fragment key={r.loanId}>
            <tr onClick={() => setOpen(open === r.loanId ? null : r.loanId)} style={{ cursor: 'pointer' }}>
              <td><b>{r.borrower}</b><div className="muted" style={{ fontSize: 12 }}>{r.region} · tier {r.tier ?? '—'} · score {r.score}</div></td>
              <td>{r.partner}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt.myr(r.principal)}<div className="muted" style={{ fontSize: 12 }}>{r.tenure}m · {fmt.myr(r.installment, 2)}/wk</div></td>
              <td><Pill tone={statusTone(r.status)}>{r.status}</Pill></td>
              <td style={{ minWidth: 140 }}><div className="bar"><span style={{ width: `${(r.weeksDone / r.weeksTotal) * 100}%` }} /></div><div className="muted" style={{ fontSize: 12 }}>{r.weeksDone}/{r.weeksTotal} wks · {r.onTime} on time{r.guaranteed ? ` · ${r.guaranteed} covered` : ''}</div></td>
              <td className="num">{r.dpd || '—'}</td><td className="num">{r.claims}/{r.maxClaims}</td>
              <td>{r.stage} · {r.stageName}</td>
              <td>{r.graduation ? (r.graduation.eligible ? <Pill tone="ok">→ Stage {r.graduation.toStage} · up to {fmt.myr(r.graduation.newLimit)}</Pill> : <Pill tone="mute">Not eligible</Pill>) : r.status === 'ACTIVE' ? <span className="muted" style={{ fontSize: 12 }}>{Math.round(r.progress * 100)}% to goal</span> : '—'}</td>
            </tr>
            {open === r.loanId && r.graduation && (
              <tr key={r.loanId + 'x'}><td colSpan={9} style={{ background: 'var(--surface-2)' }}>
                <div className="grid g3">{r.graduation.checks.map((c) => <div key={c.rule} style={{ fontSize: 12 }}><b style={{ color: c.pass ? 'var(--ok)' : 'var(--bad)' }}>{c.pass ? '✓' : '✗'}</b> {c.rule}<div className="muted">{c.detail}</div></div>)}</div>
              </td></tr>
            )}
          </Fragment>
        ))}</tbody>
      </table></div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Showing {Math.min(150, shown.length)} of {shown.length}. Click a closed loan for the rule-by-rule graduation check.</div>
    </Card>
  );
}
