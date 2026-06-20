import Link from 'next/link';

export default function AdminPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Admin</h1>
      <p className="text-sm text-gray-500">User &amp; role management — coming in Phase 9.</p>
      <Link
        href="/settings"
        className="mt-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Settings (Superadmin)
      </Link>
    </main>
  );
}
