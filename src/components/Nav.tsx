'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'Overview'], ['/pipeline', 'Originations & SLA'], ['/borrowers', 'Borrowers & graduation'],
  ['/simulator', 'Simulators'], ['/pd', 'PD pipeline'],
];
export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={path === href ? 'active' : ''} aria-current={path === href ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
