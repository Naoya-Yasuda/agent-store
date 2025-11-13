import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'company' | 'reviewer' | 'admin';
  organizationId?: string;
}

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'agent-hub-auth',
  });
}

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: 'agent-hub-auth',
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    issuer: 'agent-hub-auth',
  }) as JwtPayload;
  return decoded;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
    issuer: 'agent-hub-auth',
  }) as JwtPayload;
  return decoded;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getRefreshTokenExpiration(): Date {
  const expiresIn = JWT_REFRESH_EXPIRES_IN;
  const match = expiresIn.match(/^(\d+)([smhd])$/);

  if (!match) {
    // Default to 7 days
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + num * multipliers[unit]);
}
