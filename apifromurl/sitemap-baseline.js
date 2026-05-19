/**
 * sitemap-baseline.js — Workflow 6: Sitemap Baseline Collector
 *
 * For sitemap-only configs (Custom, BrassRing, iCIMS, SuccessFactors, unknown ATS):
 *   - First run per company: saves ALL job URLs as skipped_first_scrape (baseline)
 *   - Subsequent runs: new URLs (not seen before) → saved as pending for refiner
 *
 * How it works:
 *   1. Load career_page_configs WHERE source_type='sitemap' AND is_verified=true
 *   2. Fetch + parse each sitemap → collect job URLs
 *   3. New URL, first scrape  → skipped_first_scrape (baseline, refiner ignores)
 *   4. New URL, seen before   → pending (refiner will fetch details + promote)
 *   5. Existing URL           → update last_seen_at only
 *
 * Usage:
 *   node sitemap-baseline.js                    scrape all due configs (24h cooldown)
 *   node sitemap-baseline.js --dry-run          print only, no DB writes
 *   node sitemap-baseline.js --limit=20         first 20 configs only
 *   node sitemap-baseline.js --force            ignore 24h cooldown
 *   node sitemap-baseline.js --verbose          show each URL processed
 *   node sitemap-baseline.js --provider=Custom  only this ats_provider
 */

import { createClient } from '@supabase/supabase-js';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DB2_URL = process.env.DB2_URL || 'https://buowaosqezcvdpdjcewq.supabase.co';
const DB2_KEY = process.env.DB2_KEY;

const SCRAPE_COOLDOWN_HOURS = 24;
const MAX_FAILURES          = 3;
const REQUEST_DELAY_MS      = 300;
const WALL_LIMIT_MS         = 80 * 60 * 1000;
const HTTP_TIMEOUT_MS       = 15000;
const USER_AGENT            = 'Mozilla/5.0 (compatible; JobBot/1.0)';

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const DRY_RUN   = process.argv.includes('--dry-run');
const FORCE     = process.argv.includes('--force');
const VERBOSE   = process.argv.includes('--verbose');
const limitArg  = process.argv.find(a => a.startsWith('--limit='));
const LIMIT     = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const provArg   = process.argv.find(a => a.startsWith('--provider='));
const PROVIDER  = provArg ? provArg.split('=')[1] : null;

const db2 = createClient(DB2_URL, DB2_KEY);

// ─── URL HELPERS ──────────────────────────────────────────────────────────────

const JOB_PATTERNS = [
  /\/job\//i, /\/jobs\//i, /\/career/i, /\/position/i,
  /\/opening/i, /\/vacancy/i, /\/requisition/i, /\/posting\//i,
];

const EXCLUDE_PATTERNS = [
  /\/login/i, /\/password/i, /\/account/i, /\/faq/i,
  /\/about\b/i, /\/apply-process/i, /\/search/i, /\/category\//i,
  /\/tag\//i, /\/author\//i, /\/page\//i,
];

function isJobUrl(url) {
  return JOB_PATTERNS.some(p => p.test(url));
}

function isExcludedUrl(url) {
  return EXCLUDE_PATTERNS.some(p => p.test(url));
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source'].forEach(p =>
      u.searchParams.delete(p)
    );
    return u.toString();
  } catch {
    return url;
  }
}

function titleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts.find(p =>
      p !== 'job' && p !== 'jobs' && p !== 'career' && p !== 'careers' &&
      p !== 'position' && p !== 'opening' && p !== 'vacancy' && p !== 'apply' &&
      !/^\d+$/.test(p)
    );
    if (!slug) return null;
    return decodeURIComponent(slug)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || null;
  } catch {
    return null;
  }
}

// ─── SITEMAP FETCH ─────────────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/xml, text/xml, */*', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Fetch a sitemap and return all { url, lastmod } entries.
 * Handles sitemapindex (recursive) and urlset.
 */
