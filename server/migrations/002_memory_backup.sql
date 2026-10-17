-- End-to-end encrypted memory backups. The server stores bytes it cannot decrypt:
-- the key comes from a recovery code that never leaves the user's devices.
CREATE TABLE memory_backups (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blob        bytea NOT NULL,
  size_bytes  int NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
