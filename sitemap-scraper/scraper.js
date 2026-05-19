/**
 * Sitemap Job Scraper
 * Fetches career_pages with api_endpoint_detail='sitemap', parses sitemaps,
 * visits job pages, extracts details, and saves to Supabase via RPC.
 *
 * Usage:
 *   node scraper.js                          # full run
 *   node scraper.js --dry-run --verbose      # test without DB writes
 *   node scraper.js --limit=5 --verbose      # first 5 companies
 *   node scraper.js --concurrency=3          # 3 companies in parallel
 *   node scraper.js --max-jobs=2             # only fetch 2 job pages per company
 */

import { createClient } from '@supabase/supabase-js';
import { extractJobDetails } from './extractor.js';

// ── Config ──────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const FORCE = args.includes('--force');
const LIMIT = parseInt(getArg('limit') || '0');
const CONCURRENCY = parseInt(getArg('concurrency') || '1');
const MAX_JOBS = parseInt(getArg('max-jobs') || '0');
const SCRAPE_INTERVAL_HOURS = 24;
const SCRAPE_THRESHOLD = new Date(Date.now() - SCRAPE_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();

const JOB_PAGE_CONCURRENCY = 5;
const DELAY_BETWEEN_JOBS_MS = 200;
const DELAY_BETWEEN_COMPANIES_MS = 500;
const HTTP_TIMEOUT_MS = 15000;

const USER_AGENT = 'Mozilla/5.0 (compatible; JobBot/1.0)';

// ── URL Filtering ───────────────────────────────────────────────────

const JOB_PATTERNS = [
  /\/job\//i, /\/jobs\//i, /\/career/i, /\/position/i,
  /\/opening/i, /\/vacancy/i, /\/requisition/i, /\/posting\//i,
];

const EXCLUDE_PATTERNS = [
  /\/login/i, /\/password/i, /\/account/i, /\/faq/i,
  /\/about\b/i, /\/apply-process/i, /\/search/i, /\/category\//i,
];

function isJobUrl(url) {
  return JOB_PATTERNS.some(p => p.test(url));
}

function isExcludedUrl(url) {
  return EXCLUDE_PATTERNS.some(p => p.test(url));
}

// ── Sitemap Parsing ─────────────────────────────────────────────────

async function fetchXml(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/xml, text/xml, */*',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * Fetch a sitemap URL. Handles both <sitemapindex> (recursive) and <urlset>.
 * Returns array of { url, lastmod }.
 */
async function fetchSitemap(sitemapUrl, depth = 0) {
  if (depth > 3) return []; // prevent infinite recursion

  const xml = await fetchXml(sitemapUrl);

  // Check if this is a sitemap index
  if (xml.includes('<sitemapindex')) {
    const subSitemapUrls = [];
    const locMatches = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) || [];
    for (const block of locMatches) {
      const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
      if (locMatch) subSitemapUrls.push(locMatch[1].trim());
    }

    // Fallback: just grab all <loc> tags
    if (subSitemapUrls.length === 0) {
      const allLocs = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
      for (const match of allLocs) {
        subSitemapUrls.push(match.replace(/<\/?loc>/gi, '').trim());
      }
    }

    if (VERBOSE) console.log(`    Sitemap index: ${subSitemapUrls.length} sub-sitemaps`);

    // Fetch sub-sitemaps sequentially to be polite
    const allJobs = [];
    for (const subUrl of subSitemapUrls) {
      try {
        const jobs = await fetchSitemap(subUrl, depth + 1);
        allJobs.push(...jobs);
      } catch (err) {
        if (VERBOSE) console.log(`    Sub-sitemap error (${subUrl}): ${err.message}`);
      }
      await sleep(200);
    }
    return allJobs;
  }

  // Regular <urlset> — extract <url> blocks with <loc> + <lastmod>
  const entries = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
    if (locMatch) {
      const url = locMatch[1].trim();
      if (isJobUrl(url) && !isExcludedUrl(url)) {
        entries.push({
          url,
          lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
        });
      }
    }
  }

  // Fallback: simple <loc> extraction if no <url> blocks found
  if (entries.length === 0 && urlBlocks.length === 0) {
    const locMatches = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
    for (const match of locMatches) {
      const url = match.replace(/<\/?loc>/gi, '').trim();
      if (isJobUrl(url) && !isExcludedUrl(url)) {
        entries.push({ url, lastmod: null });
      }
    }
  }

  return entries;
}

// ── Job Page Fetching & Extraction ──────────────────────────────────

