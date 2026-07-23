#!/usr/bin/env bash
# RouteGrade production smoke test.
#
# Runs a small set of unauthenticated checks against the deployed web + API
# origins. Designed to be run by a human OR by CI after every prod deploy —
# it caught the "callback URL is localhost" auth outage that this script
# exists to prevent from happening again silently.
#
# Usage:
#   bash scripts/smoke-test.sh
#   WEB_ORIGIN=https://staging-web.example.com API_ORIGIN=https://staging-api.example.com bash scripts/smoke-test.sh
#
# Exits 0 if every check passes, non-zero otherwise. Requires curl and jq.

set -u
set -o pipefail

WEB_ORIGIN="${WEB_ORIGIN:-https://routegrade-web.vercel.app}"
API_ORIGIN="${API_ORIGIN:-https://routegrade-api.vercel.app}"

# Colors — disabled when stdout is not a TTY (CI, redirected logs).
if [[ -t 1 ]]; then
  C_GREEN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_YELLOW=$'\033[0;33m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_BOLD=""; C_OFF=""
fi

PASS_COUNT=0
FAIL_COUNT=0
FAIL_NAMES=()

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf "  %sPASS%s  %s\n" "$C_GREEN" "$C_OFF" "$1"
}
fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAIL_NAMES+=("$1")
  printf "  %sFAIL%s  %s\n" "$C_RED" "$C_OFF" "$1"
  if [[ -n "${2:-}" ]]; then printf "        %s\n" "$2"; fi
  if [[ -n "${3:-}" ]]; then printf "        %sFIX HINT:%s %s\n" "$C_YELLOW" "$C_OFF" "$3"; fi
}

require() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 2; }; }
require curl
require jq

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "${C_BOLD}RouteGrade smoke test${C_OFF}"
echo "  web:  $WEB_ORIGIN"
echo "  api:  $API_ORIGIN"
echo

# ---- 1. API /health returns 200 with a JSON status ok ----
echo "${C_BOLD}[api]${C_OFF} health"
HEALTH_BODY="$TMP/health.json"
HEALTH_CODE=$(curl -sS -o "$HEALTH_BODY" -w "%{http_code}" --max-time 15 "$API_ORIGIN/health" || echo "000")
if [[ "$HEALTH_CODE" != "200" ]]; then
  fail "GET /health returns 200" "got HTTP $HEALTH_CODE" "API is down or wrong URL — check Vercel dashboard for routegrade-api"
else
  STATUS=$(jq -r '.status // empty' <"$HEALTH_BODY" 2>/dev/null || true)
  if [[ "$STATUS" == "ok" ]]; then
    pass "GET /health returns 200 with status ok"
  else
    fail "GET /health body has status=ok" "body: $(head -c 200 "$HEALTH_BODY")" "API responded 200 but with unexpected shape — deploy may be broken"
  fi
fi

# ---- 2. Web root returns 200 with expected HTML markers ----
# Send the rg_guest cookie so the sign-in entry gate (proxy.ts) lets us through
# to the planner instead of 307-ing a cookieless visitor to /login — this check
# is about the root page's HTML, and the gate itself is exercised separately in
# the "sign-in entry gate" section below.
echo "${C_BOLD}[web]${C_OFF} public route explorer"
ROOT_BODY="$TMP/root.html"
ROOT_CODE=$(curl -sS -o "$ROOT_BODY" -w "%{http_code}" --max-time 20 -b "rg_guest=1" "$WEB_ORIGIN/" || echo "000")
if [[ "$ROOT_CODE" != "200" ]]; then
  fail "GET / returns 200" "got HTTP $ROOT_CODE" "Web app is down (or the rg_guest gate bypass broke) — check Vercel dashboard for routegrade-web"
else
  if grep -q "RouteGrade — Run routes, graded" "$ROOT_BODY"; then
    pass "GET / has expected page title"
  else
    fail "GET / has expected page title" "title tag missing 'RouteGrade — Run routes, graded'" "Web build shipped without the layout metadata — check apps/web build output"
  fi
fi

# ---- 3. Sign-in entry gate (proxy.ts) behaves correctly ----
# PR #10 added a first-touch gate: a cookieless, unauthenticated visitor to "/"
# is 307-redirected to /login; anyone with the rg_guest cookie (or a real
# session) is let straight through. The gate is a no-op unless Supabase env is
# configured, so in production these all exercise the live gate.
echo "${C_BOLD}[web]${C_OFF} sign-in entry gate"

