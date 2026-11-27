-- Room code lookups that found no room, per account (or signed-out address),
-- in fixed one-hour windows (see src/lib/joinCodeBudget.ts). Shared by every API instance.
-- Old windows are deleted as new ones are counted.
CREATE TABLE IF NOT EXISTS join_code_failures (
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  failures INT NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS join_code_failures_by_window ON join_code_failures (window_start);
