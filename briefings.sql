-- ============================================================
-- Task Tracker tab: the daily briefing inside the app.
--
-- Each morning the IPMI Daily Briefing (a scheduled Claude task)
-- saves that day's briefing here through save_briefing(). The app
-- reads it and remembers which action items have been ticked off.
--
-- Safe to run more than once. The private publishing token is
-- added separately (see README) and is never stored in this file.
-- ============================================================

-- One briefing per person per day (the Las Vegas date it was made for).
-- Only save_briefing() writes here; the app can only read.
create table if not exists public.briefings (
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

-- Action items that have been ticked off or linked to a To-Do List task.
create table if not exists public.briefing_checks (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  item_key    text not null check (char_length(item_key) between 1 and 300),
  done_at     bigint,   -- when it was ticked off (ms since 1970); null = not done
  task_id     text,     -- the To-Do List task this item is linked to, if any
  updated_at  timestamptz not null default now(),
  primary key (user_id, day, item_key)
);

-- Row-level security: people can only see their own briefings and ticks.
alter table public.briefings enable row level security;
alter table public.briefing_checks enable row level security;

drop policy if exists "Own briefings: read" on public.briefings;
create policy "Own briefings: read" on public.briefings for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Own checks: read"   on public.briefing_checks;
drop policy if exists "Own checks: add"    on public.briefing_checks;
drop policy if exists "Own checks: change" on public.briefing_checks;
drop policy if exists "Own checks: remove" on public.briefing_checks;
create policy "Own checks: read"   on public.briefing_checks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own checks: add"    on public.briefing_checks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own checks: change" on public.briefing_checks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own checks: remove" on public.briefing_checks for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.briefings from anon, authenticated;
grant select on public.briefings to authenticated;
revoke all on public.briefing_checks from anon, authenticated;
grant select, insert, update, delete on public.briefing_checks to authenticated;

-- Publishing tokens live in a private schema the API can't reach.
-- Only a SHA-256 hash of each token is stored.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.briefing_tokens (
  token_hash  text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
revoke all on private.briefing_tokens from public, anon, authenticated;

-- Called by the morning briefing: save_briefing(p_token, p_data).
-- p_data is the briefing as JSON and must include "date": "YYYY-MM-DD".
-- Saving the same day again replaces that day's briefing; ticks are kept.
create or replace function public.save_briefing(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_day  date;
begin
  select t.user_id into v_user
  from private.briefing_tokens t
  where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if v_user is null then
    raise exception 'Invalid briefing token' using errcode = '28000';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'The briefing must be a JSON object' using errcode = '22023';
  end if;

  if octet_length(p_data::text) > 300000 then
    raise exception 'The briefing is too large' using errcode = '22023';
  end if;

  begin
    v_day := (p_data ->> 'date')::date;
  exception when others then
    v_day := null;
  end;
  if v_day is null or v_day < current_date - 60 or v_day > current_date + 2 then
    raise exception 'The briefing needs a "date" (YYYY-MM-DD) close to today' using errcode = '22023';
  end if;

  insert into public.briefings (user_id, day, data)
  values (v_user, v_day, p_data)
  on conflict (user_id, day) do update
    set data = excluded.data, updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'day', v_day,
    'action_items', case when jsonb_typeof(p_data -> 'action_items') = 'array'
                         then jsonb_array_length(p_data -> 'action_items') else 0 end
  );
end;
$$;

revoke all on function public.save_briefing(text, jsonb) from public;
grant execute on function public.save_briefing(text, jsonb) to anon, authenticated;

-- Let the API see the new tables and function right away.
notify pgrst, 'reload schema';
