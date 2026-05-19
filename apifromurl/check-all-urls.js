/**
 * Check ALL application URLs and find API endpoints
 * Tests every URL in the jobs table
 */

import { createClient } from '@supabase/supabase-js';
import { detectATS, buildAPIEndpoint } from './ats-detector.js';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BATCH_SIZE = 100;
const TEST_API = process.argv.includes('--test-api');
const UPDATE_DB = process.argv.includes('--update');
const FORCE = process.argv.includes('--force');

// Cache resolved Workable slugs to avoid duplicate redirects + API calls
const workableSlugCache = new Map();

async function main() {
  console.log('===========================================');
  console.log('CHECK ALL APPLICATION URLs');
  console.log('===========================================');
  console.log(`Mode: ${UPDATE_DB ? 'UPDATE DATABASE' : 'REPORT ONLY'}`);
  console.log(`Test APIs: ${TEST_API ? 'YES' : 'NO'}`);
  console.log(`Force: ${FORCE ? 'YES (skip logic disabled)' : 'NO'}`);
  console.log('');

  // Pre-fetch company_ids that already have an api_endpoint in career_pages
  const alreadyHasEndpoint = new Set();
  if (!FORCE) {
    const { data: existing } = await supabase
      .from('career_pages')
      .select('company_id')
      .not('api_endpoint', 'is', null);

    if (existing) {
      for (const row of existing) {
        if (row.company_id) alreadyHasEndpoint.add(row.company_id);
      }
    }
    console.log(`Skipping ${alreadyHasEndpoint.size} companies with existing endpoints`);
    console.log('');
  }

  const stats = {
    total: 0,
    skipped: 0,
    withPublicAPI: 0,
    withoutPublicAPI: 0,
    apiWorking: 0,
    apiFailed: 0,
    byATS: {},
    workingAPIs: [],
    failedAPIs: []
  };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, application_url, company_id, title')
      .not('application_url', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error:', error.message);
      break;
    }

    if (!jobs || jobs.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Processing ${offset + 1} to ${offset + jobs.length}...`);

    for (const job of jobs) {
      if (!FORCE && job.company_id && alreadyHasEndpoint.has(job.company_id)) {
        stats.skipped++;
        continue;
      }
      stats.total++;
      const result = await processURL(job, stats);
    }

    offset += BATCH_SIZE;
  }

  // Print summary
  printSummary(stats);
}

async function resolveWorkableSlug(url) {
  if (workableSlugCache.has(url)) return workableSlugCache.get(url);
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)' },
      signal: AbortSignal.timeout(5000)
    });
    const location = r.headers.get('location');
    const match = location?.match(/^\/([a-zA-Z0-9_-]+)\/j\//);
    const slug = match ? match[1] : null;
    workableSlugCache.set(url, slug);
    return slug;
  } catch {
    workableSlugCache.set(url, null);
    return null;
  }
}

async function processURL(job, stats) {
  const { id, application_url, company_id, title } = job;

  if (!application_url) return;

  // Resolve Workable /j/ short links to their company career page URL
  let resolvedUrl = application_url;
  if (/apply\.workable\.com\/j\//i.test(application_url)) {
    const slug = await resolveWorkableSlug(application_url);
    if (slug) resolvedUrl = `https://apply.workable.com/${slug}`;
  }

  const atsInfo = detectATS(resolvedUrl);
  const provider = atsInfo.provider;

  // Track by ATS
  if (!stats.byATS[provider]) {
    stats.byATS[provider] = {
      total: 0,
      hasAPI: 0,
      apiWorking: 0,
      apiFailed: 0,
      urls: []
    };
  }
  stats.byATS[provider].total++;

  const apiEndpoint = buildAPIEndpoint(resolvedUrl, atsInfo);

  if (apiEndpoint) {
    stats.withPublicAPI++;
    stats.byATS[provider].hasAPI++;

    // Test if API actually works
    if (TEST_API) {
      const works = await testAPI(apiEndpoint.list, provider, apiEndpoint.method, apiEndpoint.body);
      if (works.success) {
        stats.apiWorking++;
        stats.byATS[provider].apiWorking++;
        stats.workingAPIs.push({
          provider,
          api: apiEndpoint.list,
          jobs: works.jobCount,
          company_id
        });
        process.stdout.write(`  ✅ ${provider}: ${apiEndpoint.list.substring(0, 50)}... (${works.jobCount} jobs)\n`);

        // Update database if requested
        if (UPDATE_DB && company_id) {
          await updateCareerPage(company_id, apiEndpoint, atsInfo, application_url);
        }
      } else {
        stats.apiFailed++;
        stats.byATS[provider].apiFailed++;
        stats.failedAPIs.push({
          provider,
          api: apiEndpoint.list,
          error: works.error
        });
        process.stdout.write(`  ❌ ${provider}: ${apiEndpoint.list.substring(0, 50)}... (${works.error})\n`);

        // Save error to DB so we can diagnose later
        if (UPDATE_DB && company_id) {
          await saveAPIError(company_id, works.error);
        }
      }
    } else {
      stats.byATS[provider].urls.push(apiEndpoint.list);
    }
  } else {
    stats.withoutPublicAPI++;
  }
}

