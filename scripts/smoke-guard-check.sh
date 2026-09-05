#!/usr/bin/env bash
# Billing-column guard check (PRD §4.1 rule 13; docs/api/SMOKE.md).
#
#   scripts/smoke-guard-check.sh
#
# Prompts for a signed-in coach's access_token (devtools → Application →
# Local Storage → sb-<project-ref>-auth-token → access_token). The token is
# read without echo, kept in this process only, and never written anywhere.
# Proves: (1) a user cannot change their own billing columns through the
# data API (403); (2) ordinary profile updates still work (204). If the
# guard turns out not to be active, the original entitlement is restored.
set -u
cd "$(dirname "$0")/.."
set -a; source .env; set +a
URL="${VITE_SUPABASE_URL:?VITE_SUPABASE_URL missing from .env}"
KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:?VITE_SUPABASE_PUBLISHABLE_KEY missing from .env}"
TMP="$(mktemp)"; trap 'rm -f "$TMP"; unset TOKEN' EXIT

echo "Paste the access_token (it starts with eyJ) and press Enter. Nothing is echoed."
IFS= read -r -s -p "access_token: " TOKEN; echo
TOKEN="${TOKEN//\"/}"; TOKEN="${TOKEN//[[:space:]]/}"; TOKEN="${TOKEN#access_token:}"
if [ -z "$TOKEN" ]; then echo "No token entered."; exit 2; fi

auth=(-H "apikey: $KEY" -H "Authorization: Bearer $TOKEN")
json=(-H 'Content-Type: application/json' -H 'Prefer: return=minimal')
USERID="$(curl -s "${auth[@]}" "$URL/auth/v1/user" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")')"
if [ -z "$USERID" ]; then
  echo "FAIL  the token was not accepted (expired, or copied incompletely). Sign in again and copy a fresh access_token."; exit 1
fi
echo "Signed in as user $USERID"
ROW="$URL/rest/v1/coach_profiles?user_id=eq.$USERID"
BEFORE="$(curl -s "${auth[@]}" "$ROW&select=entitlement" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(d[0]["entitlement"] if d else "")
except Exception: print("")')"
if [ -z "$BEFORE" ]; then echo "FAIL  no coach_profiles row for this user; use a coach account."; exit 1; fi
echo "Current entitlement: $BEFORE"

CODE="$(curl -s -o "$TMP" -w '%{http_code}' -X PATCH "${auth[@]}" "${json[@]}" -d '{"entitlement":"paid"}' "$ROW")"
if [ "$CODE" = "403" ]; then
  echo "PASS  1) setting your own entitlement is rejected (403): $(python3 -c 'import sys,json; print(json.load(sys.stdin).get("message",""))' < "$TMP" 2>/dev/null)"
else
  echo "FAIL  1) expected 403, got $CODE — the guard is NOT active."
  echo "      Restoring entitlement=$BEFORE:"
  curl -s -o /dev/null -w '      restore → %{http_code}\n' -X PATCH "${auth[@]}" "${json[@]}" -d "{\"entitlement\":\"$BEFORE\"}" "$ROW"
fi

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${auth[@]}" "${json[@]}" -d "{\"last_seen_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" "$ROW")"
if [ "$CODE" = "204" ]; then echo "PASS  2) ordinary profile update still works (204)"; else echo "FAIL  2) expected 204 for last_seen_at, got $CODE"; fi

echo
echo "Done. If this token was ever pasted anywhere else, sign out of gradus.training in that browser now; that revokes the refresh token."
