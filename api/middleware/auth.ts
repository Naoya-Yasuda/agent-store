import { Request, Response, NextFunction } from 'express';

// Auth Service URLの設定
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

// ユーザーロール型定義
export type UserRole = 'company' | 'reviewer' | 'admin';

// 認証済みユーザー情報をRequestに追加
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: UserRole;
    organizationId?: string;
  };
}

/**
 * JWT認証ミドルウェア
 * Authorization headerからトークンを取得し、Auth Serviceで検証
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Missing or invalid authorization header',
      });
      return;
    }

    const token = authHeader.substring(7);

    // Auth Serviceでトークン検証
    const response = await fetch(`${AUTH_SERVICE_URL}/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired token',
      });
      return;
    }

    const data = await response.json();

    if (!data.valid || !data.payload) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Token verification failed',
      });
      return;
    }

    // リクエストにユーザー情報を追加
    req.user = {
      userId: data.payload.userId,
      email: data.payload.email,
      role: data.payload.role,
      organizationId: data.payload.organizationId,
    };

    next();
  } catch (err) {
    console.error('[auth middleware] Error:', err);
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Authentication failed',
    });
  }
}

/**
 * ロールベースアクセス制御（RBAC）ミドルウェア
 * 指定されたロールのいずれかを持つユーザーのみアクセスを許可
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'forbidden',
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * オプショナル認証ミドルウェア
 * トークンがある場合は検証するが、ない場合はスキップ
 */
export async function optionalAuthenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // トークンがない場合はスキップ
    next();
    return;
  }

  // トークンがある場合は検証
  await authenticate(req, res, next);
}

/**
 * 組織所有権チェックミドルウェア
 * リクエストされたリソースが、ユーザーの組織に属しているかチェック
 */
export function requireOrganizationOwnership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  // adminは全てのリソースにアクセス可能
  if (req.user.role === 'admin') {
    next();
    return;
  }

  // companyロールの場合、組織が一致するかチェック
  const requestedOrganizationId = req.params.organizationId || req.body.organizationId;

  if (!requestedOrganizationId) {
    res.status(400).json({
      error: 'bad_request',
      message: 'Organization ID required',
    });
    return;
  }

  if (req.user.organizationId !== requestedOrganizationId) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Access denied to this organization resource',
    });
    return;
  }

  next();
}
