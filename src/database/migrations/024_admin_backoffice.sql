-- ============================================
-- 024 — Back-office: admin accounts, sessions, audit log
-- ============================================
-- Admins are a separate population from app users: they never share an id,
-- a token or a cookie with the anonymous identities.

CREATE TABLE IF NOT EXISTS admin_users (
  id                    UUID PRIMARY KEY,
  email                 VARCHAR(254) NOT NULL,
  display_name          VARCHAR(100) NOT NULL,
  role                  VARCHAR(20)  NOT NULL CHECK (role IN ('owner', 'moderator', 'support')),
  password_hash         TEXT         NOT NULL,
  must_change_password  BOOLEAN      NOT NULL DEFAULT TRUE,
  -- TOTP secrets are stored encrypted (AES-256-GCM), never in clear.
  totp_secret_enc       TEXT,
  totp_pending_enc      TEXT,
  totp_last_step        BIGINT,
  is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_login_count    INTEGER      NOT NULL DEFAULT 0,
  locked_until          TIMESTAMP,
  last_login_at         TIMESTAMP,
  created_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_admin_users_email ON admin_users (LOWER(email));

CREATE TABLE IF NOT EXISTS admin_sessions (
  id            UUID PRIMARY KEY,
  admin_id      UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMP NOT NULL,
  revoked_at    TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_admin_sessions_token ON admin_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions (admin_id);

-- Append-only: who did what, when. Rows can be added, never changed or removed.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  admin_id     UUID,
  admin_email  VARCHAR(254),
  action       VARCHAR(64) NOT NULL,
  target_type  VARCHAR(32),
  target_id    TEXT,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip           TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log (admin_id, created_at DESC);

CREATE OR REPLACE FUNCTION admin_audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_audit_log_append_only ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_is_append_only();

-- Track which admin banned an account (the ban itself stays on users).
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by TEXT;
