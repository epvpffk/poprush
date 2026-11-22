CREATE TABLE IF NOT EXISTS community_posts (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('notice','feedback')),
 author_id TEXT NOT NULL,
 author_name TEXT NOT NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_posts_kind_created ON community_posts(kind,created DESC,id DESC);
