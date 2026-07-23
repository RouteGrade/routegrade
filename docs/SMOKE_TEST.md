# Production smoke test

> Also mirrored in Notion: [Smoke Test](https://app.notion.com/p/3a5dc99a2221818788b2d1defa95cb87). This file is the source of truth; re-sync the Notion copy when this changes materially.

`scripts/smoke-test.sh` is a self-contained shell smoke test for the
deployed RouteGrade web + API. It exists because production sign-in was
silently broken for days after MVP 4 (the callback URL redirected to
`localhost`, and nobody noticed until a real user tried to log in). This
script would have caught it on the deploy that shipped it.

## When to run

- **After every production deploy** of either `routegrade-web` or
  `routegrade-api`. The Vercel dashboard says "ready" — this script says
  "the endpoints a user actually touches still work."
- **Nightly / on a cron**, as a canary — providers or Supabase config can
  drift without a code change.
- **Ad hoc**, whenever something feels off in production.

Do **not** run it as your primary test suite. Unit / integration tests
still live under `services/api/tests` and the Next.js app's own build; the
smoke test only checks that the live deployment is answering correctly.

## How to run

```bash
# Defaults hit the production origins from docs/deployment.md
bash scripts/smoke-test.sh

# Override for a preview deploy or a staging env
WEB_ORIGIN=https://routegrade-web-git-branch.vercel.app \
API_ORIGIN=https://routegrade-api-git-branch.vercel.app \
  bash scripts/smoke-test.sh
```

Requires only `curl` and `jq` — both are on every CI runner and dev
machine. No node, no python, no secrets. Exit code is `0` on all-pass and
non-zero on any failure, so it's CI-safe.

## What each check catches

| # | Check | What it catches |
|---|---|---|
| 1 | `GET /health` returns `200` with `status=ok` | API is down, wrong URL, or crash on cold start |
| 2 | `GET /` returns `200` with the expected `<title>` | Web build shipped but layout metadata is broken |
| 3a | `GET /login` returns `200` | The auth route did not ship / 404s on the login page |
| 3b | `/login` HTML contains "Continue with Google" | Google sign-in button client component missing from bundle |
| 3c | `/login` HTML contains the magic-link form (`#magic-email` or button copy) | Email magic-link form missing from bundle |
| 3d | `/login` HTML contains **no** `localhost` URLs | **The bug that prompted this script**: `NEXT_PUBLIC_APP_URL` (or the Supabase URL) is unset in Vercel, so client-side auth links to `http://localhost` in production |
| 4 | `GET /auth/callback` returns 2xx/3xx (not 5xx) | Callback route throws — logins would fail silently |
| 5 | `POST /v1/routes/plan` with a valid Toronto payload returns `200` with `start` + `routes[]` | Planner is up, providers (Nominatim/OSRM/Open-Elevation) reachable, schema stable |
| 6 | `POST /v1/routes/plan` with an invalid payload returns `400/422` | Pydantic validation is wired — no 500 on bad user input |
| 7 | A burst of 25 posts to `/plan` eventually returns `429` with `Retry-After` | Per-IP rate limiter (`app/core/rate_limit.py`) is live — protects against provider-bill blowouts |
| 8 | `OPTIONS /v1/routes/plan` returns proper `Access-Control-Allow-Origin` = web origin, and `Allow-Methods` includes `POST` | Browser CORS preflight — if this fails, the web app cannot call the API from a real browser |
| 9 | `GET /v1/users/me`, `/v1/users/me/routes`, `/v1/users/me/runs` return `401/403` without a token | Auth-protected endpoints are actually protected — no anonymous data leak |

Every failing check prints a `FIX HINT` pointing at the most likely cause.

## How to add a new check

The script is deliberately flat — a script, not a framework. To add a
check, drop a new block into `scripts/smoke-test.sh` following the
pattern:

```bash
echo "${C_BOLD}[api]${C_OFF} my new thing"
CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$API_ORIGIN/v1/whatever" || echo "000")
if [[ "$CODE" == "200" ]]; then
  pass "GET /v1/whatever returns 200"
else
  fail "GET /v1/whatever returns 200" "got HTTP $CODE" "human-readable fix hint"
fi
```

Guidelines:

- **One check per concern.** If it's easier to describe as two sentences,
  it's two checks.
- **Always include a `FIX HINT`.** Future-you at 2 AM wants a pointer,
  not a mystery.
- **No retries, no soft skips.** A smoke test either passes or it fails;
  flakiness means the underlying system is flaky and needs fixing there.
- **Unauthenticated only.** The script must not handle secrets. Auth-
  protected endpoints get the 401-shape check.
- **Bound every `curl` with `--max-time`.** A hung request must not hang
  the whole test.
- **Prefer response-shape checks over deep-equality.** The smoke test
  should tolerate benign upstream noise (e.g. how many candidate routes
  the planner returns) while being strict about the contract.

## Interpreting a failure

Every failure that the script reports is a real production signal. Do
**not** modify the script to make a failing check pass — investigate the
underlying deployment first. If a check has been superseded (e.g. the
endpoint was renamed), update the check with a link to the change.
