-- WS6 team command center metric selection (JSON document per team).
CREATE TABLE IF NOT EXISTS team_command_metric_configs_json (
  team_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
