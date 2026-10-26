CREATE TABLE backend_configurations (
  administration_id text NOT NULL,
  resource text NOT NULL CHECK (resource IN ('models', 'tools')),
  resource_id text NOT NULL,
  body jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (administration_id, resource, resource_id)
);

CREATE TABLE backend_idempotency (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);
CREATE INDEX backend_idempotency_expiry ON backend_idempotency (expires_at);

-- Local delivery outbox, not the authoritative Tooling business audit.
CREATE TABLE backend_outbox (
  id text PRIMARY KEY,
  administration_id text NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
