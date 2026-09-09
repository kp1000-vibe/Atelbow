# atElbow control plane

The backend that makes an admin's spend cap an actual cap.

Everything an admin controls — the org's API keys, who has access, per-person limits, and who
sees cost — is enforced here, on the server, before any model call happens. None of it can be
undone by editing the extension, because none of it lives in the extension.

## What's here

```
backend/supabase/
  migrations/0001_init.sql        schema, row-level security, admin-only views
  functions/chat/                 the model proxy — limits enforced, usage metered
  functions/admin-key/            set / rotate / remove the org's provider keys
  functions/admin-member/         add a person by email, invite them if new
  functions/_shared/              provider endpoints, crypto, pricing, stream metering
console/                          the admin console (React + Vite)
```

## What never touches the database

Page content. The proxy streams the request through to the provider and writes only:
who called, which provider and model, token counts, cost, and the **hostname** of the app they
were on. There is deliberately no column for prompts, completions, URLs or page text — so the
privacy promise is a property of the schema rather than of anyone's discipline.

## Access rules, and where they live

| Rule | Enforced by |
|---|---|
| Provider keys are never readable by any client | RLS: `provider_keys` has no policy, so every client role is denied. Only `service_role` (the proxy) can read it |
| Only admins see cost | `my_usage` view has no cost columns; `admin_usage` and `admin_member_summary` are gated on `is_org_admin()` |
| Members can't forge usage to hide spend | No insert policy on `usage_events` — rows come only from the proxy |
| Spend caps hold | Checked in `chat/index.ts` before the upstream call, against `spend_today()` / `spend_this_month()` in SQL |
| Suspended users can't call | `org_members.disabled`, checked in the proxy |

Limits are USD. `NULL` means no cap; `0` means blocked, and the proxy says so in plain words
rather than failing as a budget error.

## Deploy

```bash
supabase link --project-ref <your-ref>
supabase db push
supabase functions deploy chat admin-key admin-member
```

Set the function secrets:

```bash
supabase secrets set PROVIDER_KEY_SECRET="$(openssl rand -base64 48)"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

**Keep `PROVIDER_KEY_SECRET` safe and unchanged.** It decrypts every stored provider key —
rotate it and every key must be re-entered.

## Bootstrap the first org

RLS is deliberately closed, so the first admin can't create themselves. Sign in to the console
once (to create the auth user), then run this in the Supabase SQL editor:

```sql
with new_org as (
  insert into orgs (name) values ('Your company') returning id
)
insert into org_members (org_id, user_id, role)
select new_org.id, u.id, 'admin'
from new_org, auth.users u
where u.email = 'you@company.com';
```

Every admin after that can be promoted from the console.

## Console

```bash
cd console
cp .env.example .env.local     # fill in URL and anon key
npm install
npm run dev
```

The anon key is safe in the browser — it grants nothing on its own, because every table is
behind RLS and the keys table is behind no policy at all.

## Not done yet

- **The extension still calls providers directly.** It has to be switched to sign in and call
  `/functions/v1/chat` before any of this takes effect. Until then the console is accurate about
  everything except reality.
- **No billing integration.** Admins see cost; nobody is charged for it.
- **`app_host` is supplied by the extension** and isn't verified server-side. It's an analytics
  hint, not an audit record — don't build enforcement on it.
