-- 0006_telemetry_blocked_and_monitoring.sql
-- Telemetry display columns: per-device blocked-DNS tracking and group monitoring flag.
--
-- New columns:
--   blocked           INTEGER DEFAULT 0 — marks whether a DNS query was blocked
--                     by the filter. Enables the per-device drill-down to surface
--                     blocked attempts. Matches the `blocked` field on DomainEvent.
--   monitoring_enabled INTEGER DEFAULT 1 — privacy flag on app_groups.
--                     Default 1 (on) preserves current behaviour for all existing
--                     groups. When set to 0, telemetry display is suppressed at
--                     read time only — no data is deleted and ingestion continues.

ALTER TABLE app_domain_events ADD COLUMN blocked INTEGER DEFAULT 0;
ALTER TABLE app_groups ADD COLUMN monitoring_enabled INTEGER DEFAULT 1;
