import { getStore } from '@/server/store';
import { portfolioMetrics } from '@/server/metrics';
import { Kpi, Card, fmt } from '@/components/ui';
import { BarChart, HBars, Legend, LineChart } from '@/components/charts';

export const dynamic = 'force-dynamic';

const CHECK_LABEL: Record<string, string> = {
  WORKING_WINDOW: 'Outside 08:00–19:00', GEOFENCE: 'Outside weather polygon', WEATHER_SEVERITY: 'Below threshold', LOCATION_EVIDENCE: 'Weak / no location evidence',
  WAITING_PERIOD: 'Waiting period', CLAIMS_REMAINING: 'Claims exhausted', INSTALLMENT_AVAILABLE: 'No installment due', POLICY_ACTIVE: 'Policy inactive',
};

export default async function Overview() {
  const m = portfolioMetrics(await getStore());
  const k = m.kpis;
  const L = m.weeklySeries.map((w) => w.weekEnding), T = m.trigWeekly.map((w) => w.weekEnding);
  return (
    <>
      <h1>Portfolio overview</h1>
      <p className="sub">Embedded originations, repayment health and parametric weather guarantees · as of {new Date(m.asOf).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })} MYT</p>

      <div className="grid g4">
        <Kpi label="Active loans" value={fmt.int(k.activeLoans)} hint={`${fmt.myr(k.outstanding)} outstanding`} />
        <Kpi label="Applications · 30d" value={fmt.int(k.applications30d)} hint={`${fmt.pct(k.approvalRate, 0)} disbursed overall`} />
        <Kpi label="Median turnaround" value={`${k.medianSla} h`} hint={`${fmt.pct(m.sla.within48, 0)} within 48h SLA · p90 ${m.sla.p90}h`} tone={m.sla.within48 >= 90 ? 'ok' : 'warn'} />
        <Kpi label="NPS" value={k.nps >= 0 ? `+${k.nps}` : k.nps} hint="post-disbursement survey" tone={k.nps >= 40 ? 'ok' : 'warn'} />
        <Kpi label="Weekly collection rate" value={fmt.pct(k.collectionRate)} hint={`${fmt.pct(k.coveredRate)} incl. weather guarantee · 8-wk`} tone={k.coveredRate >= 95 ? 'ok' : 'warn'} />
        <Kpi label="Avg effective deduction" value={fmt.pct(k.avgEffectiveDeduction)} hint="of weekly gig payout (target 9–10%)" />
        <Kpi label="PAR30 / PAR90" value={`${fmt.pct(k.par30)} / ${fmt.pct(k.par90)}`} hint="share of outstanding principal" tone={k.par30 > 5 ? 'bad' : 'ok'} />
        <Kpi label="Guarantee payouts" value={fmt.myr(k.triggerPayouts)} hint={`${k.triggerCount} triggers · paid to lender · ${fmt.pct(k.guaranteeLossRatio, 0)} of fees`} />
      </div>

      <div className="grid g21 section">
        <Card title="Weekly collections vs due" right="last 26 weeks">
          <Legend items={[{ name: 'Collected from borrower', color: 'var(--c1)' }, { name: 'incl. weather guarantee', color: 'var(--c2)' }]} />
          <LineChart labels={L} max={100} format={(n) => n + '%'} series={[
            { name: 'Collected from borrower', color: 'var(--c1)', values: m.weeklySeries.map((w) => w.borrowerRate) },
            { name: 'incl. weather guarantee', color: 'var(--c2)', values: m.weeklySeries.map((w) => w.coveredRate) },
          ]} />
        </Card>
        <Card title="Origination SLA" right="hours to disbursement">
          <BarChart w={320} height={230} labels={m.sla.histogram.map((h) => h.label.replace('h', ''))} series={[{ name: 'Loans', color: 'var(--c1)', values: m.sla.histogram.map((h) => h.count) }]} />
          <div className="muted" style={{ fontSize: 12 }}>{fmt.pct(m.sla.within24, 0)} ≤24h · {fmt.pct(m.sla.within48, 0)} ≤48h · {m.sla.breaches} breaches</div>
        </Card>
      </div>

      <div className="grid g21 section">
        <Card title="Parametric triggers" right="weekly, last 26 weeks">
          <Legend items={[{ name: 'Triggered', color: 'var(--c1)' }, { name: 'Needs review', color: 'var(--c3)' }]} />
          <BarChart stacked labels={T} series={[
            { name: 'Triggered', color: 'var(--c1)', values: m.trigWeekly.map((w) => w.triggered) },
            { name: 'Needs review', color: 'var(--c3)', values: m.trigWeekly.map((w) => w.review) },
          ]} />
          <div className="muted" style={{ fontSize: 12 }}>Review queue: {k.reviewQueue} evaluations with inconclusive location evidence</div>
        </Card>
        <Card title="Why evaluations did not pay" right="blocking checks">
          <HBars rows={Object.entries(m.blockers).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => ({ label: CHECK_LABEL[c] ?? c, value: n }))} color="var(--c3)" />
        </Card>
      </div>

      <div className="grid g3 section">
        <Card title="Application outcomes"><HBars rows={m.funnel.map((f) => ({ label: f.status.charAt(0) + f.status.slice(1).toLowerCase(), value: f.count }))} /></Card>
        <Card title="Facility ladder" right={`${m.graduated}/${m.closed} closed loans graduated`}>
          <HBars rows={m.stageDist.map((s) => ({ label: `Stage ${s.stage} · ${s.name}`, value: s.count }))} color="var(--c2)" />
        </Card>
        <Card title="Guarantee payouts by region"><HBars rows={m.byRegion.map((r) => ({ label: r.label, value: r.paid, sub: `${r.count} claims` }))} format={(n) => fmt.myr(n)} color="var(--c4)" /></Card>
      </div>
    </>
  );
}
