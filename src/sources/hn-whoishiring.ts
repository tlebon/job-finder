import type { RawJob } from '../types.js';

interface HNItem {
  id: number;
  type: string;
  by: string;
  text?: string;
  kids?: number[];
  title?: string;
  time: number;
}

// HN Who is Hiring threads are posted monthly by "whoishiring" user
// Format: "Ask HN: Who is hiring? (Month Year)"
async function findLatestWhoIsHiringThread(): Promise<number | null> {
  try {
    // Get recent submissions from whoishiring user
    const userUrl = 'https://hacker-news.firebaseio.com/v0/user/whoishiring.json';
    const userResponse = await fetch(userUrl);
    const userData = await userResponse.json() as { submitted: number[] };

    // Check recent submissions for "Who is hiring" thread
    for (const itemId of userData.submitted.slice(0, 10)) {
      const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`;
      const itemResponse = await fetch(itemUrl);
      const item = await itemResponse.json() as HNItem;

      if (item.title?.includes('Who is hiring?')) {
        return itemId;
      }
    }

    return null;
  } catch (error) {
    console.error('Error finding HN Who is Hiring thread:', error);
    return null;
  }
}

function parseHNComment(text: string): { company: string; title: string; location: string; description: string } | null {
  if (!text) return null;

  // HN comments are HTML - decode entities
  const decoded = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/<p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // First line usually contains: Company | Location | Role | Remote?
  const lines = decoded.split('\n').filter(l => l.trim());
  const firstLine = lines[0] || decoded.substring(0, 200);

  // Try to parse pipe-separated format (most common)
  const parts = firstLine.split('|').map(p => p.trim());

  if (parts.length >= 2) {
    // Clean up title - truncate if too long
    let title = parts.length >= 3 ? parts[2] : parts[1];
    if (title.length > 100) {
      title = title.substring(0, 100) + '...';
    }

    return {
      company: parts[0]?.substring(0, 100) || 'Unknown',
      title: title || 'See description',
      location: parts[1]?.substring(0, 100) || 'Unknown',
      description: decoded.substring(0, 5000),
    };
  }

  // Fallback: use first few words as company
  const words = firstLine.split(' ');
  return {
    company: words.slice(0, 3).join(' ').substring(0, 100),
    title: 'See description',
    location: decoded.toLowerCase().includes('remote') ? 'Remote' : 'Unknown',
    description: decoded.substring(0, 5000),
  };
}

export async function fetchHNWhoIsHiringJobs(): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  try {
    console.log('Fetching HN Who is Hiring jobs...');

    const threadId = await findLatestWhoIsHiringThread();
    if (!threadId) {
      console.log('Could not find latest Who is Hiring thread');
      return [];
    }

    // Get the thread
    const threadUrl = `https://hacker-news.firebaseio.com/v0/item/${threadId}.json`;
    const threadResponse = await fetch(threadUrl);
    const thread = await threadResponse.json() as HNItem;

    if (!thread.kids || thread.kids.length === 0) {
      console.log('No comments in thread');
      return [];
    }

    console.log(`Found ${thread.kids.length} comments in thread`);

    // Fetch first 100 comments (top-level only)
    const commentIds = thread.kids.slice(0, 100);

    for (const commentId of commentIds) {
      try {
        const commentUrl = `https://hacker-news.firebaseio.com/v0/item/${commentId}.json`;
        const commentResponse = await fetch(commentUrl);
        const comment = await commentResponse.json() as HNItem;

        if (!comment.text) continue;

        const parsed = parseHNComment(comment.text);
        if (!parsed) continue;

        jobs.push({
          title: parsed.title,
          company: parsed.company,
          location: parsed.location,
          url: `https://news.ycombinator.com/item?id=${commentId}`,
          description: parsed.description,
          source: 'hn-whoishiring',
        });

        // Rate limit
        await new Promise(r => setTimeout(r, 50));
      } catch {
        continue;
      }
    }

    console.log(`Parsed ${jobs.length} job postings from HN`);
    return jobs;
  } catch (error) {
    console.error('Error fetching HN jobs:', error);
    return [];
  }
}
