import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRouter from './routes/auth';

const app = express();
const PORT = Number(process.env.PORT || 3001);

// Middleware
app.use(cors());
app.use(helmet());
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
});
