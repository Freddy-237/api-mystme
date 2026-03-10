CREATE INDEX IF NOT EXISTS idx_subscriptions_store_purchase_token
  ON subscriptions(store, purchase_token)
  WHERE purchase_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_unlocks_store_purchase_token
  ON conversation_unlocks(store, purchase_token)
  WHERE purchase_token IS NOT NULL;