-- Projects registered in the swarm
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  repo TEXT NOT NULL,
  local_path TEXT NOT NULL,
  github_project_id TEXT,
  github_project_number INTEGER,
  color TEXT DEFAULT '#3B82F6',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent sessions (running or completed)
CREATE TABLE IF NOT EXISTS agent_sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  issue_number INTEGER,
  issue_title TEXT,
  status TEXT DEFAULT 'running',
  worktree_path TEXT,
  branch_name TEXT,
  pr_number INTEGER,
  claude_session_id TEXT,
  agent_name TEXT,
  pid INTEGER,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  log_file TEXT
);

-- Broadcast history
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY,
  message TEXT NOT NULL,
  agent_count INTEGER,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Saved prompts for the prompt library
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Activity log for the event feed
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  project_name TEXT,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
