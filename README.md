# DarylWeb

Household network control for ASUS routers — device presence, blocking, timers/schedules, and domain telemetry.

## Running locally

DarylWeb runs as **two processes**. Both must be running for the app to work fully.

```bash
# Terminal 1 — Next.js web app (UI + API)
npm run dev

# Terminal 2 — background worker (REQUIRED for timers, schedules, unblocks, sync, ingest)
npm run worker
```

> The worker is a standalone process by design (see DECISIONS.md · D2). `npm run dev`
> starts **only** the web app — it does **not** start the worker.

> **Provider parity:** the worker loads `.env.local` (same as Next) and follows
> `ROUTER_PROVIDER`. With `ROUTER_PROVIDER=asus` it drives the **same real router**
> as the web app, so scheduled unblocks/blocks, sync and reconcile actually take
> effect. With `fake` it uses the in-process fake (shared with the web via
> `.fake-router-state.json`). If the worker ran a different provider than the web,
> deferred jobs would target a different router than the one that applied the block.

### Why the worker matters (gotcha)

Mutations split across the two processes:

- **Blocking is applied synchronously on the API request** → a manual/timer block works
  even if the worker is down.
- **Auto-unblocks, scheduled block/unblock windows, sync, ingest, and retention are
  deferred jobs** drained only by the worker.

So if the worker isn't running, you'll see a device **block successfully but never
auto-unblock** — the unblock job sits in `hazo_jobs` with `status=scheduled` and no
consumer. Starting the worker drains overdue jobs and fires them late (DECISIONS.md ·
D12 fire-late policy), so a stuck unblock clears as soon as `npm run worker` comes up.

## Docs

- `master_plan.md` — phase plan + trade-off ledger
- `DECISIONS.md` — architecture decisions (D1–D17)
- `CHANGELOG.md` — what shipped, by date
