/**
 * Test Sitemap Scraper
 * Tests all sitemap sources, scrapes jobs, saves results to local JSON
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SAMPLE_SIZE = parseInt(process.argv.find(a => a.startsWith('--sample='))?.split('=')[1] || '0');
const MAX_JOBS = parseInt(process.argv.find(a => a.startsWith('--max='))?.split('=')[1] || '5'); // sample jobs per source

function isJobUrl(url) {
  const patterns = [/\/job\//i, /\/jobs\//i, /\/career/i, /\/position/i, /\/opening/i, /\/vacancy/i, /\/requisition/i];
  return patterns.some(p => p.test(url));
}

function extractJobUrlsFromSitemap(xml) {
  const jobs = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
    if (locMatch) {
      const url = locMatch[1];
      if (isJobUrl(url)) {
        jobs.push({ url, lastmod: lastmodMatch ? lastmodMatch[1] : null });
      }
    }
  }

  if (jobs.length === 0) {
    const locMatches = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
    for (const match of locMatches) {
      const url = match.replace(/<\/?loc>/gi, '');
      if (isJobUrl(url)) {
        jobs.push({ url, lastmod: null });
      }
    }
  }
  return jobs;
}

function extractTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(p => p);
    const jobPart = parts.find(p => p !== 'job' && p !== 'jobs' && !/^\d+$/.test(p));
    return jobPart?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

async function main() {
  console.log('===========================================');
  console.log('SITEMAP SCRAPE TESTER');
  console.log('===========================================');
  console.log(`Sample jobs per source: ${MAX_JOBS}`);
  console.log('Output: local JSON file\n');

  // Get sitemap sources from DB
  const { data: sources, error } = await supabase
    .from('career_pages')
    .select('id, company_id, api_endpoint, ats_provider, career_url')
    .eq('api_endpoint_detail', 'sitemap');

  if (error) { console.error('DB Error:', error.message); return; }

  const toTest = SAMPLE_SIZE > 0
    ? sources.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE)
    : sources;

  console.log(`Total sitemap sources: ${sources.length}`);
  console.log(`Testing: ${toTest.length}\n`);

  const working = [];
  const failed = [];
  const allJobs = [];

  for (let i = 0; i < toTest.length; i++) {
    const src = toTest[i];
    const label = `[${i + 1}/${toTest.length}]`;

    try {
      const response = await fetch(src.api_endpoint, {
        headers: { 'Accept': 'application/xml, text/xml', 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        console.log(`${label} ❌ HTTP ${response.status} - ${src.api_endpoint}`);
        failed.push({ endpoint: src.api_endpoint, reason: `HTTP ${response.status}` });
        continue;
      }

      const xml = await response.text();
      const jobs = extractJobUrlsFromSitemap(xml);

      if (jobs.length === 0) {
        console.log(`${label} ❌ No job URLs - ${src.api_endpoint}`);
        failed.push({ endpoint: src.api_endpoint, reason: 'No job URLs found' });
        continue;
      }

      const hasLastmod = jobs.filter(j => j.lastmod).length;
      console.log(`${label} ✅ ${jobs.length} jobs (${hasLastmod} with dates) - ${src.api_endpoint}`);

      working.push({
        endpoint: src.api_endpoint,
        career_url: src.career_url,
        company_id: src.company_id,
        total_jobs: jobs.length,
        has_lastmod: hasLastmod
      });

      // Save sample jobs
      const sampleJobs = jobs.slice(0, MAX_JOBS).map(j => ({
        title: extractTitleFromUrl(j.url),
        url: j.url,
        lastmod: j.lastmod,
        source_sitemap: src.api_endpoint,
        career_url: src.career_url,
        company_id: src.company_id
      }));

      allJobs.push(...sampleJobs);

    } catch (err) {
      const reason = err.message.substring(0, 80);
      console.log(`${label} ❌ ${reason} - ${src.api_endpoint}`);
      failed.push({ endpoint: src.api_endpoint, reason });
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Summary
  console.log('\n===========================================');
  console.log('RESULTS');
  console.log('===========================================');
  console.log(`✅ Working: ${working.length}/${toTest.length}`);
  console.log(`❌ Failed:  ${failed.length}/${toTest.length}`);
  console.log(`📄 Sample jobs collected: ${allJobs.length}`);

  // Total jobs across all working sitemaps
  const totalJobsAvailable = working.reduce((sum, w) => sum + w.total_jobs, 0);
  console.log(`📊 Total jobs available: ${totalJobsAvailable.toLocaleString()}`);

  // Save to JSON
  const output = {
    tested_at: new Date().toISOString(),
    summary: {
      total_tested: toTest.length,
      working: working.length,
      failed: failed.length,
      total_jobs_available: totalJobsAvailable,
      sample_jobs_collected: allJobs.length
    },
    working_sitemaps: working,
    failed_sitemaps: failed,
    sample_jobs: allJobs
  };

  const filename = `sitemap-test-${new Date().toISOString().split('T')[0]}.json`;
  writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved to ${filename}`);

  // Show some failed ones
  if (failed.length > 0) {
    console.log('\n--- Failed Sitemaps ---');
    for (const f of failed) console.log(`  ${f.endpoint} - ${f.reason}`);
  }
}

main().catch(console.error);
