# AgentArmy — Production Ready + AutoPilot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the server for production, let users add any repo via local path, and add an AutoPilot mode that self-replenishes the agent army from GitHub Issues while you sleep.

**Architecture:** A new `AutoPilot.js` singleton listens to `agent:status` events — when an agent finishes on an autopilot-enabled project, it fetches the next open issue and fires the next launch automatically. Project registration moves from seed-only to fully dynamic (local path → auto-detect repo). Production hardening adds morgan logging, dotenv config, asyncHandler wrapping, and global error middleware.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, node-pty, ws, morgan (new), dotenv (new)

**Spec:** `docs/superpowers/specs/2026-03-10-production-ready-autopilot-design.md`

---

## Chunk 1: Production Hardening

### Task 1: Install dependencies + env config

**Files:**
- Modify: `package.json`
- Create: `.env.example`
- Modify: `server/index.js`
- Modify: `.gitignore`

- [ ] **Step 1: Install morgan and dotenv**

```bash
npm install morgan dotenv
```

Expected: both appear in `package.json` dependencies.

- [ ] **Step 2: Create `.env.example`**

```bash
cat > .env.example << 'EOF'
# Server port (default: 3000)
PORT=3000

# Node environment: development | production
NODE_ENV=development

# SQLite database path (default: db/agent-army.db)
# DB_PATH=db/agent-army.db

# Labels to skip when AutoPilot picks issues (comma-separated)
EXCLUDED_LABELS=still thinking,wip,blocked
EOF
```

- [ ] **Step 3: Add `.env` to `.gitignore`**

Open `.gitignore` (create it if missing). Add:
```
.env
db/agent-army.db
node_modules/
```

- [ ] **Step 4: Load dotenv in `server/index.js`**

Add as the very first line of `server/index.js` (before any other imports):
```js
import 'dotenv/config';
```

- [ ] **Step 5: Verify env loads**

```bash
echo "PORT=3001" > .env
npm run dev &
sleep 2
curl http://localhost:3001/health
kill %1
rm .env
```

Expected: `{"status":"ok",...}` from port 3001.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore server/index.js
git commit -m "feat: add dotenv config and morgan logging deps"
```

---

### Task 2: Add asyncHandler + error middleware

**Files:**
- Create: `server/middleware/asyncHandler.js`
- Modify: `server/index.js`

- [ ] **Step 1: Create `server/middleware/asyncHandler.js`**

```js
/**
 * Wraps an async route handler so unhandled rejections
 * get forwarded to Express error middleware instead of crashing.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

- [ ] **Step 2: Add morgan + error middleware to `server/index.js`**

After the existing imports, add:
```js
import morgan from 'morgan';
```

After `app.use(express.json());`, add:
```js
// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
```

After all route mounts, add:
```js
// Global error handler — must be last middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message;
  console.error(`[ERROR] ${req.method} ${req.url} →`, err);
  res.status(status).json({ error: message });
});
```

- [ ] **Step 3: Verify error middleware works**

```bash
npm run dev &
sleep 2
# Hit a non-existent route
curl -s http://localhost:3000/api/does-not-exist | jq .
kill %1
```

Expected: `{"error":"..."}` JSON, not HTML.

- [ ] **Step 4: Commit**

```bash
git add server/middleware/asyncHandler.js server/index.js
git commit -m "feat: add asyncHandler utility and global error middleware"
```

---

### Task 3: Wrap all routes with asyncHandler + input validation

**Files:**
- Modify: `server/routes/agents.js`
- Modify: `server/routes/github.js`
- Modify: `server/routes/broadcast.js`
- Modify: `server/routes/prompts.js`
- Create: `server/middleware/validate.js`

- [ ] **Step 1: Create `server/middleware/validate.js`**

```js
const MAX_MESSAGE_BYTES = 10 * 1024; // 10KB

/**
 * Parse and validate an integer route param.
 * Returns the integer or throws with status 400.
 */
export function parseId(param) {
  const id = parseInt(param, 10);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('ID must be a positive integer');
    err.status = 400;
    throw err;
  }
  return id;
}

/**
 * Validate a message string — must be non-empty and under 10KB.
 */
export function validateMessage(message) {
  if (!message || typeof message !== 'string') {
    const err = new Error('message is required');
    err.status = 400;
    throw err;
  }
  if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES) {
    const err = new Error('message exceeds 10KB limit');
    err.status = 413;
    throw err;
  }
  return message.trim();
}

/**
 * Validate a local filesystem path — no path traversal.
 */
export function validateLocalPath(localPath) {
  if (!localPath || typeof localPath !== 'string') {
    const err = new Error('localPath is required');
    err.status = 400;
    throw err;
  }
  if (localPath.includes('../') || localPath.includes('..\\')) {
    const err = new Error('localPath contains invalid path traversal');
    err.status = 400;
    throw err;
  }
  return localPath.trim();
}
```

- [ ] **Step 2: Update `server/routes/agents.js`** — wrap all handlers with asyncHandler, use parseId + validateMessage

Replace the file content:

```js
import { Router } from 'express';
import { agentManager } from '../services/AgentManager.js';
import { getSession, getAllSessions, getActiveSessions, clearFinishedSessions } from '../services/Database.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parseId, validateMessage } from '../middleware/validate.js';

const router = Router();

// POST /api/agents/launch
router.post('/launch', asyncHandler(async (req, res) => {
  const { projectId, issueNumber, issueTitle, customPrompt } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  const session = agentManager.launch(parseInt(projectId, 10), issueNumber || null, issueTitle || null, customPrompt || null);
  res.json(session);
}));

