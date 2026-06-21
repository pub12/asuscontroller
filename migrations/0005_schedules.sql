-- 0005_schedules.sql
-- Timers & schedules: add display label and recurring-window grouping to app_schedules.
--
-- New columns:
--   label     TEXT — human-readable display name for the schedule (e.g. "Bedtime").
--   window_id TEXT — groups the two rows of a recurring window together:
--                    a block-cron row and an unblock-cron row share one window_id.
--
-- App-layer conventions (no DDL required):
--   status ∈ { active, paused, done, cancelled }  (extended at the application layer)
--   kind is derived: cron IS NOT NULL → recurring; run_at IS NOT NULL → one-shot

ALTER TABLE app_schedules ADD COLUMN label TEXT;
ALTER TABLE app_schedules ADD COLUMN window_id TEXT;
