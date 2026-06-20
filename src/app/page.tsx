import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold tracking-tight">NetWarden</h1>
      <p className="text-muted-foreground text-lg">Foundations scaffold — app skeleton is live.</p>
      <Link
        href="/autotest"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Open AutoTest
      </Link>
    </main>
  );
}
