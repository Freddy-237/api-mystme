-- ============================================
-- Per-user archive/delete (each participant manages their own visibility)
-- ============================================

-- Allow 'deleted' status in the global check
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('active', 'blocked', 'archived', 'deleted'));

-- Track per-user visibility (soft-delete / archive per participant)
CREATE TABLE IF NOT EXISTS conversation_user_status (
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived', 'deleted')),
  updated_at        TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conv_user_status_user ON conversation_user_status(user_id);
