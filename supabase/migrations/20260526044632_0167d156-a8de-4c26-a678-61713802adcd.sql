-- Helper: generate a short, human-friendly invite code.
-- Uses Crockford-style base32 minus I, L, O, 0, 1 to avoid lookalikes.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  attempt int := 0;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    if not exists (select 1 from public.coach_invite_codes where code = candidate) then
      return candidate;
    end if;

    attempt := attempt + 1;
    if attempt > 12 then
      raise exception 'Could not generate a unique invite code after % attempts', attempt;
    end if;
  end loop;
end;
$$;

-- Table: one reusable invite code per coach.
create table public.coach_invite_codes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null unique references public.coach_profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coach_invite_codes_code_idx on public.coach_invite_codes (code);

alter table public.coach_invite_codes enable row level security;

create policy "Coaches can view own invite code"
on public.coach_invite_codes
for select
using (
  exists (
    select 1 from public.coach_profiles cp
    where cp.id = coach_invite_codes.coach_id
      and cp.user_id = auth.uid()
  )
);

create policy "Coaches can insert own invite code"
on public.coach_invite_codes
for insert
with check (
  exists (
    select 1 from public.coach_profiles cp
    where cp.id = coach_invite_codes.coach_id
      and cp.user_id = auth.uid()
  )
);

create policy "Coaches can update own invite code"
on public.coach_invite_codes
for update
using (
  exists (
    select 1 from public.coach_profiles cp
    where cp.id = coach_invite_codes.coach_id
      and cp.user_id = auth.uid()
  )
);

create policy "Coaches can delete own invite code"
on public.coach_invite_codes
for delete
using (
  exists (
    select 1 from public.coach_profiles cp
    where cp.id = coach_invite_codes.coach_id
      and cp.user_id = auth.uid()
  )
);

create trigger update_coach_invite_codes_updated_at
before update on public.coach_invite_codes
for each row
execute function public.update_updated_at_column();