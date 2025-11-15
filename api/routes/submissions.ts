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
      console.log('[submissions] Fetching agent card from:', agentCardUrl);
      const agentCardResponse = await fetch(agentCardUrl);
      if (!agentCardResponse.ok) {
        console.error('[submissions] Failed to fetch agent card, status:', agentCardResponse.status);
        return res.status(400).json({
          error: 'invalid_agent_card_url',
          message: 'Failed to fetch agent card from the provided URL',
        });
      }

      const cardDocument = await agentCardResponse.json();
      console.log('[submissions] Agent card fetched:', JSON.stringify(cardDocument, null, 2));

      // 組織情報を取得
      const orgResult = await pool.query(
        'SELECT id, name, contact_email FROM organizations WHERE id = $1',
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
      const agentId = cardDocument.agentId || `agent-${Date.now()}`;
      console.log('[submissions] Using agentId:', agentId, 'type:', typeof agentId);

      const payload = {
        agentId,
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
          operatorPublicKey: '',
        },
        signatureBundle: req.file ? {
          filename: req.file.originalname,
          data: req.file.buffer,
          mimetype: req.file.mimetype,
        } : undefined,
      };

      const validation = validateSubmissionPayload(payload);
      if (!validation.valid) {
        console.error('[submissions] Validation failed:', validation.errors);
        console.error('[submissions] Payload:', JSON.stringify(payload, null, 2));
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

// 特定のsubmissionの進捗状況を取得
router.get('/submissions/:id/progress',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const submissionId = req.params.id;

      const result = await pool.query(
        `SELECT
          id,
          state,
          trust_score,
          security_score,
          functional_score,
          judge_score,
          implementation_score,
          score_breakdown,
          auto_decision,
          created_at,
          updated_at
         FROM submissions
         WHERE id = $1`,
        [submissionId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Submission not found',
        });
      }

      const submission = result.rows[0];

      // Build trustScore object if scores exist
      const trustScore = submission.trust_score ? {
        security: submission.security_score || 0,
        functional: submission.functional_score || 0,
        judge: submission.judge_score || 0,
        implementation: submission.implementation_score || 0,
        total: submission.trust_score,
        autoDecision: submission.auto_decision || 'requires_human_review',
        reasoning: submission.score_breakdown || {},
      } : undefined;

      // Build stages object based on current state
      const stateToStages: Record<string, any> = {
        'precheck_pending': {
          precheck: { status: 'pending' },
          security_gate: { status: 'pending' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'precheck_running': {
          precheck: { status: 'running' },
          security_gate: { status: 'pending' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'security_gate_pending': {
          precheck: { status: 'completed' },
          security_gate: { status: 'pending' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'security_gate_running': {
          precheck: { status: 'completed' },
          security_gate: { status: 'running' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'functional_pending': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'functional_running': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'running' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'judge_pending': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'completed' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'judge_running': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'completed' },
          judge: { status: 'running' },
          human_review: { status: 'pending' },
        },
        'awaiting_human_review': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'completed' },
          judge: { status: 'completed' },
          human_review: { status: 'awaiting_review' },
        },
        'approved': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'completed' },
          judge: { status: 'completed' },
          human_review: { status: 'completed' },
        },
        'rejected': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'completed' },
          judge: { status: 'completed' },
          human_review: { status: 'completed' },
        },
        'failed': {
          precheck: { status: 'failed' },
          security_gate: { status: 'pending' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'precheck_failed': {
          precheck: { status: 'failed' },
          security_gate: { status: 'pending' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'security_failed': {
          precheck: { status: 'completed' },
          security_gate: { status: 'failed' },
          functional_accuracy: { status: 'pending' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'functional_failed': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'failed' },
          judge: { status: 'pending' },
          human_review: { status: 'pending' },
        },
        'judge_failed': {
          precheck: { status: 'completed' },
          security_gate: { status: 'completed' },
          functional_accuracy: { status: 'completed' },
          judge: { status: 'failed' },
          human_review: { status: 'pending' },
        },
      };

      const stages = stateToStages[submission.state] || {
        precheck: { status: 'pending' },
        security_gate: { status: 'pending' },
        functional_accuracy: { status: 'pending' },
        judge: { status: 'pending' },
        human_review: { status: 'pending' },
      };

      return res.status(200).json({
        id: submission.id,
        terminalState: submission.state,
        stages,
        trustScore,
        createdAt: submission.created_at,
        updatedAt: submission.updated_at,
      });
    } catch (error) {
      console.error('[submissions/:id/progress] Error:', error);
      const message = error instanceof Error ? error.message : 'unknown_error';
      return res.status(500).json({ error: 'fetch_failed', message });
    }
  }
);

// submissionを削除（開発環境のみ）
router.delete('/submissions/:id',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const submissionId = req.params.id;

      const result = await pool.query(
        'DELETE FROM submissions WHERE id = $1 RETURNING id',
        [submissionId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Submission not found',
        });
      }

      return res.status(200).json({
        message: 'Submission deleted successfully',
        id: result.rows[0].id,
      });
    } catch (error) {
      console.error('[submissions/:id DELETE] Error:', error);
      const message = error instanceof Error ? error.message : 'unknown_error';
      return res.status(500).json({ error: 'delete_failed', message });
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
