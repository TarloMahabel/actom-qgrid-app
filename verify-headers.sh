#!/usr/bin/env bash
# =====================================================================
# Verify the security headers are actually being served.
#
#   ./verify-headers.sh https://apply.actom.co.za
#   ./verify-headers.sh https://recruit.actomtools.co.za  admin
#
# Run this after EVERY platform change. A header config that has not
# been confirmed against the live response is only a hope — and the
# move from Netlify to Vercel silently dropped every one of these,
# because Vercel does not read netlify.toml.
# =====================================================================
set -uo pipefail

URL="${1:-}"
KIND="${2:-applicant}"

if [ -z "$URL" ]; then
  echo "Usage: $0 <url> [applicant|admin]"
  exit 2
fi

echo "Checking $URL ($KIND)"
echo "------------------------------------------------------------"

HDRS=$(curl -sSI -L "$URL" 2>/dev/null | tr -d '\r')
if [ -z "$HDRS" ]; then
  echo "FAIL  could not reach $URL"
  exit 1
fi

PASS=0
FAIL=0

check() {                     # check <label> <header> [must-contain]
  local label="$1" hdr="$2" needle="${3:-}"
  local line
  line=$(printf '%s\n' "$HDRS" | grep -i "^$hdr:" | head -1)
  if [ -z "$line" ]; then
    printf 'FAIL  %-34s missing\n' "$label"
    FAIL=$((FAIL+1)); return
  fi
  if [ -n "$needle" ] && ! printf '%s' "$line" | grep -qi -- "$needle"; then
    printf 'FAIL  %-34s present but missing "%s"\n' "$label" "$needle"
    FAIL=$((FAIL+1)); return
  fi
  printf 'PASS  %-34s\n' "$label"
  PASS=$((PASS+1))
}

check "Content-Security-Policy"     "content-security-policy"     "default-src 'none'"
check "  blocks framing"            "content-security-policy"     "frame-ancestors 'none'"
check "  reaches Supabase"          "content-security-policy"     "supabase.co"
check "  no inline script allowed"  "content-security-policy"     "script-src 'self'"
check "Strict-Transport-Security"   "strict-transport-security"   "max-age=31536000"
check "X-Content-Type-Options"      "x-content-type-options"      "nosniff"
check "X-Frame-Options"             "x-frame-options"             "DENY"
check "Referrer-Policy"             "referrer-policy"
check "Cross-Origin-Opener-Policy"  "cross-origin-opener-policy"  "same-origin"
check "Permissions-Policy"          "permissions-policy"          "camera=()"
check "Cache-Control"               "cache-control"               "no-store"

if [ "$KIND" = "admin" ]; then
  check "X-Robots-Tag (keep it unindexed)" "x-robots-tag"          "noindex"
  check "  no referrer leaves the console" "referrer-policy"       "no-referrer"
  check "  Entra endpoint allowed"         "content-security-policy" "login.microsoftonline.com"

  # The console must not be publicly reachable. A 200 here means
  # Deployment Protection is off and anyone with the URL sees the
  # sign-in page.
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -L "$URL")
  echo "------------------------------------------------------------"
  if [ "$CODE" = "200" ]; then
    echo "WARN  the console answered 200 to an anonymous request."
    echo "      Turn on Vercel Deployment Protection, or put Cloudflare"
    echo "      Access in front of it. Entra sign-in is still required to"
    echo "      see any data, but the console should not be reachable at"
    echo "      all by an anonymous visitor."
  else
    echo "PASS  anonymous request did not get through (HTTP $CODE)"
  fi
else
  # The applicant app is meant to be public, but must not allow Entra.
  if printf '%s\n' "$HDRS" | grep -i "^content-security-policy:" | grep -qi "login.microsoftonline.com"; then
    echo "FAIL  the applicant app allows the Entra endpoint. It signs in"
    echo "      with email OTP only; an injected script must not be able"
    echo "      to start an Entra flow here."
    FAIL=$((FAIL+1))
  else
    printf 'PASS  %-34s\n' "Entra endpoint correctly absent"
    PASS=$((PASS+1))
  fi
fi

echo "------------------------------------------------------------"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
