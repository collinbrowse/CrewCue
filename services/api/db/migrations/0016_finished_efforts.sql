-- One row per race room whose runner crossed the finish: plan accuracy, stop times and measured
-- slowdown, for calibrating the projection on CrewCue's own races (first-party data).
CREATE TABLE IF NOT EXISTS finished_efforts (
  room_id TEXT PRIMARY KEY,
  athlete_user_id TEXT NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS finished_efforts_by_athlete ON finished_efforts (athlete_user_id);
