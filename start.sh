#!/bin/sh
set -e

echo "=== Starting job-finder ==="
echo "Checking /app/data directory..."

# Create data directory if it doesn't exist
mkdir -p /app/data

echo "Contents of /app/data:"
ls -la /app/data || echo "Directory empty or error listing"

# Force reseed if requested
if [ "$FORCE_RESEED" = "true" ] && [ -f /app/data/jobs.db ]; then
    echo "FORCE_RESEED is set, removing existing database..."
    rm -f /app/data/jobs.db /app/data/jobs.db-shm /app/data/jobs.db-wal
fi

# Download database if it doesn't exist and SEED_DB_URL is set
if [ ! -f /app/data/jobs.db ]; then
    echo "Database not found at /app/data/jobs.db"
    if [ -n "$SEED_DB_URL" ]; then
        echo "SEED_DB_URL is set, downloading database..."
        curl -L -v -o /app/data/jobs.db "$SEED_DB_URL"
        echo "Download complete. Verifying..."
        ls -la /app/data/jobs.db
    else
        echo "SEED_DB_URL not set, starting with empty database"
    fi
else
    echo "Database already exists:"
    ls -la /app/data/jobs.db
fi

# Start the Next.js server
echo "Starting Next.js server..."
cd /app/web
exec npm run start
