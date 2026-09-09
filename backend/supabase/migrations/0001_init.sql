-- atElbow control plane.
--
-- Three rules are enforced here rather than in application code, because application code is
-- where access rules go to rot:
--   1. Provider API keys are never readable by any client, at any role. Only the proxy
--      function, running as service_role, can decrypt them.
--   2. Members can see their own usage. Only admins can see cost, anyone else's usage, or
--      org-wide totals.
--   3. Nothing in this schema can hold page content. There is deliberately no column for it.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Orgs and membership
-- ---------------------------------------------------------------------------

create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  created_at  timestamptz not null default now()
);

create type member_role as enum ('admin', 'member');

create table org_members (
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        member_role not null default 'member',

  -- Spend caps in USD. NULL means "no cap of this kind", which is different from 0
  -- ("blocked"), and the proxy treats them differently.
  daily_limit_usd    numeric(10,4) check (daily_limit_usd >= 0),
  monthly_limit_usd  numeric(10,4) check (monthly_limit_usd >= 0),

  -- Suspends access without destroying the usage history behind it.
  disabled    boolean not null default false,

  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  primary key (org_id, user_id)
);

create index org_members_user_idx on org_members(user_id);

-- ---------------------------------------------------------------------------
-- Provider keys
--
-- Stored as ciphertext produced by the edge function (AES-GCM, key from the
-- PROVIDER_KEY_SECRET env var). The database never sees plaintext, and no client role is
-- granted select — see the RLS section, where this table gets no permissive policy at all.
-- ---------------------------------------------------------------------------

create table provider_keys (
  org_id       uuid not null references orgs(id) on delete cascade,
  provider     text not null check (provider in
                 ('anthropic','openai','gemini','grok','deepseek','kimi')),
  ciphertext   text not null,
  iv           text not null,
  -- Last four characters of the real key, so admins can tell which key is installed
  -- without the console ever handling the secret.
  hint         text not null,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),

  primary key (org_id, provider)
);

-- ---------------------------------------------------------------------------
-- Usage
--
-- One row per model call. Note what is absent: no prompt, no completion, no page text, no
-- URL. `app_host` is the bare hostname (e.g. "my.salesforce.com") because admins need to know
-- which tools their people are struggling with, and that is answerable from a hostname alone.
-- ---------------------------------------------------------------------------

create table usage_events (
  id             bigserial primary key,
  org_id         uuid not null references orgs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null,
  model          text not null,
  input_tokens   integer not null default 0 check (input_tokens >= 0),
  output_tokens  integer not null default 0 check (output_tokens >= 0),
  cost_usd       numeric(12,6) not null default 0 check (cost_usd >= 0),
  app_host       text,
  ok             boolean not null default true,
  created_at     timestamptz not null default now()
);

create index usage_org_time_idx  on usage_events(org_id, created_at desc);
create index usage_user_time_idx on usage_events(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
--
-- security definer so they can read org_members from inside a policy on org_members without
-- recursing through that same policy.
-- ---------------------------------------------------------------------------

create or replace function is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = target_org and user_id = auth.uid() and not disabled
  );
$$;

create or replace function is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = target_org and user_id = auth.uid()
      and role = 'admin' and not disabled
  );
$$;

-- Email → user id, for adding people by the identifier an admin actually knows. Callable only
-- by service_role: exposing it to clients would turn it into an account-existence oracle.
create or replace function user_id_by_email(target_email text)
returns uuid language sql stable security definer set search_path = auth as $$
  select id from auth.users where lower(email) = lower(target_email) limit 1;
$$;

revoke all on function user_id_by_email(text) from public, anon, authenticated;

-- Spend so far, used by the proxy to decide whether a call is allowed. Kept in SQL so the
-- limit and the number it is compared against can never drift apart.
create or replace function spend_today(target_org uuid, target_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from usage_events
  where org_id = target_org and user_id = target_user
    and created_at >= date_trunc('day', now());
$$;

create or replace function spend_this_month(target_org uuid, target_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from usage_events
  where org_id = target_org and user_id = target_user
    and created_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table orgs           enable row level security;
alter table org_members    enable row level security;
alter table provider_keys  enable row level security;
alter table usage_events   enable row level security;

-- Orgs: visible to members, renamable only by admins.
create policy orgs_read on orgs
  for select using (is_org_member(id));
create policy orgs_update on orgs
  for update using (is_org_admin(id)) with check (is_org_admin(id));

-- Membership: you can always see your own row. Admins see and manage everyone's.
create policy members_read_self on org_members
  for select using (user_id = auth.uid());
create policy members_read_admin on org_members
  for select using (is_org_admin(org_id));
create policy members_write_admin on org_members
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- Provider keys: no policy is created on purpose, so RLS denies every client role.
-- service_role bypasses RLS, which is how the proxy — and only the proxy — reads them.
-- Admins manage keys through the set-key function, never by touching this table.

-- Usage: a member may read their own rows; admins may read the whole org.
-- Nobody may write directly — rows come only from the proxy under service_role, so usage
-- cannot be forged to hide spend.
create policy usage_read_self on usage_events
  for select using (user_id = auth.uid());
create policy usage_read_admin on usage_events
  for select using (is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- Views
--
-- Cost separation lives here. `my_usage` is what a member sees: their own activity, with no
-- money in it at all. `admin_usage` carries cost and is restricted to admins by the security
-- barrier plus the underlying RLS.
-- ---------------------------------------------------------------------------

create view my_usage with (security_barrier) as
  select created_at, provider, model, app_host, ok
  from usage_events
  where user_id = auth.uid();

create view admin_usage with (security_barrier) as
  select e.id, e.org_id, e.user_id, u.email, e.created_at, e.provider, e.model,
         e.input_tokens, e.output_tokens, e.cost_usd, e.app_host, e.ok
  from usage_events e
  join auth.users u on u.id = e.user_id
  where is_org_admin(e.org_id);

-- Per-member rollup for the console's main table: who is using it, how much it costs, and
-- how close they are to the cap the admin set.
create view admin_member_summary with (security_barrier) as
  select m.org_id,
         m.user_id,
         u.email,
         m.role,
         m.disabled,
         m.daily_limit_usd,
         m.monthly_limit_usd,
         spend_today(m.org_id, m.user_id)      as spend_today_usd,
         spend_this_month(m.org_id, m.user_id) as spend_month_usd,
         (select count(*) from usage_events e
           where e.org_id = m.org_id and e.user_id = m.user_id
             and e.created_at >= date_trunc('month', now()))      as requests_month,
         (select max(e.created_at) from usage_events e
           where e.org_id = m.org_id and e.user_id = m.user_id)   as last_seen
  from org_members m
  join auth.users u on u.id = m.user_id
  where is_org_admin(m.org_id);

revoke all on my_usage, admin_usage, admin_member_summary from anon;
grant select on my_usage, admin_usage, admin_member_summary to authenticated;
