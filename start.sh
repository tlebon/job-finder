#!/bin/bash

# Create data directory if it doesn't exist
mkdir -p /app/data

# Download database if it doesn't exist and SEED_DB_URL is set
if [ ! -f /app/data/jobs.db ] && [ -n "$SEED_DB_URL" ]; then
    echo "Database not found, downloading from seed URL..."
    curl -L -o /app/data/jobs.db "$SEED_DB_URL"
    echo "Database downloaded successfully"
fi

# Start the Next.js server
cd /app/web
exec npm run start
