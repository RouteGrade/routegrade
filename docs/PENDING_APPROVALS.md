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
- **Proposal**: Pick the scope for MVP 6. A P1 backlog item will produce a
  written proposal with 2-3 candidate scopes (scoring v2 + feedback loop vs.
  social/sharing vs. provider hardening) and effort/risk for each.
- **Recommendation**: Wait for the written proposal (next heartbeat runs), then
  decide here.
- **Options**: to be detailed in the proposal.

## Approved

## Rejected
