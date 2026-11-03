CREATE TABLE backend_agent_checkpoints (
  conversation_id text NOT NULL,
  message_id text NOT NULL,
  state jsonb NOT NULL,
  PRIMARY KEY(conversation_id,message_id)
);
