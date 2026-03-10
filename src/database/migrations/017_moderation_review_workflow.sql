ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
  ON reports(status, created_at DESC);