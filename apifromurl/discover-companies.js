/**
 * discover-companies.js — Discover new companies with ATS API endpoints
 *
 * Sources:
 *   1. Y Combinator companies API (~23,500 companies)
 *   2. Existing DB2 companies with null/custom ATS (probe for hidden endpoints)
 *
 * For each company, generates candidate slugs and probes:
 *   Greenhouse, Lever, Ashby, Workable, SmartRecruiters
 *
 * Inserts confirmed companies + configs into DB2.
 *
 * Usage:
 *   node discover-companies.js                        → full run (YC + existing DB2)
 *   node discover-companies.js --yc-only              → only YC companies
 *   node discover-companies.js --db-only              → only existing DB2 companies
 *   node discover-companies.js --dry-run              → print only, no DB writes
 *   node discover-companies.js --limit=1000           → stop after N companies probed
 *   node discover-companies.js --start-page=11        → start from YC page 11 (resume)
 *   node discover-companies.js --start-page=11 --limit=1000 → batch of 1000 from page 11
 */

import { createClient } from '@supabase/supabase-js';

const DB2_URL = process.env.DB2_URL || 'https://buowaosqezcvdpdjcewq.supabase.co';
const DB2_KEY = process.env.DB2_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1b3dhb3NxZXpjdmRwZGpjZXdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1ODY1MCwiZXhwIjoyMDg5NzM0NjUwfQ.BU8tVARSBvEQRWstBQguKY5-U4NV3nhta5SOACQ2nnk';

const DRY_RUN    = process.argv.includes('--dry-run');
const YC_ONLY    = process.argv.includes('--yc-only');
const DB_ONLY    = process.argv.includes('--db-only');
const limitArg   = process.argv.find(a => a.startsWith('--limit='));
const LIMIT      = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const startArg   = process.argv.find(a => a.startsWith('--start-page='));
const START_PAGE = startArg ? parseInt(startArg.split('=')[1]) : 1;

const CONCURRENCY    = 15;  // parallel company probes
const PROBE_TIMEOUT  = 6000; // ms per ATS probe
const REQUEST_DELAY  = 100;  // ms between batches

const db2 = createClient(DB2_URL, DB2_KEY);

// ─── ATS PROBE DEFINITIONS ───────────────────────────────────────────────────

// Only reliable ATS providers for probing:
// - Greenhouse: returns 404 for unknown slugs ✓
// - Lever:      returns 404 for unknown slugs ✓
// - Ashby:      returns 404 for unknown slugs ✓
// - Recruitee:  returns 404 for unknown slugs ✓
// - Breezy HR:  returns 404 for unknown slugs ✓
// - Eightfold:  returns 404 for unknown slugs ✓
// - BambooHR:   returns 404 for unknown slugs ✓
// - Personio:   returns 404 for unknown slugs ✓ (XML feed)
// Excluded:
// - SmartRecruiters: returns 200 for ANY slug (false positives)
// - Workable:        returns 403 for everything (API locked down)
const ATS_PROBES = [
  {
    name: 'Greenhouse',
    url:  slug => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    ok:   json => Array.isArray(json?.jobs),
  },
  {
    name: 'Lever',
    url:  slug => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    ok:   json => Array.isArray(json),
  },
  {
    name: 'Ashby',
    url:  slug => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    ok:   json => Array.isArray(json?.jobPostings) || Array.isArray(json?.jobs),
  },
  {
    name: 'Recruitee',
    url:  slug => `https://${slug}.recruitee.com/api/offers/`,
    ok:   json => Array.isArray(json?.offers),
  },
  {
    name: 'Breezy HR',
    url:  slug => `https://${slug}.breezy.hr/json`,
    ok:   json => Array.isArray(json),
  },
  {
    name: 'Eightfold',
    url:  slug => `https://${slug}.eightfold.ai/api/apply/v2/jobs?num=1&start=0`,
    ok:   json => typeof json?.count !== 'undefined' || Array.isArray(json?.positions),
  },
  {
    name: 'BambooHR',
    url:  slug => `https://${slug}.bamboohr.com/careers/list`,
    ok:   json => Array.isArray(json?.result),
  },
  {
    name: 'Personio',
    url:  slug => `https://${slug}.jobs.personio.com/xml`,
    raw:  true,
    ok:   text => typeof text === 'string' && text.includes('<workzag-jobs>'),
  },
];

// ─── SLUG GENERATOR ───────────────────────────────────────────────────────────

function candidateSlugs(name, domain) {
  const slugs = new Set();

  // From domain: stripe.com → stripe, squareup.com → squareup
  if (domain) {
    const domainBase = domain.replace(/^www\./, '').split('.')[0];
    slugs.add(domainBase);
    slugs.add(domainBase.replace(/-/g, ''));
  }

  // From name: "Square, Inc." → square, square-inc
  if (name) {
    const base = name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    slugs.add(base);
    // First word only (e.g. "stripe-inc" → "stripe")
    slugs.add(base.split('-')[0]);
    // No hyphens
    slugs.add(base.replace(/-/g, ''));
  }

  return [...slugs].filter(s => s && s.length >= 2 && s.length <= 60);
}

