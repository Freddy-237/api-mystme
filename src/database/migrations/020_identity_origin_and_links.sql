-- ============================================
-- 020 — Identity origin (web vs app), conversation start, one active link
-- ============================================

-- 1. Where an identity was created. Existing users are treated as app users
--    so nobody already in production gets locked retroactively.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS origin VARCHAR(10) NOT NULL DEFAULT 'app';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_origin_check;
ALTER TABLE users
  ADD CONSTRAINT users_origin_check CHECK (origin IN ('web', 'app'));

-- End of the 7-day write window for web identities (NULL for app users).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS web_expires_at TIMESTAMP;

-- 2. A conversation "starts" with its first message, not when the link is
--    opened (started_at had DEFAULT NOW(), so the first-message logic never ran).
ALTER TABLE conversations ALTER COLUMN started_at DROP DEFAULT;

-- 3. One active link per owner. Keep the newest active link (the one the app
--    displays and shares), deactivate older duplicates created by races.
UPDATE links l
   SET is_active = FALSE
 WHERE l.is_active = TRUE
   AND EXISTS (
     SELECT 1
       FROM links n
      WHERE n.owner_id = l.owner_id
        AND n.is_active = TRUE
        AND (n.created_at > l.created_at
             OR (n.created_at = l.created_at AND n.id > l.id))
   );

CREATE UNIQUE INDEX IF NOT EXISTS ux_links_one_active_per_owner
  ON links (owner_id)
  WHERE is_active = TRUE;
