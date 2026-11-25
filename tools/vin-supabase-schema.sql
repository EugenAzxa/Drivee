-- Drivee Canadian VIN — Durable Vercel Production Store Schema (Supabase Postgres)
-- -------------------------------------------------------------------------------
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Security:
--   - Row Level Security (RLS) is ENABLED with ZERO anon/authenticated policies.
--   - Browser clients using the public SUPABASE_ANON_KEY cannot read or write
--     orders, customer emails, hashed pack codes, promo codes, or cached reports.
--   - Only Drivee Vercel serverless functions authenticating with the secret
--     SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS) can access this table.

create table if not exists public.vin_store_buckets (
  bucket     text primary key,
  payload    jsonb not null default '{}'::jsonb,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists vin_buckets_updated_idx
  on public.vin_store_buckets (updated_at desc);

alter table public.vin_store_buckets enable row level security;

revoke all on table public.vin_store_buckets from anon, authenticated;

comment on table public.vin_store_buckets is
  'Server-side durable state for Drivee VIN reports (orders, buyers, hashed pack codes, promos, inquiries, rate limits, report cache). Service-role access only.';