// GET /api/agents
router.get('/', asyncHandler(async (req, res) => {
  const sessions = getAllSessions();
  res.json(sessions.map((s) => ({ ...s, live: agentManager.isRunning(s.id) })));
}));

// GET /api/agents/active
router.get('/active', asyncHandler(async (req, res) => {
  res.json(getActiveSessions());
}));

// POST /api/agents/stop-all — must come BEFORE /:id routes
router.post('/stop-all', asyncHandler(async (req, res) => {
  const count = agentManager.runningCount;
  agentManager.stopAll();
  res.json({ ok: true, stopped: count });
}));

// DELETE /api/agents — clear finished
router.delete('/', asyncHandler(async (req, res) => {
  const removed = clearFinishedSessions();
  res.json({ ok: true, removed });
}));

// GET /api/agents/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const session = getSession(id);
  if (!session) return res.status(404).json({ error: 'Agent not found' });
  res.json({ ...session, live: agentManager.isRunning(id), recentLog: agentManager.getLog(id) });
}));

// POST /api/agents/:id/message
router.post('/:id/message', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const message = validateMessage(req.body.message);
  agentManager.sendMessage(id, message);
  res.json({ ok: true });
}));

// POST /api/agents/:id/resume
router.post('/:id/resume', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const session = agentManager.resume(id);
  res.json(session);
}));

// DELETE /api/agents/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  agentManager.stop(id);
  res.json({ ok: true, status: 'stopping' });
}));

// GET /api/agents/:id/health
router.get('/:id/health', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const session = getSession(id);
  if (!session) return res.status(404).json({ error: 'Agent not found' });
  const running = agentManager.isRunning(id);
  res.json({ id, running, healthy: running && agentManager.isHealthy(id), status: session.status, pid: session.pid });
}));

export default router;
```

- [ ] **Step 3: Update `server/routes/broadcast.js`** — wrap with asyncHandler + validateMessage

Read the current file first, then update:
```js
import { Router } from 'express';
import { agentManager } from '../services/AgentManager.js';
import { createBroadcast } from '../services/Database.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateMessage } from '../middleware/validate.js';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const message = validateMessage(req.body.message);
  const count = agentManager.broadcast(message);
  createBroadcast(message, count);
  res.json({ ok: true, agentCount: count });
}));

export default router;
```

- [ ] **Step 4: Update `server/routes/prompts.js`** — wrap with asyncHandler

Read the current file. Wrap each handler with `asyncHandler`. Import `asyncHandler` and `parseId` at the top.

- [ ] **Step 5: Update `server/routes/github.js`** — already async, add asyncHandler + parseId

Replace the current route handlers:
```js
import { Router } from 'express';
import { getAllProjects, getProject } from '../services/Database.js';
import { getIssues, getPrs } from '../services/GitHubService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parseId } from '../middleware/validate.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(getAllProjects());
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const project = getProject(parseId(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
}));

