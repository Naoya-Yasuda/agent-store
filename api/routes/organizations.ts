import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// 組織一覧取得（管理者専用）
router.get('/organizations', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const {
      limit = 20,
      offset = 0,
      verified,
      search
    } = req.query;

    let query = `
      SELECT
        o.id,
        o.name,
        o.contact_email,
        o.website,
        o.verified,
        o.created_at,
        o.updated_at,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT s.id) as submission_count
      FROM organizations o
      LEFT JOIN users u ON u.organization_id = o.id
      LEFT JOIN submissions s ON s.organization_id = o.id
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (verified !== undefined) {
      params.push(verified === 'true');
      conditions.push(`o.verified = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(o.name ILIKE $${params.length} OR o.contact_email ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += `
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);

    // 総件数取得
    let countQuery = 'SELECT COUNT(*) FROM organizations o';
    const countParams: any[] = [];

    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
      countParams.push(...params.slice(0, params.length - 2));
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

    return res.status(200).json({
      organizations: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        contactEmail: row.contact_email,
        website: row.website,
        verified: row.verified,
        userCount: parseInt(row.user_count, 10),
        submissionCount: parseInt(row.submission_count, 10),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset),
        hasMore: Number(offset) + result.rows.length < total
      }
    });
  } catch (error) {
    console.error('[organizations GET] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organizations_fetch_failed', message });
  }
});

// 特定組織の詳細取得（自組織またはadmin）
router.get('/organizations/:organizationId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { organizationId } = req.params;
    const user = req.user;

    // アクセス制御: 自組織またはadmin
    if (user.role !== 'admin' && user.organizationId !== organizationId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access denied to this organization'
      });
    }

    const result = await pool.query(
      `SELECT
        o.id,
        o.name,
        o.contact_email,
        o.website,
        o.verified,
        o.created_at,
        o.updated_at,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT s.id) as submission_count
       FROM organizations o
       LEFT JOIN users u ON u.organization_id = o.id
       LEFT JOIN submissions s ON s.organization_id = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Organization not found'
      });
    }

    const org = result.rows[0];

    return res.status(200).json({
      id: org.id,
      name: org.name,
      contactEmail: org.contact_email,
      website: org.website,
      verified: org.verified,
      userCount: parseInt(org.user_count, 10),
      submissionCount: parseInt(org.submission_count, 10),
      createdAt: org.created_at,
      updatedAt: org.updated_at
    });
  } catch (error) {
    console.error('[organizations/:id GET] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_fetch_failed', message });
  }
});

// 組織作成（パブリックエンドポイント - 新規登録用）
router.post('/organizations', async (req: Request, res: Response) => {
  try {
    const {
      name,
      contactEmail,
      website
    } = req.body;

    // バリデーション
    if (!name || !contactEmail) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Name and contact email are required'
      });
    }

    // メールアドレス形式チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactEmail)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid email format'
      });
    }

    // 重複チェック（同じメールアドレスの組織は作成不可）
    const duplicateCheck = await pool.query(
      'SELECT id FROM organizations WHERE contact_email = $1',
      [contactEmail]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'conflict',
        message: 'An organization with this email already exists'
      });
    }

    const result = await pool.query(
      `INSERT INTO organizations (name, contact_email, website, verified, created_at, updated_at)
       VALUES ($1, $2, $3, false, now(), now())
       RETURNING id, name, contact_email, website, verified, created_at, updated_at`,
      [name, contactEmail, website || null]
    );

    const newOrg = result.rows[0];

    return res.status(201).json({
      id: newOrg.id,
      name: newOrg.name,
      contactEmail: newOrg.contact_email,
      website: newOrg.website,
      verified: newOrg.verified,
      createdAt: newOrg.created_at,
      updatedAt: newOrg.updated_at
    });
  } catch (error) {
    console.error('[organizations POST] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_creation_failed', message });
  }
});

