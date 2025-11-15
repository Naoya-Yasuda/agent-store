import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRouter from './routes/auth';

const app = express();
const PORT = Number(process.env.PORT || 3001);

// CORS設定: Submission UI (3002), Review UI (3001) からのアクセスを許可
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3002,http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Helmet設定（CORSの前に設定して、CORS-Resource-Policyを調整）
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS設定
app.use(cors({
  origin: (origin, callback) => {
    console.log('[CORS] Request from origin:', origin, 'allowedOrigins:', allowedOrigins);
    // origin未指定（同一オリジン）またはallowedOriginsに含まれる場合は許可
    if (!origin || allowedOrigins.includes(origin)) {
      console.log('[CORS] Allowing origin:', origin);
      callback(null, true);
    } else {
      // 許可されていないオリジンの場合はfalseを返す（エラーではなく）
      console.log('[CORS] Rejecting origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[auth-service] error:', err);
  res.status(500).json({ error: 'internal_server_error', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth Service listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database configured: ${Boolean(process.env.DATABASE_URL)}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(', ')}`);
});
