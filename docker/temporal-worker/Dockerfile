# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash \
    curl

# Copy Temporal worker code
COPY prototype/temporal-review-workflow/package*.json ./
COPY prototype/temporal-review-workflow/tsconfig.json ./
COPY prototype/temporal-review-workflow/src ./src/
COPY prototype/temporal-review-workflow/temporal.config.ts ./

# Install dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# Copy Python sandbox-runner for workflow execution
COPY sandbox-runner /app/sandbox-runner
COPY requirements.txt /app/
RUN python3 -m venv /app/.venv && \
    . /app/.venv/bin/activate && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install -e /app/sandbox-runner

# Copy necessary resources
COPY prompts /app/prompts
COPY third_party /app/third_party

# Create directories for artifacts and logs
RUN mkdir -p /app/artifacts /app/logs

EXPOSE 8233

# Activate venv and start worker
CMD ["/bin/sh", "-c", ". /app/.venv/bin/activate && node dist/src/worker.js"]
