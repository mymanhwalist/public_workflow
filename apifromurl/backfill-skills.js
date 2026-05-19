/**
 * backfill-skills.js — Add skills to existing Main DB jobs that have none
 *
 * Run once:  node backfill-skills.js
 */

import { createClient } from '@supabase/supabase-js';

const MAIN_URL = 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';
const main = createClient(MAIN_URL, MAIN_KEY);

function extractSkills(text, skillsMap) {
  if (!text || skillsMap.size === 0) return [];
  const t = text.toLowerCase().replace(/<[^>]+>/g, ' ');
  const found = [];
  for (const [, skill] of skillsMap) {
    const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z0-9])' + escaped.toLowerCase() + '(?![a-z0-9])', 'i');
    if (re.test(t)) found.push(skill.id);
    if (found.length >= 30) break;
  }
  return found;
}

async function run() {
  console.log('Backfilling skills for existing Main DB jobs...\n');

  // Load skills dictionary
  const skillsMap = new Map();
  let sOffset = 0;
  while (true) {
    const { data } = await main.from('skills').select('id, name, slug').range(sOffset, sOffset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) skillsMap.set(s.slug, s);
    if (data.length < 1000) break;
    sOffset += 1000;
  }
  console.log(`Skills loaded: ${skillsMap.size}`);

  // Get jobs that currently have no skills
  const { data: jobsWithSkills } = await main.from('job_skills').select('job_id');
  const withSkillsSet = new Set((jobsWithSkills || []).map(j => j.job_id));

  // Fetch all jobs with descriptions
  let processed = 0, updated = 0, noMatch = 0;
  let jOffset = 0;
  while (true) {
    const { data: jobs } = await main.from('jobs')
      .select('id, description')
      .not('description', 'is', null)
      .range(jOffset, jOffset + 99);

    if (!jobs || jobs.length === 0) break;

    for (const job of jobs) {
      if (withSkillsSet.has(job.id)) { processed++; continue; } // already has skills
      const skillIds = extractSkills(job.description, skillsMap);
      if (skillIds.length > 0) {
        const rows = skillIds.map(skill_id => ({ job_id: job.id, skill_id }));
        await main.from('job_skills').upsert(rows, { ignoreDuplicates: true });
        updated++;
      } else {
        noMatch++;
      }
      processed++;
    }

    if (jobs.length < 100) break;
    jOffset += 100;
    if (jOffset % 200 === 0) console.log(`  processed ${processed}...`);
  }

  const { count: totalSkillLinks } = await main.from('job_skills').select('*', { count: 'exact', head: true });
  console.log(`\nDone.`);
  console.log(`Jobs processed: ${processed}`);
  console.log(`Jobs with skills added: ${updated}`);
  console.log(`Jobs with no skill match: ${noMatch}`);
  console.log(`Total job_skills rows: ${totalSkillLinks}`);
}

run().catch(console.error);
