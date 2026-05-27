DELETE FROM public.coach_athletes WHERE athlete_id IN (SELECT id FROM public.athletes WHERE parent_id = '27742634-c1b2-4c66-b364-2a1ccf3f27c3');
DELETE FROM public.athlete_invite_codes WHERE parent_id = '27742634-c1b2-4c66-b364-2a1ccf3f27c3';
DELETE FROM public.athlete_goals WHERE athlete_id IN (SELECT id FROM public.athletes WHERE parent_id = '27742634-c1b2-4c66-b364-2a1ccf3f27c3');
DELETE FROM public.athlete_lesson_slots WHERE athlete_id IN (SELECT id FROM public.athletes WHERE parent_id = '27742634-c1b2-4c66-b364-2a1ccf3f27c3');
DELETE FROM public.athletes WHERE parent_id = '27742634-c1b2-4c66-b364-2a1ccf3f27c3';
DELETE FROM public.parent_profiles WHERE id = '27742634-c1b2-4c66-b364-2a1ccf3f27c3';
DELETE FROM auth.users WHERE id = '70e087da-6f6f-4cc4-8aad-21f8ef914597';