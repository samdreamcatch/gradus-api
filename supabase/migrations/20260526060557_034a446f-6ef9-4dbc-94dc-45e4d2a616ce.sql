DELETE FROM coach_athletes WHERE athlete_id IN (SELECT id FROM athletes WHERE parent_id='e08e9661-04fe-465d-ae2a-0c030d65dc07');
DELETE FROM athletes WHERE parent_id='e08e9661-04fe-465d-ae2a-0c030d65dc07';
DELETE FROM parent_profiles WHERE id='e08e9661-04fe-465d-ae2a-0c030d65dc07';
DELETE FROM auth.users WHERE id='39b049bf-d969-428c-8012-e1c9c0e55575';