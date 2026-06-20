import { resolveServerAuth } from '@/server/auth';

export default async function SettingsPage() {
  const { isSuperadmin } = await resolveServerAuth();

  if (!isSuperadmin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-4xl font-bold text-red-600">403</span>
        <h1 className="text-xl font-semibold text-gray-900">Superadmin only</h1>
        <p className="text-sm text-gray-500">
          You do not have permission to view this page.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-900">Settings</h1>

      <div className="space-y-6">
        <section className="rounded-lg border border-gray-200 p-4">
          <h2 className="mb-2 text-base font-medium text-gray-800">Router</h2>
          <dl className="space-y-1 text-sm text-gray-500">
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700">Host:</dt>
              <dd>configured via .env / staged spike</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700">User:</dt>
              <dd>configured via .env / staged spike</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-gray-200 p-4">
          <h2 className="mb-2 text-base font-medium text-gray-800">Telemetry</h2>
          <p className="text-sm text-gray-500">Provider undecided — NextDNS preferred.</p>
        </section>

        <section className="rounded-lg border border-gray-200 p-4">
          <h2 className="mb-2 text-base font-medium text-gray-800">Polling</h2>
          <p className="text-sm text-gray-500">Polling interval — placeholder from app config.</p>
        </section>
      </div>
    </main>
  );
}