// ─── PROBE A SINGLE ATS FOR A COMPANY ────────────────────────────────────────

async function probeATS(ats, slugs) {
  for (const slug of slugs) {
    try {
      const res = await fetch(ats.url(slug), {
        signal: AbortSignal.timeout(PROBE_TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': ats.raw ? 'text/xml,application/xml' : 'application/json' },
      });
      if (res.status !== 200) continue;
      const content = ats.raw
        ? await res.text().catch(() => null)
        : await res.json().catch(() => null);
      if (content && ats.ok(content)) {
        return { slug, url: ats.url(slug), jobCount: countJobs(ats.name, content) };
      }
    } catch { /* timeout or network error — try next slug */ }
  }
  return null;
}

function countJobs(atsName, content) {
  if (atsName === 'Greenhouse') return content.jobs?.length || 0;
  if (atsName === 'Lever')      return content.length || 0;
  if (atsName === 'Ashby')      return content.jobPostings?.length || 0;
  if (atsName === 'Recruitee')  return content.offers?.length || 0;
  if (atsName === 'Breezy HR')  return content.length || 0;
  if (atsName === 'Eightfold')  return content.count || 0;
  if (atsName === 'BambooHR')   return content.result?.length || 0;
  if (atsName === 'Personio')   return (content.match(/<position /g) || []).length;
  return 0;
}

// ─── INSERT INTO DB2 ──────────────────────────────────────────────────────────

async function insertCompany(company, atsName, slug, apiEndpoint, existingDomains) {
  const domain = company.domain;
  if (existingDomains.has(domain)) return 'duplicate';

  if (DRY_RUN) {
    existingDomains.add(domain);
    return 'dry-run';
  }

  // Insert company
  const { data: inserted, error: companyErr } = await db2.from('companies').insert({
    name:       company.name,
    slug:       makeSlug(company.name),
    domain,
    website:    company.website || null,
    logo_url:   company.logo_url || null,
    sources:    ['ats_discovery'],
    is_active:  true,
  }).select('id').single();

  if (companyErr) {
    if (companyErr.code === '23505') {
      // Company already exists — fetch its ID
      const { data: existing } = await db2.from('companies').select('id').eq('domain', domain).single();
      if (!existing) return 'error';
      existingDomains.add(domain);
      await insertConfig(existing.id, company.website, atsName, apiEndpoint);
      return 'config-only';
    }
    return 'error';
  }

  existingDomains.add(domain);
  await insertConfig(inserted.id, company.website, atsName, apiEndpoint);
  return 'inserted';
}

async function insertConfig(companyId, careerUrl, atsName, apiEndpoint) {
  await db2.from('career_page_configs').insert({
    company_id:       companyId,
    career_page_url:  careerUrl || null,
    ats_provider:     atsName,
    source_type:      'api',
    api_endpoint:     apiEndpoint,
    is_verified:      true,
    consecutive_failures: 0,
    discovered_from:  'ats_discovery',
  }).select('id').single();
}

function makeSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 60);
}

// ─── LOAD EXISTING DB2 DOMAINS ───────────────────────────────────────────────

async function loadExistingDomains() {
  const domains = new Set();
  let offset = 0;
  while (true) {
    const { data } = await db2.from('companies').select('domain').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.domain) domains.add(r.domain);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return domains;
}

// ─── FETCH YC COMPANIES ───────────────────────────────────────────────────────

let YC_TOTAL_PAGES = 0;
let YC_TOTAL_COMPANIES = 0;

