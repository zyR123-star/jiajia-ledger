-- 佳嘉记账 · Supabase 初始化
-- 在 Supabase SQL Editor 中整段执行。只需要在共享服务里配置一次。

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '新用户',
  invite_code text not null unique,
  partner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  amount integer not null check (amount > 0),
  category_id text not null,
  account text not null,
  date date not null,
  note text not null default '',
  visibility text not null default 'private' check (visibility in ('private', 'partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_owner_date_idx
  on public.transactions(owner_id, date desc);
create index if not exists transactions_visibility_idx
  on public.transactions(visibility);

create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select partner_id from public.profiles where id = auth.uid();
$$;

create or replace function public.are_partners(owner_id uuid, viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = viewer_id
      and p.partner_id = owner_id
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  generated_code text;
  suggested_name text;
begin
  loop
    generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1 from public.profiles where invite_code = generated_code
    );
  end loop;

  suggested_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.email, '新用户'), '@', 1)
  );

  insert into public.profiles (id, display_name, invite_code)
  values (new.id, suggested_name, generated_code)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.claim_invite(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me public.profiles%rowtype;
  inviter public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;

  select * into me
  from public.profiles
  where id = auth.uid()
  for update;

  if me.id is null then
    raise exception '账户档案不存在';
  end if;
  if me.partner_id is not null then
    raise exception '当前账号已经配对';
  end if;

  select * into inviter
  from public.profiles
  where invite_code = upper(trim(input_code))
    and id <> auth.uid()
  for update;

  if inviter.id is null then
    raise exception '配对码不存在';
  end if;
  if inviter.partner_id is not null then
    raise exception '对方已经完成配对';
  end if;

  update public.profiles set partner_id = inviter.id where id = me.id;
  update public.profiles set partner_id = me.id where id = inviter.id;

  return jsonb_build_object(
    'partner_id', inviter.id,
    'display_name', inviter.display_name
  );
end;
$$;

create or replace function public.unpair()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_partner uuid;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;

  select partner_id into old_partner
  from public.profiles
  where id = auth.uid()
  for update;

  if old_partner is null then return false; end if;

  update public.profiles
  set partner_id = null
  where id in (auth.uid(), old_partner);

  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;

drop policy if exists profiles_select_self_or_partner on public.profiles;
create policy profiles_select_self_or_partner
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or id = public.current_partner_id()
  );

drop policy if exists transactions_select_owner_or_partner_visible on public.transactions;
create policy transactions_select_owner_or_partner_visible
  on public.transactions
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or (
      visibility = 'partner'
      and public.are_partners(owner_id, auth.uid())
    )
  );

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own
  on public.transactions
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own
  on public.transactions
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own
  on public.transactions
  for delete
  to authenticated
  using (owner_id = auth.uid());

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
revoke all on function public.claim_invite(text) from public;
revoke all on function public.unpair() from public;
grant execute on function public.claim_invite(text) to authenticated;
grant execute on function public.unpair() to authenticated;
