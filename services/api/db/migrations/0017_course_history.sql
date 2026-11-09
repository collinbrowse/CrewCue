-- Past race results per course in the split format (plan PR 4). `usage` = product (may feed
-- estimates and live ETAs) or backtest_only, set from the source at import. One row per event;
-- re-importing the same source event replaces it.
CREATE TABLE IF NOT EXISTS course_history_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  usage TEXT NOT NULL CHECK (usage IN ('product', 'backtest_only')),
  name TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (source, source_event_id)
);
CREATE INDEX IF NOT EXISTS course_history_events_by_usage ON course_history_events (usage);