# 3a. Cookieless GET / redirects (307) to /login. Do NOT follow the redirect
# (no -L) — we assert on the status + Location header directly.
GATE_HEADERS="$TMP/gate.headers"
GATE_CODE=$(curl -sS -o /dev/null -D "$GATE_HEADERS" -w "%{http_code}" --max-time 20 "$WEB_ORIGIN/" || echo "000")
GATE_LOCATION=$(grep -i "^location:" "$GATE_HEADERS" | tr -d '\r' | awk -F': ' '{print $2}' | head -1)
if [[ "$GATE_CODE" =~ ^(302|307)$ && "$GATE_LOCATION" == */login* ]]; then
  pass "GET / (no rg_guest cookie) redirects to /login ($GATE_CODE)"
else
  fail "GET / (no rg_guest cookie) redirects to /login" \
       "got HTTP $GATE_CODE, Location: ${GATE_LOCATION:-<none>}" \
       "entry gate not firing: proxy.ts should 307 a cookieless, unauthenticated visitor from / to /login — confirm NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set in Vercel (the gate no-ops when Supabase is unconfigured)"
fi

# 3b. GET / WITH the rg_guest cookie is let straight through (200) — proves the
# gate is actually bypassable by the cookie, not just that it redirects.
GATE_BYPASS_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 -b "rg_guest=1" "$WEB_ORIGIN/" || echo "000")
if [[ "$GATE_BYPASS_CODE" == "200" ]]; then
  pass "GET / with rg_guest cookie returns 200 (gate bypassable)"
else
  fail "GET / with rg_guest cookie returns 200" \
       "got HTTP $GATE_BYPASS_CODE" \
       "the rg_guest cookie should let a returning guest skip the gate and load the planner — check the cookie name/logic in apps/web/src/proxy.ts"
fi

# 3c. POST /auth/guest sets the rg_guest cookie and 303-redirects onward. Send a
# real urlencoded form body so the route's request.formData() has something to
# parse. Don't follow the redirect — assert on status + Set-Cookie directly.
GUEST_HEADERS="$TMP/guest.headers"
GUEST_CODE=$(curl -sS -o /dev/null -D "$GUEST_HEADERS" -w "%{http_code}" --max-time 20 \
  -X POST "$WEB_ORIGIN/auth/guest" --data "next=/" || echo "000")
if [[ "$GUEST_CODE" != "303" ]]; then
  fail "POST /auth/guest returns 303" \
       "got HTTP $GUEST_CODE" \
       "\"Continue as guest\" is broken: POST /auth/guest should 303-redirect — check apps/web/src/app/auth/guest/route.ts"
elif grep -qi "^set-cookie:.*rg_guest" "$GUEST_HEADERS"; then
  pass "POST /auth/guest returns 303 and sets the rg_guest cookie"
else
  fail "POST /auth/guest sets an rg_guest cookie" \
       "303 returned but no 'Set-Cookie: rg_guest' header found" \
       "guest route redirected but never set the cookie — the gate would show again on the next visit; check response.cookies.set(\"rg_guest\", ...) in apps/web/src/app/auth/guest/route.ts"
fi

# ---- 4. Web /login has references to BOTH sign-in methods AND no localhost leak ----
echo "${C_BOLD}[web]${C_OFF} login page (guards the auth-callback-URL bug)"
LOGIN_BODY="$TMP/login.html"
LOGIN_CODE=$(curl -sS -o "$LOGIN_BODY" -w "%{http_code}" --max-time 20 "$WEB_ORIGIN/login" || echo "000")
if [[ "$LOGIN_CODE" != "200" ]]; then
  fail "GET /login returns 200" "got HTTP $LOGIN_CODE" "404 on /login: check Vercel build output — auth route may not have shipped"
else
  pass "GET /login returns 200"
  if grep -qi "Continue with Google" "$LOGIN_BODY"; then
    pass "GET /login renders the Google sign-in button"
  else
    fail "GET /login renders the Google sign-in button" "no 'Continue with Google' text found" "Login page rendered but Google button missing — GoogleSignInButton client component may have failed to hydrate"
  fi
  # Email sign-in: the form has id="magic-email" and label copy "Email me a sign-in link".
  if grep -q 'id="magic-email"' "$LOGIN_BODY" || grep -qi "Email me a sign-in link" "$LOGIN_BODY"; then
    pass "GET /login renders the email magic-link form"
  else
    fail "GET /login renders the email magic-link form" "no #magic-email input and no magic-link button text" "EmailMagicLinkForm client component missing from bundle"
  fi
  # Localhost leak — the whole point of this smoke test. Any 'localhost' reference in the
  # rendered login HTML means NEXT_PUBLIC_APP_URL / SUPABASE_URL was not set for production.
  if grep -qi "localhost" "$LOGIN_BODY"; then
    LEAK=$(grep -oi "http[s]*://localhost[^\"' ]*" "$LOGIN_BODY" | head -3 | tr '\n' ' ')
    fail "GET /login contains no localhost URLs" "found: $LEAK" "callback URL contains 'localhost': set NEXT_PUBLIC_APP_URL in Vercel and redeploy"
  else
    pass "GET /login contains no localhost URLs (auth callback bug guard)"
  fi
