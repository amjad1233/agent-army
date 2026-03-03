import { Router } from 'express';
import { getAllPrompts, insertPrompt, deletePrompt } from '../services/Database.js';

const router = Router();

// GET /api/prompts — List all saved prompts
router.get('/', (req, res) => {
  const prompts = getAllPrompts();
  res.json(prompts);
});

// POST /api/prompts — Create a new prompt
router.post('/', (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  const id = insertPrompt({ title, body });
  res.json({ id, title, body, created_at: new Date().toISOString() });
});

// DELETE /api/prompts/:id — Delete a prompt
router.delete('/:id', (req, res) => {
  const changes = deletePrompt(req.params.id);
  if (changes === 0) return res.status(404).json({ error: 'Prompt not found' });
  res.json({ ok: true });
});

export default router;
