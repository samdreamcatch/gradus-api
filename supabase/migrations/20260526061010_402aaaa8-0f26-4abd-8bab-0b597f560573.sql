DELETE FROM coach_athletes WHERE athlete_id IN (SELECT id FROM athletes WHERE parent_id='f46275ae-cf41-4e21-951f-f965f40f4fef');
DELETE FROM athletes WHERE parent_id='f46275ae-cf41-4e21-951f-f965f40f4fef';
DELETE FROM parent_profiles WHERE id='f46275ae-cf41-4e21-951f-f965f40f4fef';
DELETE FROM auth.users WHERE id='75b132a8-ea6d-4ecd-87ca-5eb15cd6db31';