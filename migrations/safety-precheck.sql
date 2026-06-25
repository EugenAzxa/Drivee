-- ─────────────────────────────────────────────────────────────────────────
-- Safety PreCheck — schema + storage for the Ontario SSC pre-inspection
-- feature. Paste into Supabase → SQL Editor and run. Idempotent: re-runs
-- of the same migration won't error out.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Table that holds one row per completed (or partial) inspection.
--    The per-area results live in `areas` as a JSONB array so we can add
--    or rename checks server-side without altering this schema.
create table if not exists public.safety_reports (
  id                bigserial primary key,
  user_id           uuid references auth.users(id) on delete cascade,
  car_id            bigint references public.cars(id) on delete set null,
  created_at        timestamptz not null default now(),

  -- Roll-up summary
  overall_verdict   text not null check (overall_verdict in ('likely_pass','needs_work','likely_fail','partial')),
  pass_count        int  not null default 0,
  caution_count     int  not null default 0,
  fail_count        int  not null default 0,
  unknown_count     int  not null default 0,

  -- Cost range across all areas, in CAD
  total_cost_low    int not null default 0,
  total_cost_high   int not null default 0,

  -- Full per-area JSON: [{ area, verdict, confidence, findings, estimated_repair_cost_cad, image_path }, …]
  areas             jsonb not null default '[]'::jsonb
);

create index if not exists safety_reports_user_id_idx     on public.safety_reports (user_id, created_at desc);
create index if not exists safety_reports_car_id_idx      on public.safety_reports (car_id, created_at desc);

-- Row-Level Security: users only see their own reports.
alter table public.safety_reports enable row level security;

drop policy if exists "safety_reports_select_own"  on public.safety_reports;
drop policy if exists "safety_reports_insert_own"  on public.safety_reports;
drop policy if exists "safety_reports_update_own"  on public.safety_reports;
drop policy if exists "safety_reports_delete_own"  on public.safety_reports;

create policy "safety_reports_select_own"
  on public.safety_reports for select
  using (auth.uid() = user_id);

create policy "safety_reports_insert_own"
  on public.safety_reports for insert
  with check (auth.uid() = user_id);

create policy "safety_reports_update_own"
  on public.safety_reports for update
  using (auth.uid() = user_id);

create policy "safety_reports_delete_own"
  on public.safety_reports for delete
  using (auth.uid() = user_id);


-- 2. Storage bucket for the inspection photos themselves.
--    Photos are private — only the owner can read them through signed URLs.
--    Path convention: {user_id}/{report_id}/{area}.jpg
insert into storage.buckets (id, name, public)
values ('safety-photos', 'safety-photos', false)
on conflict (id) do nothing;

drop policy if exists "safety_photos_select_own"  on storage.objects;
drop policy if exists "safety_photos_insert_own"  on storage.objects;
drop policy if exists "safety_photos_delete_own"  on storage.objects;

create policy "safety_photos_select_own"
  on storage.objects for select
  using (
    bucket_id = 'safety-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "safety_photos_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'safety-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "safety_photos_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'safety-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
