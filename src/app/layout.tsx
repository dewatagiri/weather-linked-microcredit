import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = { title: 'Gig-Rain Console', description: 'Embedded gig-worker financing + parametric weather guarantee — operations & risk dashboard' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="side">
            <div className="brand">Gig-Rain Console<small>Embedded financing · Weather guarantee</small></div>
            <Nav />
            <div className="foot">Reference prototype · simulated data · MYR</div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
