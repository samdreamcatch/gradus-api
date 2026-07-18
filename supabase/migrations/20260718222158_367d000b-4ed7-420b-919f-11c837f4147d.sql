INSERT INTO public.promo_codes (code, label, notes, duration, duration_in_months, percent_off, active)
VALUES (
  'WELCOME_BACK',
  'Welcome back — 3 months free of Coach Pro',
  'Auto-granted when a coach leaves a club plan without a prior paid subscription. Coach Pro only. Card required, auto-converts to $70/mo.',
  'repeating',
  3,
  100,
  true
)
ON CONFLICT (code) DO NOTHING;