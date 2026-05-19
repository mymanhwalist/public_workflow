/**
 * Verify API endpoints derived from remote100k_jobs application_urls
 * Reads remote100k_jobs from DB2, derives API endpoint for each company,
 * tests each one live, and prints a summary.
 */

import { createClient } from '@supabase/supabase-js';
import { detectATS } from './scrapers/remote100k/ats-detector.js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://vmdbwpqopujirdcthgta.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxMDcwMjIsImV4cCI6MjA4MjY4MzAyMn0.QwQKfGgiJEbU-3ztMSIXT5tFOska5CiBy9ZVmvea6KM';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('===========================================');
  console.log('VERIFY REMOTE100K API ENDPOINTS');
  console.log('===========================================\n');

  // Fetch all remote100k_jobs
  const { data: jobs, error } = await supabase
    .from('remote100k_jobs')
    .select('company_slug, application_url, ats_provider')
    .not('application_url', 'is', null);

  if (error) {
    console.error('Error fetching remote100k_jobs:', error.message);
    return;
  }

  console.log(`Fetched ${jobs.length} jobs from remote100k_jobs\n`);

  // Derive one API endpoint per unique company
  const companyMap = new Map(); // company_name -> best derived endpoint info

  for (const job of jobs) {
    if (companyMap.has(job.company_slug)) continue; // already processed this company

    const ats = detectATS(job.application_url);

    if (!ats.hasPublicAPI || !ats.apiEndpoint?.list) {
      companyMap.set(job.company_slug, {
        company: job.company_slug,
        application_url: job.application_url,
        provider: ats.provider,
        hasPublicAPI: false,
        api_endpoint: null,
        status: 'no_public_api'
      });
      continue;
    }

    companyMap.set(job.company_slug, {
      company: job.company_slug,
      application_url: job.application_url,
      provider: ats.provider,
      hasPublicAPI: true,
      api_endpoint: ats.apiEndpoint.list,
      api_endpoint_detail: ats.apiEndpoint.detail || null,
      method: ats.apiEndpoint.method || 'GET',
      body: ats.apiEndpoint.body || undefined,
      status: 'pending'
    });
  }

  const allCompanies = Array.from(companyMap.values());
  const withAPI = allCompanies.filter(c => c.hasPublicAPI);
  const withoutAPI = allCompanies.filter(c => !c.hasPublicAPI);

  console.log(`Unique companies: ${allCompanies.length}`);
  console.log(`With public API: ${withAPI.length}`);
  console.log(`Without public API: ${withoutAPI.length}\n`);

  // Live-test each derived API endpoint
  console.log('--- Testing API endpoints ---\n');

  const working = [];
  const failed = [];

  for (let i = 0; i < withAPI.length; i++) {
    const entry = withAPI[i];
    process.stdout.write(`[${i + 1}/${withAPI.length}] ${entry.provider} | ${entry.company}: `);

    try {
      const response = await fetch(entry.api_endpoint, {
        method: entry.method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)'
        },
        body: entry.body,
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        let jobCount = 0;
        try {
          const data = await response.json();
          if (Array.isArray(data)) {
            jobCount = data.length;
          } else if (data.jobs && Array.isArray(data.jobs)) {
            jobCount = data.jobs.length;
          } else if (data.postings && Array.isArray(data.postings)) {
            jobCount = data.postings.length;
          } else if (data.content && Array.isArray(data.content)) {
            jobCount = data.content.length;
          } else if (data.results && Array.isArray(data.results)) {
            jobCount = data.results.length;
          } else if (typeof data.total === 'number') {
            jobCount = data.total;
          }
        } catch {
          // non-JSON or parse error — still working if 200
        }
        console.log(`✅ ${jobCount} jobs — ${entry.api_endpoint}`);
        entry.status = 'working';
        entry.jobCount = jobCount;
        working.push(entry);
      } else {
        console.log(`❌ HTTP ${response.status} — ${entry.api_endpoint}`);
        entry.status = `http_${response.status}`;
        failed.push(entry);
      }
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'Timeout' : err.message.substring(0, 40);
      console.log(`❌ ${msg} — ${entry.api_endpoint}`);
      entry.status = msg;
      failed.push(entry);
    }

    await sleep(200);
  }

  // Summary
  console.log('\n===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Total unique companies:     ${allCompanies.length}`);
  console.log(`Has public API:             ${withAPI.length}`);
  console.log(`  Working endpoints:        ${working.length} ✅`);
  console.log(`  Failed endpoints:         ${failed.length} ❌`);
  console.log(`No public API (skip):       ${withoutAPI.length}`);

  if (working.length > 0) {
    const totalJobs = working.reduce((sum, e) => sum + (e.jobCount || 0), 0);
    console.log(`\nTotal jobs available now:   ${totalJobs}`);
  }

  console.log('\n--- Working endpoints (ready for DB2 migration) ---');
  for (const e of working) {
    console.log(`✅ ${e.provider.padEnd(18)} ${e.company.padEnd(25)} ${e.jobCount} jobs`);
    console.log(`   ${e.api_endpoint}`);
  }

  if (failed.length > 0) {
    console.log('\n--- Failed endpoints ---');
    for (const e of failed) {
      console.log(`❌ ${e.provider.padEnd(18)} ${e.company.padEnd(25)} (${e.status})`);
      console.log(`   ${e.api_endpoint}`);
    }
  }

  console.log('\n--- No public API (Workday / iCIMS / Custom) ---');
  for (const e of withoutAPI) {
    console.log(`⚪ ${e.provider.padEnd(18)} ${e.company}`);
  }

  // Save results to JSON
  const output = {
    generated_at: new Date().toISOString(),
    summary: {
      total_companies: allCompanies.length,
      working: working.length,
      failed: failed.length,
      no_public_api: withoutAPI.length,
      total_jobs_available: working.reduce((s, e) => s + (e.jobCount || 0), 0)
    },
    working: working.map(e => ({
      company_slug: e.company,
      ats_provider: e.provider,
      api_endpoint: e.api_endpoint,
      api_endpoint_detail: e.api_endpoint_detail || null,
      job_count: e.jobCount || 0,
      source_type: 'api',
      discovered_from: 'remote100k'
    })),
    failed: failed.map(e => ({
      company_slug: e.company,
      ats_provider: e.provider,
      api_endpoint: e.api_endpoint,
      reason: e.status
    })),
    no_public_api: withoutAPI.map(e => ({
      company_slug: e.company,
      ats_provider: e.provider,
      application_url: e.application_url
    }))
  };

  const outPath = './workflow/data/remote100k_verified_apis.json';
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved to ${outPath}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
