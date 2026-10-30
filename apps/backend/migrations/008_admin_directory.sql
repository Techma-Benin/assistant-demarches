-- Local demonstration adapter for the administrative directory. OIDC remains
-- authoritative for identity; this adapter owns only profiles and assignments.
-- No dependency on, or direct SQL access to, the Tooling database.
CREATE TABLE backend_departments (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backend_admin_users (
  subject text PRIMARY KEY,
  display_name text NOT NULL,
  email text,
  photo_url text,
  active boolean NOT NULL DEFAULT true,
  super_admin boolean NOT NULL DEFAULT false,
  -- Technical operations are separately provisioned, never granted by a business
  -- department role or editable through the directory HTTP API.
  operator_permissions text[] NOT NULL DEFAULT '{}' CHECK (operator_permissions <@ ARRAY['operator:read','operator:write']::text[]),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backend_admin_memberships (
  subject text NOT NULL REFERENCES backend_admin_users(subject),
  department_id text NOT NULL REFERENCES backend_departments(id),
  role text NOT NULL CHECK (role IN ('agent','admin')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (subject, department_id)
);
CREATE INDEX backend_admin_memberships_department
  ON backend_admin_memberships (department_id, subject);
CREATE TABLE backend_admin_directory_audit (
  id text PRIMARY KEY,
  actor_subject text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  department_ids text[] NOT NULL,
  traceparent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
