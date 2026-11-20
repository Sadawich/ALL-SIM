-- FLL SIM cloud mode. Paste into Supabase → SQL Editor → Run.
-- Replace admin@example.com with the email of your admin user (1 place below).

create table if not exists public.teams (
  id uuid primary key references auth.users(id) on delete cascade,
  team_name text not null,
  captain text default '',
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  created_at timestamptz default now()
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  code text default '',
  route jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.robots (
  team_id uuid primary key references public.teams(id) on delete cascade,
  data jsonb
);

create table if not exists public.site (
  id int primary key default 1 check (id = 1),
  locked boolean default false,
  field jsonb
);
insert into public.site (id, locked) values (1, false) on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') = lower('admin@example.com'), false)
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = auth.uid() and status = 'approved')
$$;

alter table public.teams    enable row level security;
alter table public.programs enable row level security;
alter table public.robots   enable row level security;
alter table public.site     enable row level security;

-- teams: a user creates and reads only their own row (always as 'pending'); admin does everything
drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams for insert to authenticated
  with check (id = auth.uid() and status = 'pending');
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists teams_admin_update on public.teams;
create policy teams_admin_update on public.teams for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists teams_admin_delete on public.teams;
create policy teams_admin_delete on public.teams for delete to authenticated
  using (public.is_admin());

-- programs: approved teams manage their own; admin reads/deletes all
drop policy if exists programs_own on public.programs;
create policy programs_own on public.programs for all to authenticated
  using ((team_id = auth.uid() and public.is_approved()) or public.is_admin())
  with check (team_id = auth.uid() and public.is_approved());

-- robots: same rule
drop policy if exists robots_own on public.robots;
create policy robots_own on public.robots for all to authenticated
  using ((team_id = auth.uid() and public.is_approved()) or public.is_admin())
  with check (team_id = auth.uid() and public.is_approved());

-- site settings + field: everyone reads, only admin writes
drop policy if exists site_read on public.site;
create policy site_read on public.site for select using (true);
drop policy if exists site_admin on public.site;
create policy site_admin on public.site for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Note: the admin user must NOT have a row in public.teams.
-- Create the admin user in Authentication → Users → Add user, with
-- email = the one above and password = your FLL SIM admin key.
