/**
 * Migration script: Google Sheets → SQLite
 *
 * Run with: npx tsx scripts/migrate-from-sheets.ts
 *
 * This will:
 * 1. Read all jobs from Google Sheets
 * 2. Insert them into SQLite database
 * 3. Verify the migration
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { google } from 'googleapis';
import Database from 'better-sqlite3';

// Load env from both .env.local and parent .env (quiet mode)
dotenv.config({ path: path.join(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.join(process.cwd(), '..', '.env'), quiet: true });

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: SCOPES,
  });
}

interface Job {
  id: string;
  dateFound: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  coverLetter: string;
  status: string;
  notes?: string;
  appliedDate?: string;
}

async function getJobsFromSheets(): Promise<Job[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: 'Sheet1!A:L',
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return [];

  const COL = {
    ID: 0,
    DATE: 1,
    SOURCE: 2,
    COMPANY: 3,
    TITLE: 4,
    LOCATION: 5,
    URL: 6,
    DESCRIPTION: 7,
    COVER_LETTER: 8,
    STATUS: 9,
    NOTES: 10,
    APPLIED_DATE: 11,
  };

  const jobs: Job[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[COL.ID] || !row[COL.URL]) continue; // Skip empty rows

    jobs.push({
      id: row[COL.ID] || '',
      dateFound: row[COL.DATE] || new Date().toISOString(),
      source: row[COL.SOURCE] || 'unknown',
      company: row[COL.COMPANY] || '',
      title: row[COL.TITLE] || '',
      location: row[COL.LOCATION] || '',
      url: row[COL.URL] || '',
      description: row[COL.DESCRIPTION] || '',
      coverLetter: row[COL.COVER_LETTER] || '',
      status: row[COL.STATUS] || 'NEW',
      notes: row[COL.NOTES] || undefined,
      appliedDate: row[COL.APPLIED_DATE] || undefined,
    });
  }

  return jobs;
}

async function main() {
  console.log('🚀 Starting migration from Google Sheets to SQLite...\n');

  // Initialize database
  const dbPath = path.join(process.cwd(), '..', 'jobs.db');
  console.log(`📁 Database path: ${dbPath}`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      date_found TEXT NOT NULL,
      source TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      description TEXT,
      cover_letter TEXT,
      status TEXT DEFAULT 'NEW',
      notes TEXT,
      applied_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_date_found ON jobs(date_found);
  `);

  // Fetch from Sheets
  console.log('\n📊 Fetching jobs from Google Sheets...');
  const jobs = await getJobsFromSheets();
  console.log(`   Found ${jobs.length} jobs in Sheets`);

  // Check existing
  const existingCount = (db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number }).count;
  console.log(`   Existing jobs in SQLite: ${existingCount}`);

  // Insert jobs
  console.log('\n💾 Inserting jobs into SQLite...');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO jobs (id, date_found, source, company, title, location, url, description, cover_letter, status, notes, applied_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((jobs: Job[]) => {
    let inserted = 0;
    for (const job of jobs) {
      try {
        insert.run(
          job.id,
          job.dateFound,
          job.source,
          job.company,
          job.title,
          job.location,
          job.url,
          job.description,
          job.coverLetter || null,
          job.status || 'NEW',
          job.notes || null,
          job.appliedDate || null
        );
        inserted++;
      } catch (err) {
        console.error(`   ❌ Failed to insert job: ${job.title} at ${job.company}`);
        console.error(`      Error: ${err}`);
      }
    }
    return inserted;
  });

  const inserted = insertMany(jobs);
  console.log(`   ✅ Inserted/updated ${inserted} jobs`);

  // Verify
  const finalCount = (db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number }).count;
  console.log(`\n📈 Final job count in SQLite: ${finalCount}`);

  // Status breakdown
  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM jobs
    GROUP BY status
    ORDER BY count DESC
  `).all() as { status: string; count: number }[];

  console.log('\n📋 Status breakdown:');
  for (const { status, count } of statusCounts) {
    console.log(`   ${status}: ${count}`);
  }

  db.close();
  console.log('\n✨ Migration complete!');
}

main().catch(console.error);
