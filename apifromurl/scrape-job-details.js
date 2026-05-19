/**
 * Job Detail Scraper
 * Visits individual job page URLs and extracts full job details
 * (title, description, location, company, etc.) using HTML parsing.
 * Saves results to a local JSON file.
 *
 * Usage:
 *   node scrape-job-details.js --input=sitemap-test-2026-02-07.json
 *   node scrape-job-details.js --input=sitemap-test-2026-02-07.json --sample=5 --max=3
 *   node scrape-job-details.js --input=sitemap-test-2026-02-07.json --verbose
 */

import { readFileSync, writeFileSync } from 'fs';

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const INPUT_FILE = getArg('input');
const SAMPLE_SIZE = parseInt(getArg('sample') || '0');
const MAX_JOBS = parseInt(getArg('max') || '3');
const VERBOSE = args.includes('--verbose');
const DELAY_MS = 300;

// ── Extraction helpers ──────────────────────────────────────────────

/** Extract all JSON-LD blocks from HTML, return the first JobPosting */
function extractJsonLd(html) {
  const blocks = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const content = block.replace(/<script[^>]*>/, '').replace(/<\/script>/i, '').trim();
    try {
      const data = JSON.parse(content);
      // Could be a single object or an array
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'JobPosting') return item;
        // Sometimes wrapped in @graph
        if (item['@graph']) {
          const posting = item['@graph'].find(g => g['@type'] === 'JobPosting');
          if (posting) return posting;
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }
  return null;
}

