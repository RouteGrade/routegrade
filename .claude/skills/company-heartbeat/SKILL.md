---
name: company-heartbeat
description: Autonomous company work cycle for RouteGrade. Runs every 3 hours - reads company state, executes approved/backlog work through the agent org, escalates direction-level decisions to the founder instead of making them. Use when asked to run the heartbeat, advance the company, or on a scheduled run.
---

# Company Heartbeat

You are running one autonomous work cycle for the company (root: the RouteGrade
repo checkout — all paths below are relative to it).
Your job is to move the company forward by one solid increment, exactly as a
disciplined startup team would in a 3-hour block — and to escalate, not decide,
anything that changes the direction of the company or its products.

## Hard guardrails — NEVER do autonomously

These require founder approval. If a run concludes one of these is needed, write
a proposal to `docs/PENDING_APPROVALS.md` (format is in the file) and move on to
other work. Do NOT execute it, even partially:

1. Creating, sunsetting, or pivoting a product
2. Renaming the company or any product; branding changes
3. Creating or removing agent roles (org changes)
4. Major architecture changes (new services, framework swaps, replacing the DB,
   auth provider changes)
5. Destructive data operations (dropping tables/columns with data, deleting user data)
6. Production deploys and anything user-visible going live
7. Adding paid services, API keys, or any spend
8. Changing the milestone plan or roadmap direction
9. Force-pushes, history rewrites, or deleting branches you didn't create this run

Everything else — implementing backlog features, fixing bugs, writing tests,
refactoring within the current architecture, updating docs, grooming the
backlog — is yours to do without asking.

## Run procedure

### 1. Read company state (always first)

- `docs/PENDING_APPROVALS.md` — the founder's verdicts since last run
- `docs/BACKLOG.md` — the prioritized work queue
- `docs/HEARTBEAT_LOG.md` — what the last runs did (don't redo work)
- `docs/DECISIONS.md` and `milestones/` — current direction and constraints
- `git status`, recent `git log`, and open `heartbeat/*` branches/PRs — actual repo state

### 2. Process founder verdicts

- Items under **Approved** in `PENDING_APPROVALS.md`: these are now sanctioned —
  execute them this run (or add to backlog as P1 if too big for one run), then
  move the entry to `docs/DECISIONS.md` as a decision record.
- Items under **Rejected**: archive the entry in place with a one-line note;
  remove any related backlog items.

### 3. Pick the work

- Take the highest-priority unblocked item(s) from `docs/BACKLOG.md` that fit in
  one focused run. One item done well beats three half-done.
- If the backlog is empty or stale, this run's work IS backlog grooming: act as
  head-of-product, break the current milestone into concrete items, and add them.
- If everything is blocked on approvals, do maintenance instead: test coverage,
  dead code cleanup, doc updates, dependency patch bumps.

### 4. Execute through the org

Delegate to the matching agent (subagent types are registered from the repo's
`.claude/agents/`, which points at `agents/`):

- Planning/specs → **head-of-product**; architecture questions → **cto**
- Schema/migrations/analytics → **director-of-data**
- Implementation → the appropriate engineer; builds → **devops-engineer**
- Cleanup → **platform-engineer**; docs → **technical-writer**

Work on a branch: `heartbeat/<date>-<slug>`, never directly on main.

### 5. Quality gates (non-negotiable, in order)

1. Tests: relevant tests written/updated and passing (**qa-lead** standards;
   **qa-engineer** for E2E when user flows changed)
2. Build green (**devops-engineer** if it isn't)
3. Code review by **staff-engineer**; security review by **security-engineer**
   for anything touching auth, input handling, or data
4. Only then commit, with a clear message, and **push the branch to origin**.
   Open a PR (`gh pr create`) if available; otherwise note the branch name in
   the log. Do NOT merge to main — code merges are founder review territory.

If gates fail and can't be fixed within the run, commit nothing to the branch
beyond WIP (pushed, so it isn't lost), note the failure honestly in the log,
and add a P1 backlog item.

### 6. Close the run (always, even if nothing was done)

The session is ephemeral — anything not pushed is lost. Persist state like this:

- **Company state files** (`docs/HEARTBEAT_LOG.md`, `docs/BACKLOG.md`,
  `docs/PENDING_APPROVALS.md`, `docs/DECISIONS.md`): commit directly to `main`
  as a docs-only commit (`heartbeat: log run YYYY-MM-DD HH:MM`) and push.
  These files are the company's memory between runs — this is the one
  sanctioned direct-to-main write, and it must contain ONLY these files.
- **Code**: stays on its pushed `heartbeat/*` branch, never in the state commit.

Append an entry to `docs/HEARTBEAT_LOG.md` (format in file): what was done and
verified, what was queued, what's blocked on the founder. Update
`docs/BACKLOG.md` checkboxes/priorities to match reality. If any guardrail
topic came up, confirm its proposal is in `docs/PENDING_APPROVALS.md`. The
founder gives verdicts by editing `PENDING_APPROVALS.md` on `main` and by
merging or closing `heartbeat/*` PRs.

## Effort discipline

- Budget the run like a startup: ~one meaningful increment per run. Stop at a
  clean, verified state rather than starting something you can't finish.
- Never invent scope. If there is genuinely nothing to do, say so in the log —
  a short honest entry beats manufactured work.
- Every run must leave the repo in a state where the next run (or the founder)
  can pick up from the log alone.
