import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 監査レジャーエントリの取得（管理者・レビュアー専用）
router.get('/governance/audit-ledger', authenticate, requireRole('admin', 'reviewer'), async (req: Request, res: Response) => {
  try {
    const {
      limit = 20,
      offset = 0,
      submissionId,
      stage,
      severity,
      startDate,
      endDate
    } = req.query;

    const limitNum = Math.min(Number(limit) || 20, 100);
    const offsetNum = Number(offset) || 0;

    let query = `
      SELECT
        se.id,
        se.agent_revision_id,
        se.stage,
        se.event,
        se.data,
        se.timestamp,
        se.severity,
        se.links,
        s.id as submission_id,
        s.card_document->>'agent'->>'name' as agent_name
      FROM stage_events se
      LEFT JOIN agent_revisions ar ON se.agent_revision_id = ar.id
      LEFT JOIN submissions s ON ar.submission_id = s.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // フィルタリング
    if (submissionId) {
      query += ` AND s.id = $${paramIndex}`;
      params.push(submissionId);
      paramIndex++;
    }

    if (stage) {
      query += ` AND se.stage = $${paramIndex}`;
      params.push(stage);
      paramIndex++;
    }

    if (severity) {
      query += ` AND se.severity = $${paramIndex}`;
      params.push(severity);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND se.timestamp >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND se.timestamp <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // ソートとページネーション
    query += ` ORDER BY se.timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offsetNum);

    const result = await pool.query(query, params);

    // カウントクエリ
    let countQuery = `
      SELECT COUNT(*)
      FROM stage_events se
      LEFT JOIN agent_revisions ar ON se.agent_revision_id = ar.id
      LEFT JOIN submissions s ON ar.submission_id = s.id
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (submissionId) {
      countQuery += ` AND s.id = $${countParamIndex}`;
      countParams.push(submissionId);
      countParamIndex++;
    }

    if (stage) {
      countQuery += ` AND se.stage = $${countParamIndex}`;
      countParams.push(stage);
      countParamIndex++;
    }

    if (severity) {
      countQuery += ` AND se.severity = $${countParamIndex}`;
      countParams.push(severity);
      countParamIndex++;
    }

    if (startDate) {
      countQuery += ` AND se.timestamp >= $${countParamIndex}`;
      countParams.push(startDate);
      countParamIndex++;
    }

    if (endDate) {
      countQuery += ` AND se.timestamp <= $${countParamIndex}`;
      countParams.push(endDate);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = Number(countResult.rows[0]?.count || 0);

    const entries = result.rows.map(row => ({
      id: row.id,
      submissionId: row.submission_id,
      agentName: row.agent_name,
      agentRevisionId: row.agent_revision_id,
      stage: row.stage,
      event: row.event,
      data: row.data,
      timestamp: row.timestamp,
      severity: row.severity,
      links: row.links
    }));

    return res.json({
      entries,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      }
    });
  } catch (error) {
    console.error('[governance/audit-ledger] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'audit_ledger_fetch_failed', message });
  }
});

// 特定Submission の監査トレイル取得
router.get('/governance/audit-trail/:submissionId', authenticate, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const user = (req as any).user;

    // アクセス制御: 自組織のSubmissionまたはadmin/reviewer
    const submissionCheck = await pool.query(
      `SELECT s.id, s.organization_id
       FROM submissions s
       WHERE s.id = $1`,
      [submissionId]
    );

    if (submissionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'submission_not_found' });
    }

    const submission = submissionCheck.rows[0];
    const canAccess =
      user.role === 'admin' ||
      user.role === 'reviewer' ||
      (user.role === 'company' && user.organizationId === submission.organization_id);

    if (!canAccess) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // 監査イベントの取得
    const eventsResult = await pool.query(
      `SELECT
        se.id,
        se.stage,
        se.event,
        se.data,
        se.timestamp,
        se.severity,
        se.links
       FROM stage_events se
       JOIN agent_revisions ar ON se.agent_revision_id = ar.id
       WHERE ar.submission_id = $1
       ORDER BY se.timestamp ASC`,
      [submissionId]
    );

    // Trust Score履歴の取得
    const scoresResult = await pool.query(
      `SELECT
        id,
        total_score,
        security_score,
        functional_score,
        judge_score,
        implementation_score,
        auto_decision,
        reasoning,
        created_at
       FROM trust_score_history
       WHERE submission_id = $1
       ORDER BY created_at DESC`,
      [submissionId]
    );

    const auditTrail = {
      submissionId,
      events: eventsResult.rows.map(row => ({
        id: row.id,
        stage: row.stage,
        event: row.event,
        data: row.data,
        timestamp: row.timestamp,
        severity: row.severity,
        links: row.links
      })),
      trustScoreHistory: scoresResult.rows.map(row => ({
        id: row.id,
        totalScore: row.total_score,
        breakdown: {
          security: row.security_score,
          functional: row.functional_score,
          judge: row.judge_score,
          implementation: row.implementation_score
        },
        autoDecision: row.auto_decision,
        reasoning: row.reasoning,
        timestamp: row.created_at
      }))
    };

    return res.json(auditTrail);
  } catch (error) {
    console.error('[governance/audit-trail] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'audit_trail_fetch_failed', message });
  }
});

// Trust Signal収集エンドポイント（外部からのフィードバック）
router.post('/governance/trust-signal', authenticate, async (req: Request, res: Response) => {
  try {
    const {
      agentId,
      signalType,
      severity,
      description,
      metadata
    } = req.body;

    // バリデーション
    const allowedSignalTypes = ['security_incident', 'functional_error', 'performance_degradation', 'user_complaint', 'compliance_violation'];
    const allowedSeverities = ['critical', 'high', 'medium', 'low', 'info'];

    if (!agentId || !signalType || !severity) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    if (!allowedSignalTypes.includes(signalType)) {
      return res.status(400).json({ error: 'invalid_signal_type' });
    }

    if (!allowedSeverities.includes(severity)) {
      return res.status(400).json({ error: 'invalid_severity' });
    }

    const user = (req as any).user;

    // Trust Signalを保存
    const result = await pool.query(
      `INSERT INTO trust_signals (agent_id, signal_type, severity, description, metadata, reporter_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, created_at`,
      [agentId, signalType, severity, description, JSON.stringify(metadata || {}), user.userId]
    );

    const signalId = result.rows[0].id;
    const createdAt = result.rows[0].created_at;

    // スコア減算ロジック（Phase 7の実装予定）
    // 現時点では記録のみ

    return res.status(201).json({
      signalId,
      agentId,
      signalType,
      severity,
      createdAt,
      message: 'Trust signal recorded successfully'
    });
  } catch (error) {
    console.error('[governance/trust-signal] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'trust_signal_creation_failed', message });
  }
});

// ポリシーバージョン一覧取得（管理者専用）
router.get('/governance/policies', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
        id,
        policy_type,
        version,
        content,
        is_active,
        created_at,
        activated_at
       FROM governance_policies
       ORDER BY created_at DESC`
    );

    const policies = result.rows.map(row => ({
      id: row.id,
      policyType: row.policy_type,
      version: row.version,
      content: row.content,
      isActive: row.is_active,
      createdAt: row.created_at,
      activatedAt: row.activated_at
    }));

    return res.json({ policies });
  } catch (error) {
    console.error('[governance/policies] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'policies_fetch_failed', message });
  }
});

