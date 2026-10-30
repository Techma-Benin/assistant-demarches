CREATE TABLE backend_work_items (
  id text PRIMARY KEY,
  administration_id text NOT NULL,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  user_ref text NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  body jsonb NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backend_work_department ON backend_work_items(administration_id,(body->>'status'),id);
CREATE TABLE backend_department_events (
  id text PRIMARY KEY,
  fingerprint text NOT NULL,
  administration_id text NOT NULL,
  request_id text NOT NULL,
  revision bigint NOT NULL,
  actor_ref text,
  action text NOT NULL,
  outcome text NOT NULL,
  trace_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backend_department_activity ON backend_department_events(administration_id,id);
CREATE TABLE backend_unanswered (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES backend_conversations(id),
  message_id text NOT NULL,
  administration_id text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(conversation_id,message_id,reason)
);

-- A durable record survives an RPC timeout even when the projection transaction rolls back.
-- Retrying this stable key asks Tooling for its original idempotent result.
CREATE TABLE backend_admin_command_attempts (
  command_key text PRIMARY KEY,
  fingerprint text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
