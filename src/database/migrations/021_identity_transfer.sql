-- ============================================
-- 021 — PWA → app identity transfer
-- ============================================

-- 1. One-time transfer codes issued to a web identity. Only the hash is stored.
CREATE TABLE IF NOT EXISTS identity_transfer_tokens (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  expires_at    TIMESTAMP NOT NULL,
  consumed_at   TIMESTAMP,
  consumed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_transfer_tokens_code_hash
  ON identity_transfer_tokens (code_hash);

CREATE INDEX IF NOT EXISTS idx_identity_transfer_tokens_user
  ON identity_transfer_tokens (user_id, created_at DESC);

-- 2. A merged web identity points to the app identity that absorbed it.
--    Its sessions are refused from then on.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS merged_into_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP;

-- 3. The anonymous side's name/avatar is frozen per conversation, so it does
--    not change when the identity is transferred or renamed later.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS anonymous_alias VARCHAR(100);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS anonymous_avatar_url TEXT;

UPDATE conversations c
   SET anonymous_alias = u.pseudo,
       anonymous_avatar_url = u.avatar_url
  FROM users u
 WHERE u.id = c.anonymous_id
   AND c.anonymous_alias IS NULL;
