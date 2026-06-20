-- 0002_rate_limit.sql — hazo_api rate-limiting table. Idempotent.

CREATE TABLE IF NOT EXISTS hazo_api_rate_limits (
  bucket_key  TEXT    PRIMARY KEY,
  tokens      REAL    NOT NULL,
  capacity    REAL    NOT NULL,
  refill_rate REAL    NOT NULL,
  updated_at  TEXT    NOT NULL
);
