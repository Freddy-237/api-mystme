-- Phase 2: Optional email OTP linkage for cross-device recovery
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique_lower
  ON users ((LOWER(email)))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity_email_otps (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_email_otps_user_email
  ON identity_email_otps (user_id, LOWER(email), created_at DESC);
