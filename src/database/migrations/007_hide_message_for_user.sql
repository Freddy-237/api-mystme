-- ============================================
-- MystMe — Migration 007 : hide message for current user
-- ============================================

CREATE TABLE IF NOT EXISTS hidden_messages (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  hidden_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_hidden_messages_user
  ON hidden_messages(user_id);

CREATE INDEX IF NOT EXISTS idx_hidden_messages_message
  ON hidden_messages(message_id);
