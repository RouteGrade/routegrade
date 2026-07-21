# Pending Approvals

Decisions the autonomous heartbeat is NOT allowed to make. Each entry needs a
human (founder) verdict. The heartbeat reads this file every run: entries under
**Approved** get executed and moved to `DECISIONS.md`; entries under **Rejected**
get archived with the reason; entries under **Awaiting decision** are left alone.

Entry format:

```markdown
### <title>
- **Raised**: YYYY-MM-DD by <agent>
- **Type**: new-product | direction-change | architecture | schema-destructive | deploy | spend | org-change | other
- **Proposal**: what is being proposed
- **Recommendation**: what the raising agent recommends and why
- **Options**: alternatives considered
```

## Awaiting decision

### Self-host OSRM with the `foot` profile
- **Raised**: 2026-07-21 by head-of-product
- **Type**: architecture + spend + deploy
- **Proposal**: Stand up a self-hosted OSRM instance built from the Geofabrik
  Ontario extract with the `foot` profile (setup already documented in
  `docs/routing-setup.md`).
- **Recommendation**: Approve first, ahead of everything else awaiting decision.
  Production currently grades RUNNING routes using the public OSRM demo's
  `driving` profile — cars, not runners — which undermines the core product
  claim. This is the single biggest credibility gap in the product.
- **Options**: (a) self-host OSRM foot profile (recommended); (b) pay for a
  hosted routing API with a foot profile; (c) accept driving-profile routing
  until MVP 6 (not recommended).

### Move rate limiting to Redis/Upstash
- **Raised**: 2026-07-21 by head-of-product
- **Type**: spend
- **Proposal**: Back the existing `check()` interface in
  `app/core/rate_limit.py` with Redis (e.g. Upstash free tier) instead of the
  per-instance in-memory bucket.
- **Recommendation**: Approve when convenient. Current limiter multiplies by
  Vercel instance count and resets on cold starts, so real limits are much
  looser than configured.
- **Options**: (a) Upstash Redis (recommended, has free tier); (b) keep
  in-memory and accept loose limits; (c) Vercel KV.

### Adopt a hosted production tile provider
- **Raised**: 2026-07-21 by head-of-product
- **Type**: spend + direction-change
- **Proposal**: Choose a MapLibre-compatible hosted tile provider (with proper
  attribution) for production maps.
- **Recommendation**: Decide before any public beta. README explicitly forbids
  the current OpenFreeMap default beyond local dev.
- **Options**: MapTiler, Stadia Maps, Protomaps self-hosted PMTiles.

### Founder manual action: Supabase auth redirect allow-list
- **Raised**: 2026-07-21 by head-of-product
- **Type**: other (production auth config — founder dashboard access only)
- **Proposal**: Add `https://routegrade-web.vercel.app/auth/callback` to the
  Supabase Auth redirect allow-list.
- **Recommendation**: Do this now — production sign-in is broken/bouncing to
  localhost until it's done (open MS4 follow-up). No code change involved.
- **Options**: n/a

### Adopt an MVP 6 scope
- **Raised**: 2026-07-21 by head-of-product
- **Type**: direction-change
- **Proposal**: Pick one of the three scopes below as MVP 6. Context: code is at
  MVP 5 (live run tracking with GPS, splits, audio cues, `public.runs` —
  commit `da6bf78`) on a public Vercel deployment. The heartbeat has no
  destination once the current P1 cleanup (doc truth-up, runs analytics,
  MVP 5 security review) lands. Infra decisions already awaiting verdict in
  this file — self-hosted OSRM `foot` profile, Redis rate limiting, hosted
  tile provider, Supabase redirect allow-list — are referenced as dependencies
  below, not re-proposed.