router.get('/:id/issues', asyncHandler(async (req, res) => {
  const project = getProject(parseId(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const issues = await getIssues(project.repo);
  res.json(issues);
}));

router.get('/:id/prs', asyncHandler(async (req, res) => {
  const project = getProject(parseId(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const prs = await getPrs(project.repo);
  res.json(prs);
}));

export default router;
```

- [ ] **Step 6: Smoke test**

```bash
npm run dev &
sleep 2
curl -s http://localhost:3000/api/agents | jq .
curl -s -X POST http://localhost:3000/api/agents/launch \
  -H "Content-Type: application/json" \
  -d '{"projectId": "abc"}' | jq .
# Should return 400-level validation error for bad projectId
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add server/middleware/ server/routes/
git commit -m "feat: add asyncHandler wrapping and input validation across all routes"
```

---

### Task 4: Write validation unit tests

**Files:**
- Create: `tests/middleware/validate.test.js`

- [ ] **Step 1: Create test file**

```js
import { describe, it, expect } from 'vitest';
import { parseId, validateMessage, validateLocalPath } from '../../server/middleware/validate.js';

describe('parseId', () => {
  it('parses a valid positive integer string', () => {
    expect(parseId('42')).toBe(42);
  });

  it('throws 400 for zero', () => {
    expect(() => parseId('0')).toThrow();
    expect(() => parseId('0')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 for negative numbers', () => {
    expect(() => parseId('-1')).toThrow();
  });

  it('throws 400 for non-numeric strings', () => {
    expect(() => parseId('abc')).toThrow();
  });
});

describe('validateMessage', () => {
  it('returns trimmed message', () => {
    expect(validateMessage('  hello  ')).toBe('hello');
  });

  it('throws 400 for empty string', () => {
    expect(() => validateMessage('')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('throws 413 for message over 10KB', () => {
    const big = 'x'.repeat(10 * 1024 + 1);
    expect(() => validateMessage(big)).toThrowError(expect.objectContaining({ status: 413 }));
  });
});

describe('validateLocalPath', () => {
  it('returns trimmed path', () => {
    expect(validateLocalPath('/Users/foo/bar')).toBe('/Users/foo/bar');
  });

  it('throws 400 for path traversal', () => {
    expect(() => validateLocalPath('/foo/../../../etc/passwd')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 for empty', () => {
    expect(() => validateLocalPath('')).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/middleware/validate.test.js
```

Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "test: add input validation unit tests"
```

---

## Chunk 2: Add Any Repo

### Task 5: DB — add project CRUD (delete + autopilot columns migration)

**Files:**
- Modify: `server/services/Database.js`
- Create: `db/migrations/001-autopilot.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 001-autopilot.sql
-- Add autopilot columns to projects table
ALTER TABLE projects ADD COLUMN autopilot_enabled INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN autopilot_max_agents INTEGER DEFAULT 3;
ALTER TABLE projects ADD COLUMN autopilot_excluded_labels TEXT DEFAULT '["still thinking","wip","blocked"]';
```

- [ ] **Step 2: Add migration runner and new DB functions to `Database.js`**

In `getDb()`, after the existing `claude_session_id` migration block, add:

```js
// Migrate: add autopilot columns to projects (for existing DBs)
const projectCols = instance.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projectCols.includes('autopilot_enabled')) {
  instance.exec('ALTER TABLE projects ADD COLUMN autopilot_enabled INTEGER DEFAULT 0');
  instance.exec('ALTER TABLE projects ADD COLUMN autopilot_max_agents INTEGER DEFAULT 3');
  instance.exec(`ALTER TABLE projects ADD COLUMN autopilot_excluded_labels TEXT DEFAULT '["still thinking","wip","blocked"]'`);
}
```

At the end of the projects section, add:

```js
export function deleteProject(id) {
  const result = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes;
}

export function getProjectByPath(localPath) {
  return getDb().prepare('SELECT * FROM projects WHERE local_path = ?').get(localPath);
}

export function updateProjectAutopilot(id, { enabled, maxAgents, excludedLabels }) {
  getDb()
    .prepare(
      `UPDATE projects
       SET autopilot_enabled = ?,
           autopilot_max_agents = ?,
           autopilot_excluded_labels = ?
       WHERE id = ?`
    )
    .run(enabled ? 1 : 0, maxAgents, JSON.stringify(excludedLabels), id);
}
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/ server/services/Database.js
git commit -m "feat: add autopilot schema migration and project delete/autopilot DB functions"
```

---

### Task 6: Backend — project registration route

**Files:**
- Modify: `server/routes/github.js`
- Create: `server/services/ProjectDetector.js`

- [ ] **Step 1: Create `server/services/ProjectDetector.js`**

This module handles all the validation logic for registering a new project from a local path.

```js
import { existsSync } from 'fs';
import { basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Auto-detect GitHub repo and project name from a local path.
 * Returns { name, repo } or throws a descriptive error.
 */
export async function detectProject(localPath) {
  // 1. Path exists
  if (!existsSync(localPath)) {
    const err = new Error(`Path does not exist: ${localPath}`);
    err.status = 400;
    throw err;
  }

  // 2. Is a git repo
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: localPath, timeout: 5000 });
  } catch {
    const err = new Error(`Not a git repository: ${localPath}`);
    err.status = 400;
    throw err;
  }

  // 3. Has a GitHub remote
  let remoteUrl;
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: localPath,
      timeout: 5000,
    });
    remoteUrl = stdout.trim();
  } catch {
    const err = new Error('No git remote "origin" found');
    err.status = 400;
    throw err;
  }

  // 4. Parse owner/repo from remote URL
  // Handles: https://github.com/owner/repo.git  AND  git@github.com:owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
  if (!httpsMatch) {
    const err = new Error(`Remote URL does not look like a GitHub repo: ${remoteUrl}`);
    err.status = 400;
    throw err;
  }
  const repo = httpsMatch[1];

  // 5. Derive name from directory basename
  const name = basename(localPath);

  return { name, repo };
}
```

- [ ] **Step 2: Add POST, POST /validate, DELETE, and PATCH /autopilot routes to `server/routes/github.js`**

Add to the end of `github.js`, before `export default router`:

```js
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  insertProject,
  deleteProject,
  getProjectByPath,
  updateProjectAutopilot,
  getActiveSessions,
} from '../services/Database.js';
import { detectProject } from '../services/ProjectDetector.js';

// POST /api/projects/validate — pre-check a local path without saving
router.post('/validate', asyncHandler(async (req, res) => {
  const { localPath } = req.body;
  const path = validateLocalPath(localPath);
  const detected = await detectProject(path);
  const existing = getProjectByPath(path);
  res.json({ ...detected, alreadyRegistered: !!existing });
}));

// POST /api/projects — register a new project
router.post('/', asyncHandler(async (req, res) => {
  const { localPath, githubProjectNumber } = req.body;
  const path = validateLocalPath(localPath);

  // Check not already registered
  if (getProjectByPath(path)) {
    return res.status(409).json({ error: 'This path is already registered' });
  }

  const { name, repo } = await detectProject(path);

  // Optionally fetch GitHub Projects board ID
  let githubProjectId = null;
  if (githubProjectNumber) {
    const owner = repo.split('/')[0];
    try {
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        'gh', ['project', 'view', String(githubProjectNumber), '--owner', owner, '--json', 'id'],
        { timeout: 10000 }
      );
      githubProjectId = JSON.parse(stdout.trim()).id;
    } catch {
      // Non-fatal — project board is optional
    }
  }

  const result = insertProject({
    name,
    repo,
    localPath: path,
    githubProjectId,
    githubProjectNumber: githubProjectNumber || null,
  });

  const project = getProject(result.lastInsertRowid);
  res.status(201).json(project);
}));

// DELETE /api/projects/:id — unregister a project
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const project = getProject(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Block if agents are running on this project
  const active = getActiveSessions().filter(s => s.project_id === id);
  if (active.length > 0) {
    return res.status(409).json({
      error: `Cannot remove project — ${active.length} agent(s) still running on it`,
    });
  }

  deleteProject(id);
  res.json({ ok: true });
}));

// PATCH /api/projects/:id/autopilot — update autopilot settings
router.patch('/:id/autopilot', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const project = getProject(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { enabled = false, maxAgents = 3, excludedLabels = ['still thinking', 'wip', 'blocked'] } = req.body;
  updateProjectAutopilot(id, { enabled, maxAgents, excludedLabels });
  res.json(getProject(id));
}));

// GET /api/projects/:id/autopilot — get autopilot status
router.get('/:id/autopilot', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const project = getProject(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  res.json({
    enabled: !!project.autopilot_enabled,
    maxAgents: project.autopilot_max_agents ?? 3,
    excludedLabels: JSON.parse(project.autopilot_excluded_labels || '[]'),
  });
}));
```

Also add `validateLocalPath` to the imports at the top of `github.js`:
```js
import { validateLocalPath, parseId } from '../middleware/validate.js';
```

- [ ] **Step 3: Test registration endpoint**

```bash
npm run dev &
sleep 2
# Try to register the agent-army repo itself
curl -s -X POST http://localhost:3000/api/projects/validate \
  -H "Content-Type: application/json" \
  -d '{"localPath": "/Users/amjad/sites/personal/agent-army"}' | jq .
kill %1
```

Expected: `{ "name": "agent-army", "repo": "amjad1233/agent-army", "alreadyRegistered": false }`

- [ ] **Step 4: Write tests for ProjectDetector**

Create `tests/services/ProjectDetector.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

// We test the parsing logic by mocking execFile
// The actual git/filesystem calls are integration-tested manually

describe('detectProject — remote URL parsing', () => {
  const cases = [
    ['https://github.com/amjad1233/my-app.git', 'amjad1233/my-app'],
    ['https://github.com/amjad1233/my-app', 'amjad1233/my-app'],
    ['git@github.com:amjad1233/my-app.git', 'amjad1233/my-app'],
  ];

  for (const [url, expected] of cases) {
    it(`parses "${url}"`, () => {
      const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe(expected);
    });
  }

  it('returns null for non-GitHub remotes', () => {
    const url = 'https://gitlab.com/owner/repo.git';
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
    expect(match).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/services/ProjectDetector.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/github.js server/services/ProjectDetector.js tests/
git commit -m "feat: add project registration routes (POST/DELETE /api/projects, validate, autopilot)"
```

---

## Chunk 3: AutoPilot Service

### Task 7: Build AutoPilot.js

**Files:**
- Create: `server/services/AutoPilot.js`
- Modify: `server/index.js`
- Modify: `server/websocket.js`

- [ ] **Step 1: Create `server/services/AutoPilot.js`**

```js
import { EventEmitter } from 'events';
import { agentManager } from './AgentManager.js';
import { getIssues } from './GitHubService.js';
import { getProject, getActiveSessions, getAllProjects } from './Database.js';

const RETRY_DELAY_MS = 30_000; // wait 30s before retrying a failed issue
const DEFAULT_EXCLUDED = ['still thinking', 'wip', 'blocked'];

class AutoPilot extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, number>} projectId-issueNumber → fail count */
    this.failCounts = new Map();
    this._attached = false;
  }

  /**
   * Wire AutoPilot into AgentManager events.
   * Call once at server startup.
   */
  attach() {
    if (this._attached) return;
    this._attached = true;

    agentManager.on('agent:status', ({ sessionId, status }) => {
      this._onAgentFinished(sessionId, status);
    });
  }

  _onAgentFinished(sessionId, status) {
    // Find which project this session belongs to
    // We need to look it up from all projects since session may be gone from DB soon
    const activeBefore = getActiveSessions();
    const session = activeBefore.find(s => s.id === sessionId);

    // If not in active sessions, check all sessions
    // The status event fires before DB update completes so we read from agentManager context
    // Instead we get projectId from all projects and check which has this session
    // Simplest: iterate projects and try to trigger for any autopilot-enabled one
    // that lost a running agent
    const allProjects = getAllProjects();
    for (const project of allProjects) {
      if (!project.autopilot_enabled) continue;
      // Schedule check with short delay to let DB update settle
      setTimeout(() => this._tryLaunchNext(project.id, status), 500);
    }
  }

  async _tryLaunchNext(projectId, triggerStatus) {
    const project = getProject(projectId);
    if (!project || !project.autopilot_enabled) return;

    // Count agents currently running on this project
    const running = getActiveSessions().filter(s => s.project_id === projectId);
    const maxAgents = project.autopilot_max_agents ?? 3;
    if (running.length >= maxAgents) return;

    // Get excluded labels
    let excluded;
    try {
      excluded = JSON.parse(project.autopilot_excluded_labels || '[]');
    } catch {
      excluded = DEFAULT_EXCLUDED;
    }

    // Fetch open issues
    let issues;
    try {
      issues = await getIssues(project.repo);
    } catch (err) {
      console.error(`[AutoPilot] Failed to fetch issues for ${project.repo}:`, err.message);
      return;
    }

    if (!issues.length) {
      console.log(`[AutoPilot] Nothing left boss, army's chilling on ${project.name}`);
      this.emit('autopilot:idle', { projectId });
      return;
    }

    // Get issue numbers currently being worked on by running agents
    const activeIssueNumbers = new Set(running.map(s => s.issue_number).filter(Boolean));

    // Filter issues
    const skipKeys = new Set(
      [...this.failCounts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([key]) => key)
    );

    const available = issues.filter(issue => {
      // Skip excluded labels
      const labels = issue.labels?.map(l => (typeof l === 'string' ? l : l.name).toLowerCase()) ?? [];
      if (labels.some(l => excluded.map(e => e.toLowerCase()).includes(l))) return false;
      // Skip already being worked on
      if (activeIssueNumbers.has(issue.number)) return false;
      // Skip failed twice
      if (skipKeys.has(`${projectId}-${issue.number}`)) return false;
      return true;
    });

    if (!available.length) {
      console.log(`[AutoPilot] No available issues for ${project.name} — all filtered or in-flight`);
      this.emit('autopilot:idle', { projectId });
      return;
    }

    // Pick oldest (last in array since gh returns newest first)
    const pick = available[available.length - 1];

    // Track if this was a retry after failure
    if (triggerStatus === 'failed') {
      const key = `${projectId}-${pick.number}`;
      this.failCounts.set(key, (this.failCounts.get(key) ?? 0) + 1);
    }

    try {
      const session = agentManager.launch(projectId, pick.number, pick.title);
      console.log(`[AutoPilot] Picked up #${pick.number} on ${project.name} — let's get it`);
      this.emit('autopilot:launched', {
        projectId,
        issueNumber: pick.number,
        issueTitle: pick.title,
        sessionId: session.id,
      });
    } catch (err) {
      console.error(`[AutoPilot] Launch failed for #${pick.number}:`, err.message);
    }
  }

  /**
   * Manually trigger autopilot check for a project
   * (useful for testing or manual kicks via API).
   */
  kick(projectId) {
    this._tryLaunchNext(projectId, 'manual');
  }
}

export const autoPilot = new AutoPilot();
```

- [ ] **Step 2: Attach AutoPilot in `server/index.js`**

Add import:
```js
import { autoPilot } from './services/AutoPilot.js';
```

After `setupWebSocket(server);`, add:
```js
// Attach AutoPilot — must happen after AgentManager is initialized
autoPilot.attach();
```

- [ ] **Step 3: Forward AutoPilot events over WebSocket in `server/websocket.js`**

Add import at the top:
```js
import { autoPilot } from './services/AutoPilot.js';
```

After the existing `agentManager.on(...)` blocks, add:
```js
autoPilot.on('autopilot:launched', ({ projectId, issueNumber, issueTitle, sessionId }) => {
  broadcast({ type: 'autopilot:launched', projectId, issueNumber, issueTitle, sessionId }, null);
});

autoPilot.on('autopilot:idle', ({ projectId }) => {
  broadcast({ type: 'autopilot:idle', projectId }, null);
});
```

- [ ] **Step 4: Write AutoPilot unit tests**

Create `tests/services/AutoPilot.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the issue filtering logic in isolation
describe('AutoPilot — issue filtering', () => {
  const excluded = ['still thinking', 'wip', 'blocked'];

  function filterIssues(issues, activeIssueNumbers, skipKeys) {
    return issues.filter(issue => {
      const labels = issue.labels?.map(l => (typeof l === 'string' ? l : l.name).toLowerCase()) ?? [];
      if (labels.some(l => excluded.includes(l))) return false;
      if (activeIssueNumbers.has(issue.number)) return false;
      if (skipKeys.has(`1-${issue.number}`)) return false;
      return true;
    });
  }

  it('excludes issues with excluded labels', () => {
    const issues = [
      { number: 1, title: 'Do thing', labels: [{ name: 'still thinking' }] },
      { number: 2, title: 'Do other thing', labels: [] },
    ];
    const result = filterIssues(issues, new Set(), new Set());
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it('excludes issues already being worked on', () => {
    const issues = [
      { number: 1, title: 'Active', labels: [] },
      { number: 2, title: 'Available', labels: [] },
    ];
    const result = filterIssues(issues, new Set([1]), new Set());
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it('excludes issues in the skip list', () => {
    const issues = [
      { number: 1, title: 'Failed twice', labels: [] },
      { number: 2, title: 'Fresh', labels: [] },
    ];
    const result = filterIssues(issues, new Set(), new Set(['1-1']));
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it('picks oldest issue (last in array)', () => {
    const issues = [
      { number: 5, title: 'Newest', labels: [] },
      { number: 2, title: 'Oldest', labels: [] },
    ];
    const available = filterIssues(issues, new Set(), new Set());
    const pick = available[available.length - 1];
    expect(pick.number).toBe(2);
  });

  it('returns empty when all issues are filtered', () => {
    const issues = [
      { number: 1, title: 'Blocked', labels: [{ name: 'wip' }] },
    ];
    const result = filterIssues(issues, new Set(), new Set());
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/services/AutoPilot.test.js
```

Expected: all 5 pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/AutoPilot.js server/index.js server/websocket.js tests/
git commit -m "feat: add AutoPilot service — self-replenishing agent army"
```

---

### Task 8: Add kick endpoint for manual AutoPilot trigger

**Files:**
- Modify: `server/routes/github.js`

- [ ] **Step 1: Add POST /api/projects/:id/autopilot/kick**

In `server/routes/github.js`, add import:
```js
import { autoPilot } from '../services/AutoPilot.js';
```

Add route:
```js
// POST /api/projects/:id/autopilot/kick — manually trigger autopilot check
router.post('/:id/autopilot/kick', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const project = getProject(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  autoPilot.kick(id);
  res.json({ ok: true, message: 'AutoPilot kick triggered' });
}));
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/github.js
git commit -m "feat: add autopilot kick endpoint"
```

---

## Chunk 4: UI — Projects Section + AutoPilot Controls + Add Project Modal

### Task 9: App state + data methods in app.js

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add project management state**

In `app.js`, add to the root state object (after `launchForm`):

```js
showAddProjectModal: false,
addProjectForm: { localPath: '', githubProjectNumber: '' },
addProjectValidation: { state: 'idle', name: '', repo: '', error: '' }, // idle|checking|valid|error
addProjectError: '',
addingProject: false,
```

- [ ] **Step 2: Add fetchProjects enhancement — parse autopilot fields**

Update `fetchProjects()` to parse the JSON field:
```js
async fetchProjects() {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    this.projects = data.map(p => ({
      ...p,
      autopilot_excluded_labels: typeof p.autopilot_excluded_labels === 'string'
        ? JSON.parse(p.autopilot_excluded_labels || '[]')
        : (p.autopilot_excluded_labels || []),
    }));
  } catch (err) {
    console.error('Failed to fetch projects:', err);
  }
},
```

- [ ] **Step 3: Add project management methods**

```js
async validateProjectPath() {
  const path = this.addProjectForm.localPath.trim();
  if (!path || path.length < 3) {
    this.addProjectValidation = { state: 'idle', name: '', repo: '', error: '' };
    return;
  }
  this.addProjectValidation = { state: 'checking', name: '', repo: '', error: '' };
  try {
    const res = await fetch('/api/projects/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localPath: path }),
    });
    const data = await res.json();
    if (!res.ok) {
      this.addProjectValidation = { state: 'error', name: '', repo: '', error: data.error };
    } else if (data.alreadyRegistered) {
      this.addProjectValidation = { state: 'error', name: data.name, repo: data.repo, error: 'Already registered bro' };
    } else {
      this.addProjectValidation = { state: 'valid', name: data.name, repo: data.repo, error: '' };
    }
  } catch (err) {
    this.addProjectValidation = { state: 'error', name: '', repo: '', error: 'Could not connect to server' };
  }
},

async addProject() {
  if (this.addProjectValidation.state !== 'valid') return;
  this.addingProject = true;
  this.addProjectError = '';
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        localPath: this.addProjectForm.localPath.trim(),
        githubProjectNumber: this.addProjectForm.githubProjectNumber || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      this.addProjectError = data.error || 'Failed to add project';
      return;
    }
    data.autopilot_excluded_labels = JSON.parse(data.autopilot_excluded_labels || '[]');
    this.projects.push(data);
    this.showAddProjectModal = false;
    this.addProjectForm = { localPath: '', githubProjectNumber: '' };
    this.addProjectValidation = { state: 'idle', name: '', repo: '', error: '' };
    this.showToast(`${data.name} added to the army 🤙`);
  } catch (err) {
    this.addProjectError = `Network error: ${err.message}`;
  } finally {
    this.addingProject = false;
  }
},

async removeProject(id) {
  if (!confirm('Remove this project from AgentArmy? (Agents will not be affected)')) return;
  try {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return;
    }
    this.projects = this.projects.filter(p => p.id !== id);
  } catch (err) {
    alert(`Failed: ${err.message}`);
  }
},

async toggleAutopilot(projectId) {
  const project = this.projects.find(p => p.id === projectId);
  if (!project) return;
  const newEnabled = !project.autopilot_enabled;
  try {
    const res = await fetch(`/api/projects/${projectId}/autopilot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: newEnabled,
        maxAgents: project.autopilot_max_agents ?? 3,
        excludedLabels: project.autopilot_excluded_labels ?? [],
      }),
    });
    const data = await res.json();
    if (res.ok) {
      project.autopilot_enabled = newEnabled ? 1 : 0;
      if (newEnabled) this.showToast(`AutoPilot on for ${project.name} — army's self-running now 🤖`);
    }
  } catch (err) {
    console.error('Failed to toggle autopilot:', err);
  }
},

async updateAutopilotMax(projectId, delta) {
  const project = this.projects.find(p => p.id === projectId);
  if (!project) return;
  const newMax = Math.max(1, Math.min(10, (project.autopilot_max_agents ?? 3) + delta));
  project.autopilot_max_agents = newMax;
  try {
    await fetch(`/api/projects/${projectId}/autopilot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: !!project.autopilot_enabled,
        maxAgents: newMax,
        excludedLabels: project.autopilot_excluded_labels ?? [],
      }),
    });
  } catch (err) {
    console.error('Failed to update max agents:', err);
  }
},
```

- [ ] **Step 4: Add toast system**

Add to root state:
```js
toasts: [],
```

Add method:
```js
showToast(message, duration = 4000) {
  const id = Date.now();
  this.toasts.push({ id, message });
  setTimeout(() => {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }, duration);
},
```

- [ ] **Step 5: Handle AutoPilot WebSocket events**

In `connectWebSocket()`, inside `ws.onmessage`, after the existing `if` blocks, add:

```js
if (msg.type === 'autopilot:launched') {
  this.showToast(`AutoPilot picked up #${msg.issueNumber} — let's get it 🤙`);
  this.fetchAgents();
}
if (msg.type === 'autopilot:idle') {
  const project = this.projects.find(p => p.id === msg.projectId);
  if (project) this.showToast(`Nothing left boss, ${project.name}'s army is chilling`);
}
```

- [ ] **Step 6: Update dynamic copy**

Replace `dashboardSubtitle` getter:
```js
get dashboardSubtitle() {
  const autoPilotCount = this.projects.filter(p => p.autopilot_enabled).length;
  if (this.runningCount > 0 && autoPilotCount > 0) {
    return `${this.runningCount} agent${this.runningCount > 1 ? 's' : ''} grinding rn — AutoPilot's got the wheel 🤖`;
  }
  if (this.runningCount > 0) {
    return `${this.runningCount} agent${this.runningCount > 1 ? 's' : ''} grinding rn.`;
  }
  if (autoPilotCount > 0) {
    return `AutoPilot's watching ${autoPilotCount} project${autoPilotCount > 1 ? 's' : ''} — it'll pick something up.`;
  }
  if (this.agents.length > 0) {
    return `${this.agents.length} session${this.agents.length > 1 ? 's' : ''} total. Launch one to get going.`;
  }
  return "Your army's idle. Launch one to get going.";
},
```

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add project management state, autopilot methods, and toast system to app.js"
```

---

### Task 10: UI — Projects section + Add Project modal + Toasts

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add AutoPilot stat card to stats grid**

Replace the 4th stat card (Failed) with an autopilot card, and push Failed to a 5th card. Actually, insert before the failed card:

Find:
```html
<div class="grid grid-cols-4 gap-3.5 mb-7">
```
Replace with:
```html
<div class="grid grid-cols-5 gap-3.5 mb-7">
```

Add a new card after the Completed card:
```html
<div class="card fadeUp fadeUp-4" style="padding: 18px 20px;">
  <div class="stat-label">AutoPilot</div>
  <div class="stat-value" style="color: var(--green);"
    x-text="projects.filter(p => p.autopilot_enabled).length"></div>
  <div class="stat-sub">projects on auto</div>
</div>
```

- [ ] **Step 2: Add Projects section to dashboard**

Insert after the "Active Agents" section (after the closing `</div>` of the `fadeUp fadeUp-2` div), before the Session History section:

```html
<!-- Projects + AutoPilot controls -->
<div class="fadeUp fadeUp-3 mb-7">
  <div class="flex items-center justify-between mb-3">
    <div class="label">Projects</div>
    <button
      @click="showAddProjectModal = true"
      class="btn btn-ghost btn-sm"
      style="font-size: 11px;"
    >+ Add Project</button>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <template x-for="project in projects" :key="project.id">
      <div class="card" style="padding: 16px 18px; position: relative;">
        <!-- Remove button -->
        <button
          @click.stop="removeProject(project.id)"
          class="absolute"
          style="top: 10px; right: 10px; color: var(--text-3); font-size: 14px; line-height: 1; background: none; border: none; cursor: pointer; opacity: 0;"
          @mouseenter="$el.style.opacity = 1; $el.style.color = 'var(--red)'"
          @mouseleave="$el.style.opacity = 0"
          x-init="$el.parentElement.addEventListener('mouseenter', () => $el.style.opacity = 1); $el.parentElement.addEventListener('mouseleave', () => $el.style.opacity = 0)"
          title="Remove project"
        >&times;</button>

        <!-- Project info -->
        <div class="text-[13px] font-medium text-text1 mb-0.5 pr-5" x-text="project.name"></div>
        <div class="mono text-[10px] text-text3 mb-3" x-text="project.repo"></div>

        <!-- AutoPilot toggle -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <!-- Toggle switch -->
            <button
              @click="toggleAutopilot(project.id)"
              class="relative flex-shrink-0"
              style="width: 36px; height: 20px; border-radius: 10px; border: none; cursor: pointer; transition: background 0.2s;"
              :style="project.autopilot_enabled ? 'background: var(--green)' : 'background: var(--bg-elevated); border: 1px solid var(--border)'"
              title="Toggle AutoPilot"
            >
              <span
                class="absolute"
                style="width: 14px; height: 14px; border-radius: 50%; background: white; top: 3px; transition: left 0.2s;"
                :style="project.autopilot_enabled ? 'left: 19px;' : 'left: 3px;'"
              ></span>
            </button>
            <span
              class="mono text-[10px]"
              :class="project.autopilot_enabled ? 'text-green' : 'text-text3'"
              x-text="project.autopilot_enabled ? 'AutoPilot ON' : 'AutoPilot off'"
            ></span>
          </div>

          <!-- Max agents (only when autopilot on) -->
          <div x-show="project.autopilot_enabled" class="flex items-center gap-1">
            <button
              @click="updateAutopilotMax(project.id, -1)"
              class="mono text-[12px] text-text3"
              style="background: none; border: 1px solid var(--border); border-radius: 4px; width: 18px; height: 18px; line-height: 1; cursor: pointer;"
            >−</button>
            <span class="mono text-[11px] text-text2" x-text="(project.autopilot_max_agents ?? 3) + ' max'"></span>
            <button
              @click="updateAutopilotMax(project.id, 1)"
              class="mono text-[12px] text-text3"
              style="background: none; border: 1px solid var(--border); border-radius: 4px; width: 18px; height: 18px; line-height: 1; cursor: pointer;"
            >+</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div x-show="projects.length === 0" class="col-span-2 card" style="padding: 28px 20px; text-align: center;">
      <p class="text-[13px] text-text3 mb-2">No projects yet</p>
      <button @click="showAddProjectModal = true" class="btn btn-ghost btn-sm" style="font-size: 11px;">
        + Add your first project
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add "auto" badge to agent cards in history**

In the history row template, add after the project name div:
```html
<span
  x-show="agent.launched_by === 'autopilot'"
  class="mono text-[9px] px-1.5 py-0.5 rounded"
  style="background: rgba(34,197,94,0.1); color: var(--green); border: 1px solid rgba(34,197,94,0.2);"
>auto</span>
```

- [ ] **Step 4: Add Add Project modal**

Insert before the closing `</body>` tag (after the prompt library modal):

```html
<!-- ─── ADD PROJECT MODAL ─────────────────────────────── -->
<div x-show="showAddProjectModal" x-cloak class="modal">
  <div class="modal-backdrop" @click="showAddProjectModal = false"></div>
  <div class="modal-content" @click.stop style="max-width: 460px;">
    <h2 class="modal-title">Add Project</h2>

    <form @submit.prevent="addProject">
      <label class="form-label">Local path</label>
      <input
        type="text"
        x-model="addProjectForm.localPath"
        @input.debounce.600ms="validateProjectPath()"
        placeholder="/Users/you/sites/my-app"
        class="input mb-2"
        autocomplete="off"
        spellcheck="false"
      />

      <!-- Validation feedback -->
      <div class="mb-4 mono text-[11px]" style="min-height: 18px;">
        <span x-show="addProjectValidation.state === 'checking'" class="text-text3">checking...</span>
        <span x-show="addProjectValidation.state === 'valid'" class="text-green">
          ✓ found <span x-text="addProjectValidation.repo"></span>
        </span>
        <span x-show="addProjectValidation.state === 'error'" style="color: var(--red);"
          x-text="addProjectValidation.error"></span>
      </div>

      <label class="form-label">
        GitHub Project number
        <span class="form-label-hint">(optional — links the board)</span>
      </label>
      <input
        type="number"
        x-model.number="addProjectForm.githubProjectNumber"
        placeholder="e.g. 3"
        class="input mb-6"
      />

      <div x-show="addProjectError" x-cloak class="mb-4 px-3 py-2 rounded-lg text-[13px]"
        style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: var(--red);"
        x-text="addProjectError"
      ></div>

      <div class="flex justify-end gap-2">
        <button type="button" @click="showAddProjectModal = false" class="btn btn-ghost">Cancel</button>
        <button
          type="submit"
          :disabled="addProjectValidation.state !== 'valid' || addingProject"
          class="btn btn-primary disabled:opacity-30"
        >
          <span x-show="!addingProject">Add to Army</span>
          <span x-show="addingProject" x-cloak>Adding...</span>
        </button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 5: Add toast container**

Insert just before the `<script src="/js/app.js">` line:

```html
<!-- ─── TOASTS ──────────────────────────────────────────── -->
<div
  class="fixed flex flex-col gap-2"
  style="bottom: 24px; right: 24px; z-index: 9999; pointer-events: none;"
>
  <template x-for="toast in toasts" :key="toast.id">
    <div
      class="px-4 py-2.5 rounded-lg mono text-[12px] text-text1"
      style="background: var(--bg-elevated); border: 1px solid var(--border); pointer-events: auto; max-width: 320px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);"
      x-text="toast.message"
      x-transition:enter="transition ease-out duration-200"
      x-transition:enter-start="opacity-0 translate-y-2"
      x-transition:enter-end="opacity-100 translate-y-0"
      x-transition:leave="transition ease-in duration-150"
      x-transition:leave-start="opacity-100"
      x-transition:leave-end="opacity-0"
    ></div>
  </template>
</div>
```

- [ ] **Step 6: Smoke test the UI**

```bash
npm run dev
# Open http://localhost:3000
# Verify:
# - Projects section appears on dashboard
# - "+ Add Project" button opens modal
# - Typing a valid path shows "✓ found owner/repo"
# - Typing an invalid path shows error
# - Toasts appear and disappear after 4s
# - AutoPilot toggle flips and persists on refresh
```

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: add projects section, autopilot controls, add-project modal, and toasts to UI"
```

---

### Task 11: Final wiring — run all tests, lint, verify

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Fix any errors. Then:

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Full smoke test**

```bash
npm run dev
```

Open `http://localhost:3000` and verify:
- Dashboard loads, shows projects
- Add a new project (type a local path to any git repo on your machine)
- Autopilot toggle works per project
- Launch an agent manually — it appears in terminals tab
- Toast appears on autopilot events
- Server logs show morgan request lines
- Shutdown via "Quit Server" closes cleanly

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: production-ready — hardened server, dynamic project registration, AutoPilot army"
```

---

## File Map Summary

| File | Action | Purpose |
|------|--------|---------|
| `server/index.js` | Modify | Add dotenv, morgan, error middleware, autopilot attach |
| `server/middleware/asyncHandler.js` | Create | Async route wrapper |
| `server/middleware/validate.js` | Create | parseId, validateMessage, validateLocalPath |
| `server/services/AutoPilot.js` | Create | Self-replenishing army logic |
| `server/services/ProjectDetector.js` | Create | Local path → git remote → repo detection |
| `server/services/Database.js` | Modify | Autopilot migration, deleteProject, updateProjectAutopilot |
| `server/routes/agents.js` | Modify | asyncHandler wrapping, validation |
| `server/routes/github.js` | Modify | Add project CRUD + autopilot endpoints |
| `server/routes/broadcast.js` | Modify | asyncHandler + validateMessage |
| `server/routes/prompts.js` | Modify | asyncHandler wrapping |
| `server/websocket.js` | Modify | Forward autopilot events |
| `db/migrations/001-autopilot.sql` | Create | Autopilot schema columns |
| `public/js/app.js` | Modify | Project CRUD state, autopilot methods, toasts, dynamic copy |
| `public/index.html` | Modify | Projects section, autopilot toggles, add modal, toasts |
| `.env.example` | Create | Env var docs |
| `tests/middleware/validate.test.js` | Create | Validation unit tests |
| `tests/services/AutoPilot.test.js` | Create | AutoPilot filtering unit tests |
| `tests/services/ProjectDetector.test.js` | Create | Remote URL parsing tests |
