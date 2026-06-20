# NetWarden — Stitch Screen Designs (Review & Catalog)

**Source:** Google Stitch (mobile mode), generated from the prompt in `stitch-prompt.md`.
**Date captured:** 2026-06-20
**Style observed:** light theme, deep-indigo headings, teal/green primary actions, pill status chips, rounded cards, bottom nav (Explore · Schedules · Analytics · Admin). Matches the PRD's intended look.

> Drop the exported PNGs into `design/screens/` using the filenames in the table below.

---

## Screen catalog

| # | File | Screen | Maps to PRD §10 | Notes |
|---|------|--------|-----------------|-------|
| 1 | `01-explore-groups.png` | Explore — Groups tab | §10.2 | Groups/Devices toggle, search, 2-col card grid (Kids/Guest/IoT Hub/Media), per-card "Block all", BLOCKED chip, FAB "+". On-brand. |
| 2 | `02-create-group.png` | Create Group | §10.3 (group CRUD) / §7.3 | Photo upload, name, member multi-select. ⚠️ "Filtering Defaults: None/Standard/Strict" is out of v1 scope (see conflicts). |
| 3 | `03-device-detail.png` | Device detail — "Oliver's iPad" | §10.4 | Access toggle, time-on-device, top domains (query bars), recent activity timeline, collapsible Audit history. ⚠️ "Blocked adult content / Safety Engine" out of v1 scope. |
| 4 | `04-block-timer-modal.png` | Block-with-timer modal | §10.5 | Bottom sheet, quick-pick chips (15m/30m/1h/2h/Custom), "Until a specific time" + "Recurring schedule" toggles, Block now / Cancel. Matches PRD well. |
| 5 | `05-analytics.png` | Analytics — Network Insights | §10.7 | Date range, active-time bar chart, Per-device/Per-group toggle, Top Domains list (time + queries). ⚠️ "Packet Inspection Status" panel contradicts a PRD Non-Goal; active-time not labeled as estimate. |
| 6 | `06-admin-pending-requests.png` | Admin — Pending requests | §10.8 | Tabs (Users/Pending/Grants), request cards with capability + group scope, Approve/Decline. ⚠️ shows `network.reboot` capability not in PRD. |

*(Two duplicate captures of the Analytics and Explore screens were supplied; only one of each is catalogued.)*

---

## ⚠️ Design ↔ PRD scope conflicts to resolve

These screens introduce capabilities the PRD explicitly excludes from v1. Decide per item: **(a) fix the design to match v1 scope**, or **(b) expand the PRD scope** (and move the relevant item out of "future").

1. **"Packet Inspection Status — 1.2 TB Data Processed, 99.9% Accuracy" (Analytics, #5).**
   Directly contradicts PRD §2 Non-Goal: *"Deep-packet inspection, full-URL capture, or TLS interception. Not done — by design."* NetWarden only sees destination domains via DNS/SNI.
   → **Recommend:** remove this panel or relabel as "DNS query volume" / "Telemetry coverage". Do not imply DPI.

2. **"Blocked adult content — Filtered via Safety Engine" (Device detail, #3).**
   Content/category filtering is not in v1 — v1 blocking is internet-access on/off only (§2, §7.4). Category filtering is the router's own AiProtection, which the PRD explicitly does *not* replace.
   → **Recommend:** change the timeline event to an in-scope one (e.g. "Internet blocked — scheduled 'Bedtime'" or "Unblocked by Mom").

3. **"Filtering Defaults: None / Standard / Strict" (Create Group, #2).**
   Same as above — per-group content filtering is out of v1 scope.
   → **Recommend:** replace with in-scope group fields from §7.3: `type` (person/generic), colour, and (future) a per-group "monitoring on/off" flag.

4. **`network.reboot` capability (Admin, #6).**
   Not in the PRD capability set (§8 `app_user_grants`: `device.block/unblock`, `group.block/unblock`, `schedule.create/cancel`). Router reboot isn't a modelled action.
   → **Recommend:** swap for an in-scope capability (e.g. `group.block`), or add `router.reboot` to the PRD if you want it.

5. **Active-time shown as a hard number, unlabeled (Analytics #5, Device #3).**
   PRD §7.6 requires per-domain time to be presented **explicitly as an estimate** (sessionisation model), alongside the hard `query_count`. Per-device *presence* time (e.g. "Time on device 2h 45m") is genuine and can stay as-is.
   → **Recommend:** label per-domain durations "~12h 45m (est.)" with a tooltip explaining sessionisation; keep query counts as the hard metric.

---

## On-scope, looks good (no change needed)
- Explore / Groups (#1): toggle, cards, Block-all, FAB — matches §7.7.
- Block-with-timer modal (#4): quick picks + until-time + recurring — matches §7.4.
- Admin request/approve flow shape (#6): matches §7.1 (aside from the one capability name).
- Bottom nav (Explore · Schedules · Analytics · Admin) — matches §7.7. (Note: no Schedules screen was generated yet — still needed per §10.6.)

## Still to design
- **Login** (§10.1) — hazo_auth.
- **Schedules** list (§10.6) — active/upcoming one-shot + recurring, edit/cancel.
- **Settings (superadmin)** (§10.9) — router connection, telemetry provider, intervals.
- **Group detail** (§10.3) — image, members, Block-all, group analytics/schedules.
- **Admin: Users & Grants tabs** (only Pending requests was captured).
