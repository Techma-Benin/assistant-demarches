ALTER TABLE backend_identities ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE TABLE IF NOT EXISTS backend_unanswered (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  message_id text NOT NULL,
  administration_id text,
  theme text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (conversation_id, message_id, reason)
);

CREATE TABLE IF NOT EXISTS backend_avatars (
  official_id text PRIMARY KEY,
  file_id text NOT NULL
);
