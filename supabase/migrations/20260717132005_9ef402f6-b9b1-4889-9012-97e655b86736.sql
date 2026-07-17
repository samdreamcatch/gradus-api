DELETE FROM public.user_roles
WHERE role = 'admin'
  AND user_id IN (
    SELECT id FROM auth.users WHERE email IN ('coach@test.dev', 'coach2@test.dev')
  );

DELETE FROM public.admin_allowlist
WHERE email IN ('coach@test.dev', 'coach2@test.dev');