-- ============================================
-- MystMe — Migration 004 : media messages
-- ============================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_messages_media_type
  ON messages(media_type)
  WHERE media_type IS NOT NULL;
