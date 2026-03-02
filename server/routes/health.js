import { Router } from 'express';
import { agentManager } from '../services/AgentManager.js';

const router = Router();
const startedAt = Date.now();

// GET /health
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    runningAgents: agentManager.runningCount,
  });
});

// POST /health/shutdown — Stop all agents and exit server
router.post('/shutdown', (req, res) => {
  res.json({ ok: true, message: 'Shutting down...' });
  // Give the response time to flush, then exit
  setTimeout(() => {
    agentManager.stopAll();
    process.exit(0);
  }, 500);
});

export default router;
