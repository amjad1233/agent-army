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
