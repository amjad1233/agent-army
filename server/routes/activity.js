import { Router } from 'express';
import { getRecentActivity } from '../services/Database.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(getRecentActivity(limit));
}));

export default router;
