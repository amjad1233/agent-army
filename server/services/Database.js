import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../db/agent-army.db');
const SCHEMA_PATH = join(__dirname, '../../db/schema.sql');

let instance = null;

export function getDb() {
  if (!instance) {
    instance = new Database(DB_PATH);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');

    // Run schema
    const schema = readFileSync(SCHEMA_PATH, 'utf-8');
    instance.exec(schema);

    // Migrate: add claude_session_id if missing (for existing DBs)
    const cols = instance.prepare('PRAGMA table_info(agent_sessions)').all();
    if (!cols.find(c => c.name === 'claude_session_id')) {
      instance.exec('ALTER TABLE agent_sessions ADD COLUMN claude_session_id TEXT');
    }

    // Migrate: add autopilot columns to projects (for existing DBs)
    const projectCols = instance.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
    if (!projectCols.includes('autopilot_enabled')) {
      instance.exec('ALTER TABLE projects ADD COLUMN autopilot_enabled INTEGER DEFAULT 0');
      instance.exec('ALTER TABLE projects ADD COLUMN autopilot_max_agents INTEGER DEFAULT 3');
      instance.exec('ALTER TABLE projects ADD COLUMN autopilot_excluded_labels TEXT DEFAULT \'["still thinking","wip","blocked"]\'');
    }
  }
  return instance;
}

// --- Projects ---

export function getAllProjects() {
  return getDb().prepare('SELECT * FROM projects ORDER BY name').all();
}

