import { Router } from 'express';
import { agentManager } from '../services/AgentManager.js';
import { getSession, getAllSessions, getActiveSessions, clearFinishedSessions } from '../services/Database.js';

const router = Router();

// POST /api/agents/launch — Launch a new agent
router.post('/launch', (req, res) => {
  try {
    const { projectId, issueNumber, issueTitle } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    const session = agentManager.launch(projectId, issueNumber, issueTitle);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents — List all agents
router.get('/', (req, res) => {
  const sessions = getAllSessions();
  // Annotate with live running status
  const result = sessions.map((s) => ({
    ...s,
    live: agentManager.isRunning(s.id),
  }));
  res.json(result);
});

// GET /api/agents/active — List running agents only
router.get('/active', (req, res) => {
  const sessions = getActiveSessions();
  res.json(sessions);
});

// GET /api/agents/:id — Agent detail
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const session = getSession(id);
  if (!session) return res.status(404).json({ error: 'Agent not found' });

  const log = agentManager.getLog(id);
  res.json({ ...session, live: agentManager.isRunning(id), recentLog: log });
});

// POST /api/agents/:id/message — Send message to agent
router.post('/:id/message', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    agentManager.sendMessage(id, message);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/:id/resume — Resume a stopped/completed agent
router.post('/:id/resume', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = agentManager.resume(id);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/agents/:id — Stop agent
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    agentManager.stop(id);
    res.json({ ok: true, status: 'stopping' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/stop-all — Stop all running agents
router.post('/stop-all', (req, res) => {
  const count = agentManager.runningCount;
  agentManager.stopAll();
  res.json({ ok: true, stopped: count });
});

// DELETE /api/agents — Remove finished (non-running) agents from the list
router.delete('/', (req, res) => {
  const removed = clearFinishedSessions();
  res.json({ ok: true, removed });
});

// GET /api/agents/:id/health — Check if agent process is alive
router.get('/:id/health', (req, res) => {
  const id = parseInt(req.params.id);
  const session = getSession(id);
  if (!session) return res.status(404).json({ error: 'Agent not found' });

  const running = agentManager.isRunning(id);
  const healthy = running && agentManager.isHealthy(id);

  res.json({
    id,
    running,
    healthy,
    status: session.status,
    pid: session.pid,
  });
});

export default router;
