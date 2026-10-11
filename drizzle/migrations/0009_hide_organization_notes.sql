REVOKE SELECT ON public.organizations FROM anon, authenticated;

DO $$
DECLARE
  readable text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO readable
    FROM pg_attribute
   WHERE attrelid = 'public.organizations'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname <> 'notes';

  EXECUTE format('GRANT SELECT (%s) ON public.organizations TO authenticated', readable);
END $$;

DO $$
DECLARE
  r text;
  col name;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_column_privilege(r, 'public.organizations', 'notes', 'SELECT') THEN
      RAISE EXCEPTION 'organizations.notes is still readable by %', r;
    END IF;
  END LOOP;

  FOR col IN
    SELECT attname
      FROM pg_attribute
     WHERE attrelid = 'public.organizations'::regclass
       AND attnum > 0
       AND NOT attisdropped
       AND attname <> 'notes'
  LOOP
    IF NOT has_column_privilege('authenticated', 'public.organizations', col, 'SELECT') THEN
      RAISE EXCEPTION 'organizations.% is no longer readable by authenticated', col;
    END IF;
  END LOOP;
END $$;