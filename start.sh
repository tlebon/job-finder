#!/bin/sh
set -e

# Create data directory if it doesn't exist
mkdir -p /app/data

# Force reseed if requested (set FORCE_RESEED=true and SEED_DB_URL to reseed)
if [ "$FORCE_RESEED" = "true" ] && [ -f /app/data/jobs.db ]; then
    echo "FORCE_RESEED: removing existing database..."
    rm -f /app/data/jobs.db /app/data/jobs.db-shm /app/data/jobs.db-wal
fi

# Download database if it doesn't exist and SEED_DB_URL is set
if [ ! -f /app/data/jobs.db ] && [ -n "$SEED_DB_URL" ]; then
    echo "Downloading database from SEED_DB_URL..."
    curl -L -o /app/data/jobs.db "$SEED_DB_URL"
fi

# Start the Next.js server
cd /app/web
exec npm run start
