REVOKE SELECT ON public.athletes FROM anon, authenticated;

DO $$
DECLARE
  readable text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO readable
    FROM pg_attribute
   WHERE attrelid = 'public.athletes'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname NOT IN ('guardian_claim_token', 'guardian_claim_code');

  EXECUTE format('GRANT SELECT (%s) ON public.athletes TO anon, authenticated', readable);
END $$;

DO $$
DECLARE
  r text;
  c text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOR c IN
      SELECT attname FROM pg_attribute
       WHERE attrelid = 'public.athletes'::regclass AND attnum > 0 AND NOT attisdropped
    LOOP
      IF c IN ('guardian_claim_token', 'guardian_claim_code') THEN
        IF has_column_privilege(r, 'public.athletes', c, 'SELECT') THEN
          RAISE EXCEPTION 'athletes.% is still readable by %', c, r;
        END IF;
      ELSIF NOT has_column_privilege(r, 'public.athletes', c, 'SELECT') THEN
        RAISE EXCEPTION 'athletes.% is no longer readable by %', c, r;
      END IF;
    END LOOP;
  END LOOP;
END $$;