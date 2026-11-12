WITH ranked_conversation_reports AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id, reported_by
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM reports
  WHERE message_id IS NULL
)
DELETE FROM reports r
USING ranked_conversation_reports ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

WITH ranked_message_reports AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY message_id, reported_by
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM reports
  WHERE message_id IS NOT NULL
)
DELETE FROM reports r
USING ranked_message_reports ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_reports_conversation_reported_by
  ON reports(conversation_id, reported_by)
  WHERE message_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_reports_message_reported_by
  ON reports(message_id, reported_by)
  WHERE message_id IS NOT NULL;