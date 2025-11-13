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

# Install API dependencies using package manifest for caching
COPY api/package*.json /app/api/
RUN cd /app/api && npm install && ln -s /app/api/node_modules /app/node_modules

# Copy API code
COPY api/ /app/api/
COPY schemas/ /app/schemas/
COPY db/ /app/db/
COPY prototype/temporal-review-workflow/ /app/prototype/temporal-review-workflow/

# Change to API directory for runtime
WORKDIR /app/api

EXPOSE 3000

CMD ["node", "-r", "ts-node/register/transpile-only", "server.ts"]
