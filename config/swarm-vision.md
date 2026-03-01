# Agent Swarm — Vision & Lessons Learned

> Living document capturing the automation vision, pain points, and improvements.
> Updated after each swarm run.

---

## The Vision

A fully autonomous development pipeline where:

1. **I define the backlog** — issues on GitHub Projects with priorities and iterations
2. **Agents pick up work autonomously** — no manual assignment needed
3. **Agents self-review before pushing** — CodeRabbit CLI runs locally, agents fix issues before creating PRs
4. **CodeRabbit reviews on GitHub** — second pass, catches anything agents missed
5. **I only do final review** — approve/reject PRs, that's it
6. **Merge conflicts are handled intelligently** — agents rebase and resolve without my intervention

**My role:** Product owner + final code reviewer. Everything else is automated.

---

## Pain Points from First Swarm Run (2026-03-01)

### 1. Manual Agent Spinning — SOLVED (launcher script)

**Problem:** Had to open 4 terminal windows, paste the same prompt, stagger manually.

**Solution:** `~/.claude/swarm-launch.sh` — a launcher script that spins up N agents with staggered starts in worktrees.

**Wishlist:** A proper UI/dashboard where I can:
- See all running agents and their status
- Add/remove agents on the fly
- View which issue each agent is working on
- One-click launch for "spin up 4 agents on BookBuddy iteration-1"

### 2. Broadcasting Instructions to All Agents — UNSOLVED (Claude Code limitation)

**Problem:** Sometimes need to tell all agents the same thing ("create your PR now", "stop working", "rebase on main").

**Current workaround:** None — have to go window by window.

**Wishlist:**
- A broadcast channel that all agents listen to
- Ability to send a message to all running agents at once
- Or a shared file (e.g. `~/.claude/broadcast.md`) that agents poll periodically

**Possible hack:** Agents could check a broadcast file every N minutes:
```bash
# Agent checks ~/.claude/broadcast.md before each major step
# If file has content, execute the instruction, then clear it
```

### 3. Merge Conflict Cascading — PARTIALLY SOLVED (merge order strategy)

**Problem:** When Agent A's PR merges, Agent B/C/D's branches now conflict with main. Each agent needs to be told individually to rebase and resolve.

**Root cause:** Multiple agents touching overlapping files (e.g. routes/web.php, CLAUDE.md, config files).

