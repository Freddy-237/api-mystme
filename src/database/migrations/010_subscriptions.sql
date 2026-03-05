-- ============================================
-- 010 — Subscriptions & single-unlocks for IAP
-- ============================================

-- User tier column (free by default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'free';

-- Subscriptions table (Apple / Google receipts)
CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id      VARCHAR(100) NOT NULL,       -- e.g. 'mystme_premium_monthly'
  store           VARCHAR(20)  NOT NULL,        -- 'apple' | 'google'
  purchase_token  TEXT,                          -- store-specific receipt / token
  status          VARCHAR(20)  DEFAULT 'active', -- active | expired | cancelled
  started_at      TIMESTAMP    DEFAULT NOW(),
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP    DEFAULT NOW(),
  updated_at      TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Single conversation unlocks (consumable IAP)
CREATE TABLE IF NOT EXISTS conversation_unlocks (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  product_id        VARCHAR(100) NOT NULL,       -- e.g. 'mystme_unlock_single'
  store             VARCHAR(20)  NOT NULL,
  purchase_token    TEXT,
  created_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);
