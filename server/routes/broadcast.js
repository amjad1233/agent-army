import { Router } from 'express';
import { agentManager } from '../services/AgentManager.js';
import { createBroadcast } from '../services/Database.js';

const router = Router();

// POST /api/broadcast — Send message to all running agents
router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const count = agentManager.broadcast(message);
  createBroadcast(message, count);
  res.json({ ok: true, agentCount: count });
});

export default router;
