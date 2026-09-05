#!/usr/bin/env bash
# Supervised smoke test for the /api/v1 auth broker (PRD milestone B2).
#
# Usage:
#   BASE_URL=https://gradus.training scripts/smoke-api-v1.sh
#   BASE_URL=http://localhost:8080  scripts/smoke-api-v1.sh     # local dev server with API_V1_ENABLED=true
#
# Optional env:
#   COACH_EMAIL       demo coach login (default alyson.stemas@gmail.com)
#   PARENT_EMAIL      demo parent, receives the recovery email (default mariah.slone+1@gmail.com)
#   ATHLETE_USERNAME  a demo athlete username to test username sign-in (skipped if empty)
#   SIGNUP_EMAIL      a fresh address to exercise coach sign-up (skipped if empty)
#
# Passwords are read with `read -s`: never echoed, never logged, never sent
# anywhere but the API under test. Tokens are kept in shell variables and
# never printed. Requires curl and python3 (both ship with macOS).
set -u
BASE_URL="${BASE_URL:-http://localhost:8080}"
COACH_EMAIL="${COACH_EMAIL:-alyson.stemas@gmail.com}"
PARENT_EMAIL="${PARENT_EMAIL:-mariah.slone+1@gmail.com}"
ATHLETE_USERNAME="${ATHLETE_USERNAME:-}"
SIGNUP_EMAIL="${SIGNUP_EMAIL:-}"
API="$BASE_URL/api/v1"
PASS=0; FAIL=0; BODY=""; CODE=""

req() { # req METHOD PATH [JSON_BODY] [BEARER]
  local method="$1" path="$2" body="${3:-}" bearer="${4:-}"
  local -a args=(-s -o /tmp/smoke_body.txt -w '%{http_code}' -X "$method" -H 'Accept: application/json' -H 'X-Gradus-Client: smoke/0.0.1+0')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
  [ -n "$bearer" ] && args+=(-H "Authorization: Bearer $bearer")
  CODE=$(curl "${args[@]}" "$API$path"); BODY=$(cat /tmp/smoke_body.txt)
}
json() { python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
except Exception:
  print(""); sys.exit(0)
cur=d
for k in sys.argv[1].split("."):
  cur=cur.get(k,"") if isinstance(cur,dict) else ""
print(cur if cur is not None else "")' "$1" <<<"$BODY"; }
ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1  (got $CODE: $(echo "$BODY" | head -c 200))"; }
check(){ [ "$CODE" = "$2" ] && ok "$1" || bad "$1 (expected $2)"; }
redact(){ echo "$BODY" | head -c 200; }

echo "Smoke test against $API"
echo

echo "1. Kill switch and public metadata"
req GET /meta/config
if [ "$CODE" = "503" ]; then echo "  ABORT  API_V1_ENABLED is off (503). Turn it on (and republish if needed), then rerun."; exit 2; fi
check "GET /meta/config is 200" 200
[ -n "$(json paywallEnabled)" ] && ok "config has paywallEnabled" || bad "config missing paywallEnabled"
req GET /meta/client-policy; check "GET /meta/client-policy is 200" 200

echo "1b. Limiter health (public write routes fail closed when the limiter's table is missing)"
req POST /auth/password '{"identifier":"smoke-limiter-health@example.com","password":"x"}'
if [ "$CODE" = "503" ] && [ "$(json error.code)" = "rate_limiter_unavailable" ]; then
  echo "  ABORT  The rate limiter cannot reach its table (api_rate_limits). The /api/v1 migrations are"
  echo "         probably not applied in production. Turn the flag off, run the SQL precheck in"
  echo "         docs/api/SMOKE.md, ask Lovable to apply pending migrations, then rerun."
  exit 3
fi
check "limiter reachable (a plain 401 here, not 503)" 401

echo "2. Auth is required where it should be"
req POST /me/presence; check "POST /me/presence without bearer is 401" 401
req GET /me/terms "" "not-a-real-token"; check "GET /me/terms with a garbage bearer is 401" 401

echo "3. Password sign-in (demo coach: $COACH_EMAIL)"
printf '  Coach password (hidden): '; read -rs COACH_PASSWORD; echo
req POST /auth/password "{\"identifier\":\"$COACH_EMAIL\",\"password\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$COACH_PASSWORD")}"
check "POST /auth/password returns 200" 200
TOKEN=$(json accessToken); [ -n "$TOKEN" ] && ok "response carries accessToken" || bad "no accessToken in response"
[ -n "$(json refreshToken)" ] && ok "response carries refreshToken" || bad "no refreshToken in response"
unset COACH_PASSWORD

