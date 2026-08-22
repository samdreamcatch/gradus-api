ALTER TABLE public.athletes DROP CONSTRAINT athletes_self_managed_shape;
ALTER TABLE public.athletes ADD CONSTRAINT athletes_self_managed_shape CHECK (
  (self_managed = true AND parent_id IS NULL AND birthdate IS NOT NULL)
  OR (self_managed = false AND parent_id IS NOT NULL)
  OR (self_managed = false AND parent_id IS NULL AND added_by_coach_id IS NOT NULL AND guardian_email IS NOT NULL)
);