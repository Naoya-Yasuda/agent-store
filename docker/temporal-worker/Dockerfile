# syntax=docker/dockerfile:1.7
FROM python:3.13-slim AS base

WORKDIR /app

# Install Node.js 20.x and other system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN python3 --version && node --version && npm --version

# Copy Temporal worker code
COPY prototype/temporal-review-workflow/package*.json ./
COPY prototype/temporal-review-workflow/tsconfig.json ./
COPY prototype/temporal-review-workflow/src ./src/
COPY prototype/temporal-review-workflow/temporal.config.ts ./

# Install Node.js dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# Copy Python sandbox-runner and inspect-worker for workflow execution
COPY sandbox-runner /app/sandbox-runner
COPY prototype/inspect-worker /app/prototype/inspect-worker
COPY requirements.txt /app/
RUN python3 -m venv /app/.venv && \
    . /app/.venv/bin/activate && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install -e /app/sandbox-runner

# Install inspect-worker dependencies
COPY prototype/inspect-worker/requirements.txt /app/prototype/inspect-worker/
RUN . /app/.venv/bin/activate && \
    pip install --no-cache-dir -r /app/prototype/inspect-worker/requirements.txt

# Copy necessary resources
COPY prompts /app/prompts
COPY third_party /app/third_party

# Create directories for artifacts, logs, and inspect-worker output
RUN mkdir -p /app/artifacts /app/logs /app/prototype/inspect-worker/out /app/sandbox-runner/artifacts

EXPOSE 8233

# Activate venv and start worker
CMD ["/bin/sh", "-c", ". /app/.venv/bin/activate && node dist/src/worker.js"]
