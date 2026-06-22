'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Shield } from 'lucide-react';
import { ProfilePicMenu } from 'hazo_auth/components/layouts/shared';
import { ThemeToggle } from '@/components/ThemeToggle';

export function TopNav() {
  return (
    <nav className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
      <div className="relative flex items-center justify-between px-4 sm:px-6 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-foreground hover:text-foreground/80">
          <Shield className="h-5 w-5 text-primary" />
          DarylWeb
        </Link>
        {/* Cropped section of the landing hero image, centered in the navbar */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 h-9 w-64 overflow-hidden rounded-lg border border-border sm:block lg:w-96">
          <Image
            src="/hero.jpg"
            alt=""
            width={768}
            height={72}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <ProfilePicMenu />
        </div>
      </div>
    </nav>
  );
}
