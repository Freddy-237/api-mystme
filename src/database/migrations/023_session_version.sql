-- Revocable sessions. Every JWT carries the session_version it was issued
-- for; bumping the column (logout) invalidates all tokens issued before.
-- Tokens issued before this migration carry no version and count as 0.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
