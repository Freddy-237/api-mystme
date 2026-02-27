-- ============================================
-- MystMe — Migration 003 : bio + deleted status
-- ============================================

-- users: optional bio field
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';

-- conversations: allow 'deleted' status
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('active', 'blocked', 'archived', 'expired', 'deleted'));