async function fetchSitemap(sitemapUrl, depth = 0) {
  if (depth > 3) return [];

  let xml;
  try {
    xml = await fetchText(sitemapUrl);
  } catch (err) {
    throw new Error(`Sitemap fetch failed: ${err.message}`);
  }

  // Sitemap index — recurse into child sitemaps
  if (xml.includes('<sitemapindex')) {
    const childUrls = (xml.match(/<loc>([^<]+)<\/loc>/gi) || [])
      .map(m => m.replace(/<\/?loc>/gi, '').trim());

    const results = await Promise.allSettled(
      childUrls.map(u => fetchSitemap(u, depth + 1))
    );
    return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  }

  // Regular urlset
  const entries = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  for (const block of urlBlocks) {
    const locMatch    = block.match(/<loc>([^<]+)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
    if (locMatch) {
      entries.push({
        url:     locMatch[1].trim(),
        lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
      });
    }
  }
  return entries;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('SITEMAP BASELINE COLLECTOR — Workflow 6');
  if (DRY_RUN)   console.log('DRY RUN — no writes');
  if (FORCE)     console.log('FORCE — ignoring cooldown');
  if (PROVIDER)  console.log(`PROVIDER — ${PROVIDER} only`);
  console.log('══════════════════════════════════════════\n');

  // ── Load sitemap configs ───────────────────────────────────────────

  const threshold = new Date(Date.now() - SCRAPE_COOLDOWN_HOURS * 3600000).toISOString();
  let q = db2
    .from('career_page_configs')
    .select('id, company_id, ats_provider, sitemap_url, career_page_url, consecutive_failures')
    .eq('source_type', 'sitemap')
    .eq('is_verified', true)
    .lt('consecutive_failures', MAX_FAILURES);

  if (!FORCE)   q = q.or(`last_scraped_at.is.null,last_scraped_at.lt.${threshold}`);
  if (PROVIDER) q = q.eq('ats_provider', PROVIDER);

  const { data: configs, error } = await q.order('last_scraped_at', { ascending: true, nullsFirst: true });
  if (error) { console.error('Failed to load configs:', error.message); process.exit(1); }

  const toScrape = LIMIT ? configs.slice(0, LIMIT) : configs;
  console.log(`Configs to process: ${toScrape.length} (of ${configs.length} due)\n`);

  // ── First-scrape detection ─────────────────────────────────────────
  // A company is "first scrape" if it has no prior raw_jobs or scrape_runs

  const { data: priorRuns } = await db2.from('scrape_runs').select('company_id').eq('status', 'success');
  const { data: rawJobCos } = await db2.from('raw_jobs').select('company_id').limit(300000);
  const scrapedCompanies = new Set([
    ...(priorRuns  || []).map(r => r.company_id),
    ...(rawJobCos  || []).map(r => r.company_id),
  ]);
  console.log(`Companies with existing data: ${scrapedCompanies.size}\n`);

  // ── Scrape loop ────────────────────────────────────────────────────

  const totals = { configs: 0, urls_found: 0, new_baseline: 0, new_pending: 0, updated: 0, errors: 0 };
  const startTime = Date.now();

  for (let i = 0; i < toScrape.length; i++) {
    if (Date.now() - startTime > WALL_LIMIT_MS) {
      console.log('\n⏱ 90-min wall limit reached — stopping gracefully');
      break;
    }

    const config = toScrape[i];

    // Resolve sitemap URL — stored sitemap_url first, then /sitemap.xml off career_page_url
    let sitemapUrl = config.sitemap_url;
    if (!sitemapUrl && config.career_page_url) {
      try {
        sitemapUrl = new URL(config.career_page_url).origin + '/sitemap.xml';
      } catch { /* invalid career_page_url — skip */ }
    }

    if (!sitemapUrl) {
      if (VERBOSE) console.log(`[${i+1}/${toScrape.length}] ${config.ats_provider || 'unknown'}: no URL — skip`);
      continue;
    }

    const isFirstScrape = !scrapedCompanies.has(config.company_id);
    console.log(`[${i+1}/${toScrape.length}] ${config.ats_provider || 'unknown'}${isFirstScrape ? ' [FIRST]' : ''}: ${sitemapUrl.substring(0, 70)}`);
    totals.configs++;

    let runUrlsFound = 0, runNew = 0, runUpdated = 0;
    let runStatus = 'success';

    try {
      const entries    = await fetchSitemap(sitemapUrl);
      const jobEntries = entries.filter(e => isJobUrl(e.url) && !isExcludedUrl(e.url));

      runUrlsFound = jobEntries.length;
      totals.urls_found += jobEntries.length;
      console.log(`  → ${entries.length} sitemap URLs, ${jobEntries.length} job URLs`);

      for (const entry of jobEntries) {
        if (Date.now() - startTime > WALL_LIMIT_MS) {
          console.log('\n⏱ 80-min wall limit reached inside URL loop — stopping gracefully');
          runStatus = 'partial';
          break;
        }
        const url = cleanUrl(entry.url);

        // Check if already in raw_jobs
        const { data: existing } = await db2
          .from('raw_jobs')
          .select('id, seen_count')
          .eq('application_url', url)
          .maybeSingle();

        if (existing) {
          if (!DRY_RUN) {
            await db2.from('raw_jobs').update({
              last_seen_at: new Date().toISOString(),
              seen_count:   existing.seen_count + 1,
            }).eq('id', existing.id);
          }
          runUpdated++;
          totals.updated++;
          continue;
        }

        // New URL — determine status
        runNew++;
        const status = isFirstScrape ? 'skipped_first_scrape' : 'pending';

        // Title from URL slug (fast, no extra HTTP request)
        const title = titleFromUrl(url) || 'Job Opening';

        // Date: use sitemap lastmod if available; for non-baseline new jobs use now()
        const posted_date = entry.lastmod
          ? new Date(entry.lastmod).toISOString()
          : (!isFirstScrape ? new Date().toISOString() : null);

        if (VERBOSE) console.log(`    + [${status}] ${title}`);

        if (!DRY_RUN) {
          const { error: insertErr } = await db2.from('raw_jobs').insert({
            company_id:      config.company_id,
            config_id:       config.id,
            title,
            application_url: url,
            posted_date,
            is_first_scrape: isFirstScrape,
            status,
          });
          if (insertErr && !insertErr.message?.includes('duplicate')) {
            console.log(`    ❌ Insert error: ${insertErr.message}`);
            totals.errors++;
          }
        }

        if (status === 'skipped_first_scrape') totals.new_baseline++;
        else totals.new_pending++;
      }

      // Mark company as scraped so subsequent configs for same company aren't first-scrape
      scrapedCompanies.add(config.company_id);

      console.log(`  → new: ${runNew} (${isFirstScrape ? 'baseline' : 'pending'})  updated: ${runUpdated}`);

    } catch (err) {
      console.log(`  ❌ ${err.message}`);
      runStatus = 'failed';
      totals.errors++;

      if (!DRY_RUN) {
        const { data: cfg } = await db2
          .from('career_page_configs')
          .select('consecutive_failures')
          .eq('id', config.id)
          .single();
        await db2.from('career_page_configs').update({
          consecutive_failures: (cfg?.consecutive_failures || 0) + 1,
        }).eq('id', config.id);
      }
    }

    // Update last_scraped_at + log scrape run
    if (!DRY_RUN) {
      await db2.from('career_page_configs').update({
        last_scraped_at:      new Date().toISOString(),
        consecutive_failures: runStatus === 'success' ? 0 : undefined,
      }).eq('id', config.id);

      try {
        await db2.from('scrape_runs').insert({
          company_id:      config.company_id,
          config_id:       config.id,
          is_first_scrape: !scrapedCompanies.has(config.company_id) || isFirstScrape,
          jobs_found:      runUrlsFound,
          jobs_new:        runNew,
          jobs_updated:    runUpdated,
          status:          runStatus,
          completed_at:    new Date().toISOString(),
        });
      } catch { /* scrape_runs log failure is non-critical */ }
    }

    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }

  // ── Summary ────────────────────────────────────────────────────────

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('\n══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════════════════');
  console.log(`Configs processed:  ${totals.configs}`);
  console.log(`URLs found:         ${totals.urls_found}`);
  console.log(`New (baseline):     ${totals.new_baseline}  ← skipped_first_scrape`);
  console.log(`New (pending):      ${totals.new_pending}   ← ready for refiner`);
  console.log(`Updated (seen):     ${totals.updated}`);
  console.log(`Errors:             ${totals.errors}`);
  console.log(`Duration:           ${elapsed}s`);
  if (DRY_RUN) console.log('\n⚠ DRY RUN — nothing was written to DB');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
