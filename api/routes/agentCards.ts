// AgentCard API placeholder (TypeScript)
import { Router, Request, Response } from 'express';
import { validateAgentCardPayload } from '../utils/agentCardValidator';
import { upsertAgentCard, getAgentCards, getAgentCardByAgentId } from '../services/agentCardService';

const router = Router();

router.get('/public/catalog', async (_req: Request, res: Response) => {
  const cards = await getAgentCards();
  res.json({ items: cards });
});

router.get('/public/catalog/:slug', async (req: Request, res: Response) => {
  const card = await getAgentCardByAgentId(req.params.slug);
  if (!card) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json(card);
});

router.post('/v1/agents/:agentId/card', async (req: Request, res: Response) => {
  const payload = req.body;
  const validation = validateAgentCardPayload(payload);
  if (!validation.valid) {
    return res.status(400).json({ errors: validation.errors });
  }
  // TODO: map payload to persistence model, handle locales & review workflow
  await upsertAgentCard({
    ...(payload as any),
    agentId: req.params.agentId
  });
  res.status(202).json({ status: 'pending' });
});

router.patch('/v1/agents/:agentId/card/:locale', async (_req: Request, res: Response) => {
  // TODO: update translation
  res.status(202).json({ status: 'pending' });
});

export default router;
