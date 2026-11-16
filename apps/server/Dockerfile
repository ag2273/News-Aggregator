# Multi-stage Dockerfile for News Aggregator Server (Hono + Node.js)
# Build from repository root: docker build -f apps/server/Dockerfile -t news-server .

# Stage 1: Build TypeScript source
FROM node:22-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy root workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/

# Install server dependencies (including devDependencies for build)
RUN pnpm --filter @news/server install --frozen-lockfile

# Copy server source code and configuration
COPY apps/server ./apps/server

# Build TypeScript to dist
RUN pnpm --filter @news/server build

# Stage 2: Production runner
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace manifests for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/

# Install only production dependencies
RUN pnpm --filter @news/server install --prod --frozen-lockfile

# Copy compiled JavaScript output
COPY --from=builder /app/apps/server/dist ./apps/server/dist
RUN ln -s /app/apps/server/dist /app/dist

# Mount point for a Railway Volume (attach a Volume at /data in the Railway dashboard)
RUN mkdir -p /data

EXPOSE 3001

WORKDIR /app/apps/server

CMD ["node", "dist/index.js"]
