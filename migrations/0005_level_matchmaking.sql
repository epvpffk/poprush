CREATE TABLE IF NOT EXISTS player_progress (
 user TEXT PRIMARY KEY NOT NULL,
 xp INTEGER NOT NULL DEFAULT 0,
 updated INTEGER NOT NULL
);
INSERT OR IGNORE INTO player_progress(user,xp,updated)
SELECT p.id,
 COALESCE((SELECT SUM(CAST(r.score / 500 AS INTEGER)) FROM results r WHERE r.user=p.id),0)+
 COALESCE((SELECT SUM(CAST(a.score / 500 AS INTEGER)) FROM (SELECT room,user,MAX(score) AS score FROM ai_results GROUP BY room,user) a WHERE a.user=p.id),0),
 CAST(strftime('%s','now') AS INTEGER)*1000
FROM profiles p;
CREATE TABLE IF NOT EXISTS matchmaking_queue (
 user TEXT PRIMARY KEY NOT NULL,
 ticket TEXT UNIQUE NOT NULL,
 level INTEGER NOT NULL,
 joined INTEGER NOT NULL,
 seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matchmaking_queue_joined ON matchmaking_queue(joined);
CREATE TABLE IF NOT EXISTS matchmaking_matches (
 user TEXT PRIMARY KEY NOT NULL,
 room TEXT NOT NULL,
 created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matchmaking_matches_created ON matchmaking_matches(created);
