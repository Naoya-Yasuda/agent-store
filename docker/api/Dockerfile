# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    postgresql-client

# Copy API code
COPY api/ /app/api/
COPY schemas/ /app/schemas/
COPY db/ /app/db/

# Install Node.js dependencies for API routes
WORKDIR /app
RUN if [ -f api/package.json ]; then \
    cd api && npm install --production; \
    fi

# Create a simple Express server wrapper
RUN cat > /app/server.js << 'EOF'
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
try {
  const agentCardsRouter = require('./api/routes/agentCards');
  const submissionsRouter = require('./api/routes/submissions');
  const reviewsRouter = require('./api/routes/reviews');

  app.use('/api', agentCardsRouter);
  app.use('/api', submissionsRouter);
  app.use('/api', reviewsRouter);
} catch (error) {
  console.error('Failed to load API routes:', error.message);
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agent Store API listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});
EOF

# Install Express if not already installed
RUN npm install express

EXPOSE 3000

CMD ["node", "server.js"]
