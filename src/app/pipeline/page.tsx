import { getStore } from '@/server/store';
import { partnerMetrics, recentApplications, portfolioMetrics } from '@/server/metrics';
import { Card, Kpi, Pill, fmt, statusTone } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Pipeline() {
  const s = await getStore();
  const partners = partnerMetrics(s).sort((a, b) => b.apps - a.apps);
  const apps = recentApplications(s, 30);
  const m = portfolioMetrics(s);
  const down = partners.filter((p) => p.health.status !== 'HEALTHY');
  return (
    <>
      <h1>Originations &amp; partner health</h1>
      <p className="sub">Embedded partner feeds (30 adapters), agent pipeline timings and SLA — target 24–48h from origination to disbursement.</p>

      <div className="grid g4">
        <Kpi label="Partner APIs healthy" value={`${partners.length - down.length}/${partners.length}`} tone={down.length ? 'warn' : 'ok'} hint={down.map((d) => d.name).join(', ') || 'all feeds up'} />
        <Kpi label="Median turnaround" value={`${m.sla.median} h`} hint={`p90 ${m.sla.p90} h`} />
        <Kpi label="≤ 24h" value={fmt.pct(m.sla.within24, 0)} hint="fast lane" />
        <Kpi label="SLA breaches (>48h)" value={m.sla.breaches} tone={m.sla.breaches ? 'warn' : 'ok'} hint="disbursed loans" />
      </div>

      <div className="section"><Card title="Partner integrations" right="sorted by volume">
        <div className="scroll"><table>
          <thead><tr><th>Partner</th><th>Category</th><th>Feed</th><th>API</th><th className="num">p95 ms</th><th className="num">Err %</th><th className="num">Apps</th><th className="num">Approval</th><th className="num">Med. SLA</th><th className="num">PAR30</th></tr></thead>
          <tbody>{partners.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b><div className="muted mono">{p.id}</div></td><td>{p.category.replace('_', '-').toLowerCase()}</td><td className="mono">{p.feedFormat}</td>
              <td><Pill tone={statusTone(p.health.status)}>{p.health.status}</Pill>{p.health.lastHeartbeatMin > 10 && <div className="muted" style={{ fontSize: 11 }}>last beat {p.health.lastHeartbeatMin}m ago</div>}</td>
              <td className="num">{p.health.status === 'DOWN' ? '—' : p.health.p95Ms}</td><td className="num">{p.health.errorRatePct}</td>
              <td className="num">{p.apps}</td><td className="num">{fmt.pct(p.approvalRate, 0)}</td><td className="num">{p.medianSla ? p.medianSla + ' h' : '—'}</td><td className="num">{fmt.pct(p.par30, 0)}</td>
            </tr>))}</tbody>
        </table></div>
      </Card></div>

      <div className="section"><Card title="Recent applications" right="expand a row for the agent timeline">
        <div className="scroll"><table>
          <thead><tr><th>Received</th><th>Partner</th><th>Applicant</th><th>Status</th><th>Tier</th><th className="num">Offer</th><th className="num">Hours</th><th>SLA</th></tr></thead>
          {apps.map((a) => (
            <tbody key={a.id}>
              <tr>
                <td>{fmt.date(a.receivedAt)}</td><td>{a.partner}</td><td>{a.borrower}</td>
                <td><details><summary><Pill tone={statusTone(a.status)}>{a.status}</Pill> <span className="muted" style={{ fontSize: 12 }}>▾</span></summary>
                  <div className="steps">{a.steps.map((st, i) => <span key={i} title={st.note}>{st.step.replace('_', ' ')} · {(st.durationMin / 60).toFixed(1)}h{st.attempts > 1 ? ` · ${st.attempts} tries` : ''}</span>)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{a.reasons.join(' · ') || '—'}</div></details></td>
                <td>{a.tier ?? '—'}</td><td className="num">{a.principal ? fmt.myr(a.principal) + ` / ${a.tenure}m` : '—'}</td>
                <td className="num">{a.slaHours.toFixed(1)}</td><td>{a.status === 'DISBURSED' ? <Pill tone={statusTone(a.slaBand)}>{a.slaBand.replace('_', ' ')}</Pill> : ''}</td>
              </tr>
            </tbody>))}
        </table></div>
      </Card></div>
    </>
  );
}
