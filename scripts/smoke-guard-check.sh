#!/usr/bin/env bash
# Billing-column guard check (PRD §4.1 rule 13; docs/api/SMOKE.md).
#
#   scripts/smoke-guard-check.sh
#
# Reads a signed-in coach's access_token from the clipboard (devtools →
# Application → Local Storage → sb-<project-ref>-auth-token → copy the
# access_token value, then run this). The token is kept in this process
# only and never written anywhere.
# Proves: (1) a user cannot change their own billing columns through the
# data API (403); (2) ordinary profile updates still work (204). If the
# guard turns out not to be active, the original entitlement is restored.
set -u
cd "$(dirname "$0")/.."
set -a; source .env; set +a
URL="${VITE_SUPABASE_URL:?VITE_SUPABASE_URL missing from .env}"
KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:?VITE_SUPABASE_PUBLISHABLE_KEY missing from .env}"
TMP="$(mktemp)"; trap 'rm -f "$TMP"; unset TOKEN' EXIT

# A Supabase access token is ~1,100 characters, longer than the 1,024-character
# line limit of a macOS terminal in canonical mode, so pasting it at a normal
# prompt silently drops the tail and the Return. Read it from the clipboard
# instead (copy the access_token value, then run this), with a raw-mode
# prompt as the fallback. GUARD_TOKEN=<token> overrides both (automation).
TOKEN="${GUARD_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v pbpaste >/dev/null; then
  TOKEN="$(pbpaste 2>/dev/null | tr -d '"[:space:]')"; TOKEN="${TOKEN#access_token:}"
  if [[ "$TOKEN" == eyJ* ]]; then echo "Using the access token from the clipboard."; else TOKEN=""; fi
fi
if [ -z "$TOKEN" ]; then
  echo "The clipboard does not hold an access token. Paste it here and press Return (nothing is echoed):"
  if [ -t 0 ]; then saved_stty="$(stty -g)"; stty -icanon -echo; fi
  IFS= read -r -d $'\n' TOKEN || true
  if [ -t 0 ]; then stty "$saved_stty"; echo; fi
  TOKEN="${TOKEN//\"/}"; TOKEN="${TOKEN//[[:space:]]/}"; TOKEN="${TOKEN#access_token:}"
fi
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
STATE="$(curl -s "${auth[@]}" "$ROW&select=entitlement,free_access_until" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)[0]; print(d["entitlement"]); print(json.dumps(d.get("free_access_until")))
except Exception: print(""); print("null")')"
BEFORE="$(printf '%s\n' "$STATE" | sed -n 1p)"; BEFORE_FAU="$(printf '%s\n' "$STATE" | sed -n 2p)"
if [ -z "$BEFORE" ]; then echo "FAIL  no coach_profiles row for this user; use a coach account."; exit 1; fi
echo "Current entitlement: $BEFORE (free_access_until: $BEFORE_FAU)"

# The guard rejects a *change*, so the probe must differ from the current
# value or a no-op update would pass and mask a missing guard.
if [ "$BEFORE" = "paid" ]; then TRY="promo_free"; else TRY="paid"; fi
CODE="$(curl -s -o "$TMP" -w '%{http_code}' -X PATCH "${auth[@]}" "${json[@]}" -d "{\"entitlement\":\"$TRY\",\"free_access_until\":\"2099-01-01T00:00:00Z\"}" "$ROW")"
if [ "$CODE" = "403" ]; then
  echo "PASS  1) changing your own entitlement/free access is rejected (403): $(python3 -c 'import sys,json; print(json.load(sys.stdin).get("message",""))' < "$TMP" 2>/dev/null)"
else
  echo "FAIL  1) expected 403, got $CODE — the guard is NOT active (tried entitlement=$TRY)."
  echo "      Restoring entitlement=$BEFORE, free_access_until=$BEFORE_FAU:"
  curl -s -o /dev/null -w '      restore → %{http_code}\n' -X PATCH "${auth[@]}" "${json[@]}" -d "{\"entitlement\":\"$BEFORE\",\"free_access_until\":$BEFORE_FAU}" "$ROW"
fi

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${auth[@]}" "${json[@]}" -d "{\"last_seen_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" "$ROW")"
if [ "$CODE" = "204" ]; then echo "PASS  2) ordinary profile update still works (204)"; else echo "FAIL  2) expected 204 for last_seen_at, got $CODE"; fi

echo
echo "Done. If this token was ever pasted anywhere else, sign out of gradus.training in that browser now; that revokes the refresh token."
