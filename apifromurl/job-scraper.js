/**
 * Job Scraper
 * Fetches jobs from APIs and sitemaps, saves to database
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const SOURCE = process.argv.includes('--sitemap') ? 'sitemap' : 'api';
const FORCE = process.argv.includes('--force');
const SCRAPE_INTERVAL_HOURS = 24;
const SCRAPE_THRESHOLD = new Date(Date.now() - SCRAPE_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();

// Filter by days - default 7 days, use --days=X to change, --all for no filter
const DAYS_ARG = process.argv.find(a => a.startsWith('--days='));
const MAX_DAYS = process.argv.includes('--all') ? null : (DAYS_ARG ? parseInt(DAYS_ARG.split('=')[1]) : 7);

function isRecentJob(postedDate) {
  if (!MAX_DAYS) return true; // No filter
  if (!postedDate) return true; // Include if no date (can't filter)

  const posted = new Date(postedDate);
  const now = new Date();
  const diffDays = (now - posted) / (1000 * 60 * 60 * 24);
  return diffDays <= MAX_DAYS;
}

async function main() {
  console.log('===========================================');
  console.log('JOB SCRAPER');
  console.log('===========================================');
  console.log(`Source: ${SOURCE.toUpperCase()}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'SAVE TO DATABASE'}`);
  console.log(`Date filter: ${MAX_DAYS ? `Last ${MAX_DAYS} days` : 'ALL jobs'}`);
  console.log(`Force: ${FORCE ? 'YES (skip logic disabled)' : 'NO'}`);
  console.log('');

  const stats = {
    sourcesProcessed: 0,
    jobsFound: 0,
    jobsRecent: 0,
    jobsSaved: 0,
    duplicates: 0,
    skippedOld: 0,
    errors: 0
  };

  // Get career pages with endpoints + company info
  let query = supabase
    .from('career_pages')
    .select('id, company_id, api_endpoint, api_endpoint_detail, ats_provider, career_url, companies(name, website)')
    .not('api_endpoint', 'is', null);

  if (!FORCE) {
    query = query.or(`last_jobs_scraped_at.is.null,last_jobs_scraped_at.lt.${SCRAPE_THRESHOLD}`);
  }

  const { data: careerPages, error } = await query;

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  // Filter by source type
  const sources = careerPages.filter(cp => {
    if (SOURCE === 'sitemap') {
      return cp.api_endpoint_detail === 'sitemap';
    } else {
      return cp.api_endpoint_detail !== 'sitemap';
    }
  });

  if (!FORCE) {
    console.log(`Skipping recently-scraped sources (within ${SCRAPE_INTERVAL_HOURS}h)`);
  }
  console.log(`Found ${sources.length} ${SOURCE} sources to scrape\n`);

  for (const source of sources) {
    stats.sourcesProcessed++;
    console.log(`[${stats.sourcesProcessed}/${sources.length}] ${source.ats_provider}: ${source.api_endpoint.substring(0, 60)}...`);

    try {
      let jobs;

      if (SOURCE === 'sitemap') {
        jobs = await scrapeFromSitemap(source);
      } else {
        jobs = await scrapeFromAPI(source);
      }

      stats.jobsFound += jobs.length;

      // Filter for recent jobs only
      const recentJobs = jobs.filter(job => isRecentJob(job.posted_date));
      const skipped = jobs.length - recentJobs.length;
      stats.jobsRecent += recentJobs.length;
      stats.skippedOld += skipped;

      console.log(`  Found ${jobs.length} jobs, ${recentJobs.length} recent${skipped > 0 ? ` (${skipped} older than ${MAX_DAYS} days)` : ''}`);

      if (!DRY_RUN) {
        for (const job of recentJobs) {
          const saved = await saveJob(job, source);
          if (saved === 'new') stats.jobsSaved++;
          else if (saved === 'duplicate') stats.duplicates++;
          else stats.errors++;
        }
        console.log(`  Saved: ${stats.jobsSaved}, Duplicates: ${stats.duplicates}`);
      }

    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      stats.errors++;
    }

    // Update last_jobs_scraped_at timestamp
    if (!DRY_RUN) {
      await supabase
        .from('career_pages')
        .update({ last_jobs_scraped_at: new Date().toISOString() })
        .eq('id', source.id);
    }

    await sleep(500);
  }

  // Summary
  console.log('\n===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Sources processed: ${stats.sourcesProcessed}`);
  console.log(`Total jobs found: ${stats.jobsFound}`);
  console.log(`Recent jobs (${MAX_DAYS ? `<=${MAX_DAYS} days` : 'all'}): ${stats.jobsRecent}`);
  console.log(`Skipped (too old): ${stats.skippedOld}`);
  console.log(`Jobs saved: ${stats.jobsSaved}`);
  console.log(`Duplicates skipped: ${stats.duplicates}`);
  console.log(`Errors: ${stats.errors}`);
}

async function scrapeFromAPI(source) {
  // Route to specialized scrapers for providers with non-standard APIs
  if (source.ats_provider === 'Jobvite') {
    return scrapeFromJobvite(source);
  }
  if (source.ats_provider === 'Eightfold') {
    return scrapeFromEightfold(source);
  }

  const response = await fetch(source.api_endpoint, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const jobs = normalizeAPIResponse(data, source);

  // Fetch individual job details only for recent jobs (providers that don't include descriptions in list)
  if (source.ats_provider === 'Greenhouse' || source.ats_provider === 'SmartRecruiters') {
    const recentJobs = jobs.filter(j => isRecentJob(j.posted_date));
    if (VERBOSE) console.log(`  Fetching details for ${recentJobs.length}/${jobs.length} recent jobs...`);
    for (const job of recentJobs) {
      try {
        const detailUrl = `${source.api_endpoint}/${job.external_id}`;

        const detailRes = await fetch(detailUrl, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' },
          signal: AbortSignal.timeout(10000)
        });
        if (detailRes.ok) {
          const detail = await detailRes.json();

          if (source.ats_provider === 'Greenhouse') {
            if (detail.content) job.description = detail.content;
            if (detail.departments?.length) job.category = detail.departments.map(d => d.name).join(', ');
          } else if (source.ats_provider === 'SmartRecruiters') {
            const sections = detail.jobAd?.sections || {};
            const descParts = [];
            if (sections.jobDescription?.text) descParts.push(sections.jobDescription.text);
            if (sections.qualifications?.text) descParts.push(sections.qualifications.text);
            if (descParts.length) job.description = descParts.join('\n');
            if (sections.companyDescription?.text) job.company_description = sections.companyDescription.text;
          }
        }
        await sleep(200);
      } catch {
        // Skip description fetch on error
      }
    }
  }

  return jobs;
}

async function scrapeFromJobvite(source) {
  const response = await fetch(source.api_endpoint, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const baseUrl = new URL(source.api_endpoint).origin;
  const seen = new Set();
  const jobs = [];

  function addJob(jobPath, title, location, category) {
    const jobId = jobPath.match(/\/job\/([^/?]+)/)?.[1];
    if (!jobId || seen.has(jobId)) return;
    seen.add(jobId);
    const fullUrl = jobPath.startsWith('http') ? jobPath : `${baseUrl}${jobPath}`;
    const loc = location?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().replace(/,\s*$/, '') || null;
    jobs.push({
      title: title.trim(),
      source_url: fullUrl,
      application_url: fullUrl,
      location: loc && loc.length < 200 ? loc : null,
      category: category || null,
      external_id: jobId,
      company_id: source.company_id,
      scraped_from: 'Jobvite',
      posted_date: null
    });
  }

  // Strip <style> tags to prevent CSS class names from matching as content
  const cleanHtml = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Category headers — associate jobs with their preceding h3 category (from cleanHtml for correct positions)
  const categoryHeaders = [...cleanHtml.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(m => ({ text: m[1].trim(), idx: m.index }));
  const skipCats = new Set(['Open Positions', 'Featured Jobs', 'Job Seeker Tools']);
  function getCategoryAt(pos) {
    let cat = null;
    for (const h of categoryHeaders) {
      if (h.idx < pos) cat = h.text;
      else break;
    }
    return cat && !skipCats.has(cat) ? cat : null;
  }

  // Match jobs inside <tr> or <li> blocks
  for (const m of cleanHtml.matchAll(/<(?:tr|li)[^>]*>([\s\S]*?)<\/(?:tr|li)>/gi)) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*href=["']([^"']*\/job\/([^"'/?]+))["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const [, jobPath, jobId, linkContent] = linkMatch;
    const nameDiv = linkContent.match(/jv-job-list-name[^>]*>([\s\S]*?)<\/div>/i);
    const title = (nameDiv ? nameDiv[1] : linkContent).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    const locMatch = block.match(/class=["'][^"']*jv-job-list-location[^"']*["'][^>]*>([\s\S]*?)<\/(?:td|div)>/i);
    const location = locMatch ? locMatch[1] : null;

    addJob(jobPath, title, location, getCategoryAt(m.index));
  }

  // Featured jobs (in <div>, not <tr>/<li>)
  for (const m of cleanHtml.matchAll(/<div[^>]*class=["']jv-featured-job["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["']jv-featured-job["']|<\/div>\s*<\/div>)/gi)) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*href=["']([^"']*\/job\/([^"'/?]+))["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const title = linkMatch[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const locMatch = block.match(/jv-featured-job-location[^>]*>([\s\S]*?)<\/div>/i);
    const location = locMatch ? locMatch[1] : null;

    addJob(linkMatch[1], title, location, getCategoryAt(m.index));
  }

  if (VERBOSE) console.log(`  Parsed ${jobs.length} jobs from Jobvite HTML`);

  // Fetch descriptions from individual job pages
  console.log(`  Fetching descriptions for ${jobs.length} jobs...`);
  let descCount = 0;
  for (const job of jobs) {
    try {
      const pageResp = await fetch(job.source_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' },
        signal: AbortSignal.timeout(10000)
      });
      if (!pageResp.ok) continue;
      const pageHtml = await pageResp.text();
      const cleanPage = pageHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

      // Extract description from jv-job-detail-description div
      const descStart = cleanPage.indexOf('jv-job-detail-description');
      if (descStart >= 0) {
        const tagStart = cleanPage.lastIndexOf('<', descStart);
        const contentStart = cleanPage.indexOf('>', tagStart) + 1;
        let depth = 1, pos = contentStart;
        while (depth > 0 && pos < cleanPage.length) {
          const nextOpen = cleanPage.indexOf('<div', pos);
          const nextClose = cleanPage.indexOf('</div>', pos);
          if (nextClose < 0) break;
          if (nextOpen >= 0 && nextOpen < nextClose) { depth++; pos = nextOpen + 4; }
          else { depth--; if (depth === 0) { job.description = cleanPage.substring(contentStart, nextClose).trim(); } pos = nextClose + 6; }
        }
        if (job.description) descCount++;
      }

      // Check JSON-LD for posted_date and employment type
      const jsonLdMatch = pageHtml.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLdMatch) {
        try {
          const ld = JSON.parse(jsonLdMatch[1]);
          if (ld.datePosted && !job.posted_date) job.posted_date = ld.datePosted;
          if (ld.employmentType && !job.commitment_type) job.commitment_type = ld.employmentType;
        } catch {}
      }

      await sleep(200);
    } catch {
      // Skip on error
    }
  }
  console.log(`  Descriptions fetched: ${descCount}/${jobs.length}`);

  return jobs;
}

async function scrapeFromEightfold(source) {
  const jobs = [];
  const PAGE_SIZE = 10; // Eightfold caps at 10 per request
  let start = 0;
  let total = 0;

  do {
    const url = `${source.api_endpoint}?num=${PAGE_SIZE}&start=${start}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    total = data.count || 0;
    const positions = data.positions || [];

    if (positions.length === 0) break;

    for (const pos of positions) {
      jobs.push({
        title: pos.name || pos.posting_name,
        source_url: pos.canonicalPositionUrl || `${new URL(source.api_endpoint).origin}/careers/job/${pos.id}`,
        application_url: pos.canonicalPositionUrl || null,
        location: pos.location || (pos.locations?.length ? pos.locations[0] : null),
        category: pos.department || null,
        external_id: String(pos.ats_job_id || pos.id),
        company_id: source.company_id,
        scraped_from: 'Eightfold',
        posted_date: pos.t_create ? new Date(pos.t_create * 1000).toISOString() : null,
        is_remote: pos.work_location_option === 'remote',
        commitment_type: pos.work_location_option || null
      });
    }

    start += positions.length;
    if (VERBOSE) console.log(`  Eightfold: fetched ${jobs.length}/${total}`);
    await sleep(300);
  } while (start < total);

  // Fetch descriptions only for recent jobs
  const recentJobs = jobs.filter(j => isRecentJob(j.posted_date));
  console.log(`  Fetching descriptions for ${recentJobs.length}/${jobs.length} recent jobs...`);
  let descCount = 0;
  for (let i = 0; i < recentJobs.length; i++) {
    const job = recentJobs[i];
    try {
      const detailUrl = `${source.api_endpoint}/${job.external_id}`;
      const detailResp = await fetch(detailUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' },
        signal: AbortSignal.timeout(10000)
      });
      if (detailResp.ok) {
        const detail = await detailResp.json();
        if (detail.job_description) {
          job.description = detail.job_description;
          descCount++;
        }
      }
      await sleep(150);
    } catch {
      // Skip on error
    }
    if ((i + 1) % 50 === 0 || i + 1 === recentJobs.length) {
      console.log(`  Eightfold descriptions: ${i + 1}/${recentJobs.length} (${descCount} with content)`);
    }
  }
  console.log(`  Descriptions fetched: ${descCount}/${recentJobs.length}`);

  return jobs;
}

async function scrapeFromSitemap(source) {
  const response = await fetch(source.api_endpoint, {
    headers: {
      'Accept': 'application/xml, text/xml',
      'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const xml = await response.text();
  const jobEntries = extractJobUrlsFromSitemap(xml);

  // Return job objects with lastmod as posted_date
  return jobEntries.map(entry => ({
    source_url: entry.url,
    title: extractTitleFromUrl(entry.url),
    company_id: source.company_id,
    posted_date: entry.lastmod, // Use lastmod for date filtering
    scraped_from: 'sitemap'
  }));
}

function normalizeAPIResponse(data, source) {
  const jobs = [];
  let rawJobs = [];

  // Handle different API response formats
  if (Array.isArray(data)) {
    rawJobs = data;
  } else if (data.jobs) {
    rawJobs = data.jobs;
  } else if (data.content) {
    rawJobs = data.content;
  } else if (data.results) {
    rawJobs = data.results;
  }

  for (const raw of rawJobs) {
    const job = normalizeJob(raw, source);
    if (job) jobs.push(job);
  }

  return jobs;
}

function normalizeJob(raw, source) {
  const ats = source.ats_provider;

  let job = {
    company_id: source.company_id,
    scraped_from: ats
  };

  switch (ats) {
    case 'Lever':
      job.title = raw.text;
      job.source_url = raw.hostedUrl || raw.applyUrl;
      job.application_url = raw.applyUrl;
      job.description = raw.descriptionPlain || raw.description;
      job.location = raw.categories?.location;
      job.commitment_type = raw.categories?.commitment;
      job.category = raw.categories?.team;
      job.external_id = raw.id;
      job.posted_date = raw.createdAt ? new Date(raw.createdAt).toISOString() : null;
      break;

    case 'Greenhouse':
      job.title = raw.title;
      job.source_url = raw.absolute_url;
      job.application_url = raw.absolute_url;
      job.location = raw.location?.name;
      job.external_id = String(raw.id);
      job.posted_date = raw.first_published || raw.updated_at;
      break;

    case 'Ashby':
      job.title = raw.title;
      job.source_url = raw.jobUrl;
      job.application_url = raw.applyUrl;
      job.description = raw.descriptionHtml;
      job.location = raw.location;
      job.commitment_type = raw.employmentType;
      job.category = raw.department;
      job.external_id = raw.id;
      job.is_remote = raw.isRemote;
      job.posted_date = raw.publishedAt;
      break;

    case 'SmartRecruiters':
      job.title = raw.name;
      job.source_url = `https://jobs.smartrecruiters.com/${raw.company?.identifier}/${raw.id}`;
      job.location = raw.location?.city;
      job.commitment_type = raw.typeOfEmployment?.label;
      job.category = raw.department?.label;
      job.external_id = raw.id;
      job.posted_date = raw.releasedDate;
      job.is_remote = raw.location?.remote;
      break;

    case 'Breezy HR':
      job.title = raw.name;
      job.source_url = raw.url;
      job.application_url = raw.url;
      job.location = raw.location?.city;
      job.commitment_type = raw.type?.name;
      job.external_id = raw.id;
      job.posted_date = raw.published_date;
      break;

    default:
      job.title = raw.title || raw.name;
      job.source_url = raw.url || raw.absolute_url || raw.hostedUrl;
      job.external_id = raw.id;
  }

  // Skip if no title or URL
  if (!job.title || !job.source_url) return null;

  return job;
}

function extractJobUrlsFromSitemap(xml) {
  const jobs = [];

  // Parse each <url> block to get both loc and lastmod
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i);

    if (locMatch) {
      const url = locMatch[1];
      if (isJobUrl(url)) {
        jobs.push({
          url: url,
          lastmod: lastmodMatch ? lastmodMatch[1] : null
        });
      }
    }
  }

  // Fallback: if no <url> blocks found, try simple <loc> extraction
  if (jobs.length === 0) {
    const locMatches = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
    for (const match of locMatches) {
      const url = match.replace(/<\/?loc>/gi, '');
      if (isJobUrl(url)) {
        jobs.push({ url: url, lastmod: null });
      }
    }
  }

  return jobs;
}

function isJobUrl(url) {
  const patterns = [/\/job\//i, /\/jobs\//i, /\/career/i, /\/position/i, /\/opening/i, /\/vacancy/i, /\/requisition/i];
  return patterns.some(p => p.test(url));
}

function extractTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(p => p);
    // Skip common non-title segments, pick the longest slug-like segment
    const skipWords = new Set(['job', 'jobs', 'career', 'careers', 'en', 'de', 'fr', 'es', 'nl', 'pt', 'it', 'ja', 'zh', 'ko', 'ar', 'employment', 'posting', 'postings', 'position', 'positions', 'opening', 'openings', 'vacancy', 'vacancies', 'requisition', 'apply', 'details', 'view']);
    const candidates = parts.filter(p => !skipWords.has(p.toLowerCase()) && !/^\d+$/.test(p) && p.length > 2);
    // Pick the last candidate (usually the most specific slug)
    const jobPart = candidates.length > 0 ? candidates[candidates.length - 1] : parts[parts.length - 1];
    return jobPart
      ? decodeURIComponent(jobPart).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
      : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

async function saveJob(job, source) {
  try {
    const companyName = source.companies?.name || null;
    const companyWebsite = source.companies?.website || null;

    const { data, error } = await supabase.rpc('save_hiring_cafe_job_to_existing_schema', {
      p_title: job.title,
      p_description: job.description || null,
      p_responsibilities: null,
      p_requirement_summary: null,
      p_job_type: job.is_remote ? 'remote' : null,
      p_commitment_type: job.commitment_type || null,
      p_category: job.category || null,
      p_experience_level: null,
      p_salary_min: null,
      p_salary_max: null,
      p_salary_currency: null,
      p_salary_period: null,
      p_education_requirement: [],
      p_education_preferred: [],
      p_application_url: job.application_url || job.source_url,
      p_source_url: job.source_url,
      p_external_id: job.external_id || null,
      p_posted_date: job.posted_date || null,
      p_raw_data: { scraped_from: job.scraped_from },
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
      p_location_full: job.location || null,
      p_is_remote: job.is_remote || false,
      p_skills: [],
      p_benefits: [],
      p_career_url: source.career_url || null,
      p_api_endpoint: null,
      p_api_endpoint_detail: null,
      p_ats_provider: source.ats_provider || null,
    });

    if (error) throw error;
    if (data?.duplicate) return 'duplicate';
    return 'new';
  } catch (err) {
    if (err.message?.includes('duplicate') || err.code === '23505') return 'duplicate';
    return 'error';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
