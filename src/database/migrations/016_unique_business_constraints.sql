-- ============================================
-- 016 — Enforce unique business keys
-- ============================================

-- 1. Conversations must be unique per link + anonymous participant.
-- If legacy duplicates exist, fold child rows into the earliest conversation.
WITH ranked_conversations AS (
  SELECT
    id,
    link_id,
    anonymous_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM conversations
  WHERE anonymous_id IS NOT NULL
), duplicates AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked_conversations
  WHERE rn > 1
)
UPDATE messages m
SET conversation_id = d.keep_id
FROM duplicates d
WHERE m.conversation_id = d.duplicate_id;

WITH ranked_conversations AS (
  SELECT
    id,
    link_id,
    anonymous_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM conversations
  WHERE anonymous_id IS NOT NULL
), duplicates AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked_conversations
  WHERE rn > 1
)
DELETE FROM conversation_user_status cus
USING duplicates d
WHERE cus.conversation_id = d.duplicate_id;

WITH ranked_conversations AS (
  SELECT
    id,
    link_id,
    anonymous_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM conversations
  WHERE anonymous_id IS NOT NULL
), duplicates AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked_conversations
  WHERE rn > 1
)
DELETE FROM trust_status ts
USING duplicates d
WHERE ts.conversation_id = d.duplicate_id;

WITH ranked_conversations AS (
  SELECT
    id,
    link_id,
    anonymous_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM conversations
  WHERE anonymous_id IS NOT NULL
), duplicates AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked_conversations
  WHERE rn > 1
)
DELETE FROM reports r
USING duplicates d
WHERE r.conversation_id = d.duplicate_id;

WITH ranked_conversations AS (
  SELECT
    id,
    link_id,
    anonymous_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY link_id, anonymous_id
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM conversations
  WHERE anonymous_id IS NOT NULL
)
DELETE FROM conversations c
USING ranked_conversations rc
WHERE c.id = rc.id
  AND rc.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_conversations_link_anonymous
  ON conversations(link_id, anonymous_id)
  WHERE anonymous_id IS NOT NULL;

-- 2. Purchase tokens must be unique per store when present.
WITH ranked_subscriptions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store, purchase_token
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM subscriptions
  WHERE purchase_token IS NOT NULL
)
DELETE FROM subscriptions s
USING ranked_subscriptions rs
WHERE s.id = rs.id
  AND rs.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_subscriptions_store_purchase_token
  ON subscriptions(store, purchase_token)
  WHERE purchase_token IS NOT NULL;

WITH ranked_unlocks AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store, purchase_token
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM conversation_unlocks
  WHERE purchase_token IS NOT NULL
)
DELETE FROM conversation_unlocks cu
USING ranked_unlocks ru
WHERE cu.id = ru.id
  AND ru.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_conversation_unlocks_store_purchase_token
  ON conversation_unlocks(store, purchase_token)
  WHERE purchase_token IS NOT NULL;