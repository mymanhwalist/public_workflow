/**
 * Verify all API endpoints
 * Tests each API to see if it works
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('===========================================');
  console.log('VERIFYING ALL API ENDPOINTS');
  console.log('===========================================\n');

  // Get all career pages with API endpoints (paginated to bypass 1000 row limit)
  const careerPages = [];
  let offset = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('career_pages')
      .select('id, ats_provider, api_endpoint, company_id')
      .not('api_endpoint', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching career pages:', error.message);
      return;
    }
    if (!data || data.length === 0) break;
    careerPages.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`Found ${careerPages.length} API endpoints to test\n`);

  const results = {
    working: [],
    failed: [],
    byATS: {}
  };

  for (let i = 0; i < careerPages.length; i++) {
    const page = careerPages[i];
    const { id, ats_provider, api_endpoint } = page;

    process.stdout.write(`[${i + 1}/${careerPages.length}] Testing ${ats_provider}: ${api_endpoint.substring(0, 50)}... `);

    try {
      const isSitemapEndpoint = api_endpoint.includes('.xml') || api_endpoint.includes('sitemap');
      const isWorkable = ats_provider === 'Workable';
      const workableBody = JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] });
      const response = await fetch(api_endpoint, {
        method: isWorkable ? 'POST' : 'GET',
        headers: {
          'Accept': isSitemapEndpoint ? 'application/xml, text/xml, */*' : 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)'
        },
        body: isWorkable ? workableBody : undefined,
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (response.ok) {
        let jobCount = 0;
        const isSitemap = isSitemapEndpoint;
        if (isSitemap) {
          // Sitemap XML — count <loc> tags matching job URLs
          const xml = await response.text();
          const locs = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
          const jobPatterns = /\/job\/|\/jobs\/|\/career|\/position|\/opening|\/vacancy|\/posting\//i;
          jobCount = locs.filter(l => jobPatterns.test(l)).length;
        } else if (isWorkable) {
          const data = await response.json();
          jobCount = data.total ?? data.results?.length ?? 0;
        } else if (ats_provider === 'Jobvite') {
          // Jobvite returns HTML, not JSON — count job links
          const html = await response.text();
          jobCount = (html.match(/\/job\/[A-Za-z0-9]+/g) || []).length;
        } else {
          const data = await response.json();
          jobCount = countJobs(data, ats_provider);
        }

        console.log(`✅ OK (${jobCount} jobs)`);
        results.working.push({ id, ats_provider, api_endpoint, jobCount });

        // Clear any previous error
        await supabase.from('career_pages').update({
          last_error: null,
          last_error_at: null,
        }).eq('id', id);

        // Track by ATS
        if (!results.byATS[ats_provider]) {
          results.byATS[ats_provider] = { working: 0, failed: 0, totalJobs: 0 };
        }
        results.byATS[ats_provider].working++;
        results.byATS[ats_provider].totalJobs += jobCount;
      } else {
        const errorMsg = `HTTP ${response.status}`;
        console.log(`❌ ${errorMsg}`);
        results.failed.push({ id, ats_provider, api_endpoint, error: errorMsg });

        await supabase.from('career_pages').update({
          last_error: errorMsg,
          last_error_at: new Date().toISOString(),
        }).eq('id', id);

        if (!results.byATS[ats_provider]) {
          results.byATS[ats_provider] = { working: 0, failed: 0, totalJobs: 0 };
        }
        results.byATS[ats_provider].failed++;
      }
    } catch (err) {
      const errorMsg = err.name === 'TimeoutError' ? 'Timeout' : err.message.substring(0, 50);
      console.log(`❌ ${errorMsg}`);
      results.failed.push({ id, ats_provider, api_endpoint, error: errorMsg });

      await supabase.from('career_pages').update({
        last_error: errorMsg,
        last_error_at: new Date().toISOString(),
      }).eq('id', id);

      if (!results.byATS[ats_provider]) {
        results.byATS[ats_provider] = { working: 0, failed: 0, totalJobs: 0 };
      }
      results.byATS[ats_provider].failed++;
    }

    // Small delay between requests
    await sleep(200);
  }

  // Print summary
  console.log('\n===========================================');
  console.log('SUMMARY');
  console.log('===========================================');
  console.log(`Total tested: ${careerPages.length}`);
  console.log(`Working: ${results.working.length} ✅`);
  console.log(`Failed: ${results.failed.length} ❌`);
  console.log(`Success rate: ${Math.round(results.working.length / careerPages.length * 100)}%`);

  const totalJobs = results.working.reduce((sum, r) => sum + r.jobCount, 0);
  console.log(`Total jobs available: ${totalJobs}`);

  console.log('\n--- By ATS Provider ---');
  for (const [ats, stats] of Object.entries(results.byATS).sort((a, b) => b[1].working - a[1].working)) {
    const total = stats.working + stats.failed;
    const rate = Math.round(stats.working / total * 100);
    console.log(`${ats}: ${stats.working}/${total} working (${rate}%) - ${stats.totalJobs} jobs`);
  }

  if (results.failed.length > 0) {
    console.log('\n--- Failed Endpoints ---');
    for (const f of results.failed) {
      console.log(`❌ ${f.ats_provider}: ${f.api_endpoint.substring(0, 60)}... (${f.error})`);
    }
  }

  console.log('\n--- Working Endpoints ---');
  for (const w of results.working) {
    console.log(`✅ ${w.ats_provider}: ${w.api_endpoint.substring(0, 60)}... (${w.jobCount} jobs)`);
  }
}

function countJobs(data, atsProvider) {
  try {
    // Different ATS return different structures
    if (Array.isArray(data)) {
      return data.length;
    }
    if (data.jobs && Array.isArray(data.jobs)) {
      return data.jobs.length;
    }
    if (data.content && Array.isArray(data.content)) {
      return data.content.length;
    }
    if (data.totalFound) {
      return data.totalFound;
    }
    if (data.results && Array.isArray(data.results)) {
      return data.results.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
