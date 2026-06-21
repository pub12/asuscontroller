-- 0004_groups_permissions.sql
-- Additive indexes for groups/permissions tables that already exist in 0001_init.sql.
-- Idempotent: uses CREATE INDEX IF NOT EXISTS throughout. No tables are altered or recreated.
--
-- Status conventions:
--   app_user_grants.status  ∈ { active, revoked }
--   app_access_requests.status ∈ { pending, approved, declined }

-- ── app_group_members: reverse lookup by device_id ───────────────────────────
-- The PK is already (group_id, device_id); this covers queries in the other direction
-- (all groups a device belongs to).
CREATE INDEX IF NOT EXISTS idx_app_group_members_device
  ON app_group_members (device_id);

-- ── app_user_grants: lookup by subject (user/identity) ───────────────────────
CREATE INDEX IF NOT EXISTS idx_app_user_grants_subject
  ON app_user_grants (subject);

-- ── app_access_requests: filter by status (pending / approved / declined) ────
CREATE INDEX IF NOT EXISTS idx_app_access_requests_status
  ON app_access_requests (status);

-- ── app_access_requests: lookup by subject ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_app_access_requests_subject
  ON app_access_requests (subject);
