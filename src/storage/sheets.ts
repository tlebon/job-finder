import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import type { Job, RawJob } from '../types.js';
import { env } from '../config.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: SCOPES,
  });
}

const sheets = google.sheets({ version: 'v4', auth: getAuth() });

// Column order in the sheet
const COLUMNS = [
  'id',
  'date_found',
  'source',
  'company',
  'title',
  'location',
  'url',
  'description',
  'cover_letter',
  'status',
  'notes',
  'applied_date',
];

export async function getExistingJobUrls(): Promise<Set<string>> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_ID,
      range: 'Sheet1!G:G', // URL column
    });

    const urls = new Set<string>();
    const rows = response.data.values || [];

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]) {
        urls.add(rows[i][0]);
      }
    }

    console.log(`Found ${urls.size} existing jobs in sheet`);
    return urls;
  } catch (error) {
    console.error('Error reading from Google Sheets:', error);
    return new Set();
  }
}

export async function appendJobs(jobs: Job[]): Promise<number> {
  if (jobs.length === 0) {
    console.log('No jobs to append');
    return 0;
  }

  try {
    const rows = jobs.map(job => [
      job.id,
      job.dateFound,
      job.source,
      job.company,
      job.title,
      job.location,
      job.url,
      job.description.substring(0, 50000), // Limit description size
      job.coverLetter || '',
      job.status,
      job.notes || '',
      job.appliedDate || '',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEETS_ID,
      range: 'Sheet1!A:L',
      valueInputOption: 'RAW',
      requestBody: {
        values: rows,
      },
    });

    console.log(`Appended ${jobs.length} jobs to Google Sheets`);
    return jobs.length;
  } catch (error) {
    console.error('Error appending to Google Sheets:', error);
    throw error;
  }
}

export async function ensureSheetHeaders(): Promise<void> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_ID,
      range: 'Sheet1!A1:L1',
    });

    const existingHeaders = response.data.values?.[0];

    if (!existingHeaders || existingHeaders.length === 0) {
      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: env.GOOGLE_SHEETS_ID,
        range: 'Sheet1!A1:L1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [COLUMNS],
        },
      });
      console.log('Added headers to sheet');
    }
  } catch (error) {
    console.error('Error checking/adding headers:', error);
  }
}

export function rawJobToJob(rawJob: RawJob, coverLetter?: string): Job {
  return {
    id: uuidv4(),
    dateFound: new Date().toISOString(),
    source: rawJob.source,
    company: rawJob.company,
    title: rawJob.title,
    location: rawJob.location,
    url: rawJob.url,
    description: rawJob.description,
    coverLetter,
    status: 'NEW',
    score: (rawJob as RawJob & { score?: number }).score,
  };
}
