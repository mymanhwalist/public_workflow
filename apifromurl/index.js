/**
 * API Endpoint Finder
 * Reads application URLs from Supabase and finds their API endpoints
 */

import { createClient } from '@supabase/supabase-js';
import { detectATS, buildAPIEndpoint } from './ats-detector.js';

// ===========================================
// CONFIGURATION
// ===========================================
const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

// ===========================================
// MAIN
// ===========================================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('===========================================');
  console.log('API ENDPOINT FINDER');
  console.log('===========================================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no updates)' : 'LIVE (will update database)'}`);
  console.log('');

  // Get jobs that have application_url but no api_endpoint in career_pages
  const stats = {
    total: 0,
    processed: 0,
    apiFound: 0,
    noApiAvailable: 0,
    errors: 0,
    byATS: {}
  };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch jobs with application_url
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, application_url, company_id, source_url')
      .not('application_url', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching jobs:', error.message);
      break;
    }

    if (!jobs || jobs.length === 0) {
      hasMore = false;
      break;
    }

    stats.total += jobs.length;
    console.log(`Processing batch: ${offset + 1} to ${offset + jobs.length}`);

    for (const job of jobs) {
      try {
        const result = await processJob(job, stats);
        stats.processed++;
      } catch (err) {
        console.error(`Error processing job ${job.id}:`, err.message);
        stats.errors++;
      }
    }

    offset += BATCH_SIZE;

    // Small delay to avoid rate limiting
    await sleep(100);
  }

  // Print summary
  console.log('');
  console.log('===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Total jobs processed: ${stats.processed}`);
  console.log(`API endpoints found: ${stats.apiFound}`);
  console.log(`No public API available: ${stats.noApiAvailable}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('');
  console.log('By ATS Provider:');
  for (const [ats, count] of Object.entries(stats.byATS).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ats}: ${count}`);
  }
}

async function processJob(job, stats) {
  const { id, application_url, company_id, source_url } = job;

  if (!application_url) return;

  // Detect ATS and build API endpoint
  const atsInfo = detectATS(application_url);

  // Track ATS stats
  stats.byATS[atsInfo.provider] = (stats.byATS[atsInfo.provider] || 0) + 1;

  const apiEndpoint = buildAPIEndpoint(application_url, atsInfo);

  if (apiEndpoint) {
    stats.apiFound++;

    if (!DRY_RUN && company_id) {
      // Check if career_page exists for this company
      const { data: existingPage } = await supabase
        .from('career_pages')
        .select('id, api_endpoint')
        .eq('company_id', company_id)
        .limit(1)
        .single();

      if (existingPage) {
        // Update existing career page if no API endpoint yet
        if (!existingPage.api_endpoint) {
          await supabase
            .from('career_pages')
            .update({
              api_endpoint: apiEndpoint.list,
              api_endpoint_detail: apiEndpoint.detail,
              ats_provider: atsInfo.provider,
              application_url: application_url
            })
            .eq('id', existingPage.id);

          console.log(`  ✅ Updated: ${atsInfo.provider} → ${apiEndpoint.list.substring(0, 60)}...`);
        }
      } else {
        // Create new career page
        await supabase
          .from('career_pages')
          .insert({
            company_id: company_id,
            career_url: atsInfo.careerPageUrl || application_url,
            api_endpoint: apiEndpoint.list,
            api_endpoint_detail: apiEndpoint.detail,
            ats_provider: atsInfo.provider,
            application_url: application_url,
            scraped_from: 'api-finder',
            scraped_at: new Date().toISOString()
          });

        console.log(`  ✅ Created: ${atsInfo.provider} → ${apiEndpoint.list.substring(0, 60)}...`);
      }
    } else if (DRY_RUN) {
      console.log(`  [DRY] ${atsInfo.provider}: ${apiEndpoint.list.substring(0, 70)}...`);
    }
  } else {
    stats.noApiAvailable++;
    // ATS providers without public API
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(console.error);
