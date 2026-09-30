-- Tasks table for the To-Do app. Each row belongs to one signed-in user.
create table if not exists public.tasks (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  due         text,
  priority    text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  list        text,
  done        boolean not null default false,
  created_at  bigint not null,
  done_at     bigint
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);

-- Row-level security: people can only see and change their own tasks.
alter table public.tasks enable row level security;

drop policy if exists "Own tasks: read"   on public.tasks;
drop policy if exists "Own tasks: add"    on public.tasks;
drop policy if exists "Own tasks: change" on public.tasks;
drop policy if exists "Own tasks: remove" on public.tasks;

create policy "Own tasks: read"   on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own tasks: add"    on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own tasks: change" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own tasks: remove" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;
