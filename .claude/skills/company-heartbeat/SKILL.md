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

## Company operating state lives in Notion, not git

As of 2026-07-22, the four state files that used to live under `docs/` were
migrated to Notion databases. **Notion is now the source of truth** — read and
write these via the `mcp__notion__*` tools, not the filesystem. The old
`docs/*.md` files are frozen historical snapshots (each has a banner pointing
here) and must not be read or written by heartbeat runs.

All of these live under the **Engineering Docs** page
(`https://app.notion.com/p/3a5dc99a222181c3af65db78a0b33d56`) in the
**RouteGrade** Notion workspace:

| State | Notion database | Data source ID (for `query_data_sources`) |
| --- | --- | --- |
| Backlog | https://app.notion.com/p/8e3359fcb6634485b221b35fa3819a4f | `bf94637c-9071-4d16-af2d-4966c7beacd4` |
| Decisions Log | https://app.notion.com/p/97f6f76a019945ceaafd609e4ed3ae46 | `78a28a8e-bf10-4f2c-8db0-628b0dfdedcf` |
| Heartbeat Log | https://app.notion.com/p/4d0f2abcc32346a0bbb05964049cdc02 | `6f74446f-8a92-4b98-8713-33c4ec987403` |
| Pending Approvals | https://app.notion.com/p/e718a8d7a21b4bcc848a151991cc040d | `aabc1618-77c6-46a1-b12f-393269b6da7c` |
| Open MRs | https://app.notion.com/p/8acfdf0e8f78499682617ed7740409b4 | `29e351ba-1f5d-4910-8691-82bc06a1f259` |

Plus one plain page (not a database — the founder appends free-form, no
properties to fill in):

| State | Notion page |
| --- | --- |
| Founder Requests | https://app.notion.com/p/3a6dc99a2221813a9548cba3c71cd6c9 |

**Reading**: prefer `mcp__notion__notion-query-data-sources` against the data
source ID. If that tool is unavailable (its plan tier can lapse — check
`notion-fetch` on `id: "self"` for `current_tool_access` if queries start
failing), fall back to `mcp__notion__notion-fetch` on the database URL for
schema + a page listing, or `mcp__notion__notion-search` with
`data_source_url` set to `collection://<data source ID>`.

**Writing**: `mcp__notion__notion-create-pages` with
`parent: {"type": "data_source_id", "data_source_id": "<id>"}` to add rows;
`mcp__notion__notion-update-page` with `command: "update_properties"` to
change a row's `Status` or other fields. Always `notion-fetch` the data
source first if you don't already have its exact property names/options from
the table above — property names are case- and space-sensitive.

Reference docs (Deployment, Routing Setup, Scoring, Supabase Setup, Smoke
Test, OSRM Cutover Runbook, Proposals Process) are also mirrored as regular
Notion pages under Engineering Docs, but **git remains their source of
truth** — keep editing the `docs/*.md` files for those as normal, and ask
technical-writer to re-sync the Notion mirror when they change materially.

