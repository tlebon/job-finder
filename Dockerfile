# Build stage for the Next.js web app
FROM node:20-slim AS web-builder

WORKDIR /app/web

# Copy web package files
COPY web/package*.json ./
RUN npm ci

# The web app imports from the scraper's src through the @shared alias, so this
# stage needs it. Without it the build fails on an unresolved module, and it
# builds fine locally where src/ is simply present, so nothing catches it first.
#
# All of src, not a list of subdirectories. This used to copy only
# src/questions/ on the theory that the rest would drag @anthropic-ai/sdk and
# better-sqlite3 into a build that lacks them. That was asserted in the same
# commit that added the line and never tested; building this stage with all of
# src present succeeds. Nothing here is type-checked or bundled unless the web
# app imports it, and web/tsconfig.json opts directories into type-checking
# explicitly rather than sweeping up ../src.
#
# The list was a live trap: sharing a new directory meant remembering to add it
# here, and forgetting cost a silent 49-minute deploy failure once already.
COPY src/ /app/src/

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
