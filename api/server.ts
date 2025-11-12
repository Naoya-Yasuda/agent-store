import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import agentCardsRouter from './routes/agentCards';
import submissionsRouter from './routes/submissions';
import reviewsRouter from './routes/reviews';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = allowedOrigins.length
  ? {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      }
    }
  : undefined;

if (corsOptions) {
  app.use(cors(corsOptions));
} else {
  app.use(cors());
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);
const maxRequests = Number(process.env.RATE_LIMIT_MAX ?? 120);
app.use(rateLimit({ windowMs, max: maxRequests, standardHeaders: true, legacyHeaders: false }));

const bodySizeLimit = process.env.BODY_SIZE_LIMIT ?? '1mb';
app.use(express.json({ limit: bodySizeLimit }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', agentCardsRouter);
app.use('/api', submissionsRouter);
app.use('/api', reviewsRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] error:', err);
  res.status(500).json({ error: 'internal_server_error', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agent Store API listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`Database configured: ${Boolean(process.env.DATABASE_URL)}`);
});
