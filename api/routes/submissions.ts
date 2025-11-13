import { Router, Response } from 'express';
import multer from 'multer';
import { validateSubmissionPayload } from '../utils/submissionValidator';
import { createSubmission } from '../services/submissionService';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Multer設定（署名バンドルのアップロード用）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// エージェント登録はcompanyロール必須
router.post('/submissions',
  authenticate,
  requireRole('company'),
  upload.single('signatureBundle'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FormDataからパラメータを取得
      const agentCardUrl = req.body.agentCardUrl;
      const endpointUrl = req.body.endpointUrl;
      const organizationId = req.body.organization_id || req.user?.organizationId;

      if (!agentCardUrl || !endpointUrl) {
        return res.status(400).json({
          error: 'missing_required_fields',
          message: 'agentCardUrl and endpointUrl are required',
        });
      }

      if (!organizationId) {
        return res.status(400).json({
          error: 'missing_organization_id',
          message: 'Organization ID is required',
        });
      }

      // Agent Cardを取得
      const agentCardResponse = await fetch(agentCardUrl);
      if (!agentCardResponse.ok) {
        return res.status(400).json({
          error: 'invalid_agent_card_url',
          message: 'Failed to fetch agent card from the provided URL',
        });
      }

      const cardDocument = await agentCardResponse.json();

      // SubmissionPayloadを構築
      const payload = {
        cardDocument,
        endpointUrl,
        organizationId,
        signatureBundle: req.file ? {
          filename: req.file.originalname,
          data: req.file.buffer,
          mimetype: req.file.mimetype,
        } : undefined,
      };

      const validation = validateSubmissionPayload(payload);
      if (!validation.valid) {
        return res.status(400).json({ errors: validation.errors });
      }

      const submissionRecord = await createSubmission(validation.payload, validation.manifestWarnings, {
        ip: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
        requestId: req.get('x-request-id') ?? undefined,
      });

      return res.status(202).json({
        submissionId: submissionRecord.id,
        state: submissionRecord.state,
        manifestWarnings: submissionRecord.manifestWarnings,
      });
    } catch (error) {
      console.error('[submissions] Error:', error);
      const message = error instanceof Error ? error.message : 'unknown_error';
      return res.status(500).json({ error: 'submission_failed', message });
    }
  }
);

export default router;
