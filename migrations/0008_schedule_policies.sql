-- 0008_schedule_policies.sql
-- Declarative recurring block/unblock schedules ("policies") + manual-override hold.
--
-- A policy is a per-target (device|group) set of weekly transition rules. The
-- worker reconcile computes the desired state from these rules each poll. A
-- manual block/unblock stamps app_block_state.override_until so the manual state
-- is honored until the next scheduled transition, then the policy resumes.
--
-- Weekday convention: 0=Mon .. 6=Sun. time_min: 0..1439 local minutes past midnight.

CREATE TABLE IF NOT EXISTS app_schedule_policies (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,                       -- 'device' | 'group'
  target_id   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  tz          TEXT NOT NULL DEFAULT 'Australia/Melbourne',
  label       TEXT,
  created_by  TEXT,
  created_at  TEXT,
  updated_at  TEXT,
  UNIQUE (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS app_schedule_rules (
  id        TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES app_schedule_policies(id),
  weekday   INTEGER NOT NULL,                      -- 0=Mon .. 6=Sun
  time_min  INTEGER NOT NULL,                      -- 0..1439
  action    TEXT NOT NULL                          -- 'block' | 'unblock'
);
CREATE INDEX IF NOT EXISTS idx_schedule_rules_policy ON app_schedule_rules (policy_id);

-- Manual-override expiry instant (ISO-8601). NULL = no active override.
ALTER TABLE app_block_state ADD COLUMN override_until TEXT;
