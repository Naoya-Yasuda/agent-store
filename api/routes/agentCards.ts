// AgentCard API placeholder (TypeScript)
import { Router, Request, Response } from 'express';
import { validateAgentCardPayload } from '../utils/agentCardValidator';

const router = Router();

router.get('/public/catalog', async (_req: Request, res: Response) => {
  // TODO: fetch AgentCards with default locale
  res.json({ items: [] });
});

router.get('/public/catalog/:slug', async (_req: Request, res: Response) => {
  // TODO: fetch AgentCard detail by slug/agentId
  res.json({});
});

router.post('/v1/agents/:agentId/card', async (req: Request, res: Response) => {
  const payload = req.body;
  const validation = validateAgentCardPayload(payload);
  if (!validation.valid) {
    return res.status(400).json({ errors: validation.errors });
  }
  // TODO: create/update card and enqueue review
  res.status(202).json({ status: 'pending' });
});

router.patch('/v1/agents/:agentId/card/:locale', async (_req: Request, res: Response) => {
  // TODO: update translation
  res.status(202).json({ status: 'pending' });
});

export default router;
