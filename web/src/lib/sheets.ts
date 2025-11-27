import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: SCOPES,
  });
}

const sheets = google.sheets({ version: 'v4', auth: getAuth() });

// Column order in the sheet
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

export interface Job {
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
  rowIndex?: number;
}

export async function getJobs(): Promise<Job[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: 'Sheet1!A:L',
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return [];

  const jobs: Job[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    jobs.push({
      id: row[COL.ID] || '',
      dateFound: row[COL.DATE] || '',
      source: row[COL.SOURCE] || '',
      company: row[COL.COMPANY] || '',
      title: row[COL.TITLE] || '',
      location: row[COL.LOCATION] || '',
      url: row[COL.URL] || '',
      description: row[COL.DESCRIPTION] || '',
      coverLetter: row[COL.COVER_LETTER] || '',
      status: row[COL.STATUS] || 'NEW',
      notes: row[COL.NOTES] || '',
      appliedDate: row[COL.APPLIED_DATE] || '',
      rowIndex: i + 1, // 1-indexed for sheets
    });
  }

  return jobs;
}

export async function getJobById(id: string): Promise<Job | null> {
  const jobs = await getJobs();
  return jobs.find(job => job.id === id) || null;
}

export async function updateJobCoverLetter(id: string, coverLetter: string): Promise<boolean> {
  const jobs = await getJobs();
  const job = jobs.find(j => j.id === id);

  if (!job || !job.rowIndex) return false;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `Sheet1!I${job.rowIndex}`, // Column I is cover_letter
    valueInputOption: 'RAW',
    requestBody: {
      values: [[coverLetter]],
    },
  });

  return true;
}

export async function updateJobStatus(id: string, status: string): Promise<boolean> {
  const jobs = await getJobs();
  const job = jobs.find(j => j.id === id);

  if (!job || !job.rowIndex) return false;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `Sheet1!J${job.rowIndex}`, // Column J is status
    valueInputOption: 'RAW',
    requestBody: {
      values: [[status]],
    },
  });

  return true;
}

export async function deleteJob(id: string): Promise<boolean> {
  const jobs = await getJobs();
  const job = jobs.find(j => j.id === id);

  if (!job || !job.rowIndex) return false;

  // Get the sheet ID first
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
  });

  const sheetId = spreadsheet.data.sheets?.[0]?.properties?.sheetId || 0;

  // Delete the row using batchUpdate
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: job.rowIndex - 1, // 0-indexed
              endIndex: job.rowIndex,
            },
          },
        },
      ],
    },
  });

  return true;
}
