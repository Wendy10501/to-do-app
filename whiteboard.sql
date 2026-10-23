-- ============================================================
-- Whiteboard dashboard (dashboard.html)
--
-- A Google Apps Script called "Whiteboard sync" (see the
-- whiteboard-sync folder) sends the WHITEBOARD Google Sheet here
-- every 10 minutes through save_whiteboard(). The dashboard reads
-- the latest copy after you sign in.
--
-- Anyone can create an account in this project (the To-Do List
-- needs that), so an account alone is not enough: the email must
-- be on the approved list below AND confirmed.
--
-- Safe to run more than once. The sync script's private token is
-- added separately (see README); only its SHA-256 hash is stored.
-- ============================================================

-- ---- Approved list --------------------------------------------
-- Who can see the dashboard. Add or remove people in
-- Table Editor > dashboard_access. Type emails in lower case.
create table if not exists public.dashboard_access (
  email     text primary key check (email = lower(email) and email like '%_@_%'),
  name      text,
  added_at  timestamptz not null default now()
);

-- Nobody can read this list through the API (no policies on purpose).
-- Only the Supabase dashboard and can_view_whiteboard() can.
alter table public.dashboard_access enable row level security;
revoke all on public.dashboard_access from anon, authenticated;

insert into public.dashboard_access (email, name) values
  ('wendy@integritypmnv.com',   'Wendy'),
  ('ira.integritypm@gmail.com', 'Ira'),
  ('ren.integritypm@gmail.com', 'Ren')
on conflict (email) do nothing;

-- True when the signed-in person's email is on the list and confirmed.
create or replace function public.can_view_whiteboard()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.dashboard_access a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.can_view_whiteboard() from public, anon;
grant execute on function public.can_view_whiteboard() to authenticated;

-- ---- The latest copy of the sheet -----------------------------
-- A single row: the sheet exported as an .xlsx file, base64-encoded.
-- Only save_whiteboard() writes it; approved people can read it.
create table if not exists public.whiteboard (
  id          smallint primary key default 1 check (id = 1),
  workbook    text not null,
  updated_at  timestamptz not null default now()
);

alter table public.whiteboard enable row level security;

drop policy if exists "Approved people: read" on public.whiteboard;
create policy "Approved people: read" on public.whiteboard
  for select to authenticated
  using ((select public.can_view_whiteboard()));

revoke all on public.whiteboard from anon, authenticated;
grant select on public.whiteboard to authenticated;

-- ---- The sync script's token ----------------------------------
-- Lives in a private schema the API can't reach. Only a SHA-256
-- hash of the token is stored; the token itself stays inside the
-- Whiteboard sync script.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.whiteboard_tokens (
  token_hash  text primary key,
  created_at  timestamptz not null default now()
);
alter table private.whiteboard_tokens enable row level security;
revoke all on private.whiteboard_tokens from public, anon, authenticated;

-- Called by the sync script: save_whiteboard(p_token, p_workbook).
-- Replaces the stored copy with the new one.
create or replace function public.save_whiteboard(p_token text, p_workbook text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.whiteboard_tokens t
    where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  ) then
    raise exception 'Invalid whiteboard token' using errcode = '28000';
  end if;

  -- An .xlsx file is a zip, so its base64 always starts with "UEsD".
  if p_workbook is null
     or left(p_workbook, 4) <> 'UEsD'
     or p_workbook !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'The workbook must be a base64-encoded .xlsx file' using errcode = '22023';
  end if;

  if length(p_workbook) > 8000000 then
    raise exception 'The workbook is too large' using errcode = '22023';
  end if;

  insert into public.whiteboard (id, workbook, updated_at)
  values (1, p_workbook, now())
  on conflict (id) do update
    set workbook = excluded.workbook, updated_at = now();

  return jsonb_build_object('ok', true, 'kb', round(length(p_workbook) / 1024.0));
end;
$$;

revoke all on function public.save_whiteboard(text, text) from public;
grant execute on function public.save_whiteboard(text, text) to anon, authenticated;

-- Let the API see the new tables and functions right away.
notify pgrst, 'reload schema';
