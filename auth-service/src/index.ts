import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { registerUser, login, refreshAccessToken, revokeRefreshToken } from './auth';
import { verifyAccessToken } from './jwt';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3002'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'auth-service' });
});

// Register
app.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, role, organizationId } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields: email, password, role' });
    }

    if (!['company', 'reviewer', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be company, reviewer, or admin' });
    }

    const result = await registerUser({ email, password, role, organizationId });

    res.status(201).json(result);
  } catch (err) {
    console.error('Register error:', err);
    const error = err as Error;
    if (error.message.includes('already exists')) {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
app.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields: email, password' });
    }

    const result = await login({ email, password });

    res.json(result);
  } catch (err) {
    console.error('Login error:', err);
    const error = err as Error;
    if (error.message.includes('Invalid credentials') || error.message.includes('deactivated')) {
      return res.status(401).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Refresh token
app.post('/auth/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    const result = await refreshAccessToken(refreshToken);

    res.json(result);
  } catch (err) {
    console.error('Refresh token error:', err);
    const error = err as Error;
    return res.status(401).json({ error: error.message });
  }
});

// Logout (revoke refresh token)
app.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    await revokeRefreshToken(refreshToken);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Verify token (for middleware usage)
app.post('/auth/verify', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    res.json({ valid: true, payload });
  } catch (err) {
    console.error('Verify token error:', err);
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Auth service listening on port ${PORT}`);
});
