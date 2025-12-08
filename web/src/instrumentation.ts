export async function register() {
  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import to ensure it only loads on Node.js
    const { initCronScheduler } = await import('./lib/cronScheduler');
    initCronScheduler();
  }
}
