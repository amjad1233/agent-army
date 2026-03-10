# AgentArmy — Production Ready + AutoPilot Design Spec

**Date:** 2026-03-10
**Status:** Approved
**Scope:** Production hardening, dynamic project registration, self-replenishing autonomous agent army

---

## Context

AgentArmy is a localhost dashboard for launching and monitoring Claude Code agents across multiple repos. Currently functional as an MVP. This spec covers three areas:

1. **Production hardening** — error handling, logging, input validation, env config
2. **Add any repo** — dynamic project registration from a local path
3. **AutoPilot** — self-replenishing army that runs while you sleep, pulling from GitHub Issues

Deployment path: localhost-first, then public. No auth for now.

---

## Section 1: Production Hardening

### Error Handling
- Add `asyncHandler(fn)` wrapper utility — wraps every async route handler so unhandled rejections don't crash the server
- Add Express error middleware at the bottom of `server/index.js` — catches all errors, logs them, returns clean JSON `{ error: message }` (no stack traces when `NODE_ENV=production`)
- All existing routes wrapped with `asyncHandler`

### Request Logging
- Add `morgan` package — `"dev"` format in development, `"combined"` in production
- Mounted before all routes in `server/index.js`

### Input Validation
- `projectId` params: must parse as a positive integer — reject with 400 otherwise
- Message bodies: max 10KB length — reject with 413 otherwise
- `localPath` values: check for path traversal sequences (`../`, `..\\`) — reject with 400
- `count` for bulk launch: enforce 1–10 range server-side
- Validation happens at route layer before hitting any service

### Environment Config
- Add `dotenv` — reads `.env` on startup via `dotenv/config`
- Supported variables:
  - `PORT` (default: 3000)
  - `NODE_ENV` (default: development)
  - `DB_PATH` (default: `db/agent-army.db`)
  - `EXCLUDED_LABELS` (default: `still thinking,wip,blocked`)
- Ship `.env.example` with all variables documented
- `.env` added to `.gitignore`

### Graceful Shutdown
- Existing SIGTERM/SIGINT handlers extended to close SQLite DB connection before exit
- Order: stop all agents → close DB → exit

### New Dependencies
- `morgan` — request logging
- `dotenv` — env var loading

---

## Section 2: Add Any Repo

### User Flow
User clicks "+ Add Project" → types a local path → app auto-detects repo and name → optionally links a GitHub Projects board → project is registered and ready.

### Backend

**POST /api/projects** — `{ localPath, githubProjectNumber? }`

Validation sequence:
1. Path exists on disk (`fs.existsSync`)
2. Is a git repo (`git rev-parse --git-dir` in that directory)
3. Has a GitHub remote — parse `owner/repo` from `git remote get-url origin`
4. Not already registered (check `local_path` uniqueness)
5. If `githubProjectNumber` provided — fetch project ID via `gh project view <number> --owner <owner> --json id`
6. Auto-derive `name` from directory basename
7. Insert into `projects` table, return created record

**DELETE /api/projects/:id**
- Return 409 if any agents are currently running on this project
- Hard delete (no running agents = safe to remove)

### Schema
No new columns needed. `local_path`, `repo`, `github_project_id`, `github_project_number` already exist.

### Frontend — Add Project Modal
- Single input: "Drop a local path" (`/Users/you/sites/my-app`)
- Optional input: "GitHub Project number" (the `#` in the URL)
- Inline validation feedback as user types: "checking..." → "✓ found `amjad1233/my-app`" or "✗ not a git repo"
- Validation hits a `POST /api/projects/validate` endpoint before submit (non-destructive pre-check)
- On success: modal closes, project appears immediately in list

### Frontend — Project Management
- Projects section on dashboard with one card per project
- Hover on project card reveals trash icon
- Delete confirms with a dialog; disabled if agents are running on the project

---

## Section 3: AutoPilot

### Architecture
`AutoPilot.js` — new singleton service in `server/services/`. Listens to `agent:status` events from `AgentManager`. When an agent finishes on an autopilot-enabled project, it triggers the next launch.