- **Recommendation**: **Option A (Scoring v2 + feedback loop), gated on
  approving the pending OSRM `foot`-profile item first.** Reasoning: the
  product's one claim is that the grade means something, and today it is
  doubly hollow — routes are computed on the public OSRM demo's `driving`
  profile (cars, not runners), and scoring v1 is uncalibrated heuristics with
  sidewalks stubbed to a flat 50 and no scenery signal (`docs/scoring.md`
  known limits 1–5). Pre-users, the only thing that will earn a first cohort
  is a grade that survives scrutiny; nobody churns off features we don't have
  yet. Option B (social) amplifies distribution of a grade we can't yet
  defend, to an audience of zero. Option C is real but is mostly the
  execution vehicle for items already individually raised here or sitting as
  P2s in `docs/BACKLOG.md` (plan cache, CI, Overpass sidewalks) — it doesn't
  need a whole milestone; its two blocking pieces (foot profile, tile
  provider) should be approved as the standing infra items and folded in as
  Option A's phase 0. If the OSRM foot item is rejected, fall back to
  Option C, because shipping scoring v2 on driving-profile geometry
  calibrates against the wrong roads.
- **Options**:

#### Option A — Scoring v2 + user feedback loop ("make the grade trustworthy")

**Pitch**: Turn the grade from a heuristic into the product. Replace the two
stubbed/proxied scoring inputs with real measurements, add the missing scenery
signal, show users *why* a route earned its grade, and start capturing
ground truth (explicit feedback plus the run telemetry we already store in
`public.runs`) so weights can be calibrated instead of guessed. This directly
attacks every known limit listed in `docs/scoring.md` and converts MVP 5's run
data from dead weight into the calibration asset only we have.

**Deliverables**:
- Phase 0: cut `OSRM_BASE_URL`/`OSRM_PROFILE` over to the self-hosted `foot`
  instance once approved, and re-verify loop generation tolerance (±10%) on
  pedestrian geometry.
- Overpass-based sidewalk-coverage estimator behind the existing
  `sidewalk_coverage` field in `app/services/scoring.py`, with graceful
  fallback to neutral 50 (absorbs the existing P2 backlog item).
- Real intersection density from OSM node-degree analysis, replacing the
  maneuver-count proxy (absorbs the existing P3 backlog item).
- Scenery signal for the `scenic` preference: parks/waterfront/green-space
  proximity via Overpass, so `scenic` stops silently reusing default weights.
- Route feedback capture: additive Alembic migration for a `route_feedback`
  table + `POST /v1/routes/{id}/feedback` (grade agreement thumbs + optional
  tags: traffic, lighting, surface), with a lightweight prompt in the web UI
  after viewing a route and after finishing a run.
- Grade explanation UI on the route card: per-factor sub-scores and one-line
  reasons, replacing the bare letter grade.
- Calibration harness: dbt models joining `route_feedback` + `runs` against
  stored scores, plus a documented scoring v2 weights revision in
  `docs/scoring.md` (weight changes themselves stay heuristic until feedback
  volume exists — the loop is the deliverable).
- Regression tests for every new scoring input and the feedback endpoints.

**Effort**: 5–7 heartbeat-runs (Overpass integrations 2, node-degree analysis
1, scenery 1, feedback schema/API/UI 1.5, explanation UI + docs/tests 1).

**Key risks**: Overpass public endpoints are rate-limited and flaky — needs
caching and fallbacks or a paid mirror; OSM sidewalk/park tag coverage in
Toronto may be too sparse to score honestly (mitigation: audit tag density
first, keep the neutral fallback and label unknowns); feedback volume will be
~0 pre-users, so calibration is infrastructure, not results, this milestone.

**Depends on pending approvals**: OSRM `foot` profile (hard prerequisite —
calibrating on driving geometry is calibrating the wrong thing); Redis rate
limiting (soft — Overpass fan-out raises per-request provider cost).

#### Option B — Social & sharing ("routes are better with witnesses")

**Pitch**: Make routes and runs shareable objects. A public, no-login route
page turns every saved route into a distribution channel; shared run summaries
give runners a reason to come back; "routes near me" seeds discovery. This is
the classic growth bet: the product already produces artifacts people might
show off (graded loops, finished runs with splits), and sharing is the
cheapest acquisition loop a pre-marketing company can build.