async function fetchAndExtractJob(jobUrl, lastmod) {
  const response = await fetch(jobUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return extractJobDetails(html, jobUrl, lastmod);
}

// ── Save to Supabase ────────────────────────────────────────────────

async function saveJob(details, companyName, companyWebsite) {
  const { data, error } = await supabase.rpc('save_hiring_cafe_job_to_existing_schema', {
    p_title: details.title,
    p_description: details.description,
    p_responsibilities: null,
    p_requirement_summary: null,
    p_job_type: null,
    p_commitment_type: details.employment_type,
    p_category: null,
    p_experience_level: null,
    p_salary_min: null,
    p_salary_max: null,
    p_salary_currency: null,
    p_salary_period: null,
    p_education_requirement: [],
    p_education_preferred: [],
    p_application_url: details.source_url,
    p_source_url: details.source_url,
    p_external_id: null,
    p_posted_date: details.posted_date,
    p_raw_data: { scraped_from: 'sitemap-scraper', extraction_method: details.extraction_method },
    p_company_name: companyName,
    p_company_website: companyWebsite,
    p_company_description: null,
    p_company_logo_url: null,
    p_company_linkedin_url: null,
    p_company_year_founded: null,
    p_company_employees: null,
    p_company_industries: [],
    p_company_activities: [],
    p_company_funding_stage: null,
    p_location_city: null,
    p_location_state: null,
    p_location_country: null,
    p_location_full: details.location,
    p_is_remote: false,
    p_skills: [],
    p_benefits: [],
    p_career_url: null,
    p_api_endpoint: null,
    p_api_endpoint_detail: null,
    p_ats_provider: null,
  });

  if (error) throw error;
  return data;
}

// ── Process a Single Company ────────────────────────────────────────

async function processCompany(source, index, total) {
  const companyName = source.company_name || 'Unknown';
  const companyWebsite = source.company_website || null;
  const sitemapUrl = source.api_endpoint;
  const label = `[${index + 1}/${total}]`;

  const companyStats = { sitemapUrls: 0, jobUrls: 0, saved: 0, dupes: 0, errors: 0 };

  console.log(`${label} ${companyName}: ${sitemapUrl}`);

  // 1. Fetch and parse sitemap
  let jobEntries;
  try {
    jobEntries = await fetchSitemap(sitemapUrl);
  } catch (err) {
    console.log(`${label} ${companyName}: Sitemap fetch failed — ${err.message}`);
    return companyStats;
  }

  companyStats.sitemapUrls = jobEntries.length;

  // Limit job pages fetched per company
  if (MAX_JOBS > 0 && jobEntries.length > MAX_JOBS) {
    jobEntries = jobEntries.slice(0, MAX_JOBS);
  }

  companyStats.jobUrls = jobEntries.length;

  if (jobEntries.length === 0) {
    console.log(`${label} ${companyName}: 0 job URLs found in sitemap`);
    return companyStats;
  }

  if (VERBOSE) {
    const limitNote = MAX_JOBS > 0 && companyStats.sitemapUrls > MAX_JOBS ? ` (fetching ${MAX_JOBS} of ${companyStats.sitemapUrls})` : '';
    console.log(`  ${companyStats.sitemapUrls} job URLs in sitemap${limitNote}`);
  }

  // 2. Process job pages in batches
  for (let i = 0; i < jobEntries.length; i += JOB_PAGE_CONCURRENCY) {
    const batch = jobEntries.slice(i, i + JOB_PAGE_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (entry, batchIdx) => {
        // Stagger requests within batch
        if (batchIdx > 0) await sleep(DELAY_BETWEEN_JOBS_MS);

        const details = await fetchAndExtractJob(entry.url, entry.lastmod);

        if (!details.title) {
          if (VERBOSE) console.log(`    Skip (no title): ${entry.url.substring(0, 80)}`);
          return { status: 'skip' };
        }

        if (DRY_RUN) {
          if (VERBOSE) {
            console.log(`    [DRY] ${details.title.substring(0, 60)} [${details.extraction_method}]`);
          }
          return { status: 'dry' };
        }

        try {
          await saveJob(details, companyName, companyWebsite);
          return { status: 'saved' };
        } catch (err) {
          // Duplicate check — RPC returns error for existing source_url
          if (err.message?.includes('duplicate') || err.message?.includes('unique') || err.code === '23505') {
            return { status: 'dupe' };
          }
          return { status: 'error', error: err.message };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        companyStats.errors++;
        if (VERBOSE) console.log(`    Error: ${result.reason?.message?.substring(0, 80)}`);
      } else {
        const val = result.value;
        if (val.status === 'saved' || val.status === 'dry') companyStats.saved++;
        else if (val.status === 'dupe') companyStats.dupes++;
        else if (val.status === 'error') {
          companyStats.errors++;
          if (VERBOSE) console.log(`    Save error: ${val.error?.substring(0, 80)}`);
        }
      }
    }
  }

  const mode = DRY_RUN ? ' (dry run)' : '';
  console.log(`${label} ${companyName}: ${companyStats.jobUrls} URLs, ${companyStats.saved} saved, ${companyStats.dupes} dupes, ${companyStats.errors} errors${mode}`);

  // Update last_jobs_scraped_at timestamp
  if (!DRY_RUN && source.id) {
    await supabase
      .from('career_pages')
      .update({ last_jobs_scraped_at: new Date().toISOString() })
      .eq('id', source.id);
  }

  return companyStats;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('===========================================');
  console.log('SITEMAP JOB SCRAPER');
  console.log('===========================================');
  console.log(`Mode:        ${DRY_RUN ? 'DRY RUN' : 'SAVE TO DATABASE'}`);
  console.log(`Force:       ${FORCE ? 'YES (skip logic disabled)' : 'NO'}`);
  console.log(`Limit:       ${LIMIT || 'all'}`);
  console.log(`Concurrency: ${CONCURRENCY} companies`);
  console.log(`Verbose:     ${VERBOSE}`);
  console.log('');

  // Fetch career_pages with sitemap endpoints + company info
  let query = supabase
    .from('career_pages')
    .select('id, company_id, api_endpoint, career_url, ats_provider, companies(name, website)')
    .eq('api_endpoint_detail', 'sitemap')
    .not('api_endpoint', 'is', null);

  if (!FORCE) {
    query = query.or(`last_jobs_scraped_at.is.null,last_jobs_scraped_at.lt.${SCRAPE_THRESHOLD}`);
  }

  const { data: sources, error } = await query;

  if (error) {
    console.error('Failed to fetch career_pages:', error.message);
    process.exit(1);
  }

  if (!FORCE) {
    console.log(`Skipping recently-scraped sources (within ${SCRAPE_INTERVAL_HOURS}h)`);
  }

  // Flatten company info
  let companies = sources.map(s => ({
    ...s,
    company_name: s.companies?.name || null,
    company_website: s.companies?.website || null,
  }));

  if (LIMIT > 0) {
    companies = companies.slice(0, LIMIT);
  }

  console.log(`Found ${sources.length} sitemap sources, processing ${companies.length}\n`);

  const totalStats = { companies: 0, jobUrls: 0, saved: 0, dupes: 0, errors: 0, sitemapErrors: 0 };

  // Process companies with concurrency
  if (CONCURRENCY <= 1) {
    // Sequential
    for (let i = 0; i < companies.length; i++) {
      const stats = await processCompany(companies[i], i, companies.length);
      totalStats.companies++;
      totalStats.jobUrls += stats.jobUrls;
      totalStats.saved += stats.saved;
      totalStats.dupes += stats.dupes;
      totalStats.errors += stats.errors;
      if (stats.jobUrls === 0 && stats.sitemapUrls === 0) totalStats.sitemapErrors++;

      if (i < companies.length - 1) await sleep(DELAY_BETWEEN_COMPANIES_MS);
    }
  } else {
    // Parallel batches
    for (let i = 0; i < companies.length; i += CONCURRENCY) {
      const batch = companies.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((company, batchIdx) =>
          processCompany(company, i + batchIdx, companies.length)
        )
      );

      for (const result of results) {
        totalStats.companies++;
        if (result.status === 'fulfilled') {
          const stats = result.value;
          totalStats.jobUrls += stats.jobUrls;
          totalStats.saved += stats.saved;
          totalStats.dupes += stats.dupes;
          totalStats.errors += stats.errors;
          if (stats.jobUrls === 0 && stats.sitemapUrls === 0) totalStats.sitemapErrors++;
        } else {
          totalStats.sitemapErrors++;
        }
      }

      if (i + CONCURRENCY < companies.length) await sleep(DELAY_BETWEEN_COMPANIES_MS);
    }
  }

  // Summary
  console.log('\n===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Companies processed: ${totalStats.companies}`);
  console.log(`Sitemap errors:      ${totalStats.sitemapErrors}`);
  console.log(`Total job URLs:      ${totalStats.jobUrls}`);
  console.log(`Jobs saved:          ${totalStats.saved}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Duplicates skipped:  ${totalStats.dupes}`);
  console.log(`Errors:              ${totalStats.errors}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
