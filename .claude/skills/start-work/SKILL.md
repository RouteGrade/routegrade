---
name: start-work
description: Kick off the RouteGrade autonomous work loop for the day. Use whenever the user says "start work for today", "what's start work for today", "let's start work", "start the day", "kick off work", or any similar phrase asking to begin the company's work.
---

# Start Work

The founder just told you to start the company's work day. Do the following:

1. **Check for an already-running loop** — if a company-heartbeat loop is
   already active in this session, say so and stop; never start a second one.
2. **Sync state** — `git -C /workspace/routegrade pull --ff-only origin main`
   so the loop starts from the latest founder verdicts in
   `docs/PENDING_APPROVALS.md` and the latest backlog/log.
3. **Start the loop** — invoke the `loop` skill with args: `3h /company-heartbeat`.
   This runs one heartbeat cycle immediately, then every 3 hours for as long as
   this session stays open.
4. **Brief the founder** — after kicking it off, tell them in one or two
   sentences: the loop is running every 3 hours, progress lands in
   `docs/HEARTBEAT_LOG.md`, code ships on `heartbeat/*` branches/PRs for their
   review, and anything direction-level will wait for them in
   `docs/PENDING_APPROVALS.md`. Remind them the loop stops if this session closes.
