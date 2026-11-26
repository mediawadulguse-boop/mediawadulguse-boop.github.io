BEGIN;
CREATE TABLE IF NOT EXISTS mwg_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  profile jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mwg_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES mwg_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mwg_sessions_expiry ON mwg_sessions(expires_at);
CREATE TABLE IF NOT EXISTS mwg_records (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object' AND data ? 'id' AND data->>'id'=id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(collection,id)
);
CREATE INDEX IF NOT EXISTS mwg_records_brief ON mwg_records(collection,(data->>'brief_id'));
CREATE INDEX IF NOT EXISTS mwg_records_date ON mwg_records(collection,(data->>'tanggal'));
CREATE INDEX IF NOT EXISTS mwg_records_assignee ON mwg_records(collection,(data->>'petugas_id'));
CREATE INDEX IF NOT EXISTS mwg_records_link ON mwg_records(collection,(data->>'link_id'));
CREATE TABLE IF NOT EXISTS mwg_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mwg_changes (
  sequence bigserial PRIMARY KEY,
  collection text NOT NULL,
  id text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('UPSERT','DELETE','REFRESH')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mwg_changes_collection ON mwg_changes(collection,sequence);
CREATE TABLE IF NOT EXISTS mwg_requests (
  user_id text NOT NULL,
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);
CREATE TABLE IF NOT EXISTS mwg_jobs (
  id text PRIMARY KEY,
  kind text NOT NULL,
  record_id text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mwg_jobs_ready ON mwg_jobs(state,available_at);
CREATE TABLE IF NOT EXISTS mwg_login_attempts (
  bucket text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
COMMIT;
