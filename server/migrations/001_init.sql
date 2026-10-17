-- Unfog initial schema. Requires PostgreSQL 13+ (gen_random_uuid is built in).
-- Privacy rule: no raw GPS coordinates are ever stored. Location exists only as hex cell ids
-- with day-level granularity.

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  username        text UNIQUE,
  display_name    text,
  city_id         text NOT NULL DEFAULT 'blr',
  crew_id         uuid,
  crew_joined_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE otp_codes (
  email              text PRIMARY KEY,
  code_hash          bytea NOT NULL,
  expires_at         timestamptz NOT NULL,
  attempts           int NOT NULL DEFAULT 0,
  sends_in_window    int NOT NULL DEFAULT 1,
  window_started_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  color        text NOT NULL,
  invite_code  text NOT NULL UNIQUE,
  owner_id     uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_crew_fk FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE SET NULL;
CREATE INDEX users_crew_idx ON users(crew_id);

-- One row per user per cell ever visited.
CREATE TABLE user_cells (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell             text NOT NULL,
  city_id          text,
  neighbourhood_id text,
  first_day        date NOT NULL,
  last_day         date NOT NULL,
  visit_days       int NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, cell)
);
CREATE INDEX user_cells_city_idx ON user_cells(user_id, city_id, first_day);

-- Distinct cells revealed per user per day (all places, inside or outside cities).
CREATE TABLE user_days (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  cell_days  int NOT NULL DEFAULT 0,
  new_cells  int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Cells explored per user per neighbourhood, kept in step with user_cells.
CREATE TABLE user_neighbourhoods (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id          text NOT NULL,
  neighbourhood_id text NOT NULL,
  cells            int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, city_id, neighbourhood_id)
);
CREATE INDEX user_neighbourhoods_nb_idx ON user_neighbourhoods(city_id, neighbourhood_id);

-- Presence per user per neighbourhood per day. Drives territory, titles and challenges.
CREATE TABLE neighbourhood_days (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id          text NOT NULL,
  neighbourhood_id text NOT NULL,
  day              date NOT NULL,
  cell_days        int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, city_id, neighbourhood_id, day)
);
CREATE INDEX neighbourhood_days_city_day_idx ON neighbourhood_days(city_id, day);

-- First user to explore LIMITS.pioneerFraction of a neighbourhood. Freed if they delete their account.
CREATE TABLE neighbourhood_pioneers (
  city_id          text NOT NULL,
  neighbourhood_id text NOT NULL,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achieved_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, neighbourhood_id)
);
CREATE INDEX neighbourhood_pioneers_user_idx ON neighbourhood_pioneers(user_id);

CREATE TABLE drops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell             text NOT NULL,
  city_id          text,
  neighbourhood_id text,
  title            text NOT NULL,
  note             text,
  kind             text NOT NULL CHECK (kind IN ('community', 'venue', 'quest')),
  sponsor          text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  starts_at        timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,
  hidden           boolean NOT NULL DEFAULT false,
  report_count     int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drops_cell_idx ON drops(cell);
CREATE INDEX drops_city_idx ON drops(city_id) WHERE NOT hidden;
CREATE INDEX drops_creator_idx ON drops(created_by, created_at);

CREATE TABLE drop_finds (
  drop_id   uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  found_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id, user_id)
);
CREATE INDEX drop_finds_user_idx ON drop_finds(user_id, found_at);

CREATE TABLE drop_reports (
  drop_id    uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id, user_id)
);

-- Campus and company "city wars".
CREATE TABLE challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  city_id     text NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE challenge_teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text NOT NULL,
  join_code     text NOT NULL UNIQUE
);
CREATE INDEX challenge_teams_challenge_idx ON challenge_teams(challenge_id);

CREATE TABLE challenge_members (
  challenge_id  uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES challenge_teams(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX challenge_members_team_idx ON challenge_members(team_id);
CREATE INDEX challenge_members_user_idx ON challenge_members(user_id);
