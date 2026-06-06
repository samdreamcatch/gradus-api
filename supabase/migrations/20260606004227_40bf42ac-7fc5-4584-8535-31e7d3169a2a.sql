DO $$
DECLARE
  _uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
    'parent@test.dev', crypt('test1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Lorelai","last_name":"Gilmore"}'::jsonb,
    false, false
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), _uid,
    jsonb_build_object('sub', _uid::text, 'email', 'parent@test.dev', 'email_verified', true),
    'email', _uid::text, now(), now(), now());

  UPDATE public.parent_profiles
     SET user_id = _uid, updated_at = now()
   WHERE id = 'e0481e2e-43a6-4eb5-a669-f7919cd3ac6a';
END $$;