import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import pool from '../db/pool';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashRefreshToken,
  TokenPayload,
} from '../services/jwtService';

const router = Router();

// アカウント登録
router.post('/register', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { organization, user } = req.body;

    if (!organization?.name || !organization?.contact_email || !user?.email || !user?.password) {
      return res.status(400).json({
        error: 'missing_required_fields',
        message: 'Organization name, contact_email, user email, and password are required',
      });
    }

    await client.query('BEGIN');

    // Organizationの作成
    const orgResult = await client.query(
      `INSERT INTO organizations (name, contact_email, website, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [organization.name, organization.contact_email, organization.website || null]
    );

    const organizationId = orgResult.rows[0].id;

    // パスワードのハッシュ化
    const passwordHash = await bcrypt.hash(user.password, 10);

    // Userの作成
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, organization_id, created_at, updated_at)
       VALUES ($1, $2, 'company', $3, NOW(), NOW())
       RETURNING id, email, role`,
      [user.email, passwordHash, organizationId]
    );

    await client.query('COMMIT');

    const newUser = userResult.rows[0];

    // JWTトークンの生成
    const tokenPayload: TokenPayload = {
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
      organizationId,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Refresh tokenをハッシュ化してDBに保存（セキュリティ強化）
    const tokenHash = hashRefreshToken(refreshToken);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
      [newUser.id, tokenHash]
    );

    return res.status(201).json({
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        organizationId,
      },
      accessToken,
      refreshToken,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[auth] Registration error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'duplicate_email',
        message: 'An account with this email already exists',
      });
    }

    return res.status(500).json({
      error: 'registration_failed',
      message: error.message || 'Failed to register account',
    });
  } finally {
    client.release();
  }
});

// ログイン
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'missing_credentials',
        message: 'Email and password are required',
      });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, role, organization_id FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    // JWTトークンの生成
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Refresh tokenをハッシュ化してDBに保存（セキュリティ強化）
    const tokenHash = hashRefreshToken(refreshToken);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
      [user.id, tokenHash]
    );

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id,
      },
      accessToken,
      refreshToken,
    });
  } catch (error: any) {
    console.error('[auth] Login error:', error);
    return res.status(500).json({
      error: 'login_failed',
      message: error.message || 'Failed to login',
    });
  }
});

// トークン検証
router.post('/verify', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'missing_token',
        message: 'Authorization header with Bearer token is required',
      });
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    if (!payload) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid or expired token',
      });
    }

    return res.status(200).json({ valid: true, payload });
  } catch (error: any) {
    console.error('[auth] Verify error:', error);
    return res.status(500).json({
      error: 'verification_failed',
      message: error.message || 'Failed to verify token',
    });
  }
});

// トークンリフレッシュ
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'missing_refresh_token',
        message: 'Refresh token is required',
      });
    }

    const payload = verifyRefreshToken(refreshToken);

    if (!payload) {
      return res.status(401).json({
        error: 'invalid_refresh_token',
        message: 'Invalid or expired refresh token',
      });
    }

    // DBでトークンが有効か確認（ハッシュ化されたトークンで検索）
    const tokenHash = hashRefreshToken(refreshToken);
    const result = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2 AND revoked = false AND expires_at > NOW()',
      [tokenHash, payload.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'invalid_refresh_token',
        message: 'Refresh token is revoked or expired',
      });
    }

    // 新しいトークンを生成（JWTクレームを除外したクリーンなペイロードを使用）
    const cleanPayload: TokenPayload = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
    };
    const newAccessToken = generateAccessToken(cleanPayload);
    const newRefreshToken = generateRefreshToken(cleanPayload);

    // 古いトークンを無効化してから新しいトークンを保存（ハッシュ化されたトークンで更新）
    await pool.query(
      'UPDATE refresh_tokens SET revoked = true, revoked_at = NOW() WHERE token_hash = $1',
      [tokenHash]
    );

    // 新しいRefresh tokenをハッシュ化してDBに保存
    const newTokenHash = hashRefreshToken(newRefreshToken);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
      [payload.userId, newTokenHash]
    );

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error: any) {
    console.error('[auth] Refresh error:', error);
    return res.status(500).json({
      error: 'refresh_failed',
      message: error.message || 'Failed to refresh token',
    });
  }
});

export default router;