export function getProject(id) {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

export function insertProject({ name, repo, localPath, githubProjectId, githubProjectNumber }) {
  return getDb()
    .prepare(
      `INSERT INTO projects (name, repo, local_path, github_project_id, github_project_number)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, repo, localPath, githubProjectId, githubProjectNumber);
}

export function projectCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM projects').get().count;
}

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

// --- Agent Sessions ---

export function createSession({ projectId, issueNumber, issueTitle, pid, worktreePath, branchName, claudeSessionId }) {
  const result = getDb()
    .prepare(
      `INSERT INTO agent_sessions (project_id, issue_number, issue_title, pid, worktree_path, branch_name, claude_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, issueNumber || null, issueTitle || null, pid, worktreePath || null, branchName || null, claudeSessionId || null);
  return result.lastInsertRowid;
}

export function updateSessionStatus(id, status) {
  const finished = status !== 'running' ? new Date().toISOString() : null;
  getDb()
    .prepare('UPDATE agent_sessions SET status = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?')
    .run(status, finished, id);
}

export function updateSessionPr(id, prNumber) {
  getDb().prepare('UPDATE agent_sessions SET pr_number = ? WHERE id = ?').run(prNumber, id);
}

export function getSession(id) {
  return getDb()
    .prepare(
      `SELECT s.*, p.name as project_name, p.repo as project_repo
       FROM agent_sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE s.id = ?`
    )
    .get(id);
}

export function getActiveSessions() {
  return getDb()
    .prepare(
      `SELECT s.*, p.name as project_name, p.repo as project_repo
       FROM agent_sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE s.status = 'running'
       ORDER BY s.started_at DESC`
    )
    .all();
}

export function getAllSessions() {
  return getDb()
    .prepare(
      `SELECT s.*, p.name as project_name, p.repo as project_repo
       FROM agent_sessions s
       JOIN projects p ON s.project_id = p.id
       ORDER BY s.started_at DESC`
    )
    .all();
}

export function clearFinishedSessions() {
  const result = getDb()
    .prepare("DELETE FROM agent_sessions WHERE status IN ('completed', 'failed', 'stopped')")
    .run();
  return result.changes;
}

export function getResumableSessions() {
  return getDb()
    .prepare(
      `SELECT s.*, p.name as project_name, p.repo as project_repo
       FROM agent_sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE s.status IN ('completed', 'failed', 'stopped')
         AND s.claude_session_id IS NOT NULL
       ORDER BY s.finished_at DESC`
    )
    .all();
}

// --- Broadcasts ---

export function createBroadcast(message, agentCount) {
  return getDb()
    .prepare('INSERT INTO broadcasts (message, agent_count) VALUES (?, ?)')
    .run(message, agentCount);
}

// --- Prompts ---

export function getAllPrompts() {
  return getDb().prepare('SELECT * FROM prompts ORDER BY created_at DESC').all();
}

export function getPrompt(id) {
  return getDb().prepare('SELECT * FROM prompts WHERE id = ?').get(id);
}

export function insertPrompt({ title, body }) {
  const result = getDb()
    .prepare('INSERT INTO prompts (title, body) VALUES (?, ?)')
    .run(title, body);
  return result.lastInsertRowid;
}

export function deletePrompt(id) {
  const result = getDb().prepare('DELETE FROM prompts WHERE id = ?').run(id);
  return result.changes;
}

// --- Default Prompts ---

export function seedDefaultPrompts() {
  const count = getDb().prepare('SELECT COUNT(*) as count FROM prompts').get().count;
  if (count > 0) return; // Already seeded

  const defaults = [
    {
      title: 'Auto-pick issue',
      body: `You are an autonomous development agent. Your job is to pick up one issue, complete it, create a PR, and stop.

SETUP:
1. Read ~/.claude/swarm.md for the full agent protocol and project registry
2. Read the project's CLAUDE.md for project-specific rules
3. Identify this project from the registry by matching the current working directory

EXECUTE THE FULL 12-STEP PROTOCOL from swarm.md:
1. Orient — read CLAUDE.md, check open PRs
2. Claim — find next available issue (no \`picked-up\` label), add \`picked-up\` label
3. Move to "In progress" on the project board
4. Check dependencies — wait if blocked
5. Create feature branch from main (or dependency branch)
6. Do the work — follow all project rules
7. Commit with issue reference
8. Run \`cr review\` (CodeRabbit CLI) — fix ALL findings before pushing
9. Rebase on main (fetch latest, rebase if main moved), re-run checks if rebased
10. Push and create PR with review requested from amjad1233
11. Move issue to "In review" on the board
12. STOP — do not pick up another issue

CONSTRAINTS:
- One issue per session
- Never commit to main
- Never force-push
- If merge conflict during rebase → abort rebase, report conflict, and stop
- If dependency not started → report and stop
- Run \`cr review\` BEFORE pushing — fix issues locally, not after PR`
    },
    {
      title: 'Specific issue (#N)',
      body: `You are an autonomous development agent. Your job is to complete issue #<NUMBER>, create a PR, and stop.

SETUP:
1. Read ~/.claude/swarm.md for the full agent protocol and project registry
2. Read the project's CLAUDE.md for project-specific rules
3. Identify this project from the registry by matching the current working directory

EXECUTE THE FULL 12-STEP PROTOCOL from swarm.md:
1. Orient — read CLAUDE.md, check open PRs
2. Verify issue #<NUMBER> has no \`picked-up\` label — if it does, STOP
3. Claim it — add \`picked-up\` label, move to "In progress" on the board
4. Check dependencies — wait if blocked
5. Create feature branch from main (or dependency branch)
6. Do the work — follow all project rules
7. Commit with issue reference
8. Run \`cr review\` (CodeRabbit CLI) — fix ALL findings before pushing
9. Rebase on main (fetch latest, rebase if main moved), re-run checks if rebased
10. Push and create PR with review requested from amjad1233
11. Move issue to "In review" on the board
12. STOP — do not pick up another issue

CONSTRAINTS:
- One issue per session
- Never commit to main
- Never force-push
- If merge conflict during rebase → abort rebase, report conflict, and stop
- If dependency not started → report and stop
- Run \`cr review\` BEFORE pushing — fix issues locally, not after PR`
    },
    {
      title: 'New project setup',
      body: `You are setting up a new project for my agent swarm. Read ~/.claude/swarm.md for the full swarm protocol.

DO THE FOLLOWING:

1. GITHUB SETUP:
   - Create a GitHub repo under amjad1233 (ask me for the repo name and description)
   - Create a GitHub Project (beta) board for it
   - Add fields: Priority (P0/P1/P2), Size (XS/S/M/L/XL) if not already present
   - Create labels: picked-up (yellow #fbca04), plus any phase labels I specify
   - Create a \`picked-up\` label: gh label create "picked-up" --description "Claimed by an agent — do not pick up" --color "fbca04"

2. CLAUDE.MD:
   - Ask me about the project (what it does, tech stack, key features)
   - Create a CLAUDE.md following the same structure as other projects in the swarm
   - Include: project overview, tech stack table, architecture, directory structure, data model, development rules, terminology, quick start
   - Include the Multi-Agent Workflow section from the swarm protocol

3. BACKLOG:
   - Ask me about the features/phases I want
   - Break them into GitHub issues with detailed descriptions, acceptance criteria, and checklists
   - Add all issues to the project board with appropriate Status, Priority, and Size
   - Set up iterations if I want them

4. SWARM REGISTRY:
   - Get all project field IDs using the GraphQL query from swarm.md
   - Add the project entry to ~/.claude/swarm.md under the Project Registry section
   - Include all field IDs, status option IDs, and labels

5. VERIFY:
   - Commit and push CLAUDE.md
   - Print a summary: repo URL, board URL, number of issues, and the launch command`
    },
    {
      title: 'Onboard existing project',
      body: `You are onboarding an existing project into my agent swarm. Read ~/.claude/swarm.md for the full swarm protocol.

This project already has code. DO NOT modify any existing code. Only add swarm infrastructure.

DO THE FOLLOWING:

1. UNDERSTAND THE PROJECT:
   - Read the codebase: check package.json/composer.json, look at src/app structure, README if it exists
   - Identify: tech stack, key directories, existing conventions, test setup, linting

2. GITHUB PROJECT BOARD:
   - Check if a GitHub Project board exists for this repo. If not, create one.
   - Add fields: Priority (P0/P1/P2), Size (XS/S/M/L/XL) if not present
   - Create the \`picked-up\` label if it doesn't exist

3. CLAUDE.MD:
   - Create CLAUDE.md based on what you learned from the codebase
   - Follow the same structure as other swarm projects
   - Include accurate: tech stack, architecture, directory structure, existing conventions
   - Include the Multi-Agent Workflow section
   - DO NOT invent or assume features — only document what exists

4. BACKLOG:
   - Ask me what work I want done on this project
   - Create GitHub issues with descriptions and acceptance criteria
   - Add to project board with Priority, Size, and Status

5. SWARM REGISTRY:
   - Get all project field IDs
   - Add the project to ~/.claude/swarm.md under the Project Registry

6. VERIFY:
   - Commit CLAUDE.md (only file that should be new)
   - Print summary: repo URL, board URL, issues created, launch command

DO NOT: Modify any existing code, restructure the project, add dependencies, or change the README.`
    },
    {
      title: 'Shutdown project',
      body: `You are shutting down a project from my agent swarm. Read ~/.claude/swarm.md for the full swarm protocol.

DO THE FOLLOWING:

1. CHECK FOR IN-FLIGHT WORK:
   - List all open issues with \`picked-up\` label — these have agents working on them
   - List all open PRs — these need to be merged or closed
   - If anything is in-flight, STOP and tell me. Do not proceed until I confirm.

2. CLEAN UP GITHUB:
   - Close all remaining open issues (or move to Done if completed)
   - Merge or close all open PRs

3. CLEAN UP WORKTREES:
   - List all git worktrees: git worktree list
   - Remove any leftover agent worktrees: git worktree remove <path>
   - Prune: git worktree prune

4. CLEAN UP BRANCHES:
   - List all remote branches: git branch -r
   - Delete merged feature branches (remote and local)
   - Keep only main

5. REMOVE FROM SWARM REGISTRY:
   - Remove the project entry from ~/.claude/swarm.md

6. SUMMARY:
   - Print what was cleaned up: issues closed, PRs merged, branches deleted, worktrees removed
   - Confirm the project is no longer in the swarm registry

Ask me before doing anything destructive (deleting branches, archiving repo, closing issues).`
    }
  ];

  const stmt = getDb().prepare('INSERT INTO prompts (title, body) VALUES (?, ?)');
  for (const { title, body } of defaults) {
    stmt.run(title, body);
  }
}

// --- Activity Log ---

export function insertActivity(type, projectName, message, metadata = null) {
  return getDb()
    .prepare('INSERT INTO activity_log (type, project_name, message, metadata_json) VALUES (?, ?, ?, ?)')
    .run(type, projectName, message, metadata ? JSON.stringify(metadata) : null);
}

export function getRecentActivity(limit = 50) {
  return getDb()
    .prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

// --- Cleanup ---

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}
