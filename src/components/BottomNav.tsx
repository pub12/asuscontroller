'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, Calendar, BarChart2, ShieldCheck } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/explore', label: 'Explore', Icon: Compass },
  { href: '/schedules', label: 'Schedules', Icon: Calendar },
  { href: '/analytics', label: 'Analytics', Icon: BarChart2 },
  { href: '/admin', label: 'Admin', Icon: ShieldCheck },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card">
      <div className="mx-auto flex max-w-md items-center justify-around">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs font-medium transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon
                size={22}
                strokeWidth={active ? 2.5 : 1.8}
                className={active ? 'text-primary' : 'text-muted-foreground'}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
