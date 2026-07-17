DROP POLICY IF EXISTS "Public can search listed active organizations" ON public.organizations;
REVOKE SELECT ON public.organizations FROM anon;