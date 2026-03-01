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

// --- Agent Sessions ---

export function createSession({ projectId, issueNumber, issueTitle, pid, worktreePath, branchName }) {
  const result = getDb()
    .prepare(
      `INSERT INTO agent_sessions (project_id, issue_number, issue_title, pid, worktree_path, branch_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, issueNumber || null, issueTitle || null, pid, worktreePath || null, branchName || null);
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

// --- Broadcasts ---

export function createBroadcast(message, agentCount) {
  return getDb()
    .prepare('INSERT INTO broadcasts (message, agent_count) VALUES (?, ?)')
    .run(message, agentCount);
}

// --- Cleanup ---

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}
