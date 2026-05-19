/**
 * seed-skills.js — Copy skills from DB1 into Main DB
 *
 * Run once:  node seed-skills.js
 */

import { createClient } from '@supabase/supabase-js';

const DB1_URL  = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const DB1_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';
const MAIN_URL = 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';

const db1  = createClient(DB1_URL,  DB1_KEY);
const main = createClient(MAIN_URL, MAIN_KEY);

function makeSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80)
    .replace(/^-|-$/g, '');
}

async function run() {
  console.log('Seeding skills from DB1 → Main DB...\n');

  // Fetch all skills from DB1 in batches
  let allSkills = [];
  let offset = 0;
  const BATCH = 1000;
  while (true) {
    const { data, error } = await db1.from('skills')
      .select('name, category')
      .range(offset, offset + BATCH - 1);
    if (error) { console.error('DB1 fetch error:', error.message); break; }
    if (!data || data.length === 0) break;
    allSkills = allSkills.concat(data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }

  console.log(`Fetched ${allSkills.length} skills from DB1`);

  // Deduplicate by slug
  const seen = new Set();
  const toInsert = [];
  for (const s of allSkills) {
    if (!s.name || !s.name.trim()) continue;
    const slug = makeSlug(s.name.trim());
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    toInsert.push({
      name:     s.name.trim(),
      slug,
      category: s.category || null,
    });
  }

  console.log(`Unique skills to insert: ${toInsert.length}`);

  // Insert in batches of 500
  let inserted = 0;
  let skipped  = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error } = await main.from('skills').upsert(chunk, { onConflict: 'slug', ignoreDuplicates: true });
    if (error) console.error(`Batch ${i} error:`, error.message);
    else inserted += chunk.length;
    if (i % 2000 === 0 && i > 0) console.log(`  inserted ${inserted}...`);
  }

  const { count } = await main.from('skills').select('*', { count: 'exact', head: true });
  console.log(`\nDone. Main DB skills total: ${count}`);
}

run().catch(console.error);
