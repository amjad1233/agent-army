import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getAllProjects,
  getProject,
  insertProject,
  deleteProject,
  getProjectByPath,
  updateProjectAutopilot,
  getActiveSessions,
} from '../services/Database.js';
import { getIssues, getPrs } from '../services/GitHubService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parseId, validateLocalPath } from '../middleware/validate.js';
import { detectProject } from '../services/ProjectDetector.js';

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

// POST /api/projects/validate — pre-check a local path without saving
// IMPORTANT: This must come BEFORE the /:id routes to avoid conflict
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

export default router;