echo "4. The minted token works on protected routes"
req GET /me/terms "" "$TOKEN"; check "GET /me/terms with token is 200" 200
req POST /me/presence "" "$TOKEN"; check "POST /me/presence with token is 200" 200

echo "5. Wrong password is generic and does not leak account existence"
req POST /auth/password "{\"identifier\":\"$COACH_EMAIL\",\"password\":\"definitely-wrong-password\"}"
check "wrong password is 401" 401
[ "$(json error.code)" = "invalid_credentials" ] && ok "code is invalid_credentials" || bad "unexpected error code"
req POST /auth/password '{"identifier":"nobody-here-'"$RANDOM"'@example.com","password":"x"}'
check "unknown email is also 401" 401
echo "$BODY" | grep -qiE "not found|no user|does not exist" && bad "body leaks existence" || ok "body does not leak existence"

if [ -n "$ATHLETE_USERNAME" ]; then
  echo "6. Username sign-in ($ATHLETE_USERNAME)"
  printf '  Athlete password (hidden): '; read -rs ATHLETE_PASSWORD; echo
  req POST /auth/password "{\"identifier\":\"$ATHLETE_USERNAME\",\"password\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$ATHLETE_PASSWORD")}"
  check "username sign-in returns 200" 200
  unset ATHLETE_PASSWORD
else
  echo "6. Username sign-in skipped (set ATHLETE_USERNAME to run)"
fi

echo "7. Username lookups"
req POST /auth/username/check '{"username":"zz_smoke_nobody_9"}'; check "username/check answers 200" 200
req POST /auth/username/resolve '{"username":"zz_smoke_nobody_9"}'
[ "$CODE" = "404" ] || [ "$CODE" = "200" ] && ok "username/resolve answers ($CODE) for an unknown name" || bad "username/resolve unexpected"

echo "8. Password recovery (sends a real email to $PARENT_EMAIL)"
req POST /auth/recover "{\"email\":\"$PARENT_EMAIL\"}"; check "POST /auth/recover is 200" 200
[ "$(json ok)" = "True" ] && ok "recover reports ok" || bad "recover did not report ok"
echo "  → confirm the reset email arrives in that inbox (this proves the captcha bypass for recovery)."

if [ -n "$SIGNUP_EMAIL" ]; then
  echo "9. Coach sign-up ($SIGNUP_EMAIL)"
  printf '  New password for the smoke account (hidden, 8+ chars): '; read -rs NEW_PASSWORD; echo
  req POST /auth/signup/coach "{\"email\":\"$SIGNUP_EMAIL\",\"password\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$NEW_PASSWORD")}"
  check "POST /auth/signup/coach is 200" 200
  if [ "$(json confirmationRequired)" = "False" ]; then
    ok "auto-confirm returned a session (project setting honored)"
    NEW_TOKEN=$(json accessToken)
    req GET /me/terms "" "$NEW_TOKEN"; check "new account's token works on /me/terms" 200
  else
    bad "sign-up reported confirmationRequired=true (project auto-confirms, so this should be false)"
  fi
  unset NEW_PASSWORD
  echo "  → keep $SIGNUP_EMAIL as the throwaway for the account-deletion smoke test."
else
  echo "9. Coach sign-up skipped (set SIGNUP_EMAIL to run)"
fi

echo "10. Per-identifier rate limit (11 wrong attempts on a throwaway identifier)"
HIT429=0
for i in $(seq 1 11); do
  req POST /auth/password '{"identifier":"smoke-ratelimit@example.com","password":"x"}'
  [ "$CODE" = "429" ] && HIT429=1
done
[ "$HIT429" = "1" ] && ok "a 429 appeared within 11 attempts" || bad "no 429 after 11 attempts (limit is 10/min per identifier)"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] || exit 1
