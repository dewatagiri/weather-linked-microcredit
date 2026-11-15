'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, Pill, fmt } from './ui';
import { BarChart, LineChart } from './charts';

type Tab = 'trigger' | 'pricing' | 'underwrite' | 'webhook';
const TABS: [Tab, string][] = [['trigger', 'Weather trigger'], ['pricing', 'Guarantee pricing'], ['underwrite', 'Underwriting'], ['webhook', 'Partner webhook']];
const REGIONS = ['KLANG_VALLEY', 'JOHOR', 'PENANG', 'KELANTAN', 'TERENGGANU', 'PAHANG', 'SABAH', 'SARAWAK'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
function useDebounced<T>(v: T, ms = 150) { const [d, set] = useState(v); useEffect(() => { const t = setTimeout(() => set(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

function Slider({ label, value, set, min, max, step = 1, unit = '', show }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step?: number; unit?: string; show?: string }) {
  return <label className="f"><span style={{ display: 'flex', justifyContent: 'space-between' }}>{label}<output>{show ?? value}{unit}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} /></label>;
}
function Select({ label, value, set, options }: { label: string; value: string; set: (s: string) => void; options: [string, string][] }) {
  return <label className="f">{label}<select value={value} onChange={(e) => set(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;

export function Simulators({ partners }: { partners: { id: string; name: string; feed: string }[] }) {
  const [tab, setTab] = useState<Tab>('trigger');
  return (
    <>
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'trigger' && <TriggerSim />}
      {tab === 'pricing' && <PricingSim />}
      {tab === 'underwrite' && <UnderwriteSim />}
      {tab === 'webhook' && <WebhookSim partners={partners} />}
    </>
  );
}

/* ---------------------------------------------------------------- trigger */
function TriggerSim() {
  const [s, setS] = useState({ region: 'KLANG_VALLEY', rainMmHr: 48, floodAlert: 'NONE', hour: 14, distanceKm: 3, bearingDeg: 40, source: 'GPS', pingOffsetMin: 0, online: true, noPing: false, accuracyM: 20 });
  const set = <K extends keyof typeof s>(k: K) => (v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));
  const q = useDebounced(s);
  const [res, setRes] = useState<any>(null);
  useEffect(() => { post('/api/simulate/trigger', { ...q, localTime: hhmm(q.hour), accuracyM: q.source === 'IP' ? q.accuracyM * 50 : q.accuracyM }).then(setRes); }, [q]);
  const ev = res?.evaluation;
  const preset = (p: Partial<typeof s>) => setS((x) => ({ ...x, ...p }));
  return (
    <div className="grid g12">
      <Card title="Scenario">
        <div className="grid" style={{ gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="ghost" onClick={() => preset({ rainMmHr: 48, hour: 14, distanceKm: 3, noPing: false, online: true, source: 'GPS', pingOffsetMin: 0, floodAlert: 'NONE' })}>Afternoon storm</button>
            <button className="ghost" onClick={() => preset({ rainMmHr: 80, hour: 4, distanceKm: 3, noPing: false, online: true, source: 'GPS' })}>04:00 storm</button>
            <button className="ghost" onClick={() => preset({ rainMmHr: 48, hour: 14, distanceKm: 18, source: 'GPS' })}>Worker across town</button>
            <button className="ghost" onClick={() => preset({ rainMmHr: 10, hour: 11, floodAlert: 'DANGER', distanceKm: 2 })}>Flood alert only</button>
          </div>
          <Select label="Region (weather cell)" value={s.region} set={set('region')} options={REGIONS.map((r) => [r, r.replace('_', ' ')])} />
          <Slider label="Rainfall" value={s.rainMmHr} set={set('rainMmHr')} min={0} max={120} unit=" mm/hr" />
          <Select label="Flood alert" value={s.floodAlert} set={set('floodAlert')} options={['NONE', 'ADVISORY', 'WARNING', 'DANGER'].map((x) => [x, x])} />
          <Slider label="Event time (Malaysia)" value={s.hour} set={set('hour')} min={0} max={23.5} step={0.5} show={hhmm(s.hour)} />
          <Slider label="Worker distance from cell centre" value={s.distanceKm} set={set('distanceKm')} min={0} max={30} unit=" km" />
          <Slider label="Bearing" value={s.bearingDeg} set={set('bearingDeg')} min={0} max={359} unit="°" />
          <Select label="Location source" value={s.source} set={set('source')} options={[['GPS', 'GPS (±20 m)'], ['IP', 'IP geolocation (±1 km … 25 km)']]} />
          {s.source === 'IP' && <Slider label="IP accuracy radius" value={s.accuracyM} set={set('accuracyM')} min={1} max={500} show={fmt.int(s.accuracyM * 50)} unit=" m" />}
          <Slider label="Ping offset vs event" value={s.pingOffsetMin} set={set('pingOffsetMin')} min={-60} max={60} unit=" min" />
          <label className="f" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center' }}><input type="checkbox" checked={s.online} onChange={(e) => set('online')(e.target.checked)} /> Worker online on platform</label>
          <label className="f" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center' }}><input type="checkbox" checked={s.noPing} onChange={(e) => set('noPing')(e.target.checked)} /> No location data</label>
        </div>
      </Card>
      <div className="grid">
        {ev && <>
          <div className={`verdict ${ev.outcome === 'TRIGGERED' ? 'ok' : ev.outcome === 'REVIEW' ? 'warn' : 'bad'}`}>
            {ev.outcome === 'TRIGGERED' ? `TRIGGERED — guarantee pays ${fmt.myr(ev.payout.amount, 2)} to the LENDER for installment #${ev.payout.installmentNo}` : ev.outcome === 'REVIEW' ? 'REVIEW — location evidence inconclusive; routed to ops queue' : 'NOT TRIGGERED — no payment'}
            <div style={{ fontWeight: 400, fontSize: 12, marginTop: 4 }}>Calibrated trigger for {s.region.replace('_', ' ')}: {res.threshold.triggerMmHr} mm/hr (98.5th pct of wet hours, {res.threshold.years.toFixed(0)}y history, ≈{Math.round(res.threshold.expectedTriggerHoursPerYear)} h/yr) · flood alert ≥ WARNING</div>
          </div>
          <div className="grid g2">
            <Card title="Rule checks">{ev.checks.map((c: any) => (
              <div className="chk" key={c.code}><b style={{ color: c.pass ? 'var(--ok)' : c.inconclusive ? 'var(--warn)' : 'var(--bad)' }}>{c.pass ? '✓' : c.inconclusive ? '?' : '✗'}</b><div><b>{c.code.replaceAll('_', ' ')}</b><span className="d">{c.detail}</span></div></div>))}</Card>
            <Card title="Geofence & working window">
              <GeoMap radiusM={res.radiusM} distanceKm={s.distanceKm} bearing={s.bearingDeg} rainy={s.rainMmHr >= res.threshold.triggerMmHr || ['WARNING', 'DANGER'].includes(s.floodAlert)} noPing={s.noPing} />
              <DayBar hour={s.hour} />
            </Card>
          </div>
        </>}
      </div>
    </div>
  );
}

function GeoMap({ radiusM, distanceKm, bearing, rainy, noPing }: { radiusM: number; distanceKm: number; bearing: number; rainy: boolean; noPing: boolean }) {
  const px = 5, r = (radiusM / 1000) * px, b = (bearing * Math.PI) / 180;
  const x = 150 + distanceKm * px * Math.sin(b), y = 150 - distanceKm * px * Math.cos(b);
  const inside = distanceKm <= radiusM / 1000;
  return (
    <svg viewBox="0 0 300 300" width="100%" role="img" aria-label="Weather polygon and worker location" style={{ maxHeight: 260 }}>
      <rect width="300" height="300" rx="10" fill="var(--surface-2)" />
      {[50, 100, 150, 200, 250].map((g) => <g key={g}><line x1={g} x2={g} y1="0" y2="300" stroke="var(--border)" /><line y1={g} y2={g} x1="0" x2="300" stroke="var(--border)" /></g>)}
      <circle cx="150" cy="150" r={r} fill={rainy ? 'var(--c2)' : 'var(--c5)'} fillOpacity=".22" stroke={rainy ? 'var(--c2)' : 'var(--c5)'} strokeWidth="2" strokeDasharray="5 3" />
      <text x="150" y={150 - r - 6} textAnchor="middle">weather cell {radiusM / 1000} km radius</text>
      {!noPing && <><circle cx={Math.min(290, Math.max(10, x))} cy={Math.min(290, Math.max(10, y))} r="7" fill={inside ? 'var(--ok)' : 'var(--bad)'} stroke="var(--surface)" strokeWidth="2" /><text x={Math.min(260, Math.max(30, x))} y={Math.min(285, Math.max(24, y)) - 12} textAnchor="middle">worker {inside ? 'inside' : 'outside'}</text></>}
    </svg>
  );
}
function DayBar({ hour }: { hour: number }) {
  const w = 600 / 24;
  return (
    <svg viewBox="0 0 600 54" width="100%" role="img" aria-label="24-hour working window">
      <rect x="0" y="14" width="600" height="14" rx="4" fill="var(--surface-2)" />
      <rect x={8 * w} y="14" width={11 * w} height="14" fill="var(--c1)" fillOpacity=".45" />
      {[0, 4, 8, 12, 16, 19, 24].map((h) => <text key={h} x={h * w} y="46" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>{String(h).padStart(2, '0')}:00</text>)}
      <path d={`M${hour * w} 8 l-5 -8 h10z`} fill="var(--c4)" /><line x1={hour * w} x2={hour * w} y1="8" y2="32" stroke="var(--c4)" strokeWidth="2" />
    </svg>
  );
}

/* ---------------------------------------------------------------- pricing */
function PricingSim() {
  const [s, setS] = useState({ tenureMonths: 3, region: 'KLANG_VALLEY', principal: 2400, installment: 100, month: 11 });
  const set = <K extends keyof typeof s>(k: K) => (v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));
  const q = useDebounced(s, 200);
  const [all, setAll] = useState<any[]>([]);
  useEffect(() => { Promise.all(Array.from({ length: 12 }, (_, i) => post('/api/simulate/pricing', { ...q, month: i + 1 }))).then(setAll); }, [q]);
  const cur = all[q.month - 1];
  return (
    <div className="grid g12">
      <Card title="Loan & policy">
        <div className="grid" style={{ gap: 12 }}>
          <Select label="Tenure" value={String(s.tenureMonths)} set={(v) => set('tenureMonths')(Number(v))} options={[['3', '3 months'], ['6', '6 months'], ['12', '12 months']]} />
          <Select label="Region" value={s.region} set={set('region')} options={REGIONS.map((r) => [r, r.replace('_', ' ')])} />
          <Slider label="Principal" value={s.principal} set={set('principal')} min={500} max={8000} step={100} show={fmt.myr(s.principal)} />
          <Slider label="Weekly installment" value={s.installment} set={set('installment')} min={30} max={400} step={5} show={fmt.myr(s.installment)} />
          <Select label="Highlight origination month" value={String(s.month)} set={(v) => set('month')(Number(v))} options={MONTHS.map((m, i) => [String(i + 1), m])} />
        </div>
      </Card>
      <div className="grid">
        {cur && <div className="grid g4">
          <Card><div className="muted">Upfront fee ({MONTHS[q.month - 1]})</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmt.myr(cur.fee, 2)}</div><div className="muted">{cur.feePctOfPrincipal}% of principal{cur.capped ? ` · ${cur.capped} bound` : ''}</div></Card>
          <Card><div className="muted">Expected claims</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cur.expectedClaims}</div><div className="muted">max {cur.maxClaims} · liability {fmt.myr(cur.maxLiability)}</div></Card>
          <Card><div className="muted">Seasonality index</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cur.seasonalityIndex}×</div><div className="muted">1.0 = annual average</div></Card>
          <Card><div className="muted">Loadings</div><div style={{ fontSize: 24, fontWeight: 700 }}>×{cur.regionFactor}</div><div className="muted">region · Q4 ×{cur.q4Loading}</div></Card>
        </div>}
        <Card title="Fee by origination month" right="Q4 originations carry an extra loading and price into the NE monsoon">
          {all.length === 12 && <BarChart labels={MONTHS} format={(n) => 'RM' + Math.round(n)} series={[{ name: 'Fee', color: 'var(--c2)', values: all.map((a) => a.fee) }]} height={220} />}
        </Card>
        {cur && <Card title={`Weekly trigger exposure over the loan (${MONTHS[q.month - 1]} origination)`}>
          <LineChart labels={cur.weeklyExposure.map((e: any) => `w-${String(e.week).padStart(2, '0')}`)} series={[{ name: 'p(trigger week)', color: 'var(--c4)', values: cur.weeklyExposure.map((e: any) => +(e.prob * 100).toFixed(2)) }]} format={(n) => n.toFixed(1) + '%'} />
        </Card>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- underwriting */
function UnderwriteSim() {
  const [s, setS] = useState({ weeklyAvg: 950, volatility: 0.15, activeWeeks: 26, rating: 4.7, ctos: 680, ccrisArrears: 0, tenureMonths: 6, stage: 1, tenure: 14 });
  const set = <K extends keyof typeof s>(k: K) => (v: number) => setS((p) => ({ ...p, [k]: v }));
  const q = useDebounced(s);
  const [res, setRes] = useState<any>(null);
  useEffect(() => { post('/api/simulate/underwrite', q).then(setRes); }, [q]);
  const r = res?.result, o = r?.offer;
  const tone = r?.decision === 'APPROVED' ? 'ok' : r?.decision === 'REFER' ? 'warn' : 'bad';
  return (
    <div className="grid g12">
      <Card title="Applicant (trailing 6 months)">
        <div className="grid" style={{ gap: 12 }}>
          <Slider label="Avg weekly payout" value={s.weeklyAvg} set={set('weeklyAvg')} min={200} max={2500} step={25} show={fmt.myr(s.weeklyAvg)} />
          <Slider label="Income volatility" value={s.volatility} set={set('volatility')} min={0.02} max={0.6} step={0.01} show={s.volatility.toFixed(2)} />
          <Slider label="Active weeks (of 26)" value={s.activeWeeks} set={set('activeWeeks')} min={10} max={26} />
          <Slider label="Platform rating" value={s.rating} set={set('rating')} min={3.5} max={5} step={0.1} />
          <Slider label="Platform tenure" value={s.tenure} set={set('tenure')} min={2} max={36} unit=" mo" />
          <Slider label="CTOS score" value={s.ctos} set={set('ctos')} min={380} max={800} step={5} />
          <Slider label="CCRIS worst arrears" value={s.ccrisArrears} set={set('ccrisArrears')} min={0} max={6} unit=" mo" />
          <Select label="Requested tenure" value={String(s.tenureMonths)} set={(v) => set('tenureMonths')(Number(v))} options={[['3', '3 months'], ['6', '6 months'], ['12', '12 months (stage 2+)']]} />
          <Select label="Facility stage" value={String(s.stage)} set={(v) => set('stage')(Number(v))} options={[['1', '1 · Starter'], ['2', '2 · Builder'], ['3', '3 · Established'], ['4', '4 · Prime']]} />
        </div>
      </Card>
      <div className="grid">
        {r && <>
          <div className={`verdict ${tone}`}>{r.decision} {r.tier ? `· tier ${r.tier}` : ''} · alt-score {r.score.toFixed(0)}/100<div style={{ fontWeight: 400, fontSize: 12, marginTop: 4 }}>{r.reasons.join(' · ')}</div></div>
          <div className="grid g2">
            <Card title="Offer">{o ? <table><tbody>
              <tr><td>Principal</td><td className="num"><b>{fmt.myr(o.principal)}</b></td></tr><tr><td>Tenure</td><td className="num">{o.tenureMonths} months / {o.weeks} weeks</td></tr>
              <tr><td>APR</td><td className="num">{o.aprPct}%</td></tr><tr><td>Weekly installment</td><td className="num"><b>{fmt.myr(o.weeklyInstallment, 2)}</b></td></tr>
              <tr><td>Deduction (share of weekly payout)</td><td className="num">{o.deductionRatePct}%</td></tr>
              <tr><td>Weekly collection cap</td><td className="num">{o.weeklyCapPct}% of min(payout, 6m avg)</td></tr>
              <tr><td>Total repayable</td><td className="num">{fmt.myr(o.totalRepayable, 2)}</td></tr></tbody></table> : <span className="muted">No offer.</span>}</Card>
            <Card title="Earnings signals"><table><tbody>
              <tr><td>Avg weekly</td><td className="num">{fmt.myr(r.metrics.avgWeekly)}</td></tr><tr><td>Median weekly</td><td className="num">{fmt.myr(r.metrics.medianWeekly)}</td></tr>
              <tr><td>Volatility (CV)</td><td className="num">{r.metrics.cv.toFixed(2)}</td></tr><tr><td>Active-week ratio</td><td className="num">{fmt.pct(r.metrics.activeWeekRatio * 100, 0)}</td></tr>
              <tr><td>Trend (last 8w vs prior)</td><td className="num">{r.metrics.trend.toFixed(2)}×</td></tr></tbody></table></Card>
          </div>
          <Card title="Trailing 26-week payouts" right={o ? `installment ${fmt.myr(o.weeklyInstallment, 2)} · cap ${fmt.myr(o.weeklyCapPct / 100 * r.metrics.avgWeekly)}/wk` : ''}>
            <LineChart labels={res.payouts.map((_: number, i: number) => `w-${String(i + 1).padStart(2, '0')}`)} format={(n) => 'RM' + Math.round(n)}
              series={[{ name: 'Payout', color: 'var(--c1)', values: res.payouts }, ...(o ? [{ name: 'Cap', color: 'var(--c3)', values: res.payouts.map(() => (o.weeklyCapPct / 100) * r.metrics.avgWeekly) }, { name: 'Installment', color: 'var(--c4)', values: res.payouts.map(() => o.weeklyInstallment) }] : [])]} />
          </Card>
        </>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- webhook */
function WebhookSim({ partners }: { partners: { id: string; name: string; feed: string }[] }) {
  const [s, setS] = useState({ partnerId: partners[0].id, weeklyAvg: 950, volatility: 0.15, tenureMonths: 3 });
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { setRes(await post('/api/simulate/webhook', s)); } finally { setBusy(false); } };
  const r = res?.response;
  return (
    <div className="grid g12">
      <Card title="Send applicant from partner">
        <div className="grid" style={{ gap: 12 }}>
          <Select label="Partner platform" value={s.partnerId} set={(v) => setS((p) => ({ ...p, partnerId: v }))} options={partners.map((p) => [p.id, `${p.name} — ${p.feed}`])} />
          <Slider label="Avg weekly payout" value={s.weeklyAvg} set={(n) => setS((p) => ({ ...p, weeklyAvg: n }))} min={200} max={2500} step={25} show={fmt.myr(s.weeklyAvg)} />
          <Slider label="Income volatility" value={s.volatility} set={(n) => setS((p) => ({ ...p, volatility: n }))} min={0.02} max={0.6} step={0.01} />
          <Select label="Requested tenure" value={String(s.tenureMonths)} set={(v) => setS((p) => ({ ...p, tenureMonths: Number(v) }))} options={[['3', '3 months'], ['6', '6 months']]} />
          <button className="primary" onClick={send} disabled={busy}>{busy ? 'Running agents…' : 'POST signed webhook'}</button>
          <div className="muted" style={{ fontSize: 12 }}>The server builds the worker in the partner&apos;s native feed format, signs it with that partner&apos;s HMAC secret, and runs the same handler as <code>POST /api/partners/:id/applications</code>. The new application appears on the Originations page.</div>
        </div>
      </Card>
      <div className="grid">
        {res && <>
          <div className={`verdict ${r.decision === 'APPROVED' ? 'ok' : r.decision === 'REFER' ? 'warn' : 'bad'}`}>HTTP {res.http} · {res.partner} ({res.feedFormat}) · {r.status}{r.decision ? ` · ${r.decision}` : ''}{r.tier ? ` tier ${r.tier}` : ''}
            <div style={{ fontWeight: 400, fontSize: 12, marginTop: 4 }}>{(r.reasons ?? []).join(' · ')}</div></div>
          <div className="grid g2">
            <Card title="Offer + guarantee">{r.offer ? <table><tbody>
              <tr><td>Principal</td><td className="num">{fmt.myr(r.offer.principal)}</td></tr><tr><td>Weekly installment</td><td className="num">{fmt.myr(r.offer.weeklyInstallment, 2)}</td></tr>
              <tr><td>Guarantee fee (upfront)</td><td className="num"><b>{r.guarantee ? fmt.myr(r.guarantee.fee, 2) : '—'}</b></td></tr>
              <tr><td>Seasonality index</td><td className="num">{r.guarantee?.seasonalityIndex}×</td></tr>
              <tr><td>Max guarantee liability</td><td className="num">{r.guarantee ? fmt.myr(r.guarantee.maxLiability, 2) : '—'}</td></tr></tbody></table> : <span className="muted">No offer issued.</span>}</Card>
            <Card title="Agent timeline" right={<Pill tone={r.pipeline.slaBand === 'BREACH' ? 'bad' : 'ok'}>{r.pipeline.totalHours} h · {r.pipeline.slaBand}</Pill>}>
              <div className="steps" style={{ flexDirection: 'column' }}>{r.pipeline.steps.map((st: any, i: number) => <span key={i}><b>{st.step}</b> · +{(st.startMin / 60).toFixed(1)}h · took {(st.durationMin / 60).toFixed(1)}h{st.attempts > 1 ? ` · ${st.attempts} tries` : ''} — {st.note}</span>)}</div>
            </Card>
          </div>
          <Card title="Raw payload sent (truncated)"><pre>{res.sentPreview}</pre></Card>
        </>}
      </div>
    </div>
  );
}
