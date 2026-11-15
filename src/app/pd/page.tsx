import { getStore } from '@/server/store';
import { pdPipelineView } from '@/server/metrics';
import { Card, Kpi, Pill, fmt } from '@/components/ui';

export const dynamic = 'force-dynamic';
const FAMILY_TONE: Record<string, 'info' | 'ok' | 'warn' | 'bad' | 'mute'> = { EARNINGS: 'info', ACTIVITY: 'ok', REPAYMENT: 'warn', WEATHER: 'bad', BUREAU: 'mute', PROFILE: 'mute' };

export default async function Pd() {
  const v = pdPipelineView(await getStore());
  const d = v.dataset;
  return (
    <>
      <h1>PD data pipeline <Pill tone="info">future roadmap</Pill></h1>
      <p className="sub">Point-in-time feature snapshots joined with repayment and weather outcomes — the training set for a proprietary PD model. No model is trained yet; this page shows readiness.</p>
      <div className="grid g4">
        <Kpi label="Feature snapshots" value={fmt.int(d.snapshots)} hint="one per loan at as-of date" />
        <Kpi label="Matured loans (labelled)" value={fmt.int(d.matured)} hint={`target ≥ ${d.minLabelsForFirstModel} for first model`} tone={d.matured >= d.minLabelsForFirstModel ? 'ok' : 'warn'} />
        <Kpi label="Bad rate (≥30 DPD proxy)" value={fmt.pct(d.badRate)} hint={`${d.labelledBad30} bads among matured`} />
        <Kpi label="Weather-assisted loans" value={fmt.int(d.weatherAssisted)} hint={`${fmt.pct(d.weatherAssistedBadRate)} bad rate`} />
      </div>
      <div className="section"><Card title="Feature store" right={`${v.stats.length} features · version 1`}>
        <div className="scroll"><table>
          <thead><tr><th>Feature</th><th>Family</th><th>Description</th><th className="num">Mean</th><th className="num">P10</th><th className="num">P90</th></tr></thead>
          <tbody>{v.stats.map((f) => <tr key={f.name}><td className="mono">{f.name}</td><td><Pill tone={FAMILY_TONE[f.family]}>{f.family}</Pill></td><td>{f.description}</td><td className="num">{f.mean}</td><td className="num">{f.p10}</td><td className="num">{f.p90}</td></tr>)}</tbody>
        </table></div>
      </Card></div>
      <div className="grid g2 section">
        <Card title="Storage layout"><pre>{`pd_feature_definitions(name PK, family, dtype, version)
pd_feature_snapshots(application_id, as_of_date, weeks_on_book,
                     features jsonb, feature_version)   -- append-only
pd_labels(application_id, horizon_weeks, defaulted, max_dpd,
          guarantee_assisted, matured_at)
pd_model_versions(id, name, trained_at, training_window,
                  metrics jsonb, status SHADOW|CHAMPION|RETIRED)`}</pre></Card>
        <Card title="Design notes"><ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li><b>Point-in-time safe:</b> snapshots are append-only; features use only data known at <code>as_of_date</code>.</li>
          <li><b>Guarantee-aware labels:</b> a week paid by the weather guarantee is not a borrower miss, but is kept as <code>guarantee_assisted</code> so the model can learn weather-income elasticity.</li>
          <li><b>Weather features</b> pair the home-region rain hours inside the 08–19 window with realised payout changes.</li>
          <li><b>Rollout:</b> shadow-score every origination alongside the rules-based tiering, promote on AUC/KS and calibration stability.</li>
        </ul></Card>
      </div>
      <div className="section"><Card title="Sample snapshot rows" right="first 5 loans"><div className="scroll"><pre>{JSON.stringify(v.sample.map((s) => ({ loan: s.loanId, ...Object.fromEntries(Object.entries(s.features).map(([k, x]) => [k, typeof x === 'number' ? Math.round(x * 1000) / 1000 : x])) })), null, 1)}</pre></div></Card></div>
    </>
  );
}
