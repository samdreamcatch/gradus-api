UPDATE auth.users
SET encrypted_password = extensions.crypt('test1234', extensions.gen_salt('bf')),
    updated_at = now()
WHERE email IN (
  'coach@test.dev',
  'parent@test.dev',
  'parent2@test.dev',
  'athlete@test.dev',
  'athlete6@test.dev'
);