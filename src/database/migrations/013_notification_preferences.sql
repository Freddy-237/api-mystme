-- ============================================
-- MystMe — Migration 013 : notification preferences
-- ============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;