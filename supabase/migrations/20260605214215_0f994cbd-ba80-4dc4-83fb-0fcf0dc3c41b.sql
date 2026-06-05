
-- athletes
DROP POLICY "Coaches can view rostered athletes" ON public.athletes;
CREATE POLICY "Coaches can view rostered athletes" ON public.athletes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM coach_athletes ca JOIN coach_profiles cp ON cp.id = ca.coach_id WHERE ca.athlete_id = athletes.id AND cp.user_id = auth.uid()));

DROP POLICY "Parents can delete own athletes" ON public.athletes;
CREATE POLICY "Parents can delete own athletes" ON public.athletes FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()));

DROP POLICY "Parents can insert own athletes" ON public.athletes;
CREATE POLICY "Parents can insert own athletes" ON public.athletes FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()));

DROP POLICY "Parents can update own athletes" ON public.athletes;
CREATE POLICY "Parents can update own athletes" ON public.athletes FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()));

DROP POLICY "Parents can view own athletes" ON public.athletes;
CREATE POLICY "Parents can view own athletes" ON public.athletes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()));

-- coach_athletes
DROP POLICY "Coaches can delete own roster links" ON public.coach_athletes;
CREATE POLICY "Coaches can delete own roster links" ON public.coach_athletes FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = coach_athletes.coach_id AND cp.user_id = auth.uid()));

DROP POLICY "Coaches can view own roster links" ON public.coach_athletes;
CREATE POLICY "Coaches can view own roster links" ON public.coach_athletes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = coach_athletes.coach_id AND cp.user_id = auth.uid()));

DROP POLICY "Parents can delete own coach links" ON public.coach_athletes;
CREATE POLICY "Parents can delete own coach links" ON public.coach_athletes FOR DELETE TO authenticated
USING (is_parent_of_athlete(athlete_id));

DROP POLICY "Parents can insert coach links for own athletes" ON public.coach_athletes;
CREATE POLICY "Parents can insert coach links for own athletes" ON public.coach_athletes FOR INSERT TO authenticated
WITH CHECK (is_parent_of_athlete(athlete_id));

DROP POLICY "Parents can view own coach links" ON public.coach_athletes;
CREATE POLICY "Parents can view own coach links" ON public.coach_athletes FOR SELECT TO authenticated
USING (is_parent_of_athlete(athlete_id));

-- coach_levels
DROP POLICY "Coaches can delete own levels" ON public.coach_levels;
CREATE POLICY "Coaches can delete own levels" ON public.coach_levels FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()));

DROP POLICY "Coaches can insert own levels" ON public.coach_levels;
CREATE POLICY "Coaches can insert own levels" ON public.coach_levels FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()));

DROP POLICY "Coaches can update own levels" ON public.coach_levels;
CREATE POLICY "Coaches can update own levels" ON public.coach_levels FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()));

DROP POLICY "Coaches can view own levels" ON public.coach_levels;
CREATE POLICY "Coaches can view own levels" ON public.coach_levels FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()));

-- coach_profiles
DROP POLICY "Coaches can delete own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can delete own profile" ON public.coach_profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY "Coaches can insert own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can insert own profile" ON public.coach_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY "Coaches can update own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can update own profile" ON public.coach_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY "Coaches can view own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can view own profile" ON public.coach_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- parent_profiles
DROP POLICY "Coaches can view parents of rostered athletes" ON public.parent_profiles;
CREATE POLICY "Coaches can view parents of rostered athletes" ON public.parent_profiles FOR SELECT TO authenticated
USING (coach_has_rostered_athlete_of_parent(id));

DROP POLICY "Parents can delete own profile" ON public.parent_profiles;
CREATE POLICY "Parents can delete own profile" ON public.parent_profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY "Parents can insert own profile" ON public.parent_profiles;
CREATE POLICY "Parents can insert own profile" ON public.parent_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY "Parents can update own profile" ON public.parent_profiles;
CREATE POLICY "Parents can update own profile" ON public.parent_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY "Parents can view own profile" ON public.parent_profiles;
CREATE POLICY "Parents can view own profile" ON public.parent_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- plan_moves (only the one public-role policy)
DROP POLICY "Athletes view plan_moves for own plans" ON public.plan_moves;
CREATE POLICY "Athletes view plan_moves for own plans" ON public.plan_moves FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM plans p JOIN athletes a ON a.id = p.athlete_id WHERE p.id = plan_moves.plan_id AND a.user_id = auth.uid() AND p.kind = 'plan' AND p.status = ANY (ARRAY['active','benched'])));
