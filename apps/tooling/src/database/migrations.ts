import { Logger } from '@nestjs/common';
import { APP_ROLE, type Database } from './database.js';

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema with row level security',
    sql: `
do $$ begin
  if not exists (select from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} nologin;
  end if;
end $$;
grant ${APP_ROLE} to current_user;

create table requests (
  id text primary key,
  conversation_id text not null,
  user_ref text not null,
  procedure_id text not null,
  status text not null check (status in ('draft','ready','awaiting_user_validation','submitted','processing','completed','rejected','cancelled')),
  fields jsonb not null default '{}'::jsonb,
  documents jsonb not null default '{}'::jsonb,
  official_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_owner_idx on requests (user_ref, conversation_id);

create table mandates (
  id text primary key,
  challenge_id text not null unique,
  conversation_id text not null,
  user_ref text not null,
  procedure_id text not null,
  scopes text[] not null,
  status text not null check (status in ('active','revoked')),
  evidence_ref text not null,
  accepted_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index mandates_owner_idx on mandates (user_ref, conversation_id);

create table idempotency_keys (
  key_hash text primary key,
  request_digest text not null,
  response jsonb,
  created_at timestamptz not null default now()
);
create index idempotency_keys_created_idx on idempotency_keys (created_at);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  trace_id text not null,
  actor text not null,
  action text not null,
  outcome text not null check (outcome in ('success','error')),
  code text not null,
  conversation_id text,
  user_ref text,
  mandate_id text,
  request_id text
);

create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log est en ajout seul';
end $$;
create trigger audit_log_no_update before update or delete on audit_log for each row execute function audit_log_append_only();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function audit_log_append_only();

create table outbox (
  seq bigint generated always as identity primary key,
  id text not null unique,
  conversation_id text not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  published_at timestamptz,
  dead_at timestamptz,
  last_error text
);
create index outbox_pending_idx on outbox (conversation_id, seq) where published_at is null and dead_at is null;

alter table requests enable row level security;
alter table requests force row level security;
alter table mandates enable row level security;
alter table mandates force row level security;
alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;
alter table audit_log enable row level security;
alter table audit_log force row level security;
alter table outbox enable row level security;
alter table outbox force row level security;

create policy requests_owner on requests to ${APP_ROLE}
  using (user_ref = current_setting('app.user_ref', true) or current_setting('app.scope', true) = 'system')
  with check (user_ref = current_setting('app.user_ref', true) or current_setting('app.scope', true) = 'system');
create policy mandates_owner on mandates to ${APP_ROLE}
  using (user_ref = current_setting('app.user_ref', true) or current_setting('app.scope', true) = 'system')
  with check (user_ref = current_setting('app.user_ref', true) or current_setting('app.scope', true) = 'system');

create policy idempotency_service on idempotency_keys to ${APP_ROLE} using (true) with check (true);

create policy audit_insert on audit_log for insert to ${APP_ROLE} with check (true);
create policy audit_read on audit_log for select to ${APP_ROLE} using (current_setting('app.scope', true) = 'system');
create policy outbox_insert on outbox for insert to ${APP_ROLE} with check (true);
create policy outbox_system on outbox for select to ${APP_ROLE} using (current_setting('app.scope', true) = 'system');
create policy outbox_system_update on outbox for update to ${APP_ROLE}
  using (current_setting('app.scope', true) = 'system') with check (current_setting('app.scope', true) = 'system');

grant select, insert, update on requests, mandates to ${APP_ROLE};
grant select, insert, update, delete on idempotency_keys to ${APP_ROLE};
grant select, insert on audit_log to ${APP_ROLE};
grant select, insert, update on outbox to ${APP_ROLE};
grant usage on all sequences in schema public to ${APP_ROLE};
`,
  },
  {
    version: 2,
    name: 'shared rate limit counters',
    sql: `
create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket, window_start)
);
alter table rate_limits enable row level security;
alter table rate_limits force row level security;
create policy rate_limits_service on rate_limits to ${APP_ROLE} using (true) with check (true);
grant select, insert, update, delete on rate_limits to ${APP_ROLE};
`,
  },
  {
    version: 3,
    name: 'administration connector submissions',
    sql: `
alter table requests
  add column connector text,
  add column mandate_id text,
  add column external_ref text,
  add column receipt jsonb,
  add column submission_state text check (submission_state in ('queued','sent','awaiting_user','done','withdrawn','failed')),
  add column queued_at timestamptz,
  add column next_check_at timestamptz,
  add column connector_attempts integer not null default 0,
  add column connector_error text;
create index requests_connector_due_idx on requests (next_check_at) where submission_state in ('queued','sent');
`,
  },
  {
    version: 4,
    name: 'department snapshots and administrative actions',
    sql: `
alter table requests drop constraint requests_status_check;
alter table requests add constraint requests_status_check
  check (status in ('draft','ready','awaiting_user_validation','submitted','processing','completed','rejected','cancelled','blocked'));
alter table requests
  add column administration_id text,
  add column title text,
  add column processing_days integer,
  add column revision integer not null default 0,
  add column submitted_at timestamptz,
  add column due_at timestamptz,
  add column external_state jsonb,
  add column assigned_to text,
  add column information_request jsonb,
  add column issued_documents jsonb not null default '[]'::jsonb;
create index requests_administration_idx on requests (administration_id);
`,
  },
];

const MIGRATION_LOCK = 7_304_221_001;

export async function migrate(db: Database, logger = new Logger('Migrations')): Promise<number[]> {
  return db.ownerTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await tx.query('create table if not exists tooling_schema_migrations (version integer primary key, name text not null, applied_at timestamptz not null default now())');
    const done = new Set((await tx.query<{ version: number }>('select version from tooling_schema_migrations')).map((row) => row.version));
    const applied: number[] = [];
    for (const migration of MIGRATIONS) {
      if (done.has(migration.version)) continue;
      await tx.script(migration.sql);
      await tx.query('insert into tooling_schema_migrations (version, name) values ($1, $2)', [migration.version, migration.name]);
      applied.push(migration.version);
      logger.log(`Migration ${migration.version} appliquée : ${migration.name}`);
    }
    return applied;
  });
}

export async function pendingMigrations(db: Database): Promise<number> {
  return db.ownerTransaction(async (tx) => {
    const exists = await tx.query<{ ok: boolean }>("select to_regclass('tooling_schema_migrations') is not null as ok");
    if (!exists[0]?.ok) return MIGRATIONS.length;
    const rows = await tx.query<{ version: number }>('select version from tooling_schema_migrations');
    const done = new Set(rows.map((row) => row.version));
    return MIGRATIONS.filter((migration) => !done.has(migration.version)).length;
  });
}
