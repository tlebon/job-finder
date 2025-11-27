import { db } from './storage/db.js';

interface JobRow {
  id: string;
  title: string;
  company: string;
  source: string;
  score: number | null;
  date_found: string;
}

// Normalize title for duplicate detection
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(m\/w\/[dx*]\)/gi, '')
    .replace(/\(all genders?\)/gi, '')
    .replace(/\(remote\)/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function main() {
  console.log('Finding duplicate jobs...\n');

  // Get all jobs
  const jobs = db.prepare('SELECT id, title, company, source, score, date_found FROM jobs ORDER BY score DESC, date_found DESC').all() as JobRow[];

  // Group by signature (company + normalized title)
  const groups = new Map<string, JobRow[]>();

  for (const job of jobs) {
    const signature = `${job.company.toLowerCase()}|${normalizeTitle(job.title)}`;
    if (!groups.has(signature)) {
      groups.set(signature, []);
    }
    groups.get(signature)!.push(job);
  }

  // Find groups with more than one job (duplicates)
  const duplicateGroups = Array.from(groups.entries()).filter(([_, jobs]) => jobs.length > 1);

  if (duplicateGroups.length === 0) {
    console.log('No duplicates found!');
    return;
  }

  console.log(`Found ${duplicateGroups.length} duplicate groups:\n`);

  const toDelete: string[] = [];

  for (const [signature, dupes] of duplicateGroups) {
    // Keep the first one (highest score due to ORDER BY), delete the rest
    const [keep, ...remove] = dupes;

    console.log(`"${keep.title}" @ ${keep.company}:`);
    console.log(`  KEEP: [${keep.score || 0}pts] from ${keep.source}`);
    for (const dupe of remove) {
      console.log(`  DELETE: [${dupe.score || 0}pts] from ${dupe.source}`);
      toDelete.push(dupe.id);
    }
    console.log('');
  }

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  // Ask for confirmation via command line arg
  if (process.argv.includes('--confirm')) {
    console.log(`Deleting ${toDelete.length} duplicate jobs...`);

    const deleteStmt = db.prepare('DELETE FROM jobs WHERE id = ?');
    const deleteMany = db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });

    deleteMany(toDelete);
    console.log('Done!');
  } else {
    console.log(`Would delete ${toDelete.length} duplicate jobs.`);
    console.log('Run with --confirm to actually delete them.');
  }
}

main().catch(console.error);
