/**
 * cleanup.js — Remove stale jobs from Main DB
 *
 * Deletes jobs that are:
 *   - Older than 7 days (by posted_date)
 *   - Not remote AND not US-based
 *
 * Run after every refiner.js run to keep Main DB fresh.
 *
 * Usage:
 *   node cleanup.js            → delete qualifying jobs
 *   node cleanup.js --dry-run  → print counts only, no deletes
 */

import { createClient } from '@supabase/supabase-js';

const MAIN_URL = process.env.MAIN_DB_URL || 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = process.env.MAIN_DB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH   = 500;

const main = createClient(MAIN_URL, MAIN_KEY);

async function run() {
  console.log('══════════════════════════════════════════');
  console.log('CLEANUP — Main DB stale job removal');
  if (DRY_RUN) console.log('DRY RUN — no deletes');
  console.log('══════════════════════════════════════════\n');

  const CUTOFF_DAYS = 7;
  const CUTOFF = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`Cutoff: posted_date older than ${CUTOFF_DAYS} days (${CUTOFF})\n`);

  // Fetch all jobs with their location info
  let allJobs = [];
  let offset  = 0;
  while (true) {
    const { data, error } = await main
      .from('jobs')
      .select('id, job_type, posted_date, locations(country, is_remote)')
      .range(offset, offset + BATCH - 1);
    if (error) { console.error('Failed to fetch jobs:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allJobs = allJobs.concat(data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }

  console.log(`Total jobs in Main DB: ${allJobs.length}`);

  const toDelete = [];
  let staleCount = 0;
  let nonUSCount = 0;

  for (const job of allJobs) {
    // Remove if posted_date is older than 30 days (or missing)
    const isStale = !job.posted_date || job.posted_date < CUTOFF;

    if (isStale) {
      staleCount++;
      toDelete.push(job.id);
    }
  }

  console.log(`  Stale (>${CUTOFF_DAYS}d old): ${staleCount}`);
  console.log(`  To delete:          ${toDelete.length}`);
  console.log(`  To keep:             ${allJobs.length - toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  if (DRY_RUN) {
    console.log('DRY RUN — skipping deletes.');
    return;
  }

  // Delete in chunks to avoid hitting Supabase query size limits
  const CHUNK = 200;
  let deletedSkills = 0;
  let deletedJobs   = 0;

  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const chunk = toDelete.slice(i, i + CHUNK);

    const { count: sc } = await main
      .from('job_skills')
      .delete({ count: 'exact' })
      .in('job_id', chunk);
    deletedSkills += sc || 0;

    const { count: jc } = await main
      .from('jobs')
      .delete({ count: 'exact' })
      .in('id', chunk);
    deletedJobs += jc || 0;
  }

  console.log(`Deleted ${deletedJobs} jobs and ${deletedSkills} job_skills rows.`);

  const { count: remaining } = await main
    .from('jobs')
    .select('*', { count: 'exact', head: true });
  console.log(`\nMain DB jobs remaining: ${remaining}`);
}

run().catch(console.error);