**Deliverables**:
- Public route pages at `/routes/{slug}`: map, grade, factor breakdown, no
  auth required; owner-controlled public/private toggle on saved routes
  (additive migration: slug + visibility on `saved_routes`).
- Share affordances in the web app (copy link, OG/social preview image
  rendered from route geometry + grade).
- Shareable run summary page: distance, time, splits, map trace — with
  explicit opt-in, since GPS traces are home-address-adjacent PII.
- "Routes near me": PostGIS enablement + geo index (the deferred upgrade from
  `docs/routing-setup.md` Phase 0) and a `GET /v1/routes/nearby` endpoint.
- Public browse/discover page listing top-graded public routes per area.
- Abuse basics: rate limits on public reads, report mechanism, private-by-
  default everywhere.
- Analytics: dbt models for shares, public-page views, and signup attribution.

**Effort**: 6–8 heartbeat-runs (public pages + visibility 1.5, OG images 1,
run sharing 1, PostGIS + nearby 2, discover + abuse + analytics 1.5).

**Key risks**: We are pre-users — sharing features with no sharers produce
zero loops and the milestone teaches us nothing; every public page broadcasts
a grade scoring v1 can't defend, computed on car routing (reputational risk at
first contact); GPS-trace privacy is a real liability if defaults are wrong;
PostGIS migration touches the geometry storage decision and is the scope's
biggest unknown.

**Depends on pending approvals**: hosted tile provider (hard — public pages
are exactly the "beyond local dev" traffic the README forbids on OpenFreeMap);
OSRM `foot` profile (hard for credibility); Redis rate limiting (hard — public
unauthenticated pages multiply abuse surface).

#### Option C — Production hardening ("make the existing claim true")

**Pitch**: Ship no new surface; make what exists real. Today the deployed
product routes runners along car roads from a demo server we don't control,
rate-limits per serverless instance, has 67+ tests that never run in CI, no
monitoring, and docs two milestones behind the code. This scope executes the
standing infra approvals and retires every "before public launch" caveat in
`README.md` and `docs/routing-setup.md`, so that the next feature milestone
ships onto a foundation instead of a demo.

**Deliverables**:
- Deploy self-hosted OSRM (`foot`, Ontario extract per
  `docs/routing-setup.md`) and cut production over; verify loop quality on
  pedestrian geometry.
- Production tile provider integration with correct attribution, replacing
  the dev-only OpenFreeMap default.
- Redis/Upstash-backed rate limiter behind the existing `check()` interface
  in `app/core/rate_limit.py`, extended to cover runs and saved-routes
  endpoints.
- `route_plans` cache table keyed on `(start, distance, preference)` to cut
  the 10–20 s repeat latency and provider fan-out (absorbs the P2 backlog
  item).
- GitHub Actions CI: pytest + ruff, `pnpm lint` + `pnpm build`, `dbt parse`
  on every push (absorbs the P2 backlog item).
- Error tracking + uptime monitoring (e.g. Sentry free tier + a health-check
  pinger) with alerting to the founder.
- Scripted post-deploy smoke test (health, live plan, CORS, auth callback,
  save + run persist — absorbs the P3 backlog item) and a docs truth-up pass.

**Effort**: 4–6 heartbeat-runs (OSRM deploy + cutover 1.5, tiles 0.5, Redis
0.5, cache table 1, CI 0.5, monitoring 1, smoke + docs 1) — plus founder-side
spend/hosting actions the heartbeat cannot take alone.

**Key risks**: Zero user-visible progress for a milestone (acceptable
pre-users, but it delays learning anything about the grade itself); OSRM
hosting needs a persistent host — Ontario `foot` MLD data does not fit
Vercel's serverless model, so this introduces the company's first
always-on infra cost and ops burden; most items are approval-blocked, so the
milestone stalls entirely if the infra verdicts don't land first.

**Depends on pending approvals**: this option *is* largely the execution of
the pending OSRM `foot`, Redis/Upstash, and tile-provider entries plus the
Supabase redirect fix — approving Option C without approving those items
approves nothing.

## Approved

## Rejected
