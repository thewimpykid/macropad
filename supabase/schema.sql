create table if not exists macro_series (
  id text primary key,
  panel_id text not null,
  name text not null,
  note text not null,
  value text not null default '—',
  status text not null default 'pending' check (status in ('up','down','flat','pending')),
  source text not null,
  zscore double precision,
  sparkline jsonb,
  window_label text,
  updated_at timestamptz not null default now()
);

create index if not exists macro_series_panel_id_idx on macro_series (panel_id);

alter table macro_series enable row level security;

-- No public/authenticated read policy: the app reads exclusively server-side
-- with the service_role key (which bypasses RLS). With RLS on and no
-- permissive SELECT policy, anon and authenticated roles are denied, so the
-- public anon key in the browser cannot dump this table via the REST API.
-- (This is what closes the "grab the key from DevTools and hit /rest/v1"
-- extraction path.)
drop policy if exists "public read" on macro_series;
revoke all on macro_series from anon, authenticated;

alter table macro_series add column if not exists zscore double precision;
alter table macro_series add column if not exists sparkline jsonb;
alter table macro_series add column if not exists window_label text;
alter table macro_series add column if not exists history jsonb;
alter table macro_series add column if not exists extra_stats jsonb;
alter table macro_series add column if not exists payload jsonb;

-- Referral tracking: one row per successful sign-in that arrived with a
-- referral code (URL ?ref=CODE, carried through the Discord OAuth round
-- trip, or typed into the optional field on /signin). Never gates sign-in -
-- purely a side-effect insert after auth succeeds. No on-site leaderboard;
-- read directly in the Supabase SQL editor/table view:
--   select code, count(*) from referrals group by code order by count(*) desc;
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  -- One credited referral per user, ever - unique so a later login (with or
  -- without a ref code) never re-credits someone who already came in
  -- through a link once.
  user_id uuid not null unique,
  discord_username text,
  created_at timestamptz not null default now()
);

create index if not exists referrals_code_idx on referrals (code);

alter table referrals enable row level security;

drop policy if exists "public read" on referrals;
revoke all on referrals from anon, authenticated;