fi

# ---- 5. Web /auth/callback returns something sane (not 500) ----
echo "${C_BOLD}[web]${C_OFF} auth callback"
CB_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$WEB_ORIGIN/auth/callback" || echo "000")
# Expected: 302/307 (redirect to /login?error=callback with no code) OR 200.
# Absolutely NOT expected: 5xx (unhandled server error) or 000 (network fail).
if [[ "$CB_CODE" =~ ^(200|302|303|307|308)$ ]]; then
  pass "GET /auth/callback returns sane status ($CB_CODE)"
else
  fail "GET /auth/callback returns sane status" "got HTTP $CB_CODE (expected 2xx or 3xx)" "callback route is throwing — check Vercel function logs for /auth/callback"
fi

# ---- 6. POST /v1/routes/plan with valid Toronto payload returns 200 with expected shape ----
echo "${C_BOLD}[api]${C_OFF} route planning"
PLAN_BODY="$TMP/plan.json"
PLAN_HEADERS="$TMP/plan.headers"
PLAN_REQ='{"latitude":43.6532,"longitude":-79.3832,"distance_km":5,"preference":"quiet"}'
PLAN_CODE=$(curl -sS -o "$PLAN_BODY" -D "$PLAN_HEADERS" -w "%{http_code}" \
  --max-time 45 \
  -H "Content-Type: application/json" \
  -H "Origin: $WEB_ORIGIN" \
  -X POST "$API_ORIGIN/v1/routes/plan" \
  --data "$PLAN_REQ" || echo "000")
if [[ "$PLAN_CODE" != "200" ]]; then
  fail "POST /v1/routes/plan (valid Toronto payload) returns 200" \
       "got HTTP $PLAN_CODE, body: $(head -c 200 "$PLAN_BODY")" \
       "planner failed — an upstream provider (Nominatim/OSRM/Open-Elevation) may be down; retry, then check services/api/app/providers"
else
  HAS_START=$(jq 'has("start")' <"$PLAN_BODY" 2>/dev/null || echo false)
  HAS_ROUTES=$(jq '.routes | type == "array"' <"$PLAN_BODY" 2>/dev/null || echo false)
  if [[ "$HAS_START" == "true" && "$HAS_ROUTES" == "true" ]]; then
    N=$(jq '.routes | length' <"$PLAN_BODY")
    pass "POST /v1/routes/plan returns 200 with start + routes[] (n=$N)"
  else
    fail "POST /v1/routes/plan returns expected shape" \
         "missing start or routes[] in response" \
         "PlanResponse schema drift — check services/api/app/schemas/routes.py vs the deployed build"
  fi
fi

# ---- 7. POST /v1/routes/plan with an invalid payload returns 400/422 (not 500) ----
INVALID_REQ='{"distance_km":5}'  # no address, no coords
INVALID_BODY="$TMP/invalid.json"
INVALID_CODE=$(curl -sS -o "$INVALID_BODY" -w "%{http_code}" --max-time 15 \
  -H "Content-Type: application/json" \
  -X POST "$API_ORIGIN/v1/routes/plan" \
  --data "$INVALID_REQ" || echo "000")
if [[ "$INVALID_CODE" == "400" || "$INVALID_CODE" == "422" ]]; then
  pass "POST /v1/routes/plan (invalid payload) returns $INVALID_CODE"
else
  fail "POST /v1/routes/plan (invalid payload) returns 400/422" \
       "got HTTP $INVALID_CODE" \
       "planner is 500-ing on bad input — validator not shipped, check pydantic schema on deployed API"
fi

# ---- 8. Rate-limit behavior on /v1/routes/plan ----
# The API code (plans.py + core/rate_limit.py) sets Retry-After ONLY on the 429
# response — normal 200s have no rate-limit headers. Verify the limiter is
# actually wired by bursting fast requests until we see a 429 with Retry-After.
# The 429 is returned by the dependency BEFORE any provider call, so it is fast.
echo "${C_BOLD}[api]${C_OFF} rate limiter"
RL_TRIPPED=false
RL_HAS_RETRY_AFTER=false
for i in $(seq 1 25); do
  RL_HEADERS="$TMP/rl-$i.headers"
  RL_CODE=$(curl -sS -o /dev/null -D "$RL_HEADERS" -w "%{http_code}" --max-time 4 \
    -H "Content-Type: application/json" \
    -X POST "$API_ORIGIN/v1/routes/plan" \
    --data "$PLAN_REQ" 2>/dev/null || echo "000")
  if [[ "$RL_CODE" == "429" ]]; then
    RL_TRIPPED=true
    if grep -qi "^retry-after:" "$RL_HEADERS"; then
      RL_HAS_RETRY_AFTER=true
    fi
    break
  fi
