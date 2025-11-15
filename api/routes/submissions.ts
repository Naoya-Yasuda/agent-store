import { Router, Response } from 'express';
import multer from 'multer';
import { validateSubmissionPayload } from '../utils/submissionValidator';
import { createSubmission } from '../services/submissionService';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import pool from '../db/pool';

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

      // 組織情報を取得
      const orgResult = await pool.query(
        'SELECT id, name, contact_email, public_key FROM organizations WHERE id = $1',
        [organizationId]
      );
      if (orgResult.rows.length === 0) {
        return res.status(400).json({
          error: 'organization_not_found',
          message: 'Organization not found',
        });
      }
      const org = orgResult.rows[0];

      // SubmissionPayloadを構築
      const payload = {
        agentId: cardDocument.agentId || `agent-${Date.now()}`,
        cardDocument,
        endpointManifest: {
          url: endpointUrl,
          method: 'POST',
          headers: {},
        },
        organization: {
          organizationId: org.id,
          name: org.name,
          contactEmail: org.contact_email,
          operatorPublicKey: org.public_key || '',
        },
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

// 自分の組織のsubmissions一覧を取得
router.get('/submissions/my',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          error: 'missing_organization_id',
          message: 'Organization ID not found',
        });
      }

      const result = await pool.query(
        `SELECT
          s.id,
          s.state,
          s.created_at,
          s.card_document,
          s.sandbox_score,
          s.inspect_score,
          s.judge_panel_score,
          s.final_score
         FROM submissions s
         WHERE s.organization_id = $1
         ORDER BY s.created_at DESC`,
        [organizationId]
      );

      const submissions = result.rows.map(row => ({
        id: row.id,
        agentName: row.card_document?.agent?.name || 'Unknown',
        agentVersion: row.card_document?.agent?.version || 'Unknown',
        state: row.state,
        createdAt: row.created_at,
        sandboxScore: row.sandbox_score,
        inspectScore: row.inspect_score,
        judgePanelScore: row.judge_panel_score,
        finalScore: row.final_score,
      }));

      return res.status(200).json({ submissions });
    } catch (error) {
      console.error('[submissions/my] Error:', error);
      const message = error instanceof Error ? error.message : 'unknown_error';
      return res.status(500).json({ error: 'fetch_failed', message });
    }
  }
);

export default router;
