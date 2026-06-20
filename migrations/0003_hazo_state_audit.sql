-- 0003_hazo_state_audit.sql
-- Registers the canonical SQLite DDL for hazo_state (hazo_app_state) and
-- hazo_audit (outbox/field/intent). These packages ship mixed-dialect migration
-- dirs (Postgres active, SQLite commented/variant); their own docs say to use the
-- SQLite DDL when running on SQLite. Transcribed verbatim here so the app's normal
-- runMigrations flow (seed.mjs + schema-test) creates them. Idempotent.

-- ── hazo_state: hazo_app_state ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hazo_app_state (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT,
  user_id     TEXT,
  state_key   TEXT NOT NULL,
  value       TEXT,
  protected   INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hazo_app_state_unique
  ON hazo_app_state (COALESCE(scope_id, ''), COALESCE(user_id, ''), state_key);

CREATE INDEX IF NOT EXISTS idx_hazo_app_state_expires
  ON hazo_app_state (expires_at)
  WHERE expires_at IS NOT NULL;

-- ── hazo_audit: outbox / field / intent ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS hazo_audit_outbox (
  id              TEXT PRIMARY KEY,
  scope_id        TEXT,
  correlation_id  TEXT NOT NULL,
  table_name      TEXT NOT NULL,
  subject_kind    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  op              TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  before_row      TEXT,
  after_row       TEXT,
  actor_kind      TEXT NOT NULL,
  actor_user_id   TEXT,
  actor_label     TEXT,
  intent_event    TEXT,
  intent_payload  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  drained_at      TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  failed_at       TEXT,
  failure_reason  TEXT
);

CREATE INDEX IF NOT EXISTS ix_hazo_audit_outbox_drain
  ON hazo_audit_outbox (drained_at, failed_at, attempt_count, last_attempt_at);

CREATE INDEX IF NOT EXISTS ix_hazo_audit_outbox_chain
  ON hazo_audit_outbox (subject_kind, subject_id, created_at);

CREATE TABLE IF NOT EXISTS hazo_audit_field (
  id              TEXT PRIMARY KEY,
  scope_id        TEXT,
  correlation_id  TEXT NOT NULL,
  subject_kind    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  field_path      TEXT NOT NULL,
  op              TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  before_value    TEXT,
  after_value     TEXT,
  is_sensitive    INTEGER NOT NULL DEFAULT 0,
  actor_kind      TEXT NOT NULL,
  actor_user_id   TEXT,
  actor_label     TEXT,
  occurred_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_hazo_audit_field_subject
  ON hazo_audit_field (subject_kind, subject_id, field_path, occurred_at);

CREATE TABLE IF NOT EXISTS hazo_audit_intent (
  id              TEXT PRIMARY KEY,
  scope_id        TEXT,
  correlation_id  TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  payload         TEXT,
  subject_kind    TEXT,
  subject_id      TEXT,
  actor_kind      TEXT NOT NULL,
  actor_user_id   TEXT,
  actor_label     TEXT,
  occurred_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_hazo_audit_intent_event
  ON hazo_audit_intent (event_name, occurred_at);
