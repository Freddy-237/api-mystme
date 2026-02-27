-- ============================================
-- MystMe — Migration 002 : real-time features
-- ============================================

-- messages: read receipt
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read     BOOLEAN   DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at     TIMESTAMP;

-- users: moderation / ban
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned      BOOLEAN   DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at      TIMESTAMP;

-- reports: review status
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status       VARCHAR(20) DEFAULT 'pending'
  CHECK (status IN ('pending', 'reviewed', 'dismissed'));

-- conversations: allow 'expired' status
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('active', 'blocked', 'archived', 'expired'));

-- Performance indexes for unread queries
CREATE INDEX IF NOT EXISTS idx_messages_is_read      ON messages(conversation_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created_desc ON messages(conversation_id, created_at DESC);
