import { Telegraf } from 'telegraf';
import { env } from '../config.js';

const bot = env.TELEGRAM_BOT_TOKEN ? new Telegraf(env.TELEGRAM_BOT_TOKEN) : null;

export async function sendNotification(message: string): Promise<void> {
  if (!bot || !env.TELEGRAM_CHAT_ID) {
    console.log('Telegram: Skipping notification (no credentials)');
    return;
  }

  try {
    await bot.telegram.sendMessage(env.TELEGRAM_CHAT_ID, message, {
      parse_mode: 'HTML',
    });
    console.log('Telegram notification sent');
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}

export async function notifyNewJobs(
  count: number,
  sheetUrl: string,
  topJobs: { title: string; company: string }[]
): Promise<void> {
  const jobList = topJobs
    .slice(0, 5)
    .map(j => `• ${j.title} @ ${j.company}`)
    .join('\n');

  const message = `
<b>🔍 ${count} New Job${count !== 1 ? 's' : ''} Found!</b>

<b>Top matches:</b>
${jobList}

<a href="${sheetUrl}">📋 View in Google Sheets</a>
  `.trim();

  await sendNotification(message);
}

export async function notifyError(error: string): Promise<void> {
  const message = `
<b>⚠️ Job Finder Error</b>

${error}
  `.trim();

  await sendNotification(message);
}