**Open MRs** (added 2026-07-23): every PR the heartbeat opens gets a row here
— `Title`, `Branch`, `PR URL`, `Status` (Open/Merged/Closed, mirroring the
real GitHub state), `Raised By`, `Opened Date`, `Summary`, and the actual
diff pasted into the page content as a fenced ` ```diff ` block. The founder
reviews the diff in Notion, then clicks through to the real GitHub PR to
approve/merge — **a Notion status change never merges anything by itself**;
GitHub is always where the actual approve/merge happens. The heartbeat's job
is to make sure the PR link and diff are there before the run ends.

**Founder Requests** (added 2026-07-23): a single page, not a database. The
founder appends whatever they want — a request, an idea, a bug report — as an
unchecked to-do item, no format required. Every unchecked item is the
**highest priority for the next run**, above everything in Backlog. When a
run picks one up, it checks the box and adds a short note (what happened,
link to the resulting Backlog row and/or Open MR) right after that line, so
the page doubles as a running record. Use `notion-update-page` with
`update_content` to flip `- [ ]` to `- [x]` and append the note — never
delete a founder's line.

## Hard guardrails — NEVER do autonomously

These require founder approval. If a run concludes one of these is needed, add
a row to the **Pending Approvals** database (`Status: Awaiting decision` or
`Founder action needed`, format below) and move on to other work. Do NOT
execute it, even partially:

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

Pending Approvals row format (properties on the `Pending Approvals` data
source): `Title`, `Raised Date`, `Raised By`, `Type` (new-product |
direction-change | architecture | schema-destructive | deploy | spend |
org-change | other), `Status` (Awaiting decision | Founder action needed |
Approved | Rejected), `Proposal` (what is being proposed), `Recommendation`
(what the raising agent recommends and why).

## Run procedure

### 1. Read company state (always first)

- **Founder Requests** page — unchecked `- [ ]` items. These outrank
  everything else this run (see step 3).
- **Pending Approvals** database — the founder's verdicts since last run
  (rows with `Status: Approved` or `Status: Rejected` that you haven't
  processed yet)
- **Backlog** database — the prioritized work queue (`Status` = Now/Next/
  Later/Icebox/Done, `Priority` = URGENT/EMERGENCY/CRITICAL/P1/P2/P3/CLEANUP)
- **Heartbeat Log** database — what the last runs did (don't redo work);
  sort/read by `Run Date` descending
- **Decisions Log** database and `milestones/` — current direction and
  constraints
- **Open MRs** database — any `Status: Open` rows still awaiting founder
  review/merge on GitHub (don't duplicate work already sitting in a PR)
- `git status`, recent `git log`, and open `heartbeat/*` branches/PRs — actual
  repo state

### 2. Process founder verdicts

- Pending Approvals rows with `Status: Approved`: these are now sanctioned —
  execute them this run (or add to Backlog as P1 if too big for one run), then
  add a row to the **Decisions Log** database recording the decision.
- Rows with `Status: Rejected`: leave them in place (they're already the
  historical record); remove any related Backlog rows.

### 3. Pick the work

- **Founder Requests first.** Any unchecked item on that page is this run's
  top priority, full stop — ahead of URGENT/EMERGENCY Backlog rows. Work it
  this run (or, if it's too big for one run, break it into Backlog rows
  tagged with the request and start the first slice) before touching
  anything else. A guardrail topic raised as a founder request still goes to
  Pending Approvals rather than being executed directly — the request
  outranks the backlog, not the guardrails.
- Otherwise, take the highest-priority unblocked row(s) from the **Backlog**
  database (`Status: Now` first) that fit in one focused run. One item done
  well beats three half-done.
- If the backlog is empty or stale, this run's work IS backlog grooming: act
  as head-of-product, break the current milestone into concrete items, and
  add rows.
- If everything is blocked on approvals, do maintenance instead: test
  coverage, dead code cleanup, doc updates, dependency patch bumps.

### 4. Execute through the org

Delegate to the matching agent (subagent types are registered from the repo's
`.claude/agents/`, which points at `agents/`):

- Planning/specs → **head-of-product**; architecture questions → **cto**
- Revenue, monetization, productization, positioning → **head-of-growth**
- Speculative ideas / new directions → **creative-director** (proposals only —
  never let this role touch the plan, code, or approvals directly; its output
  is a `docs/PROPOSALS/*.md` doc that must be reviewed by 2+ high-order
  agents. See `agents/creative-director.md` for the flow.)
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
   **Open the PR** with `gh pr create` (base `main`) — this is required, not
   optional, as of 2026-07-23: the founder reviews every change through the
   Open MRs log + the real GitHub PR, so a pushed branch without a PR is an
   incomplete run. If `gh` isn't authenticated, that itself is a blocker: file
   it in Pending Approvals (`Type: other`) rather than silently skipping the
   PR. Do NOT merge to main yourself — code merges are founder review
   territory, and a Notion status change never merges anything either (see
   the Open MRs description above).
5. **Log it to Open MRs**: `notion-create-pages` a row (`Title` = PR title,
   `Branch`, `PR URL` = the real `gh pr create` output URL, `Status: Open`,
   `Raised By` = the executing agent, `Opened Date`, `Summary` = 2-4
   sentences) with the diff (`git diff main...HEAD`) pasted into the page
   content inside a fenced ` ```diff ` block. If the diff is very large,
   include the full thing anyway unless it's clearly unreasonable (e.g.
   generated/lockfile-heavy) — trim only the noisy generated parts and say so.

If gates fail and can't be fixed within the run, commit nothing to the branch
beyond WIP (pushed, so it isn't lost), note the failure honestly in the log,
and add a P1 Backlog row.

### 6. Close the run (always, even if nothing was done)

The session is ephemeral — anything not written to Notion (or pushed to git,
for code) is lost. Persist state like this:

- **Company state** (Backlog, Decisions Log, Pending Approvals): update the
  Notion databases directly via `notion-update-page` (status/priority
  changes) and `notion-create-pages` (new rows). This is live the moment you
  write it — no commit step, no approval needed for these particular writes
  (they're company memory, not code or direction changes).
- **Code**: stays on its pushed `heartbeat/*` branch, never committed to main.
  (Unlike the old file-based flow, there is no more sanctioned direct-to-main
  docs commit — state lives in Notion now.)

Add a row to the **Heartbeat Log** database (properties: `Run`, `Run Date`,
`Did`, `Verified`, `Queued`, `Blocked` — format matches the existing rows):
what was done and verified, what was queued, what's blocked on the founder.
Update **Backlog** rows' `Status`/`Priority` to match reality. If any
guardrail topic came up, confirm its row exists in **Pending Approvals**. If
you picked up a **Founder Requests** item this run, check its box and append
a short note on what happened right after that line — never remove or
reorder the founder's original text. The founder gives verdicts by editing
the `Status` property on Pending Approvals rows in Notion, by appending to
Founder Requests, and by approving/merging real PRs on GitHub (surfaced via
the Open MRs log).

## Effort discipline

- Budget the run like a startup: ~one meaningful increment per run. Stop at a
  clean, verified state rather than starting something you can't finish.
- Never invent scope. If there is genuinely nothing to do, say so in the
  Heartbeat Log — a short honest entry beats manufactured work.
- Every run must leave the repo (and the Notion state) in a place where the
  next run (or the founder) can pick up from the Heartbeat Log alone.