**Solutions implemented:**
- Agents must rebase on main before pushing
- Agents must check for recently merged PRs and rebase if needed
- Sequential merge order: merge PRs in issue-number order (#6 before #7 before #8)
- After each merge, remaining agents rebase before creating their PR

**Wishlist:**
- Automatic rebase trigger when main changes
- Smart file-locking: if Agent A is editing routes/web.php, Agent B should know

### 4. Code Review Before Push — SOLVED (CodeRabbit CLI pre-push)

**Problem:** CodeRabbit only reviewed on the PR (GitHub). By then, I had to copy-paste review comments back to Claude to fix things. Slow feedback loop.

**Solution:** Agents now run `cr review` (CodeRabbit CLI) locally BEFORE pushing. They fix all issues first, then push clean code. CodeRabbit on GitHub becomes a second safety net, not the primary review.

**Flow:**
```
Agent writes code
  → runs pint/tests (quality checks)
  → runs `cr review` (CodeRabbit CLI)
  → fixes any CodeRabbit findings
  → re-runs `cr review` until clean
  → pushes & creates PR
  → CodeRabbit on GitHub does final check (should be mostly clean)
  → I review
```

---

## Architecture: How It Should Work

```
┌─────────────────────────────────────────────────┐
│                  GITHUB PROJECTS                 │
│   (backlog, iterations, priorities, status)      │
└──────────┬──────────────────────────┬────────────┘
           │                          │
     ┌─────▼─────┐            ┌──────▼──────┐
     │  Agent 1   │            │  Agent 2    │
     │  (worktree)│            │  (worktree) │
     │            │            │             │
     │ 1. Claim   │            │ 1. Claim    │
     │ 2. Branch  │            │ 2. Branch   │
     │ 3. Code    │            │ 3. Code     │
     │ 4. Test    │            │ 4. Test     │
     │ 5. CR CLI  │◄──fix──►  │ 5. CR CLI   │
     │ 6. Push    │            │ 6. Push     │
     │ 7. PR      │            │ 7. PR       │
     └─────┬──────┘            └──────┬──────┘
           │                          │
     ┌─────▼──────────────────────────▼────────────┐
     │              GITHUB PRs                      │
     │  CodeRabbit auto-review (second pass)        │
     │  Human final review + merge                  │
     └──────────────────────────────────────────────┘
```

---

## Swarm Control Panel — Web UI Concept

A Node.js web app running locally (or on a VPS) that replaces the terminal workflow entirely.

### Core Screens

**1. Dashboard (Home)**
- All running agents as cards — status, which issue, which project, time elapsed
- GitHub Project board columns mirrored (Ready / In Progress / In Review / Done)
- Quick stats: agents running, PRs open, issues completed today

**2. Launch Agent**
- Pick a project (dropdown from registry)
- Pick mode: Auto-pick / Specific issue (searchable issue list from GitHub)
- Launch button → spins up Claude Code in a worktree behind the scenes
- Option to launch N agents at once with stagger

**3. Agent Detail View**
- Live log stream (tail the agent's output)
- Current step in the 12-step protocol (orient → claim → work → review → PR)
- "Send message" input — inject an instruction into the running agent
- "Stop" button — gracefully terminate

**4. Broadcast**
- Text input → sends the same instruction to ALL running agents
- Preset buttons: "Create PR now", "Rebase on main", "Stop all"

**5. PR Review Queue**
- All open PRs across projects
- CodeRabbit status (pass/fail/pending)
- One-click merge or "Request changes" with comment
- Diff viewer (or link to GitHub)

**6. Project Settings**
- Manage project registry (add/remove projects)
- Edit iteration labels, current iteration
- Manage labels, field IDs (auto-discovered from GitHub API)

### Tech Stack Idea

| Layer | Tech | Why |
|-------|------|-----|
| Backend | Node.js (Express or Fastify) | Lightweight, can spawn child processes |
| Frontend | React or plain HTML + HTMX | Dashboard doesn't need to be complex |
| Agent management | Child process spawning `claude` CLI | Each agent is a `claude --worktree -p "..."` process |
| Agent communication | PTY (node-pty) or stdin pipe | Send messages to running agents |
| Real-time updates | WebSocket or SSE | Stream agent logs and status to browser |
| GitHub integration | `gh` CLI or Octokit | Issues, PRs, project board |
| Auth | Simple password or local-only | Protect if exposed to network |
| Storage | SQLite or JSON file | Track agent sessions, history |

### How Agent Communication Would Work

```
Browser → WebSocket → Node server → node-pty (pseudo-terminal)
                                        ↕
                                   claude CLI process
                                   (running in worktree)
```

- `node-pty` gives us a real terminal interface to the Claude process
- We can write to stdin (send messages/instructions)
- We can read from stdout (stream logs to the browser)
- Broadcast = write the same message to all active PTY sessions

### Key Features That Solve Current Pain Points

| Pain point | How the UI solves it |
|------------|---------------------|
| Manual agent spinning | "Launch Agent" button, batch launch |
| Broadcasting | Broadcast panel sends to all PTYs |
| Merge conflicts | Dashboard shows conflict status, one-click "rebase all" |
| Code review round-trip | PR queue with inline CodeRabbit feedback |
| No visibility | Live agent logs, step progress, project board mirror |
| Window management | One browser tab replaces N terminals |

### MVP Scope (if building this)

Phase 1 — Just the essentials:
1. Launch agents (auto-pick or specific issue)
2. View running agents and their live logs
3. Stop an agent
4. See open PRs

Phase 2 — Communication:
5. Send message to a specific agent
6. Broadcast to all agents
7. PR merge/review from the UI

Phase 3 — Intelligence:
8. Auto-detect conflicts and trigger rebases
9. Agent health monitoring (stuck detection)
10. Historical analytics (issues/day, avg time per issue)

### Potential Project Name Ideas
- **SwarmPilot** — pilot your agent swarm
- **AgentDeck** — mission control deck
- **HiveMind** — control the hive
- **Orchestr8** — orchestrate agents

---

## File Index

| File | Purpose |
|------|---------|
| `~/.claude/swarm.md` | Agent protocol, project registry, rules |
| `~/.claude/swarm-launch.sh` | Launcher script for spinning up agent swarms |
| `~/.claude/swarm-vision.md` | This file — vision, lessons, wishlist |
| `~/.claude/agent-prompt.md` | Copy-paste prompts for agents |
| `~/.claude/settings.json` | Global permissions (git, gh, cr, etc.) |
| `<project>/CLAUDE.md` | Per-project rules agents must follow |
