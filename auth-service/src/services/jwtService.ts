import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
}

export function generateAccessToken(payload: TokenPayload): string {
  // Add jti (JWT ID) to ensure each token is unique
  const payloadWithJti = {
    ...payload,
    jti: randomBytes(16).toString('hex'),
  };
  return jwt.sign(payloadWithJti, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY } as any);
}

export function generateRefreshToken(payload: TokenPayload): string {
  // Add jti (JWT ID) to ensure each token is unique
  const payloadWithJti = {
    ...payload,
    jti: randomBytes(16).toString('hex'),
  };
  return jwt.sign(payloadWithJti, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY } as any);
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
}
