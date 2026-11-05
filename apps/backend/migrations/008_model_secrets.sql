CREATE TABLE backend_secrets (
  administration_id text NOT NULL,
  resource text NOT NULL,
  resource_id text NOT NULL,
  ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (administration_id, resource, resource_id)
);
