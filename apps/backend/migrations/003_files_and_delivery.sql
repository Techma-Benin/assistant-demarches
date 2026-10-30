CREATE TABLE backend_files (
  id text PRIMARY KEY,
  user_ref text NOT NULL,
  object_key text NOT NULL,
  body jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE backend_socket_tickets ADD token_expires_at timestamptz;
UPDATE backend_socket_tickets SET token_expires_at=expires_at;
ALTER TABLE backend_socket_tickets ALTER token_expires_at SET NOT NULL;
ALTER TABLE backend_conversation_events ADD callback_delivered_at timestamptz;
ALTER TABLE backend_conversation_events ADD callback_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE backend_conversation_events ADD callback_next_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE backend_conversation_events ADD callback_failed boolean NOT NULL DEFAULT false;
CREATE TABLE backend_tool_results (
  conversation_id text NOT NULL,
  operation_key text NOT NULL,
  tool_name text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id,operation_key)
);
