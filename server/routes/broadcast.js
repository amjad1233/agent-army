import { Router } from 'express';
import { agentManager } from '../services/AgentManager.js';
import { createBroadcast } from '../services/Database.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateMessage } from '../middleware/validate.js';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const message = validateMessage(req.body.message);
  const count = agentManager.broadcast(message);
  createBroadcast(message, count);
  res.json({ ok: true, agentCount: count });
}));

export default router;
