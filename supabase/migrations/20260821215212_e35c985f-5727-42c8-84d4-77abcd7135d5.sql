update public.coach_profiles cp
set subscription_status = null,
    stripe_subscription_id = null,
    subscription_tier = null,
    subscription_environment = null,
    trial_ends_at = null,
    current_period_end = null,
    entitlement = 'promo_free'
from auth.users u
where u.id = cp.user_id
  and u.email = 'alyson.stemas@gmail.com'
  and cp.subscription_environment = 'sandbox';