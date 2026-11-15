import { getStore } from '@/server/store';
import { borrowerRows } from '@/server/metrics';
import { BorrowerTable } from '@/components/BorrowerTable';

export const dynamic = 'force-dynamic';

export default async function Borrowers() {
  const rows = borrowerRows(await getStore());
  return (
    <>
      <h1>Borrowers &amp; graduation</h1>
      <p className="sub">Each loan&apos;s progress against graduation rules: fully repaid · ≥90% on-time (weather-guaranteed weeks are neutral) · worst DPD ≤7 · refreshed score clears the next stage.</p>
      <BorrowerTable rows={JSON.parse(JSON.stringify(rows))} />
    </>
  );
}
