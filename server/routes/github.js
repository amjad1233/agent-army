import { Router } from 'express';
import { getAllProjects, getProject } from '../services/Database.js';

const router = Router();

// GET /api/projects — List all registered projects
router.get('/', (req, res) => {
  res.json(getAllProjects());
});

// GET /api/projects/:id — Single project
router.get('/:id', (req, res) => {
  const project = getProject(parseInt(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// GET /api/projects/:id/issues — Open issues (Phase 2)
router.get('/:id/issues', (req, res) => {
  res.json([]); // TODO: implement with gh CLI
});

// GET /api/projects/:id/prs — Open PRs (Phase 2)
router.get('/:id/prs', (req, res) => {
  res.json([]); // TODO: implement with gh CLI
});

export default router;
