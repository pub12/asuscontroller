# NetWarden — Stitch design prompt

Prompt used with Google Stitch (Mobile mode) to generate the screens in `screens/`.

```
App: NetWarden — a mobile-first home network control app for a household admin to
monitor and control devices on a home Wi-Fi router (ASUS ZenWiFi).

Global style:
- Platform: mobile (iOS/Android), portrait, one-handed use, large touch targets.
- Modern, clean, slightly technical "control panel" feel. Generous whitespace.
- Light theme with a dark-mode-friendly palette: deep indigo/blue primary, teal
  accent, neutral grays. Status colors: green = online, gray = offline, red = blocked.
- Rounded cards, subtle shadows, pill-shaped status chips, clear iconography.
- Persistent bottom navigation bar with 4 items: Explore · Schedules · Analytics · Admin.

Design these 5 screens:

1. EXPLORE (home)
A segmented toggle at top: "Groups | Devices". In Groups view, a 2-column card grid;
each card shows a circular group/person photo, group name, "X of Y online" count, a
block-status chip, and a "Block all" button. Include a search bar and a floating "+"
to add a group. Bottom nav with Explore active.

2. DEVICE DETAIL
Header with device name, icon, and online/blocked status chip. A prominent
"Block internet" toggle with a "Set timer / schedule" link. Below: a "Top domains"
list (domain name + query count bars), a "Recent activity" timeline, and a small
"Time on device today" stat. A collapsible "Audit history" section at the bottom.

3. BLOCK-WITH-TIMER MODAL
A bottom-sheet modal over the device screen. Title "Block internet". Quick-pick chips:
15m, 30m, 1h, 2h, Custom. A toggle row for "Until a specific time" (with time picker)
and "Recurring schedule" (with day-of-week selector and start/end times). Primary
"Block now" button, secondary "Cancel".

4. ANALYTICS
A date-range selector at top. A trend line/bar chart of estimated active time. Below,
a ranked list of top domains showing both "est. active time" and "query count" (label
the time clearly as an estimate). A toggle to switch between per-device and per-group
views. Clean data-viz styling.

5. ADMIN (superadmin only)
Tabs or sections for "Users", "Pending requests", and "Grants". Pending requests show
the user, the requested capability (e.g. device.block) and optional group scope, with
"Approve" and "Decline" buttons. Grants list shows active capabilities per user with a
"Revoke" action and a scope badge (Global or a group name).
```

## Refinement notes for the next Stitch pass
Based on the review (`stitch-screens-review.md`), tighten the prompt to keep designs inside v1 scope:

- Analytics: **do not** show "packet inspection" / DPI language — NetWarden only sees DNS/SNI destination domains. Use "DNS query volume" / "telemetry coverage" instead, and label per-domain time as an estimate.
- Device detail & Create Group: **no content/category filtering** ("Safety Engine", "adult content", "None/Standard/Strict"). v1 blocking is internet on/off only.
- Admin: capabilities are limited to `device.block/unblock`, `group.block/unblock`, `schedule.create/cancel` — no `network.reboot`.
- Still to generate: Login, Schedules list, Settings, Group detail, Admin Users/Grants tabs.
