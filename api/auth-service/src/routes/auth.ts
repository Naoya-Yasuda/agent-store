import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import pool from '../db/pool';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  TokenPayload,
} from '../services/jwtService';

const router = Router();

// アカウント登録
router.post('/register', async (req: Request, res: Response) => {
  const { organization, user } = req.body;

  if (!organization?.name || !organization?.contact_email || !user?.email || !user?.password) {
    return res.status(400).json({
      error: 'missing_required_fields',
      message: 'Organization name, contact email, user email, and password are required',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if organization email already exists
    const orgCheck = await client.query(
      'SELECT id FROM organizations WHERE contact_email = $1',
      [organization.contact_email]
    );
    if (orgCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'organization_exists',
        message: 'An organization with this email already exists',
      });
    }

    // Check if user email already exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [user.email]
    );
    if (userCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'user_exists',
        message: 'A user with this email already exists',
      });
    }

    // Create organization
    const orgResult = await client.query(
      `INSERT INTO organizations (name, contact_email, website, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [organization.name, organization.contact_email, organization.website || null]
    );
    const organizationId = orgResult.rows[0].id;

    // Hash password
    const passwordHash = await bcrypt.hash(user.password, 10);

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, organization_id, created_at, updated_at)
       VALUES ($1, $2, 'company', $3, NOW(), NOW())
       RETURNING id, email, role`,
      [user.email, passwordHash, organizationId]
    );

    const newUser = userResult.rows[0];

    await client.query('COMMIT');

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
      organizationId,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return res.status(201).json({
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        organization_id: organizationId,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[auth] Registration error:', error);
    return res.status(500).json({
      error: 'registration_failed',
      message: 'Failed to register account',
    });
  } finally {
    client.release();
  }
});

// ログイン
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: 'missing_credentials',
      message: 'Email and password are required',
    });
  }

  try {
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

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('[auth] Login error:', error);
    return res.status(500).json({
      error: 'login_failed',
      message: 'Failed to login',
    });
  }
});

// トークン検証
router.post('/verify', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      valid: false,
      error: 'missing_token',
    });
  }

  const token = authHeader.substring(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    return res.status(401).json({
      valid: false,
      error: 'invalid_token',
    });
  }

  return res.status(200).json({
    valid: true,
    payload,
  });
});

// トークンリフレッシュ
router.post('/refresh', (req: Request, res: Response) => {
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

  const newAccessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken(payload);

  return res.status(200).json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
});

export default router;
