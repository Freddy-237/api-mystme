-- ============================================
-- MystMe — Migration 008 : media type audio/file
-- ============================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_media_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_media_type_check
  CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'audio', 'file'));
