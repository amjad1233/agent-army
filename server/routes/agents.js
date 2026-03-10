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
  const session = agentManager.launch(parseId(String(projectId)), issueNumber || null, issueTitle || null, customPrompt || null);
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