// 組織情報更新（自組織またはadmin）
router.put('/organizations/:organizationId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { organizationId } = req.params;
    const user = req.user;

    // アクセス制御: 自組織またはadmin
    if (user.role !== 'admin' && user.organizationId !== organizationId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access denied to update this organization'
      });
    }

    const {
      name,
      contactEmail,
      website
    } = req.body;

    // 存在確認
    const orgCheck = await pool.query(
      'SELECT id FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Organization not found'
      });
    }

    // 更新するフィールドを動的に構築
    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      params.push(name);
      updates.push(`name = $${params.length}`);
    }

    if (contactEmail !== undefined) {
      // メールアドレス形式チェック
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Invalid email format'
        });
      }

      // 重複チェック
      const duplicateCheck = await pool.query(
        'SELECT id FROM organizations WHERE contact_email = $1 AND id != $2',
        [contactEmail, organizationId]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'conflict',
          message: 'An organization with this email already exists'
        });
      }

      params.push(contactEmail);
      updates.push(`contact_email = $${params.length}`);
    }

    if (website !== undefined) {
      params.push(website || null);
      updates.push(`website = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'No fields to update'
      });
    }

    // updated_atは常に更新
    updates.push('updated_at = now()');

    params.push(organizationId);

    const result = await pool.query(
      `UPDATE organizations
       SET ${updates.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, name, contact_email, website, verified, created_at, updated_at`,
      params
    );

    const updatedOrg = result.rows[0];

    return res.status(200).json({
      id: updatedOrg.id,
      name: updatedOrg.name,
      contactEmail: updatedOrg.contact_email,
      website: updatedOrg.website,
      verified: updatedOrg.verified,
      createdAt: updatedOrg.created_at,
      updatedAt: updatedOrg.updated_at
    });
  } catch (error) {
    console.error('[organizations/:id PUT] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_update_failed', message });
  }
});

// 組織の認証状態を更新（admin専用）
router.patch('/organizations/:organizationId/verify', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;
    const { verified } = req.body;

    if (typeof verified !== 'boolean') {
      return res.status(400).json({
        error: 'validation_error',
        message: 'verified field must be a boolean'
      });
    }

    const result = await pool.query(
      `UPDATE organizations
       SET verified = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, name, contact_email, website, verified, created_at, updated_at`,
      [verified, organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Organization not found'
      });
    }

    const org = result.rows[0];

    return res.status(200).json({
      id: org.id,
      name: org.name,
      contactEmail: org.contact_email,
      website: org.website,
      verified: org.verified,
      createdAt: org.created_at,
      updatedAt: org.updated_at
    });
  } catch (error) {
    console.error('[organizations/:id/verify PATCH] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_verify_failed', message });
  }
});

// 組織削除（admin専用）
router.delete('/organizations/:organizationId', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;

    // 関連データの確認
    const usersCheck = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE organization_id = $1',
      [organizationId]
    );

    const submissionsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM submissions WHERE organization_id = $1',
      [organizationId]
    );

    const userCount = parseInt(usersCheck.rows[0].count, 10);
    const submissionCount = parseInt(submissionsCheck.rows[0].count, 10);

    if (userCount > 0 || submissionCount > 0) {
      return res.status(409).json({
        error: 'conflict',
        message: `Cannot delete organization with ${userCount} users and ${submissionCount} submissions. Set organization_id to NULL first.`
      });
    }

    const result = await pool.query(
      'DELETE FROM organizations WHERE id = $1 RETURNING id',
      [organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Organization not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    console.error('[organizations/:id DELETE] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_delete_failed', message });
  }
});

// 組織のユーザー一覧取得（自組織またはadmin）
router.get('/organizations/:organizationId/users', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { organizationId } = req.params;
    const user = req.user;

    // アクセス制御: 自組織またはadmin
    if (user.role !== 'admin' && user.organizationId !== organizationId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access denied to view users of this organization'
      });
    }

    const result = await pool.query(
      `SELECT
        id,
        email,
        role,
        organization_id,
        created_at,
        updated_at
       FROM users
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );

    return res.status(200).json({
      users: result.rows.map(row => ({
        id: row.id,
        email: row.email,
        role: row.role,
        organizationId: row.organization_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    console.error('[organizations/:id/users GET] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_users_fetch_failed', message });
  }
});

// 組織の提出物一覧取得（自組織またはadmin）
router.get('/organizations/:organizationId/submissions', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { organizationId } = req.params;
    const user = req.user;
    const {
      limit = 20,
      offset = 0,
      state
    } = req.query;

    // アクセス制御: 自組織またはadmin
    if (user.role !== 'admin' && user.organizationId !== organizationId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access denied to view submissions of this organization'
      });
    }

    let query = `
      SELECT
        id,
        agent_card_url,
        agent_endpoint,
        organization_id,
        state,
        trust_score,
        auto_decision,
        created_at,
        updated_at
      FROM submissions
      WHERE organization_id = $1
    `;

    const params: any[] = [organizationId];

    if (state) {
      params.push(state);
      query += ` AND state = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);

    // 総件数取得
    let countQuery = 'SELECT COUNT(*) FROM submissions WHERE organization_id = $1';
    const countParams: any[] = [organizationId];

    if (state) {
      countParams.push(state);
      countQuery += ` AND state = $${countParams.length}`;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

    return res.status(200).json({
      submissions: result.rows.map(row => ({
        id: row.id,
        agentCardUrl: row.agent_card_url,
        agentEndpoint: row.agent_endpoint,
        organizationId: row.organization_id,
        state: row.state,
        trustScore: row.trust_score,
        autoDecision: row.auto_decision,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset),
        hasMore: Number(offset) + result.rows.length < total
      }
    });
  } catch (error) {
    console.error('[organizations/:id/submissions GET] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'organization_submissions_fetch_failed', message });
  }
});

export default router;