async function testAPI(url, provider, method = 'GET', body = null) {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)'
      },
      body,
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      if (provider === 'Jobvite') {
        const html = await response.text();
        const jobCount = (html.match(/\/job\/[A-Za-z0-9]+/g) || []).length;
        return { success: true, jobCount };
      }
      const data = await response.json();
      const jobCount = countJobs(data);
      return { success: true, jobCount };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (err) {
    const error = err.name === 'TimeoutError' ? 'Timeout' : err.message.substring(0, 20);
    return { success: false, error };
  }
}

async function updateCareerPage(companyId, apiEndpoint, atsInfo, applicationUrl) {
  try {
    const { data: existing } = await supabase
      .from('career_pages')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from('career_pages')
        .update({
          api_endpoint: apiEndpoint.list,
          api_endpoint_detail: apiEndpoint.detail,
          ats_provider: atsInfo.provider,
          last_error: null,
          last_error_at: null,
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('career_pages')
        .insert({
          company_id: companyId,
          career_url: atsInfo.careerPageUrl || applicationUrl,
          api_endpoint: apiEndpoint.list,
          api_endpoint_detail: apiEndpoint.detail,
          ats_provider: atsInfo.provider,
          application_url: applicationUrl,
          scraped_from: 'api-finder',
          scraped_at: new Date().toISOString(),
          last_error: null,
          last_error_at: null,
        });
    }
  } catch (err) {
    // Ignore errors
  }
}

async function saveAPIError(companyId, errorMsg) {
  try {
    const { data: existing } = await supabase
      .from('career_pages')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from('career_pages')
        .update({
          last_error: errorMsg,
          last_error_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }
  } catch {
    // Ignore errors
  }
}

function countJobs(data) {
  try {
    if (Array.isArray(data)) return data.length;
    if (data.jobs && Array.isArray(data.jobs)) return data.jobs.length;
    if (data.content && Array.isArray(data.content)) return data.content.length;
    if (data.totalFound) return data.totalFound;
    if (data.total !== undefined) return data.total;
    if (data.results && Array.isArray(data.results)) return data.results.length;
    return 0;
  } catch {
    return 0;
  }
}

function printSummary(stats) {
  console.log('\n===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Total URLs checked: ${stats.total}`);
  if (stats.skipped > 0) console.log(`Skipped (existing endpoint): ${stats.skipped}`);
  console.log(`With public API: ${stats.withPublicAPI}`);
  console.log(`Without public API: ${stats.withoutPublicAPI}`);

  if (TEST_API) {
    console.log(`API working: ${stats.apiWorking} ✅`);
    console.log(`API failed: ${stats.apiFailed} ❌`);

    const totalJobs = stats.workingAPIs.reduce((sum, a) => sum + a.jobs, 0);
    console.log(`Total jobs available: ${totalJobs}`);
  }

  console.log('\n--- By ATS Provider ---');
  const sorted = Object.entries(stats.byATS).sort((a, b) => b[1].total - a[1].total);

  for (const [ats, data] of sorted) {
    let line = `${ats}: ${data.total} URLs`;
    if (data.hasAPI > 0) {
      line += ` (${data.hasAPI} with API)`;
    }
    if (TEST_API && data.apiWorking > 0) {
      line += ` [${data.apiWorking} working]`;
    }
    console.log(line);
  }

  if (!TEST_API) {
    console.log('\n--- Potential API Endpoints (not tested) ---');
    for (const [ats, data] of sorted) {
      if (data.urls && data.urls.length > 0) {
        console.log(`\n${ats} (${data.urls.length} endpoints):`);
        // Show unique URLs only
        const unique = [...new Set(data.urls)];
        unique.slice(0, 5).forEach(url => {
          console.log(`  ${url}`);
        });
        if (unique.length > 5) {
          console.log(`  ... and ${unique.length - 5} more`);
        }
      }
    }
  }

  if (TEST_API && stats.workingAPIs.length > 0) {
    console.log('\n--- Working APIs ---');
    // Group by unique API endpoint
    const uniqueAPIs = {};
    for (const api of stats.workingAPIs) {
      if (!uniqueAPIs[api.api]) {
        uniqueAPIs[api.api] = { ...api, count: 1 };
      } else {
        uniqueAPIs[api.api].count++;
      }
    }

    for (const api of Object.values(uniqueAPIs)) {
      console.log(`✅ ${api.provider}: ${api.api} (${api.jobs} jobs)`);
    }
  }
}

main().catch(console.error);
