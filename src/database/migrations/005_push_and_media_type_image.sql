-- ============================================
-- MystMe — Migration 005 : push token + image media type
-- ============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_updated_at TIMESTAMP;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_media_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_media_type_check
  CHECK (media_type IS NULL OR media_type IN ('image', 'video'));
