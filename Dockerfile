# Build stage for the Next.js web app
FROM node:20-slim AS web-builder

WORKDIR /app/web

# Copy web package files
COPY web/package*.json ./
RUN npm ci

# The web app imports the application-form parser from the scraper's src via the
# @shared alias, so that stage needs it too. Without this the build fails in
# eighteen seconds with an unresolved module - and it builds fine locally, where
# src/ is simply present, so nothing catches it before the deploy.
# Only src/questions, not all of src. The web tsconfig type-checks whatever it
# includes, and the rest of src imports @anthropic-ai/sdk and better-sqlite3,
# which are not web dependencies. Anything shared with the web app therefore has
# to be self-contained - the parser is, deliberately.
COPY src/questions/ /app/src/questions/

# Copy web source and build
COPY web/ ./
RUN npm run build

# Production stage
FROM node:20-slim AS runner

# Install dependencies for better-sqlite3 native module and curl for DB seeding
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy scraper package files and install
COPY package*.json ./
RUN npm ci

# Copy scraper source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy web app from builder
COPY --from=web-builder /app/web/.next ./web/.next
COPY --from=web-builder /app/web/public ./web/public
COPY --from=web-builder /app/web/package*.json ./web/
COPY --from=web-builder /app/web/node_modules ./web/node_modules

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# The database will be stored in /app/data (mount a volume here)
ENV DATABASE_PATH=/app/data/jobs.db

EXPOSE 3000

# Start via script (creates data dir, seeds DB if needed, starts server)
CMD ["/app/start.sh"]
