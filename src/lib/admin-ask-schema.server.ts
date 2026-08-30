// Server-only: compact schema summary handed to the model when translating a
// plain-English admin question into SQL. Keep this in sync with the tables that
// matter for reporting — it does not need to be exhaustive.

export const REPORTING_SCHEMA = `
coach_profiles(id, user_id, first_name, last_name, onboarded_at, created_at, is_test, promo_code, last_seen_at, organization_id, entitlement, subscription_status, subscription_tier, trial_ends_at, current_period_end, founding_coach, is_org_admin)
parent_profiles(id, user_id, first_name, last_name, created_at, coach_id, is_test, last_seen_at, subscription_status, team_plan_seats)
athletes(id, parent_id, user_id, first_name, last_name, birthdate, created_at, self_managed, is_test, username, guardian_email, added_by_coach_id, promo_code)
coach_athletes(id, coach_id, athlete_id, created_at, coach_ack_at, other_ack_at)
coach_athlete_sports(id, coach_id, athlete_id, sport, created_at)
athlete_primary_coaches(id, athlete_id, sport, coach_id, created_at)
athlete_guardians(id, athlete_id, parent_id, role, created_at)
athlete_goals(id, athlete_id, coach_id, sport, current_level_key, season_goal_key, long_term_goal, created_at)
plans(id, coach_id, kind, athlete_id, title, notes, status, created_at, updated_at, share_token, organization_id, is_org_template, source)
plan_moves(id, plan_id, move_id, position, name, description, cue, why, target_kind, target_value, created_at)
plan_sessions(id, plan_id, athlete_id, parent_id, state_index, note, duration_seconds, logged_at, created_at)
moves(id, coach_id, sport, category, name, archived_at, created_at, organization_id, is_org_template)
lesson_wrap_ups(id, coach_id, athlete_id, lesson_date, action, created_at)
athlete_lesson_slots(id, athlete_id, coach_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on)
messages(id, room_id, direct_room_id, sender_user_id, sender_deleted_at, sender_role, kind, body, created_at)
message_rooms(id, coach_id, athlete_id, created_at)
invoices(id, coach_id, athlete_id, period_start, period_end, total_cents, status, paid_at, created_at)
invoice_lines(id, invoice_id, slot_id, occurrence_date, amount_cents, created_at)
organizations(id, name, slug, active, city, region, created_at)
resources(id, sport, title, coach_id, organization_id, kind, published, created_at)
feedback(id, user_id, role, message, path, resolved_at, created_at)
promo_codes(code, label, active, percent_off, duration, created_at)
user_applied_promo_codes(id, user_id, code, scope, created_at)
billing_events(id, user_id, event_type, amount_cents, status, created_at)
user_roles(id, user_id, role, created_at)

Notes:
- Practice time is plan_sessions.duration_seconds (seconds). Minutes = duration_seconds/60.0.
- plan_sessions.state_index: 0 = frustrated .. 4 = flowing.
- Internal/demo accounts are flagged with is_test = true on coach_profiles, parent_profiles and athletes. Exclude them unless the question asks otherwise.
- An "assigned plan" is a plans row with athlete_id not null and kind = 'plan' and status in ('active','benched').
- Athlete display name: first_name || ' ' || last_name. Same for coaches and parents.
- Emails live in auth.users(id, email, created_at, last_sign_in_at) and can be joined via coach_profiles.user_id / parent_profiles.user_id / athletes.user_id.
`.trim();
