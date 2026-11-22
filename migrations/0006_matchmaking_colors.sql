ALTER TABLE matchmaking_queue ADD COLUMN colors INTEGER NOT NULL DEFAULT 4;
CREATE INDEX IF NOT EXISTS matchmaking_queue_colors_joined ON matchmaking_queue(colors,joined);
