-- Reports survive the deletion of what they point at.
--
-- Before: deleting a conversation (account deletion, purge) cascaded to its
-- reports, so a reported user could erase the evidence against them by
-- deleting their account. Now each report keeps, from the moment it is filed:
--   * who is reported and the two participants (plain ids, no foreign key);
--   * the anonymous alias of the conversation;
--   * `evidence`: a snapshot of the reported message and its context.
-- The links to conversations / messages / reporter become ON DELETE SET NULL.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20),
  ADD COLUMN IF NOT EXISTS reported_user_id UUID,
  ADD COLUMN IF NOT EXISTS owner_id UUID,
  ADD COLUMN IF NOT EXISTS anonymous_id UUID,
  ADD COLUMN IF NOT EXISTS anonymous_alias VARCHAR(255),
  ADD COLUMN IF NOT EXISTS evidence JSONB;

UPDATE reports r
   SET kind = CASE WHEN r.message_id IS NULL THEN 'conversation' ELSE 'message' END
 WHERE r.kind IS NULL;

UPDATE reports r
   SET owner_id = s.owner_id,
       anonymous_id = s.anonymous_id,
       anonymous_alias = s.anonymous_alias,
       reported_user_id = s.reported_user_id
  FROM (
    SELECT r2.id, c.owner_id, c.anonymous_id, c.anonymous_alias,
           COALESCE(
             m.sender_id,
             CASE WHEN c.owner_id = r2.reported_by THEN c.anonymous_id
                  WHEN c.anonymous_id = r2.reported_by THEN c.owner_id END
           ) AS reported_user_id
      FROM reports r2
      JOIN conversations c ON c.id = r2.conversation_id
      LEFT JOIN messages m ON m.id = r2.message_id
  ) s
 WHERE s.id = r.id AND r.owner_id IS NULL;

ALTER TABLE reports ALTER COLUMN kind SET NOT NULL;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
ALTER TABLE reports ADD CONSTRAINT reports_kind_check CHECK (kind IN ('message', 'conversation'));

ALTER TABLE reports ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN reported_by DROP NOT NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_conversation_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_by_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reported_by_fkey
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL;

-- The old "one conversation report per reporter" index was keyed on
-- message_id IS NULL, which also matched message reports whose message had
-- been deleted (SET NULL) and made such deletions fail. Key it on `kind`.
DROP INDEX IF EXISTS ux_reports_conversation_reported_by;
CREATE UNIQUE INDEX IF NOT EXISTS ux_reports_conversation_reported_by
  ON reports (conversation_id, reported_by)
  WHERE kind = 'conversation';

CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports (reported_user_id);

-- Redundant indexes (each duplicates a unique index or a wider index).
DROP INDEX IF EXISTS idx_links_code;
DROP INDEX IF EXISTS idx_messages_conversation;
DROP INDEX IF EXISTS idx_users_recovery_key_hash;
DROP INDEX IF EXISTS idx_subscriptions_store_purchase_token;
DROP INDEX IF EXISTS idx_conversation_unlocks_store_purchase_token;
