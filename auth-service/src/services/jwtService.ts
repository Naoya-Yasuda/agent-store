import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';

// JWT Secretsは必須。デフォルト値を削除してセキュリティを強化
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables must be set');
}

const jwtSecret = JWT_SECRET as string;
const jwtRefreshSecret = JWT_REFRESH_SECRET as string;

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
  return jwt.sign(payloadWithJti, jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY } as any);
}

export function generateRefreshToken(payload: TokenPayload): string {
  // Add jti (JWT ID) to ensure each token is unique
  const payloadWithJti = {
    ...payload,
    jti: randomBytes(16).toString('hex'),
  };
  return jwt.sign(payloadWithJti, jwtRefreshSecret, { expiresIn: REFRESH_TOKEN_EXPIRY } as any);
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (typeof decoded === 'object' && decoded) {
      return decoded as TokenPayload;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, jwtRefreshSecret);
    if (typeof decoded === 'object' && decoded) {
      return decoded as TokenPayload;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * リフレッシュトークンをSHA256でハッシュ化
 * DBに保存する前に平文トークンをハッシュ化してセキュリティを強化
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
