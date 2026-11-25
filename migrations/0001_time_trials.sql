CREATE TABLE time_trials (
  id INTEGER PRIMARY KEY,
  track_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lap_ms INTEGER NOT NULL,
  ghost TEXT NOT NULL,
  UNIQUE (track_id, driver_id)
);

CREATE INDEX time_trials_ranking ON time_trials (track_id, lap_ms, id);
