# Company Decision Log

Written record of every company-level decision (see `agents/ceo.md` for the
decision process). Newest first.

## Decision: MVP 6 scope — ALL THREE options (A + B + C)
- **Date**: 2026-07-21
- **Decision**: Founder approved implementing all three proposed MVP 6 scopes:
  A (scoring v2 + feedback loop), B (social/sharing), C (production hardening).
  Execution order set by orchestrator: **C → A → B** — hardening first because
  it unblocks A's hard prerequisite (OSRM `foot` profile) and B's (tile
  provider), and social ships last so public pages broadcast a grade the
  company can defend. This verdict also approves-in-principle the three infra
  items C consists of (self-hosted OSRM `foot`, Redis/Upstash rate limiting,
  hosted tile provider); their *activation* still needs founder-side accounts,
  hosts, and API keys — the heartbeat implements everything code-side behind
  env vars and lists the exact founder actions in `PENDING_APPROVALS.md`.
- **Rationale**: Founder chose breadth over the head-of-product's single-option
  recommendation; combined effort estimate 15–21 heartbeat runs.
- **Effort budget**: ~15–21 heartbeat runs across C, A, B phases.
- **Owner**: head-of-product (plan), cto (architecture), all engineers (execution)
- **Revisit by**: 2026-08-04 (check phase C completion)

## Decision: Adopt startup org structure and autonomous heartbeat
- **Date**: 2026-07-21
- **Decision**: Renamed all agents to startup roles (ceo, cto, head-of-product,
  director-of-data, staff-engineer, devops-engineer, platform-engineer, qa-lead,
  qa-engineer, security-engineer, technical-writer). Company work is driven by an
  automated heartbeat every 3 hours; anything that changes company/product
  direction requires founder approval via `PENDING_APPROVALS.md`.
- **Rationale**: Fully automated pipeline requested by founder, with human
  control retained over CEO/CTO-level and direction-changing decisions.
- **Effort budget**: n/a (structural)
- **Owner**: ceo
- **Revisit by**: 2026-08-21
