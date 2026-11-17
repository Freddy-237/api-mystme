-- ============================================
-- 019 — Email OTP hardening
--   * failed_attempts: lock a code after too many wrong guesses (anti brute-force)
--   * purpose: separate "link email" codes from "restore account" codes
-- ============================================

ALTER TABLE identity_email_otps
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;

ALTER TABLE identity_email_otps
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'link';

ALTER TABLE identity_email_otps
  DROP CONSTRAINT IF EXISTS identity_email_otps_purpose_check;

ALTER TABLE identity_email_otps
  ADD CONSTRAINT identity_email_otps_purpose_check
  CHECK (purpose IN ('link', 'restore'));

CREATE INDEX IF NOT EXISTS idx_identity_email_otps_email_purpose
  ON identity_email_otps (LOWER(email), purpose, created_at DESC);
