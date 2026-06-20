-- 0001_init.sql — NetWarden full schema (PRD §8). Idempotent.

CREATE TABLE IF NOT EXISTS app_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT,
  image_file_id TEXT,
  color TEXT,
  created_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS app_devices (
  id TEXT PRIMARY KEY,
  mac TEXT NOT NULL UNIQUE,
  hostname TEXT,
  friendly_name TEXT,
  vendor TEXT,
  icon TEXT,
  notes TEXT,
  current_ip TEXT,
  last_band TEXT,
  status TEXT,
  is_new INTEGER DEFAULT 1,
  first_seen TEXT,
  last_seen TEXT,
  primary_group_id TEXT REFERENCES app_groups(id)
);

CREATE TABLE IF NOT EXISTS app_group_members (
  group_id TEXT NOT NULL REFERENCES app_groups(id),
  device_id TEXT NOT NULL REFERENCES app_devices(id),
  added_by TEXT,
  added_at TEXT,
  PRIMARY KEY (group_id, device_id)
);

CREATE TABLE IF NOT EXISTS app_block_state (
  device_id TEXT PRIMARY KEY REFERENCES app_devices(id),
  is_blocked INTEGER DEFAULT 0,
  blocked_by TEXT,
  blocked_at TEXT,
  reason TEXT,
  scheduled_unblock_at TEXT,
  unblock_job_id TEXT,
  router_synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_schedules (
  id TEXT PRIMARY KEY,
  target_type TEXT,
  target_id TEXT,
  action TEXT,
  run_at TEXT,
  cron TEXT,
  job_id TEXT,
  status TEXT,
  created_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS app_user_grants (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope_type TEXT,
  scope_id TEXT,
  status TEXT,
  granted_by TEXT,
  granted_at TEXT,
  UNIQUE (subject, capability, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS app_access_requests (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope_type TEXT,
  scope_id TEXT,
  note TEXT,
  status TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS app_domain_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_domain_events_dev_domain_ts ON app_domain_events (device_id, domain, ts);

CREATE TABLE IF NOT EXISTS app_domain_rollup_daily (
  device_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  day TEXT NOT NULL,
  query_count INTEGER DEFAULT 0,
  first_seen TEXT,
  last_seen TEXT,
  est_active_minutes INTEGER DEFAULT 0,
  PRIMARY KEY (device_id, domain, day)
);

CREATE TABLE IF NOT EXISTS app_device_presence (
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,
  connected_minutes INTEGER DEFAULT 0,
  PRIMARY KEY (device_id, day)
);
