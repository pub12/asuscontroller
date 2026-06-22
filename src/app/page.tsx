import Link from 'next/link';
import Image from 'next/image';
import { ProfilePicMenu } from 'hazo_auth/components/layouts/shared';
import { resolveServerAuth } from '@/server/auth';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function HomePage() {
  const { authenticated } = await resolveServerAuth();

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-brand-lavender tracking-tight">DarylWeb</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {authenticated ? (
            <ProfilePicMenu />
          ) : (
            <Link
              href="/login"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-16 space-y-10">
        {/* Hero illustration */}
        <div className="overflow-hidden rounded-2xl border border-border shadow-2xl">
          <Image
            src="/hero.jpg"
            alt="DarylWeb dashboard"
            width={1200}
            height={600}
            className="w-full object-cover"
            priority
          />
        </div>

        {/* Status pill */}
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            System Status: Active
          </span>
        </div>

        {/* Headline */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold tracking-tight">
            Your home network,{' '}
            <span className="italic font-semibold text-brand-gradient">under control.</span>
          </h1>

          {/* Subtext */}
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Professional-grade management for your digital household. Monitor, secure, and optimize every connection.
          </p>
        </div>

        {/* CTAs */}
        <div className="flex justify-center gap-4">
          <Link
            href={authenticated ? '/explore' : '/login'}
            className="rounded-xl bg-primary text-primary-foreground px-8 py-3 text-base font-semibold hover:bg-primary/90 transition-colors shadow"
          >
            Open Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
