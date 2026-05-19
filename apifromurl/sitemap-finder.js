/**
 * Sitemap Finder
 * Checks websites for sitemaps and extracts job URLs
 */

import { createClient } from '@supabase/supabase-js';
import { detectATS } from './ats-detector.js';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 100;
const UPDATE_DB = process.argv.includes('--update');
const VERBOSE = process.argv.includes('--verbose');
const FORCE = process.argv.includes('--force');

// Sitemap paths to check
const SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemaps/sitemap.xml',
  '/careers/sitemap.xml',
  '/jobs/sitemap.xml',
  '/sitemap-jobs.xml',
  '/sitemap_jobs.xml'
];

async function main() {
  console.log('===========================================');
  console.log('SITEMAP FINDER');
  console.log('===========================================');
  console.log(`Mode: ${UPDATE_DB ? 'UPDATE DATABASE' : 'REPORT ONLY'}`);
  console.log(`Force: ${FORCE ? 'YES (skip logic disabled)' : 'NO'}`);
  console.log('');

  const stats = {
    totalURLs: 0,
    domainsChecked: 0,
    sitemapsFound: 0,
    jobsInSitemaps: 0,
    byATS: {},
    sitemapResults: []
  };

  // Get unique domains from application_urls that don't have public APIs
  const domains = await getDomainsWithoutAPI();
  console.log(`Found ${domains.length} unique domains to check\n`);

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    stats.domainsChecked++;

    if (VERBOSE) {
      process.stdout.write(`[${i + 1}/${domains.length}] Checking ${domain.domain}... `);
    }

    const result = await checkDomainForSitemap(domain);

    if (result.hasSitemap) {
      stats.sitemapsFound++;
      stats.jobsInSitemaps += result.jobCount;
      stats.sitemapResults.push(result);

      console.log(`✅ ${domain.domain} - ${result.jobCount} jobs (${result.sitemapUrl})`);

      // Track by ATS
      const ats = domain.ats || 'Unknown';
      if (!stats.byATS[ats]) {
        stats.byATS[ats] = { domains: 0, jobs: 0 };
      }
      stats.byATS[ats].domains++;
      stats.byATS[ats].jobs += result.jobCount;

      // Update database if requested
      if (UPDATE_DB) {
        await saveSitemapToDatabase(domain, result);
      }
    } else if (VERBOSE) {
      console.log(`❌ No sitemap`);
    }

    // Rate limiting
    await sleep(300);
  }

  // Print summary
  printSummary(stats);

  // Save results to file
  await saveResultsToFile(stats);
}

async function getDomainsWithoutAPI() {
  console.log('Fetching domains without public API...');

  const domains = new Map();
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('application_url, company_id')
      .not('application_url', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !jobs || jobs.length === 0) {
      hasMore = false;
      break;
    }

    for (const job of jobs) {
      const url = job.application_url;
      const atsInfo = detectATS(url);

      // Skip if has public API
      if (atsInfo.hasPublicAPI) continue;

      try {
        const urlObj = new URL(url);
        const domain = urlObj.origin;

        if (!domains.has(domain)) {
          domains.set(domain, {
            domain: domain,
            ats: atsInfo.provider || 'Custom',
            company_id: job.company_id,
            sampleUrl: url
          });
        }
      } catch (e) {
        // Invalid URL
      }
    }

    offset += BATCH_SIZE;
  }

  // Skip companies that already have a sitemap in career_pages
  if (!FORCE) {
    const { data: existingSitemaps } = await supabase
      .from('career_pages')
      .select('company_id')
      .eq('api_endpoint_detail', 'sitemap')
      .not('api_endpoint', 'is', null);

    if (existingSitemaps && existingSitemaps.length > 0) {
      const sitemapCompanyIds = new Set(existingSitemaps.map(r => r.company_id));
      const before = domains.size;
      for (const [key, domain] of domains) {
        if (domain.company_id && sitemapCompanyIds.has(domain.company_id)) {
          domains.delete(key);
        }
      }
      const skipped = before - domains.size;
      if (skipped > 0) {
        console.log(`Skipping ${skipped} domains with existing sitemaps`);
      }
    }
  }

  return Array.from(domains.values());
}

