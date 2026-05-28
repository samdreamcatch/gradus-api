-- Allow authenticated users to read curriculum seed moves
CREATE POLICY "Seed moves readable by authenticated"
  ON public.seed_moves FOR SELECT TO authenticated USING (true);

-- Make deny-all explicit on server-only tables (only supabaseAdmin should access)
CREATE POLICY "Deny all client access"
  ON public.athlete_otp_challenges
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "Deny all client access"
  ON public.invite_lookup_attempts
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);