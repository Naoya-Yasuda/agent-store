import { Router, Request, Response } from 'express';
import pool from '../db/pool';

const router = Router();

// 公開エージェントの一覧を取得
router.get('/catalog', async (req: Request, res: Response) => {
  try {
    const {
      limit = 20,
      offset = 0,
      search,
      category,
      sortBy = 'created_at',
      order = 'DESC'
    } = req.query;

    const limitNum = Math.min(Number(limit) || 20, 100);
    const offsetNum = Number(offset) || 0;

    // セキュリティ: sortByとorderのバリデーション
    const allowedSortFields = ['created_at', 'final_score', 'agent_name'];
    const allowedOrders = ['ASC', 'DESC'];
    const safeSortBy = allowedSortFields.includes(String(sortBy)) ? sortBy : 'created_at';
    const safeOrder = allowedOrders.includes(String(order).toUpperCase()) ? order : 'DESC';

    let query = `
      SELECT
        s.id,
        s.card_document,
        s.final_score,
        s.created_at,
        s.card_document->>'agent'->>'name' as agent_name,
        s.card_document->>'agent'->>'version' as agent_version
      FROM submissions s
      WHERE s.state = 'published'
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // 検索フィルタ
    if (search) {
      query += ` AND (
        s.card_document::text ILIKE $${paramIndex}
        OR s.card_document->>'agent'->>'name' ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // カテゴリフィルタ
    if (category) {
      query += ` AND s.card_document->'capabilities' @> $${paramIndex}::jsonb`;
      params.push(JSON.stringify([category]));
      paramIndex++;
    }

    // ソート
    query += ` ORDER BY ${safeSortBy} ${safeOrder}`;

    // ページネーション
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offsetNum);

    const result = await pool.query(query, params);

    // カウントクエリ
    let countQuery = `SELECT COUNT(*) FROM submissions s WHERE s.state = 'published'`;
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (search) {
      countQuery += ` AND (
        s.card_document::text ILIKE $${countParamIndex}
        OR s.card_document->>'agent'->>'name' ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }

    if (category) {
      countQuery += ` AND s.card_document->'capabilities' @> $${countParamIndex}::jsonb`;
      countParams.push(JSON.stringify([category]));
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = Number(countResult.rows[0]?.count || 0);

    const agents = result.rows.map(row => ({
      id: row.id,
      name: row.card_document?.agent?.name || 'Unknown',
      version: row.card_document?.agent?.version || '1.0.0',
      description: row.card_document?.agent?.description || '',
      capabilities: row.card_document?.capabilities || [],
      useCases: row.card_document?.useCases || [],
      trustScore: row.final_score,
      createdAt: row.created_at,
    }));

    return res.json({
      agents,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total,
      },
    });
  } catch (error) {
    console.error('[catalog] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'catalog_fetch_failed', message });
  }
});

// 特定エージェントの詳細を取得
router.get('/catalog/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    const result = await pool.query(
      `SELECT
        s.id,
        s.card_document,
        s.final_score,
        s.sandbox_score,
        s.inspect_score,
        s.judge_panel_score,
        s.created_at,
        s.updated_at
       FROM submissions s
       WHERE s.id = $1 AND s.state = 'published'`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'agent_not_found' });
    }

    const row = result.rows[0];

    const agent = {
      id: row.id,
      name: row.card_document?.agent?.name || 'Unknown',
      version: row.card_document?.agent?.version || '1.0.0',
      description: row.card_document?.agent?.description || '',
      capabilities: row.card_document?.capabilities || [],
      useCases: row.card_document?.useCases || [],
      executionProfile: row.card_document?.executionProfile,
      pricing: row.card_document?.pricing,
      complianceNotes: row.card_document?.complianceNotes || [],
      scores: {
        sandbox: row.sandbox_score,
        inspect: row.inspect_score,
        judgePanel: row.judge_panel_score,
        final: row.final_score,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return res.json(agent);
  } catch (error) {
    console.error('[catalog/:agentId] Error:', error);
    const message = error instanceof Error ? error.message : 'unknown_error';
    return res.status(500).json({ error: 'agent_fetch_failed', message });
  }
});

export default router;
