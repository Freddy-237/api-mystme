-- Anonymity fix.
-- Migration 021 froze conversations.anonymous_alias to the anonymous user's
-- GLOBAL pseudo. For an app user that pseudo is public (shown on their own
-- link), so the link owner could recognise who was writing to them.
--
-- From now on app users get a random alias per conversation (see
-- conversation.repository.js). This re-aliases the existing conversations.
-- Web (PWA) identities keep their alias: their pseudo is a throwaway one that
-- is never shown anywhere else.
WITH fresh AS (
  SELECT c.id,
         (ARRAY['Silent','Mystic','Hidden','Cosmic','Shadow','Secret','Frozen','Dark',
                'Lost','Wild','Neon','Crystal','Phantom','Stellar','Velvet'])[1 + floor(random() * 15)::int]
         || (ARRAY['Fox','Raven','Echo','Wolf','Ghost','Storm','Flame','Moon',
                   'Star','Night','Spark','Frost','Dream','Shade','Wing'])[1 + floor(random() * 15)::int]
         || '_' || ((1000 + floor(random() * 9000))::int)::text AS alias
    FROM conversations c
    JOIN users u ON u.id = c.anonymous_id
   WHERE u.origin = 'app'
)
UPDATE conversations c
   SET anonymous_alias = fresh.alias,
       anonymous_avatar_url = 'https://api.dicebear.com/7.x/bottts/svg?seed=' || fresh.alias
  FROM fresh
 WHERE c.id = fresh.id;