/** Extract a meta tag value by name or property */
function extractMeta(html, attr) {
  // Try property= first (OpenGraph), then name=
  const patterns = [
    new RegExp(`<meta[^>]*property\\s*=\\s*["']${attr}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*property\\s*=\\s*["']${attr}["']`, 'i'),
    new RegExp(`<meta[^>]*name\\s*=\\s*["']${attr}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*name\\s*=\\s*["']${attr}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

/** Extract the first <h1> text content */
function extractH1(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (match) return stripHtml(match[1]).trim();
  return null;
}

/** Extract job description from common CSS class/id patterns */
function extractDescriptionHtml(html) {
  const patterns = [
    // Common class patterns for job descriptions
    /<div[^>]*class\s*=\s*["'][^"']*job[-_]?desc(?:ription)?[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*jd[-_]?content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*posting[-_]?desc(?:ription)?[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*job[-_]?detail[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*job[-_]?body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*description[-_]?content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // ID patterns
    /<div[^>]*id\s*=\s*["']job[-_]?desc(?:ription)?["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id\s*=\s*["']posting[-_]?desc(?:ription)?["'][^>]*>([\s\S]*?)<\/div>/i,
    // Article/section patterns
    /<article[^>]*class\s*=\s*["'][^"']*job[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
    /<section[^>]*class\s*=\s*["'][^"']*job[-_]?desc[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 50) {
      return stripHtml(match[1]).trim();
    }
  }
  return null;
}

/** Strip HTML tags, decode entities, collapse whitespace */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Extract a readable title from URL slug as last resort */
function extractTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(p => p);
    const jobPart = parts.find(p =>
      p !== 'job' && p !== 'jobs' && p !== 'career' && p !== 'careers' &&
      p !== 'position' && p !== 'opening' && p !== 'vacancy' &&
      !/^\d+$/.test(p)
    );
    if (!jobPart) return null;
    return decodeURIComponent(jobPart)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || null;
  } catch {
    return null;
  }
}

// ── Main extraction logic ───────────────────────────────────────────

function extractJobDetails(html, url, sitemapLastmod) {
  const result = {
    title: null,
    description: null,
    location: null,
    company: null,
    employment_type: null,
    posted_date: sitemapLastmod || null,
    source_url: url,
    extraction_method: 'none',
  };

  // 1. Try JSON-LD (richest source)
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    result.extraction_method = 'json_ld';
    result.title = jsonLd.title || null;
    result.company = jsonLd.hiringOrganization?.name || null;
    result.employment_type = normalizeEmploymentType(jsonLd.employmentType);
    result.posted_date = jsonLd.datePosted || sitemapLastmod || null;

    // Location from JSON-LD
    if (jsonLd.jobLocation) {
      result.location = formatLocation(jsonLd.jobLocation);
    }

    // Description from JSON-LD
    if (jsonLd.description) {
      result.description = stripHtml(jsonLd.description);
    }
  }

  // 2. Meta tags - fill gaps
  if (!result.title) {
    result.title = extractMeta(html, 'og:title');
    if (result.title && result.extraction_method === 'none') {
      result.extraction_method = 'meta_tags';
    }
  }
  if (!result.company) {
    result.company = extractMeta(html, 'og:site_name');
  }
  if (!result.description) {
    const metaDesc = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    if (metaDesc && metaDesc.length > 20) {
      result.description = metaDesc;
      if (result.extraction_method === 'none') result.extraction_method = 'meta_tags';
    }
  }

  // 3. HTML elements - fill remaining gaps
  if (!result.title) {
    const h1 = extractH1(html);
    if (h1 && h1.length > 2) {
      result.title = h1;
      if (result.extraction_method === 'none') result.extraction_method = 'html_elements';
    }
  }
  if (!result.description) {
    const htmlDesc = extractDescriptionHtml(html);
    if (htmlDesc) {
      result.description = htmlDesc;
      if (result.extraction_method === 'none') result.extraction_method = 'html_elements';
    }
  }

  // 4. URL fallback for title
  if (!result.title) {
    result.title = extractTitleFromUrl(url);
    if (result.title && result.extraction_method === 'none') {
      result.extraction_method = 'url_fallback';
    }
  }

  // Truncate very long descriptions to 5000 chars
  if (result.description && result.description.length > 5000) {
    result.description = result.description.substring(0, 5000) + '...';
  }

  return result;
}

function formatLocation(loc) {
  if (!loc) return null;
  if (typeof loc === 'string') return loc;
  if (Array.isArray(loc)) {
    return loc.map(l => formatLocation(l)).filter(Boolean).join('; ');
  }
  const addr = loc.address;
  if (!addr) return loc.name || loc.description || null;
  if (typeof addr === 'string') return addr;
  if (typeof addr === 'object') {
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry].filter(Boolean);
    return parts.join(', ') || null;
  }
  return null;
}

function normalizeEmploymentType(type) {
  if (!type) return null;
  if (Array.isArray(type)) return type.map(t => normalizeEmploymentType(t)).filter(Boolean).join(', ');
  const map = {
    'FULL_TIME': 'Full-time',
    'PART_TIME': 'Part-time',
    'CONTRACT': 'Contract',
    'TEMPORARY': 'Temporary',
    'INTERN': 'Internship',
    'INTERNSHIP': 'Internship',
    'VOLUNTEER': 'Volunteer',
    'PER_DIEM': 'Per Diem',
    'OTHER': 'Other',
  };
  return map[type.toUpperCase()] || type;
}

// ── Load job URLs ───────────────────────────────────────────────────

function loadJobUrlsFromFile(filepath) {
  const data = JSON.parse(readFileSync(filepath, 'utf8'));

  // Group sample_jobs by source_sitemap
  const bySitemap = {};
  for (const job of (data.sample_jobs || [])) {
    const key = job.source_sitemap;
    if (!bySitemap[key]) bySitemap[key] = [];
    bySitemap[key].push(job);
  }

  let sitemapKeys = Object.keys(bySitemap);

  // Apply --sample to pick N random sitemaps
  if (SAMPLE_SIZE > 0 && SAMPLE_SIZE < sitemapKeys.length) {
    sitemapKeys = sitemapKeys.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
  }

  // Apply --max to limit jobs per sitemap
  const jobs = [];
  for (const key of sitemapKeys) {
    const sitemapJobs = bySitemap[key].slice(0, MAX_JOBS);
    jobs.push(...sitemapJobs);
  }

  return jobs;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('===========================================');
  console.log('JOB DETAIL SCRAPER');
  console.log('===========================================');

  if (!INPUT_FILE) {
    console.error('Error: --input=<file> is required');
    console.error('Usage: node scrape-job-details.js --input=sitemap-test-2026-02-07.json');
    process.exit(1);
  }

  const jobUrls = loadJobUrlsFromFile(INPUT_FILE);
  console.log(`Loaded ${jobUrls.length} job URLs from ${INPUT_FILE}`);
  if (SAMPLE_SIZE > 0) console.log(`Sampled ${SAMPLE_SIZE} sitemaps`);
  console.log(`Max ${MAX_JOBS} jobs per sitemap`);
  console.log(`Verbose: ${VERBOSE}\n`);

  const results = [];
  const stats = { total: jobUrls.length, successful: 0, failed: 0 };
  const methodCounts = { json_ld: 0, meta_tags: 0, html_elements: 0, url_fallback: 0, none: 0 };
  let withDescription = 0;
  let withLocation = 0;

  for (let i = 0; i < jobUrls.length; i++) {
    const job = jobUrls[i];
    const label = `[${i + 1}/${jobUrls.length}]`;

    try {
      const response = await fetch(job.url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (!response.ok) {
        console.log(`${label} ❌ HTTP ${response.status} - ${job.url.substring(0, 80)}`);
        stats.failed++;
        continue;
      }

      const html = await response.text();
      const details = extractJobDetails(html, job.url, job.lastmod);
      details.source_sitemap = job.source_sitemap;

      results.push(details);
      stats.successful++;
      methodCounts[details.extraction_method]++;
      if (details.description) withDescription++;
      if (details.location) withLocation++;

      const title = (details.title || 'No title').substring(0, 50);
      const method = details.extraction_method;
      if (VERBOSE) {
        console.log(`${label} ✅ [${method}] ${title}`);
        if (details.company) console.log(`       Company: ${details.company}`);
        if (details.location) console.log(`       Location: ${details.location}`);
      } else {
        console.log(`${label} ✅ [${method}] ${title}`);
      }

    } catch (err) {
      const reason = err.message.substring(0, 60);
      console.log(`${label} ❌ ${reason} - ${job.url.substring(0, 60)}`);
      stats.failed++;
    }

    // Rate limiting
    if (i < jobUrls.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Summary
  console.log('\n===========================================');
  console.log('RESULTS');
  console.log('===========================================');
  console.log(`Total URLs:       ${stats.total}`);
  console.log(`Successful:       ${stats.successful}`);
  console.log(`Failed:           ${stats.failed}`);
  console.log(`With description: ${withDescription}`);
  console.log(`With location:    ${withLocation}`);
  console.log(`\nExtraction methods:`);
  for (const [method, count] of Object.entries(methodCounts)) {
    if (count > 0) console.log(`  ${method}: ${count}`);
  }

  // Save output
  const output = {
    scraped_at: new Date().toISOString(),
    summary: {
      total_urls: stats.total,
      successful: stats.successful,
      failed: stats.failed,
      with_description: withDescription,
      with_location: withLocation,
      extraction_methods: Object.fromEntries(
        Object.entries(methodCounts).filter(([, v]) => v > 0)
      ),
    },
    jobs: results,
  };

  const filename = `job-details-${new Date().toISOString().split('T')[0]}.json`;
  writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved to ${filename}`);
}

main().catch(console.error);