// ポリシー作成（管理者専用）
router.post('/governance/policies', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const {
      policyType,
      version,
      content,
      activate
    } = req.body;

    // バリデーション
    const allowedPolicyTypes = ['aisi_prompt', 'security_threshold', 'functional_threshold', 'blacklist', 'terms_of_service'];

    if (!policyType || !version || !content) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    if (!allowedPolicyTypes.includes(policyType)) {
      return res.status(400).json({ error: 'invalid_policy_type' });
    }

    // 同じバージョンが既に存在するかチェック
    const existingPolicy = await pool.query(
      `SELECT id FROM governance_policies WHERE policy_type = $1 AND version = $2`,
      [policyType, version]
    );

    if (existingPolicy.rows.length > 0) {
      return res.status(409).json({ error: 'policy_version_already_exists' });
    }

    // トランザクション開始
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 新しいポリシーを作成
      const insertResult = await client.query(
        `INSERT INTO governance_policies (policy_type, version, content, is_active, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, created_at`,
        [policyType, version, JSON.stringify(content), activate || false]
      );

      const policyId = insertResult.rows[0].id;
      const createdAt = insertResult.rows[0].created_at;

      // activateフラグがtrueの場合、同じpolicyTypeの他のポリシーを非アクティブ化
      if (activate) {
        await client.query(
          `UPDATE governance_policies
           SET is_active = false
           WHERE policy_type = $1 AND id != $2`,
          [policyType, policyId]
        );

        await client.query(
          `UPDATE governance_policies
           SET activated_at = NOW()
           WHERE id = $1`,
          [policyId]
        );
      }

      await client.query('COMMIT');

      return res.status(201).json({
        policyId,
        policyType,
        version,
        isActive: activate || false,
        createdAt,
        message: 'Policy created successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[governance/policies POST] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'policy_creation_failed', message });
  }
});

// ポリシーのアクティベート（管理者専用、4-eyes承認用）
router.post('/governance/policies/:policyId/activate', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { policyId } = req.params;

    // ポリシーの存在確認
    const policyCheck = await pool.query(
      `SELECT policy_type, is_active FROM governance_policies WHERE id = $1`,
      [policyId]
    );

    if (policyCheck.rows.length === 0) {
      return res.status(404).json({ error: 'policy_not_found' });
    }

    const policy = policyCheck.rows[0];

    if (policy.is_active) {
      return res.status(400).json({ error: 'policy_already_active' });
    }

    // トランザクション開始
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 同じpolicy_typeの他のポリシーを非アクティブ化
      await client.query(
        `UPDATE governance_policies
         SET is_active = false
         WHERE policy_type = $1 AND id != $2`,
        [policy.policy_type, policyId]
      );

      // 対象ポリシーをアクティブ化
      await client.query(
        `UPDATE governance_policies
         SET is_active = true, activated_at = NOW()
         WHERE id = $1`,
        [policyId]
      );

      await client.query('COMMIT');

      return res.json({
        policyId,
        isActive: true,
        message: 'Policy activated successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[governance/policies/activate] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'policy_activation_failed', message });
  }
});

export default router;