### Core Logic (per completion event)
1. Check if project has `autopilot_enabled = true`
2. Count currently running agents on this project — if already at `autopilot_max_agents`, skip
3. Fetch open issues from the repo via `GitHubService.getIssues()`
4. Filter out issues with any excluded label
5. Filter out issue numbers already being worked on by running agents
6. Filter out issues in the in-memory skip list (failed twice)
7. Pick first remaining issue (oldest first by `createdAt`)
8. If none found: emit `autopilot:idle` event, log "nothing left, army's chilling"
9. Otherwise: call `AgentManager.launch(projectId, issue.number, issue.title)`, emit `autopilot:launched`

### Self-Healing on Failure
- In-memory `failCounts Map<projectId-issueNumber, count>` — resets on server restart
- If an agent fails: increment fail count for that issue
- If fail count ≥ 2: add to skip list, pick the next issue instead
- On completion: remove issue from fail counts (it succeeded)

### Schema Changes
```sql
ALTER TABLE projects ADD COLUMN autopilot_enabled INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN autopilot_max_agents INTEGER DEFAULT 3;
ALTER TABLE projects ADD COLUMN autopilot_excluded_labels TEXT DEFAULT '["still thinking","wip","blocked"]';
```

### GitHub Projects Board Integration
When a project has `github_project_number` set, AutoPilot additionally:
- Moves issue to "In Progress" column when an agent picks it up
- Moves issue to "Done" column when agent completes successfully
- Moves issue back to "Todo" column if agent fails (after skip threshold)
- Uses `gh project item-edit` CLI command for status transitions

### New Endpoints
```
PATCH /api/projects/:id/autopilot   { enabled, maxAgents, excludedLabels }
GET   /api/projects/:id/autopilot   → current autopilot config + status
```

### WebSocket Events (new)
```
{ type: 'autopilot:launched', projectId, issueNumber, issueTitle, sessionId }
{ type: 'autopilot:idle', projectId }
{ type: 'autopilot:skipped', projectId, issueNumber, reason }
```

---

## Section 4: UI Changes

### Overall Vibe
Same dark aesthetic. Copy is informal — "Your army's idle", "3 agents grinding rn", "Nothing to do boss, flip AutoPilot on". Feels like mission control, not a spreadsheet.

### Dashboard Header
- Subtitle is dynamic and bro-coded:
  - 0 running, autopilot off → "Your army's idle. Launch one to get going."
  - 0 running, autopilot on → "AutoPilot's watching. It'll pick something up."
  - N running → "N agents grinding rn."
  - Autopilot went idle → "Nothing left to pick up boss — army's chilling."

### Stats Bar (new card)
- **AutoPilot** card — "X projects on AutoPilot" (replaces or sits alongside Failed card)

### Projects Section (new on dashboard)
One card per registered project showing:
- Name + repo
- Running agent count for that project
- **AutoPilot toggle** — big satisfying flip switch, green when on
- "Max N agents" with +/− buttons (only visible when autopilot is on)
- Excluded labels as removable pill tags + input to add more
- Hover reveals trash icon to unregister

### Sidebar
- Project list with a green pulse dot next to each autopilot-active project
- "+ Add Project" button at the bottom of the project list

### Add Project Modal
- Path input with inline auto-detection feedback
- Optional GitHub Project number input
- Clean validation states: idle / checking / valid / error

### Agent Cards
- Small `auto` badge on agents launched by AutoPilot (vs manual)

### Toast Notifications
- AutoPilot picks up issue → toast bottom-right: "AutoPilot picked up #42 — let's get it 🤙"
- AutoPilot goes idle → toast: "Nothing left boss, army's chilling"

---

## File Map — What Changes

```
server/
  index.js                    — add morgan, dotenv, asyncHandler, error middleware, DB shutdown
  services/
    AutoPilot.js              — NEW: self-replenishing army logic
    GitHubService.js          — add project board status transition helpers
    Database.js               — add autopilot column reads/writes, project CRUD
  routes/
    github.js                 — add POST/DELETE /api/projects, autopilot PATCH/GET
    agents.js                 — wrap with asyncHandler

public/
  index.html                  — add projects section, autopilot toggles, add project modal
  js/app.js                   — autopilot state, project CRUD, toast notifications, dynamic copy

.env.example                  — NEW
db/
  migrations/
    001-autopilot.sql         — NEW: autopilot columns
```

---

## Out of Scope (This Iteration)

- Authentication (added when deploying publicly)
- Rate limiting (added when deploying publicly)
- Database migrations framework (manual SQL for now)
- Test coverage (separate task)
- Agent resource limits (CPU/memory caps)
- Data retention / log cleanup