async function* fetchYCCompanies() {
  let page = START_PAGE;
  while (true) {
    let json = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await fetch(`https://api.ycombinator.com/v0.1/companies?page=${page}&per_page=100`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) break;
        json = await res.json();
        break;
      } catch (err) {
        if (attempt === 5) throw err;
        console.log(`\n  YC API error (attempt ${attempt}/5): ${err.message} — retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    if (!json || !json.companies || json.companies.length === 0) break;

    if (page === START_PAGE) {
      YC_TOTAL_PAGES = json.totalPages || 0;
      YC_TOTAL_COMPANIES = YC_TOTAL_PAGES * 100;
      const endPage = LIMIT ? Math.min(START_PAGE + Math.ceil(LIMIT / 100) - 1, YC_TOTAL_PAGES) : YC_TOTAL_PAGES;
      console.log(`  YC API: ${YC_TOTAL_PAGES} pages (~${YC_TOTAL_COMPANIES.toLocaleString()} companies)`);
      console.log(`  Range:  page ${START_PAGE} → ${endPage} (~${(endPage - START_PAGE + 1) * 100} companies)\n`);
    }

    for (const c of json.companies) {
      if (!c.website) continue;
      const domain = c.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase();
      yield { name: c.name, domain, website: c.website, logo_url: c.smallLogoUrl };
    }

    if (page >= json.totalPages) break;
    page++;
  }
}

// ─── FETCH EXISTING DB2 COMPANIES WITHOUT WORKING API ─────────────────────────

async function* fetchDB2Companies() {
  let offset = 0;
  while (true) {
    // Get companies that have career_page_configs with no api_endpoint
    const { data } = await db2.from('companies')
      .select('id, name, domain, website, logo_url')
      .range(offset, offset + 499);
    if (!data || data.length === 0) break;

    // For each, check if they already have a working api config
    const ids = data.map(c => c.id);
    const { data: configs } = await db2.from('career_page_configs')
      .select('company_id, api_endpoint')
      .in('company_id', ids)
      .not('api_endpoint', 'is', null);
    const hasApi = new Set((configs || []).map(c => c.company_id));

    for (const c of data) {
      if (!hasApi.has(c.id) && c.domain) {
        yield { name: c.name, domain: c.domain, website: c.website, logo_url: c.logo_url };
      }
    }

    if (data.length < 500) break;
    offset += 500;
  }
}

// ─── PROCESS COMPANIES IN PARALLEL ───────────────────────────────────────────

async function processCompanies(source, existingDomains) {
  const totals = { probed: 0, found: 0, inserted: 0, duplicate: 0, errors: 0 };
  const queue = [];

  const processOne = async (company) => {
    if (existingDomains.has(company.domain)) { totals.duplicate++; return; }
    const slugs = candidateSlugs(company.name, company.domain);
    totals.probed++;

    // Probe all ATS in parallel
    const results = await Promise.all(ATS_PROBES.map(ats => probeATS(ats, slugs)));

    for (let i = 0; i < ATS_PROBES.length; i++) {
      const hit = results[i];
      if (!hit) continue;

      totals.found++;
      const result = await insertCompany(company, ATS_PROBES[i].name, hit.slug, hit.url, existingDomains);
      if (result === 'inserted' || result === 'config-only' || result === 'dry-run') {
        totals.inserted++;
        console.log(`  ✓ ${ATS_PROBES[i].name.padEnd(16)} ${hit.slug.padEnd(30)} ${company.name.slice(0,40)} (${hit.jobCount} jobs)`);
      } else if (result === 'error') {
        totals.errors++;
      }
      break; // one ATS per company is enough
    }

    if (totals.probed % 100 === 0) {
      const pct = YC_TOTAL_COMPANIES ? ` (${Math.round(totals.probed / YC_TOTAL_COMPANIES * 100)}%)` : '';
      process.stdout.write(`\r  Checked: ${totals.probed.toLocaleString()}${pct} | Found: ${totals.found} | Inserted: ${totals.inserted}   `);
    }
  };

  // Batch processing with concurrency
  let batch = [];
  for await (const company of source) {
    if (LIMIT && totals.probed >= LIMIT) break;
    batch.push(company);
    if (batch.length >= CONCURRENCY) {
      await Promise.all(batch.map(processOne));
      batch = [];
      await new Promise(r => setTimeout(r, REQUEST_DELAY));
    }
  }
  if (batch.length) await Promise.all(batch.map(processOne));

  return totals;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════');
  console.log('COMPANY DISCOVERY');
  if (DRY_RUN) console.log('DRY RUN — no writes');
  if (LIMIT)   console.log(`LIMIT — ${LIMIT} companies`);
  console.log('══════════════════════════════════════════\n');

  console.log('Loading existing DB2 domains...');
  const existingDomains = await loadExistingDomains();
  console.log(`  ${existingDomains.size} companies already in DB2\n`);

  let totalFound = 0;

  if (!DB_ONLY) {
    console.log('── Source 1: Y Combinator (~23,500 companies) ──');
    if (DRY_RUN) console.log('DRY RUN — showing matches only\n');
    const t1 = await processCompanies(fetchYCCompanies(), existingDomains);
    console.log(`\n  Probed: ${t1.probed} | Found: ${t1.found} | Inserted: ${t1.inserted} | Errors: ${t1.errors}`);
    totalFound += t1.found;
  }

  if (!YC_ONLY) {
    console.log('\n── Source 2: Existing DB2 companies without API ──');
    const t2 = await processCompanies(fetchDB2Companies(), existingDomains);
    console.log(`\n  Probed: ${t2.probed} | Found: ${t2.found} | Inserted: ${t2.inserted} | Errors: ${t2.errors}`);
    totalFound += t2.found;
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`DONE — Total new ATS endpoints found: ${totalFound}`);

  if (!DRY_RUN) {
    const { count } = await db2.from('career_page_configs')
      .select('*', { count: 'exact', head: true })
      .eq('source_type', 'api')
      .eq('is_verified', true);
    console.log(`Total active API configs in DB2: ${count}`);
  }
}

run().catch(console.error);
