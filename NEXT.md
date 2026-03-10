# agent-army — What To Do Next

Audit completed 2026-03-10. The app is ~90% done. Core backend works.
One critical bug blocks the full GitHub flow. Fix that first, then polish.

---

## Critical Bug (5 min fix)

**File:** `server/routes/github.js`

The `/api/github/:id/issues` and `/api/github/:id/prs` routes return hardcoded
empty arrays instead of calling `GitHubService` — which is already fully implemented.

```js
// Issues route — replace res.json([]) with:
const issues = await GitHubService.getIssues(repo);
res.json(issues);

// PRs route — replace res.json([]) with:
const prs = await GitHubService.getPrs(repo);
res.json(prs);
```

Make sure `GitHubService` is imported at the top of `github.js`.

---

## Priority Task List

### P0 — Wire GitHub routes (5 min)
- Fix `server/routes/github.js` as above
- Test: `curl http://localhost:3000/api/github/1/issues` should return real issues

### P1 — Issue picker in launch modal (30 min)
- When user selects a project in the launch modal, fetch `/api/github/:id/issues`
- Display as a dropdown/list so user can click an issue instead of typing a number
- Pre-fill the prompt with the issue title + body
- File: `public/js/app.js` — `launchModal` state + `public/index.html` modal markup

### P2 — Auto-generate prompt from issue (20 min)
- When an issue is selected, auto-build the Claude prompt from issue title + body
- Format: `"Fix GitHub issue #<n>: <title>\n\n<body>\n\nCreate a PR when done."`
- This is the bridge between "picking an issue" and "agent doing the right thing"
- Optionally let user edit the prompt before launching

### P3 — Persist branch + PR after agent completes (1 hr)
- `agent_sessions` table has `pr_number` and `branch_name` columns — never written
- After agent finishes, parse its output to detect "Created PR #X" or "Branch: feature/X"
- Update the session row so the dashboard can link to the PR directly
- Alternative: poll GitHub API for new PRs on that branch after agent exits

### P4 — Session resumption on server restart (1 hr)
- `Database.getResumableSessions()` exists but is never called
- On server start, query for sessions with `status = 'running'` and `claude_session_id` set
- Re-attach via `claude --resume <claude_session_id>`
- File: `server/index.js` startup sequence + `server/services/AgentManager.js`

---

## What's Already Working (Don't Touch)

- `AgentManager.js` — spawns Claude via PTY, lifecycle management, broadcast ✅
- `Database.js` — SQLite CRUD, all schema, session tracking ✅
- `GitHubService.js` — `gh` CLI wrapper for issues + PRs ✅ (just not called)
- `websocket.js` — real-time log streaming to browser ✅
- All Express routes except github.js ✅
- Frontend SPA — Alpine.js, xterm.js terminals, 4 themes, modals ✅
- `seed.js` — auto-seeds BookBuddy, Tractivity, AgentArmy projects on first boot ✅

---

## How The App Works (Quick Mental Model)

```
User opens dashboard → picks project + issue → clicks Launch
  → POST /api/agents/launch
  → AgentManager spawns: claude --dangerously-skip-permissions -p "<prompt>"
  → PTY captures output → WebSocket streams to browser
  → xterm.js tab opens showing live agent output
  → Agent works, creates branch, opens PR
  → Session stored in SQLite with status
```

To run locally:
```bash
npm run dev        # starts on http://localhost:3000
```

---

## File Map

```
server/
  index.js              — Express app entry, route mounting, graceful shutdown
  seed.js               — Seeds default projects + prompts on first boot
  websocket.js          — WebSocket server, subscription management
  services/
    AgentManager.js     — Core: spawn/stop/resume/broadcast agents via PTY
    Database.js         — SQLite CRUD for all tables
    GitHubService.js    — gh CLI wrapper (getIssues, getPrs) ← IMPLEMENTED NOT USED
  routes/
    agents.js           — CRUD + launch/stop/message/resume
    github.js           — ← BROKEN: stubs return [] instead of calling GitHubService
    broadcast.js        — POST /api/broadcast → all agents
    prompts.js          — Prompt library CRUD
    health.js           — Health check + shutdown

public/
  index.html            — SPA shell, all modals, sidebar, terminal tabs
  js/app.js             — Alpine.js state, all API calls, WebSocket, xterm.js
  css/styles.css        — Design system, 4 themes, animations

db/
  schema.sql            — 4 tables: projects, agent_sessions, broadcasts, prompts
```
