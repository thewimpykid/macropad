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

drop policy if exists "public read" on macro_series;
create policy "public read" on macro_series
  for select using (true);

alter table macro_series add column if not exists zscore double precision;
alter table macro_series add column if not exists sparkline jsonb;
alter table macro_series add column if not exists window_label text;
alter table macro_series add column if not exists history jsonb;
alter table macro_series add column if not exists extra_stats jsonb;
alter table macro_series add column if not exists payload jsonb;
