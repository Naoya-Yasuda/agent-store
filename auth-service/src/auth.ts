import bcrypt from 'bcrypt';
import { getDbPool } from './db';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiration,
  JwtPayload,
} from './jwt';

const SALT_ROUNDS = 10;

export interface RegisterUserInput {
  email: string;
  password: string;
  role: 'company' | 'reviewer' | 'admin';
  organizationId?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export async function registerUser(input: RegisterUserInput): Promise<AuthResponse> {
  const pool = getDbPool();

  // Check if user already exists
  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existingUser.rows.length > 0) {
    throw new Error('User already exists with this email');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  // Insert user
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role, organization_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role, organization_id`,
    [input.email, passwordHash, input.role, input.organizationId || null]
  );

  const user = result.rows[0];

  // Generate tokens
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organization_id,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // Store refresh token
  const tokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiration();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    },
  };
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const pool = getDbPool();

  // Find user
  const result = await pool.query(
    'SELECT id, email, password_hash, role, organization_id, is_active FROM users WHERE email = $1',
    [input.email]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid credentials');
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw new Error('Account is deactivated');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(input.password, user.password_hash);
  if (!isValidPassword) {
    throw new Error('Invalid credentials');
  }

  // Update last login
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

  // Generate tokens
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organization_id,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // Store refresh token
  const tokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiration();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    },
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
  const pool = getDbPool();

  // Verify refresh token
  let payload: JwtPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new Error('Invalid refresh token');
  }

  // Check if token exists in database and is not revoked
  const tokenHash = hashToken(refreshToken);
  const tokenResult = await pool.query(
    `SELECT id, expires_at, revoked
     FROM refresh_tokens
     WHERE token_hash = $1 AND user_id = $2`,
    [tokenHash, payload.userId]
  );

  if (tokenResult.rows.length === 0) {
    throw new Error('Refresh token not found');
  }

  const tokenRecord = tokenResult.rows[0];

  if (tokenRecord.revoked) {
    throw new Error('Refresh token has been revoked');
  }

  if (new Date(tokenRecord.expires_at) < new Date()) {
    throw new Error('Refresh token has expired');
  }

  // Get latest user data
  const userResult = await pool.query(
    'SELECT id, email, role, organization_id, is_active FROM users WHERE id = $1',
    [payload.userId]
  );

  if (userResult.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = userResult.rows[0];

  if (!user.is_active) {
    throw new Error('Account is deactivated');
  }

  // Generate new access token
  const newPayload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organization_id,
  };

  const accessToken = generateAccessToken(newPayload);

  // Generate new refresh token
  const newRefreshToken = generateRefreshToken(newPayload);
  const newTokenHash = hashToken(newRefreshToken);
  const newExpiresAt = getRefreshTokenExpiration();

  // Revoke old refresh token
  await pool.query(
    'UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE id = $1',
    [tokenRecord.id]
  );

  // Store new refresh token
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, newTokenHash, newExpiresAt]
  );

  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    },
  };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const pool = getDbPool();
  const tokenHash = hashToken(refreshToken);

  await pool.query(
    'UPDATE refresh_tokens SET revoked = true, revoked_at = now() WHERE token_hash = $1',
    [tokenHash]
  );
}
