# AgentArmy — Command Your AI Agent Swarm

## What This Is

A web UI to launch, monitor, and control autonomous Claude Code agents across multiple projects. One browser tab replaces N terminal windows.

## The Problem

Running multiple Claude Code agents requires:
- Opening many terminal windows manually
- Pasting the same prompt in each
- No way to broadcast instructions to all agents
- No visibility into what each agent is doing
- Merge conflicts cascade with no central coordination
- Code review feedback has to be copy-pasted back manually

## The Solution

AgentArmy is a local web dashboard that:
1. Launches Claude Code agents in git worktrees with one click
2. Streams live agent logs to the browser
3. Sends messages to individual agents or broadcasts to all
4. Shows PR status and CodeRabbit review results
5. Manages the GitHub Projects backlog visually

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Node.js + Express | Lightweight, child process spawning, PTY support |
| Frontend | HTML + TailwindCSS + Alpine.js | Fast, no build step needed for MVP, reactive |
| Agent mgmt | node-pty | Pseudo-terminal per agent — read stdout, write stdin |
| Real-time | WebSocket (ws) | Stream logs and status to browser |
| GitHub | Octokit or `gh` CLI | Issues, PRs, project board integration |
| Storage | SQLite (better-sqlite3) | Agent sessions, history, project config |
| Auth | Simple password middleware | Protect if exposed beyond localhost |

---

## Architecture

```
Browser (localhost:3000)
    │
    ├── WebSocket ──▶ Live agent logs
    ├── REST API ──▶ Launch / stop / message agents
    └── REST API ──▶ GitHub integration (issues, PRs, board)
          │
          ▼
    Express Server
    ├── AgentManager (singleton)
    │   ├── Agent 1 ──▶ node-pty ──▶ claude --worktree -p "..."
    │   ├── Agent 2 ──▶ node-pty ──▶ claude --worktree -p "..."
    │   └── Agent N ──▶ node-pty ──▶ claude --worktree -p "..."
    ├── GitHubService (Octokit)
    │   ├── Issues / PRs
    │   └── Project board status
    └── SQLite DB
        ├── agent_sessions
        ├── projects
        └── config
```

### Key Directories

```
agent-army/
├── server/
│   ├── index.js              # Express app entry point
│   ├── routes/
│   │   ├── agents.js          # POST /agents/launch, DELETE /agents/:id, POST /agents/:id/message
│   │   ├── broadcast.js       # POST /broadcast
│   │   ├── github.js          # GET /projects, GET /issues, GET /prs
│   │   └── health.js          # GET /health
│   ├── services/
│   │   ├── AgentManager.js    # Manages PTY processes, launch/stop/message
│   │   ├── GitHubService.js   # Octokit wrapper for project board + PRs
│   │   └── Database.js        # SQLite operations
│   └── websocket.js           # WebSocket server for log streaming
├── public/
│   ├── index.html             # Dashboard SPA
│   ├── css/
│   │   └── styles.css         # TailwindCSS (CDN for MVP)
│   └── js/
│       └── app.js             # Alpine.js app — agent cards, log viewer, controls
├── db/
│   └── schema.sql             # SQLite schema
├── package.json
├── CLAUDE.md                  # This file
└── README.md
```

---

## Data Model

```sql
-- Projects registered in the swarm
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  repo TEXT NOT NULL,           -- e.g. amjad1233/luma
  local_path TEXT NOT NULL,     -- e.g. /Users/amjad/sites/personal/luma
  github_project_id TEXT,       -- PVT_kwHO...
  github_project_number INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent sessions (running or completed)
CREATE TABLE agent_sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  issue_number INTEGER,
  issue_title TEXT,
  status TEXT DEFAULT 'running', -- running, completed, failed, stopped
  worktree_path TEXT,
  branch_name TEXT,
  pr_number INTEGER,
  pid INTEGER,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  log_file TEXT
);

-- Broadcast history
CREATE TABLE broadcasts (
  id INTEGER PRIMARY KEY,
  message TEXT NOT NULL,
  agent_count INTEGER,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

```
# Agents
POST   /api/agents/launch     { projectId, issueNumber? }  → Launch agent
GET    /api/agents             → List running agents
GET    /api/agents/:id         → Agent detail + recent log
POST   /api/agents/:id/message { message }                  → Send message to agent
DELETE /api/agents/:id         → Stop agent

# Broadcast
POST   /api/broadcast          { message }                  → Send to all agents

# GitHub
GET    /api/projects           → List registered projects
GET    /api/projects/:id/issues → Open issues for project
GET    /api/projects/:id/prs   → Open PRs for project
POST   /api/projects/:id/prs/:pr/merge → Merge a PR

# WebSocket
ws://localhost:3000/ws         → Real-time log stream + agent status updates
```

---

## Development Rules

### Code Standards
- **ESM modules** (`"type": "module"` in package.json)
- **No TypeScript for MVP** — plain JS, add TS later if needed
- **Prettier** for formatting
- **ESLint** with standard config

### Frontend
- **TailwindCSS via CDN** for MVP (no build step)
- **Alpine.js** for reactivity
- **Dark theme** — matches the terminal aesthetic
- **Mobile-responsive** — manage agents from your phone

### Git Workflow
- Same rules as all projects: feature branches, no main commits, `picked-up` label
- See `~/.claude/swarm.md` for the full agent protocol

### Testing
- **Vitest** for unit tests
- Test AgentManager, GitHubService independently
- E2E: launch a real agent, verify log streaming

---

## Development Phases

### Phase 1: MVP — Launch, View, Stop
- Express server with static file serving
- AgentManager with node-pty
- Dashboard: agent cards, live logs, launch/stop
- WebSocket log streaming
- SQLite for session tracking

### Phase 2: Communication
- Send message to individual agent
- Broadcast to all agents
- PR review queue with CodeRabbit status
- GitHub project board mirror

### Phase 3: Intelligence
- Auto-detect merge conflicts, trigger rebase
- Agent health monitoring (stuck detection)
- Historical analytics (issues/day, time per issue)
- Smart scheduling (don't assign overlapping file issues to concurrent agents)

---

## Quick Start

```bash
cd ~/sites/personal/agent-army
npm install
npm run dev
# Open http://localhost:3000
```

## Related Files

| File | Purpose |
|------|---------|
| `~/.claude/swarm.md` | Agent protocol that AgentArmy automates |
| `~/.claude/swarm-launch.sh` | CLI launcher (AgentArmy replaces this) |
| `~/.claude/swarm-vision.md` | Full vision document |
| `OneDrive/.../agent-swarm-vision.html` | Polished HTML version of the vision |
