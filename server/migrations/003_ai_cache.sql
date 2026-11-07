-- Cached AI output (block stories, daily quests, crew coach, crew paper, card captions).
-- Only game data and public place data go in here, never private memory. Rows tied to a user
-- or crew disappear with them.
CREATE TABLE ai_cache (
  key         text PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  crew_id     uuid REFERENCES crews(id) ON DELETE CASCADE,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_cache_created_idx ON ai_cache(created_at);