done
if [[ "$RL_TRIPPED" == "true" && "$RL_HAS_RETRY_AFTER" == "true" ]]; then
  pass "POST /v1/routes/plan trips 429 with Retry-After header (rate limiter live)"
elif [[ "$RL_TRIPPED" == "true" ]]; then
  fail "429 response includes Retry-After header" \
       "got 429 without Retry-After" \
       "limiter is firing but not returning Retry-After — check app/api/routes/plans.py enforce_plan_rate_limit"
else
  fail "POST /v1/routes/plan rate limit is wired" \
       "burst of 25 requests never returned 429" \
       "rate limiter disabled or per-instance limit far too generous — check ROUTE_PLAN_RATE_LIMIT_PER_MINUTE in Vercel env"
fi

# ---- 9. CORS preflight OPTIONS on /v1/routes/plan ----
echo "${C_BOLD}[api]${C_OFF} CORS preflight"
CORS_HEADERS="$TMP/cors.headers"
CORS_CODE=$(curl -sS -o /dev/null -D "$CORS_HEADERS" -w "%{http_code}" --max-time 15 \
  -X OPTIONS "$API_ORIGIN/v1/routes/plan" \
  -H "Origin: $WEB_ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" || echo "000")
if [[ "$CORS_CODE" != "200" && "$CORS_CODE" != "204" ]]; then
  fail "OPTIONS /v1/routes/plan returns 2xx" "got HTTP $CORS_CODE" "CORS middleware not responding — the browser will refuse to POST from the web app"
else
  ALLOW_ORIGIN=$(grep -i "^access-control-allow-origin:" "$CORS_HEADERS" | tr -d '\r' | awk -F': ' '{print $2}' | head -1)
  ALLOW_METHODS=$(grep -i "^access-control-allow-methods:" "$CORS_HEADERS" | tr -d '\r' | awk -F': ' '{print $2}' | head -1)
  if [[ -n "$ALLOW_ORIGIN" && "$ALLOW_ORIGIN" == "$WEB_ORIGIN" ]]; then
    pass "CORS Access-Control-Allow-Origin = $WEB_ORIGIN"
  else
    fail "CORS Access-Control-Allow-Origin matches web origin" \
         "got '$ALLOW_ORIGIN', expected '$WEB_ORIGIN'" \
         "add $WEB_ORIGIN to CORS_ORIGINS in the routegrade-api Vercel env and redeploy"
  fi
  if [[ -n "$ALLOW_METHODS" && "$ALLOW_METHODS" == *POST* ]]; then
    pass "CORS Access-Control-Allow-Methods includes POST"
  else
    fail "CORS Access-Control-Allow-Methods includes POST" \
         "got '$ALLOW_METHODS'" \
         "CORSMiddleware in app/main.py should allow POST — check deployed build"
  fi
fi

# ---- 10. Auth-protected GETs return 401 without a token ----
echo "${C_BOLD}[api]${C_OFF} auth-protected endpoints reject anon"
for path in "/v1/users/me" "/v1/users/me/routes" "/v1/users/me/runs"; do
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$API_ORIGIN$path" || echo "000")
  # 401 is the expected "no token"; 403 also acceptable. Anything else — especially
  # 200 or 500 — is a bug and MUST NOT leak existence or crash.
  if [[ "$CODE" == "401" || "$CODE" == "403" ]]; then
    pass "GET $path (no token) returns $CODE"
  else
    fail "GET $path (no token) returns 401/403" "got HTTP $CODE" "auth dependency not wired on $path — this may be leaking data; check app/auth/dependencies.py"
  fi
done

# ---- Summary ----
echo
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  printf "%sAll %d checks passed.%s\n" "$C_GREEN$C_BOLD" "$TOTAL" "$C_OFF"
  exit 0
else
  printf "%s%d passed, %d failed (of %d).%s\n" "$C_RED$C_BOLD" "$PASS_COUNT" "$FAIL_COUNT" "$TOTAL" "$C_OFF"
  printf "Failing checks:\n"
  for name in "${FAIL_NAMES[@]}"; do printf "  - %s\n" "$name"; done
  exit 1
fi
