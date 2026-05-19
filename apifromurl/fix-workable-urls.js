/**
 * One-time fix: update Workable API endpoints in DB
 * Old format: /api/v1/widget/{slug}
 * New format: /api/v1/widget/jobs?company={slug}
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // Get all Workable endpoints
  const { data, error } = await supabase
    .from('career_pages')
    .select('id, api_endpoint')
    .eq('ats_provider', 'Workable')
    .not('api_endpoint', 'is', null);

  if (error) { console.error(error.message); return; }

  console.log(`Found ${data.length} Workable endpoints to fix`);

  let fixed = 0;
  for (const row of data) {
    // Match old format: /api/v1/widget/{slug}  (no ?company=)
    const match = row.api_endpoint.match(/\/api\/v1\/widget\/([^/?]+)$/);
    if (!match) {
      console.log(`  SKIP (already correct or unknown format): ${row.api_endpoint}`);
      continue;
    }
    const slug = match[1];
    const newUrl = `https://apply.workable.com/api/v1/widget/jobs?company=${slug}`;

    const { error: updateErr } = await supabase
      .from('career_pages')
      .update({ api_endpoint: newUrl })
      .eq('id', row.id);

    if (updateErr) {
      console.log(`  ERROR id=${row.id}: ${updateErr.message}`);
    } else {
      console.log(`  FIXED: ${row.api_endpoint} → ${newUrl}`);
      fixed++;
    }
  }

  console.log(`\nDone. Fixed ${fixed}/${data.length} Workable URLs.`);
}

main().catch(console.error);
