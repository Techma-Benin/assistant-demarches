import { Logger } from '@nestjs/common';
import { APP_ROLE, type Database } from './database.js';

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 10,
    name: 'contract v2 schema with row level security',
    sql: `
drop table if exists requests, mandates, idempotency_keys, outbox, rate_limits cascade;
drop table if exists audit_log cascade;
drop function if exists audit_log_append_only() cascade;

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
  title text not null,
  administration_id text not null,
  status text not null check (status in ('draft','ready','submitted','cancelled')),
  filing jsonb not null,
  fields jsonb not null,
  documents jsonb not null,
  case_id text unique,
  channel text check (channel in ('web','whatsapp')),
  case_state text,
  tracking_done boolean not null default false,
  next_check_at timestamptz,
  check_attempts integer not null default 0,
  tracking_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_owner_idx on requests (user_ref, conversation_id);
create index requests_tracking_due_idx on requests (next_check_at) where case_id is not null and not tracking_done;

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
  traceparent text not null,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  published_at timestamptz,
  dead_at timestamptz,
  last_error text
);
create index outbox_pending_idx on outbox (conversation_id, seq) where published_at is null and dead_at is null;

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket, window_start)
);

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
alter table rate_limits enable row level security;
alter table rate_limits force row level security;

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
create policy rate_limits_service on rate_limits to ${APP_ROLE} using (true) with check (true);

grant select, insert, update on requests, mandates to ${APP_ROLE};
grant select, insert, update, delete on idempotency_keys, rate_limits to ${APP_ROLE};
grant select, insert on audit_log to ${APP_ROLE};
grant select, insert, update on outbox to ${APP_ROLE};
grant usage on all sequences in schema public to ${APP_ROLE};
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
