-- Add recovery key support for cross-device identity restore
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_key_hash TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS recovery_key_created_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_recovery_key_hash ON users(recovery_key_hash);
