import { Router, Response } from 'express';
import { validateSubmissionPayload } from '../utils/submissionValidator';
import { createSubmission } from '../services/submissionService';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// エージェント登録はcompanyロール必須
router.post('/v1/submissions', authenticate, requireRole('company'), async (req: AuthenticatedRequest, res: Response) => {
  const validation = validateSubmissionPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({ errors: validation.errors });
  }

  try {
    const submissionRecord = await createSubmission(validation.payload, validation.manifestWarnings, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
      requestId: req.get('x-request-id') ?? undefined
    });
    return res.status(202).json({
      submissionId: submissionRecord.id,
      state: submissionRecord.state,
      manifestWarnings: submissionRecord.manifestWarnings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'submission_failed', message });
  }
});

export default router;
