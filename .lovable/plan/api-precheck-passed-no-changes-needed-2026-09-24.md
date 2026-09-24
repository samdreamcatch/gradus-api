# API precheck: passed, no changes needed

## Results
- All 11 database objects the precheck looks for exist.
- The email-lookup function turns away anonymous callers (401).
- The rate-limit probe got 503 on all 12 tries because the sign-in API is switched off on the live site. That's expected, so the limiter wasn't tested.

## Next steps
None. Leave the API switched off until the next supervised test.
