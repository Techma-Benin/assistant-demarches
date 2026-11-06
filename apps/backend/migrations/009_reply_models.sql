-- Which model produced each assistant reply, and how the reply came out.
-- One row per message.sent, written in the same transaction as the reply itself.
CREATE TABLE backend_reply_models (
  conversation_id text NOT NULL,
  reply_message_id text NOT NULL,
  input_message_id text NOT NULL,
  administration_id text NOT NULL,
  -- model: written by the model; fallback: the model was asked but no usable answer came out;
  -- error: processing was abandoned after its attempts; system: no model involved.
  origin text NOT NULL CHECK (origin IN ('model', 'fallback', 'error', 'system')),
  config_id text,
  provider text,
  model text,
  protocol text,
  -- For fallback and error: reason code, upstream HTTP status and attempts (no prompt, no provider text).
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, reply_message_id)
);
CREATE INDEX backend_reply_models_created ON backend_reply_models (created_at DESC);
CREATE INDEX backend_reply_models_model ON backend_reply_models (model, created_at DESC);
