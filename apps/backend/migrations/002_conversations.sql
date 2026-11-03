ALTER TABLE backend_configurations DROP CONSTRAINT backend_configurations_resource_check;
ALTER TABLE backend_configurations ADD CHECK (resource IN ('models','tools','procedures'));

CREATE TABLE backend_identities (
  identity_hash text PRIMARY KEY,
  user_ref text NOT NULL UNIQUE
);
CREATE TABLE backend_conversations (
  id text PRIMARY KEY,
  user_ref text NOT NULL,
  administration_id text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backend_conversations_owner ON backend_conversations (user_ref);
CREATE TABLE backend_messages (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  id text NOT NULL,
  fingerprint text NOT NULL,
  body jsonb NOT NULL,
  traceparent text NOT NULL,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id,id)
);
CREATE INDEX backend_pending_messages ON backend_messages(seq) WHERE processed_at IS NULL;
CREATE TABLE backend_conversation_events (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text NOT NULL UNIQUE,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  body jsonb NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '48 hours',
  PRIMARY KEY (conversation_id,seq)
);
CREATE TABLE backend_ingested_events (
  id text PRIMARY KEY,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backend_requests (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  user_ref text NOT NULL,
  body jsonb NOT NULL,
  last_event_at timestamptz NOT NULL
);
CREATE TABLE backend_mandates (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  user_ref text NOT NULL,
  body jsonb NOT NULL
);
CREATE TABLE backend_challenges (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  body jsonb NOT NULL,
  evidence jsonb,
  consumed_at timestamptz
);
CREATE TABLE backend_socket_tickets (
  digest text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  expires_at timestamptz NOT NULL
);
