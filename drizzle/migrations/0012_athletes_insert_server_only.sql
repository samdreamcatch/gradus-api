DROP POLICY IF EXISTS "Adults can insert own self-managed athlete row" ON public.athletes;
DROP POLICY IF EXISTS "Parents can insert own athletes" ON public.athletes;

REVOKE INSERT ON public.athletes FROM anon, authenticated;

DO $$
BEGIN
  IF has_any_column_privilege('anon', 'public.athletes', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.athletes', 'INSERT') THEN
    RAISE EXCEPTION 'anon or authenticated can still insert into public.athletes';
  END IF;
END;
$$;