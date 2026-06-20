# NetWarden — Stitch tweak prompts (per screen)

How to use: Stitch edits one screen at a time. For each section below, **open/select the
screen described in "Which image"**, then paste the prompt in the code block into Stitch's
edit box. Work top to bottom.

---

## 1. Explore — Groups
**Which image:** The home screen titled "NetWarden" with the "Groups | Devices" toggle and a 2-column grid of circular cards (Kids, Guest, IoT Hub, Media), each with a "Block all" button and a green "+" floating button.

```
Keep this layout. Minor polish only:
- On each group card, move the block-status chip (e.g. "BLOCKED") to the top-right corner
  of the card as a small pill, instead of below the online count.
- Add a tiny online-count dot color: green when all members online, gray when some offline.
- Make the "Block all" button on a currently-blocked group read "Unblock all" instead.
```

---

## 2. Create Group
**Which image:** The "Create Group" form with a dashed circle photo uploader, a "Group Name" field, a "Filtering Defaults: None / Standard / Strict" segmented control, and an "Add Members" checklist.

```
Remove the "Filtering Defaults" section entirely (None/Standard/Strict) — this app does not
do content filtering.
Replace it with two in-scope fields:
- "Group type" segmented control: Person | Generic.
- "Color" row: a horizontal swatch picker (6 color dots) for the group's accent color.
Keep the photo uploader, group name field, and the Add Members checklist as they are.
Keep the primary "Create Group" button at the bottom.
```

---

## 3. Device detail
**Which image:** The screen titled "Oliver's iPad" with an "Access Active" toggle, "Time on device today 2h 45m", a "Top Domains (Last 24h)" list with progress bars, a "Recent Activity" timeline, and a collapsible "Audit history" row.

```
Change the "Recent Activity" timeline so the events are about internet access only — this app
blocks internet on/off, it does not filter content. Replace the three events with:
- "Internet blocked — scheduled 'Morning Study'"  (time 08:00)
- "Device connected — Living Room (Wi-Fi 6)"      (time 12:05)
- "Unblocked by Mom"                               (time 14:22)
Remove any "Safety Engine" / "adult content" / content-filtering wording anywhere on the screen.
Keep the Access toggle, Time on device, Top Domains, and Audit history sections unchanged.
```

---

## 4. Block-with-timer modal
**Which image:** The bottom-sheet modal titled "Block internet" with quick-pick chips (15m, 30m, 1h, 2h, Custom), "Until a specific time" and "Recurring schedule" toggle rows, and a green "Block now" button.

```
Keep this layout. Small additions:
- When "Until a specific time" is toggled on, show a time picker row beneath it.
- When "Recurring schedule" is toggled on, show a day-of-week selector (S M T W T F S pills)
  and a Start time / End time row beneath it.
- Show a small helper line under the title: "Access resumes automatically when the timer ends."
```

---

## 5. Analytics
**Which image:** The screen titled "Network Insights" with a "Last 7 Days" date selector, an "Active Time 42h 15m" bar chart, a Per-device/Per-group toggle, a "Top Domains" list, and a dark "Packet Inspection Status" panel at the bottom showing "1.2 TB Data Processed / 99.9% Accuracy Rating".

```
Remove the dark "Packet Inspection Status" panel (1.2 TB / 99.9% accuracy) at the bottom —
this app does NOT do packet inspection; it only sees DNS/destination-domain data.
Replace it with a dark "Telemetry Coverage" panel showing two stats:
- "Devices reporting" (e.g. 18 of 21)
- "Queries logged (7d)" (e.g. 142k)
In the Top Domains list, label the time values as estimates: show "~12h 45m (est.)" and keep
the query count as the exact number. Add a small note under the "Top Domains" header:
"Active time is estimated from DNS query patterns."
Keep the date selector, bar chart, and Per-device/Per-group toggle as they are.
```

---

## 6. Admin — Pending requests
**Which image:** The "NetWarden" admin screen with tabs "Users / Pending requests (2) / Grants", showing request cards for "Mom" (device.block) and "Brother Bob" (network.reboot), each with green "Approve" and red "Decline" buttons.

```
Change "Brother Bob"'s requested capability from "network.reboot" to "group.block", and change
its scope tag from "Entertainment" to "Media" — this app's capabilities are only
device.block, device.unblock, group.block, group.unblock, schedule.create, schedule.cancel.
Keep "Mom" requesting "device.block" with the "Kids" scope.
Keep the tabs, the Approve/Decline buttons, and the overall layout unchanged.
```
