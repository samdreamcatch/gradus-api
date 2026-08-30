-- Ad-hoc read-only reporting queries for admins ("Ask the data").
-- Runs the supplied SELECT inside a read-only transaction with a short
-- statement timeout and returns the rows as JSON. Admin-only.
create or replace function public.admin_run_readonly_sql(_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Forbidden';
  end if;

  if _sql !~* '^\s*(select|with)\s' then
    raise exception 'Only read-only SELECT queries are allowed';
  end if;

  set local transaction_read_only = on;
  set local statement_timeout = '8s';

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', _sql)
    into result;

  return result;
end;
$$;

revoke all on function public.admin_run_readonly_sql(text) from public;
grant execute on function public.admin_run_readonly_sql(text) to authenticated;
