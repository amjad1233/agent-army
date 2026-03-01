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

export default router;
