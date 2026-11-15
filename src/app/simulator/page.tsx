import { PARTNERS } from '@/engine';
import { Simulators } from '@/components/Simulators';

export default function SimulatorPage() {
  return (
    <>
      <h1>Simulators</h1>
      <p className="sub">Exercise the real engine code: weather trigger evaluation, seasonality pricing, alt-credit underwriting and the signed partner webhook.</p>
      <Simulators partners={PARTNERS.map((p) => ({ id: p.id, name: p.name, feed: p.feedFormat }))} />
    </>
  );
}
