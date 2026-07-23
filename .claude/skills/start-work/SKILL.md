---
name: start-work
description: Kick off the RouteGrade autonomous work loop for the day. Use whenever the user says "start work for today", "what's start work for today", "let's start work", "start the day", "kick off work", or any similar phrase asking to begin the company's work.
---

# Start Work

The founder just told you to start the company's work day. Do the following:

1. **Check for an already-running loop** — if a company-heartbeat loop is
   already active in this session, say so and stop; never start a second one.
2. **Sync code state** — `git -C /workspace/routegrade pull --ff-only origin main`
   so the loop starts from the latest merged code. Company state (backlog,
   decisions, pending approvals, heartbeat log) lives in Notion now, not git —
   see `.claude/skills/company-heartbeat/SKILL.md` for the database links; it
   reads live, no pull needed for that part.
3. **Start the loop** — invoke the `loop` skill with args: `3h /company-heartbeat`.
   This runs one heartbeat cycle immediately, then every 3 hours for as long as
   this session stays open.
4. **Brief the founder** — after kicking it off, tell them in one or two
   sentences: the loop is running every 3 hours, progress lands in the
   Heartbeat Log database in Notion, code ships on `heartbeat/*` branches/PRs
   for their review, and anything direction-level will wait for them in the
   Pending Approvals database in Notion. Remind them the loop stops if this
   session closes.
