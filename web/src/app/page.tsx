import { redirect } from 'next/navigation';

/**
 * The candidates queue is the landing page.
 *
 * This was an application tracker, which is the right page for a full funnel
 * and the wrong one for this funnel: 1,425 pending against 1 applied, so it
 * opened on a nearly empty table while the actual work - triage and review -
 * sat a click away. The tracker still exists at /tracker.
 */
export default function Home() {
  redirect('/candidates');
}
