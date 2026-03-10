CREATE TABLE IF NOT EXISTS distributed_rate_limits (
  scope         TEXT NOT NULL,
  identifier    TEXT NOT NULL,
  bucket_start  TIMESTAMPTZ NOT NULL,
  hits          INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, identifier, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_distributed_rate_limits_updated_at
  ON distributed_rate_limits(updated_at);