async function checkDomainForSitemap(domain) {
  for (const path of SITEMAP_PATHS) {
    const sitemapUrl = domain.domain + path;

    try {
      const response = await fetch(sitemapUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
          'Accept': 'application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const text = await response.text();

        // Check if it's actually XML
        if (text.includes('<?xml') || text.includes('<urlset') || text.includes('<sitemapindex')) {
          const jobUrls = extractJobUrls(text);

          if (jobUrls.length > 0) {
            return {
              hasSitemap: true,
              sitemapUrl: sitemapUrl,
              jobCount: jobUrls.length,
              jobUrls: jobUrls.slice(0, 10) // Sample
            };
          }
        }
      }
    } catch (e) {
      // Continue to next path
    }
  }

  return { hasSitemap: false };
}

function extractJobUrls(xml) {
  const urls = [];

  // Extract all <loc> tags
  const locMatches = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];

  for (const match of locMatches) {
    const url = match.replace(/<\/?loc>/gi, '');

    // Filter for job-related URLs
    if (isJobUrl(url)) {
      urls.push(url);
    }
  }

  return urls;
}

function isJobUrl(url) {
  const jobPatterns = [
    /\/job\//i,
    /\/jobs\//i,
    /\/career/i,
    /\/position/i,
    /\/opening/i,
    /\/vacancy/i,
    /\/requisition/i,
    /jobid=/i,
    /job-id=/i,
    /\/posting\//i
  ];

  return jobPatterns.some(pattern => pattern.test(url));
}

async function saveSitemapToDatabase(domain, result) {
  try {
    // Check if career_page exists
    const { data: existing } = await supabase
      .from('career_pages')
      .select('id')
      .eq('company_id', domain.company_id)
      .limit(1)
      .single();

    const sitemapData = {
      career_url: domain.domain,
      api_endpoint: result.sitemapUrl,
      api_endpoint_detail: 'sitemap',
      ats_provider: domain.ats,
      scraped_from: 'sitemap-finder',
      scraped_at: new Date().toISOString()
    };

    if (existing) {
      await supabase
        .from('career_pages')
        .update(sitemapData)
        .eq('id', existing.id);
    } else if (domain.company_id) {
      await supabase
        .from('career_pages')
        .insert({
          company_id: domain.company_id,
          ...sitemapData
        });
    }
  } catch (e) {
    // Ignore errors
  }
}

function printSummary(stats) {
  console.log('\n===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Domains checked: ${stats.domainsChecked}`);
  console.log(`Sitemaps found: ${stats.sitemapsFound}`);
  console.log(`Total jobs in sitemaps: ${stats.jobsInSitemaps}`);

  if (Object.keys(stats.byATS).length > 0) {
    console.log('\n--- By ATS Provider ---');
    const sorted = Object.entries(stats.byATS).sort((a, b) => b[1].jobs - a[1].jobs);
    for (const [ats, data] of sorted) {
      console.log(`${ats}: ${data.domains} sites, ${data.jobs} jobs`);
    }
  }

  if (stats.sitemapResults.length > 0) {
    console.log('\n--- Sitemaps Found ---');
    for (const result of stats.sitemapResults) {
      console.log(`✅ ${result.sitemapUrl} (${result.jobCount} jobs)`);
    }
  }
}

async function saveResultsToFile(stats) {
  const fs = await import('fs');
  const filename = `sitemap-results-${new Date().toISOString().slice(0, 10)}.json`;

  const results = {
    timestamp: new Date().toISOString(),
    summary: {
      domainsChecked: stats.domainsChecked,
      sitemapsFound: stats.sitemapsFound,
      totalJobs: stats.jobsInSitemaps
    },
    byATS: stats.byATS,
    sitemaps: stats.sitemapResults
  };

  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${filename}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
