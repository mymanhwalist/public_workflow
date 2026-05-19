/**
 * migrate-to-db2.js
 * Migrates all data into new DB2 (buowaosqezcvdpdjcewq)
 *
 * Phase 1: DB1 companies        → new DB2 companies       (category: general)
 * Phase 2: remote100k_companies → new DB2 companies       (category: top500, merge if domain matches)
 * Phase 3: DB1 career_pages     → new DB2 career_page_configs (is_verified: true)
 * Phase 4: remote100k verified  → new DB2 career_page_configs (is_verified: true)
 *
 * Usage:
 *   node migrate-to-db2.js              → full migration
 *   node migrate-to-db2.js --phase=1    → only phase 1
 *   node migrate-to-db2.js --dry-run    → print counts, write nothing
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// ─── CREDENTIALS ────────────────────────────────────────────────────────────

const DB1_URL  = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const DB1_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const OLDDB2_URL = 'https://vmdbwpqopujirdcthgta.supabase.co';
const OLDDB2_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxMDcwMjIsImV4cCI6MjA4MjY4MzAyMn0.QwQKfGgiJEbU-3ztMSIXT5tFOska5CiBy9ZVmvea6KM';

const NEWDB2_URL = 'https://buowaosqezcvdpdjcewq.supabase.co';
const NEWDB2_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1b3dhb3NxZXpjdmRwZGpjZXdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1ODY1MCwiZXhwIjoyMDg5NzM0NjUwfQ.BU8tVARSBvEQRWstBQguKY5-U4NV3nhta5SOACQ2nnk';

const VERIFIED_JSON = './workflow/data/remote100k_verified_apis.json';
const BOILERPLATE   = 'Stop applying to jobs manually';
const BATCH_SIZE    = 200;

// ─── ARGS ────────────────────────────────────────────────────────────────────

const DRY_RUN   = process.argv.includes('--dry-run');
const phaseArg  = process.argv.find(a => a.startsWith('--phase='));
const ONLY_PHASE = phaseArg ? parseInt(phaseArg.split('=')[1]) : null;

const db1    = createClient(DB1_URL,    DB1_KEY);
const oldDb2 = createClient(OLDDB2_URL, OLDDB2_KEY);
const db2    = createClient(NEWDB2_URL, NEWDB2_KEY);

// ─── UTILS ───────────────────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return null;
  try {
    const u = url.startsWith('http') ? url : 'https://' + url;
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch { return null; }
}

function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function isBoilerplate(text) {
  return text && text.includes(BOILERPLATE);
}

async function fetchAllPages(client, table, selectCols, filters = []) {
  const rows = [];
  let offset = 0;
  while (true) {
    let q = client.from(table).select(selectCols).range(offset, offset + 999);
    for (const [col, op, val] of filters) {
      if (op === 'not.is') q = q.not(col, 'is', val);
      else if (op === 'eq')  q = q.eq(col, val);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return rows;
}

async function batchInsert(table, rows, onConflict = null) {
  if (DRY_RUN) { console.log(`  [dry-run] would insert ${rows.length} rows into ${table}`); return { inserted: rows.length, errors: 0 }; }
  let inserted = 0, errors = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    let q = db2.from(table);
    if (onConflict) {
      q = q.upsert(batch, { onConflict, ignoreDuplicates: false });
    } else {
      q = q.insert(batch);
    }
    const { error } = await q;
    if (error) {
      // Batch failed — fall back to row-by-row to salvage good rows
      for (const row of batch) {
        let rq = db2.from(table);
        if (onConflict) {
          rq = rq.upsert(row, { onConflict, ignoreDuplicates: false });
        } else {
          rq = rq.insert(row);
        }
        const { error: rowErr } = await rq;
        if (rowErr) errors++;
        else inserted++;
      }
    } else {
      inserted += batch.length;
    }
  }
  return { inserted, errors };
}

// ─── PHASE 1: DB1 companies → new DB2 companies ──────────────────────────────

async function migrateDB1Companies() {
  console.log('\n══════════════════════════════════════════');
  console.log('PHASE 1 — DB1 companies → DB2 companies');
  console.log('══════════════════════════════════════════');

  const raw = await fetchAllPages(db1, 'companies',
    'id,name,slug,website,logo_url,description,linkedin_url,headquarters,headquarters_country,year_founded,number_employees,industries');

  console.log(`Fetched ${raw.length} companies from DB1`);

  // Load existing DB2 slugs to avoid unique constraint conflicts
  const existingSlugRows = await fetchAllPages(db2, 'companies', 'slug');
  const existingSlugs = new Set(existingSlugRows.map(c => c.slug));

  const usedSlugs = new Set(existingSlugs);
  const rows = [];

  for (const c of raw) {
    const domain = extractDomain(c.website);
    if (!domain) continue; // skip — can't dedup without domain

    const baseslug = c.slug || toSlug(c.name);
    let slug = baseslug;
    let i = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseslug}-${i++}`;
    }
    usedSlugs.add(slug);

    rows.push({
      name:                 c.name,
      slug,
      domain,
      website:              c.website,
      logo_url:             c.logo_url || null,
      description:          c.description || null,
      linkedin_url:         c.linkedin_url || null,
      headquarters:         c.headquarters || null,
      headquarters_country: c.headquarters_country || null,
      founded_year:         c.year_founded || null,
      industry:             c.industries?.length ? c.industries : null,
      category:             'general',
      sources:              ['hiring_cafe'],
    });
  }

  // Dedup by domain — keep first occurrence
  const domainSeen = new Set();
  const deduped = rows.filter(r => {
    if (domainSeen.has(r.domain)) return false;
    domainSeen.add(r.domain);
    return true;
  });

  console.log(`Prepared ${deduped.length} rows (skipped ${raw.length - rows.length} no website, ${rows.length - deduped.length} duplicate domains)`);
  const result = await batchInsert('companies', deduped, 'domain');
  console.log(`✅ Inserted/updated ${result.inserted} companies, ${result.errors} errors`);
  return deduped.length;
}

// ─── PHASE 2: remote100k_companies → new DB2 companies ───────────────────────

async function migrateRemote100kCompanies() {
  console.log('\n══════════════════════════════════════════');
  console.log('PHASE 2 — remote100k_companies → DB2 companies');
  console.log('══════════════════════════════════════════');

  const raw = await fetchAllPages(oldDb2, 'remote100k_companies',
    'id,name,slug,website_url,logo_url,description,industry_array,company_size,hq_city,hq_country,linkedin_url,twitter_url');

  console.log(`Fetched ${raw.length} remote100k companies`);

  const slugCounts = new Map();
  const rows = [];

  for (const c of raw) {
    const domain = extractDomain(c.website_url) || `nositefound-${c.slug}`;
    const baseslug = c.slug || toSlug(c.name);
    const count = slugCounts.get(baseslug) || 0;
    const slug = count === 0 ? baseslug : `${baseslug}-${count + 1}`;
    slugCounts.set(baseslug, count + 1);

    const hq = [c.hq_city, c.hq_country].filter(Boolean).join(', ') || null;
    const description = isBoilerplate(c.description) ? null : (c.description || null);

    rows.push({
      name:                 c.name,
      slug,
      domain,
      website:              c.website_url || null,
      logo_url:             c.logo_url || null,
      description,
      linkedin_url:         c.linkedin_url || null,
      twitter_url:          c.twitter_url || null,
      headquarters:         hq,
      headquarters_country: c.hq_country || null,
      industry:             c.industry_array?.length ? c.industry_array : null,
      company_size:         c.company_size || null,
      category:             'top500',
      sources:              ['remote100k'],
    });
  }

  // Dedup by domain within remote100k too
  const domainSeen2 = new Set();
  const finalRows = rows.filter(r => {
    if (domainSeen2.has(r.domain)) return false;
    domainSeen2.add(r.domain);
    return true;
  });

  // Load existing slugs from new DB2 to avoid conflicts
  const existingSlugRows = await fetchAllPages(db2, 'companies', 'slug');
  const existingSlugs = new Set(existingSlugRows.map(c => c.slug));
  const batchSlugs = new Set();

  // Fix any slug conflicts
  for (const r of finalRows) {
    let slug = r.slug;
    let i = 2;
    while (existingSlugs.has(slug) || batchSlugs.has(slug)) {
      slug = `${r.slug}-${i++}`;
    }
    r.slug = slug;
    batchSlugs.add(slug);
  }

  console.log(`Prepared ${finalRows.length} rows (${rows.length - finalRows.length} duplicate domains removed)`);

  // Upsert: ON CONFLICT domain → merge enrichment + append source
  if (!DRY_RUN) {
    let inserted = 0, errors = 0;
    for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
      const batch = finalRows.slice(i, i + BATCH_SIZE);
      const { error } = await db2.from('companies')
        .upsert(batch, { onConflict: 'domain', ignoreDuplicates: false });
      if (error) {
        console.log(`  ⚠ batch error: ${error.message}`);
        errors += batch.length;
      } else {
        inserted += batch.length;
      }
    }
    console.log(`✅ Upserted ${inserted} remote100k companies, ${errors} errors`);
  } else {
    console.log(`  [dry-run] would upsert ${finalRows.length} rows`);
  }
}

// ─── PHASE 3: DB1 career_pages → new DB2 career_page_configs ─────────────────

async function migrateDB1Configs() {
  console.log('\n══════════════════════════════════════════');
  console.log('PHASE 3 — DB1 career_pages → DB2 career_page_configs');
  console.log('══════════════════════════════════════════');

  // Fetch DB1 career_pages with api_endpoint
  const careerPages = await fetchAllPages(db1, 'career_pages',
    'id,company_id,career_url,api_endpoint,api_endpoint_detail,ats_provider,last_jobs_scraped_at',
    [['api_endpoint', 'not.is', null]]);

  console.log(`Fetched ${careerPages.length} DB1 career pages with API endpoints`);

  // Fetch all DB1 companies to build domain → company_id map
  const db1Companies = await fetchAllPages(db1, 'companies', 'id,website');
  const db1DomainMap = new Map();
  for (const c of db1Companies) {
    const d = extractDomain(c.website);
    if (d) db1DomainMap.set(c.id, d);
  }

  // Fetch all new DB2 companies to build domain → new company_id map
  const newCompanies = await fetchAllPages(db2, 'companies', 'id,domain');
  const newDomainMap = new Map();
  for (const c of newCompanies) newDomainMap.set(c.domain, c.id);

  console.log(`New DB2 has ${newCompanies.length} companies`);

  // Track already-inserted api_endpoints to avoid duplicates
  const existingConfigs = await fetchAllPages(db2, 'career_page_configs', 'api_endpoint');
  const existingEndpoints = new Set(existingConfigs.map(c => c.api_endpoint));

  const rows = [];
  let skippedNoCompany = 0, skippedDuplicate = 0;

  for (const cp of careerPages) {
    const domain = db1DomainMap.get(cp.company_id);
    if (!domain) { skippedNoCompany++; continue; }

    const companyId = newDomainMap.get(domain);
    if (!companyId) { skippedNoCompany++; continue; }

    if (existingEndpoints.has(cp.api_endpoint)) { skippedDuplicate++; continue; }
    existingEndpoints.add(cp.api_endpoint);

    const isSitemap = cp.api_endpoint.includes('.xml') || cp.api_endpoint.toLowerCase().includes('sitemap');
    const sourceType = isSitemap ? 'sitemap' : 'api';

    rows.push({
      company_id:          companyId,
      career_page_url:     cp.career_url || null,
      ats_provider:        cp.ats_provider || null,
      source_type:         sourceType,
      api_endpoint:        sourceType === 'api' ? cp.api_endpoint : null,
      api_endpoint_detail: sourceType === 'api' ? (cp.api_endpoint_detail || null) : null,
      sitemap_url:         sourceType === 'sitemap' ? cp.api_endpoint : null,
      is_verified:         true,
      last_verified_at:    cp.last_jobs_scraped_at || null,
      discovered_from:     'hiring_cafe',
    });
  }

  console.log(`Prepared ${rows.length} configs`);
  console.log(`Skipped ${skippedNoCompany} (company not in DB2), ${skippedDuplicate} duplicates`);

  const result = await batchInsert('career_page_configs', rows);
  console.log(`✅ Inserted ${result.inserted} configs, ${result.errors} errors`);
}

// ─── PHASE 4: remote100k verified → new DB2 career_page_configs ──────────────

async function migrateRemote100kConfigs() {
  console.log('\n══════════════════════════════════════════');
  console.log('PHASE 4 — remote100k verified APIs → DB2 career_page_configs');
  console.log('══════════════════════════════════════════');

  const json = JSON.parse(readFileSync(VERIFIED_JSON, 'utf-8'));
  console.log(`Loaded ${json.working.length} verified endpoints from JSON`);

  // Build slug → domain map from old DB2 remote100k_companies
  const r100kCompanies = await fetchAllPages(oldDb2, 'remote100k_companies', 'slug,website_url');
  const slugDomainMap = new Map();
  for (const c of r100kCompanies) {
    const domain = extractDomain(c.website_url) || `nositefound-${c.slug}`;
    slugDomainMap.set(c.slug, domain);
  }

  // Fetch new DB2 companies for domain → id lookup
  const newCompanies = await fetchAllPages(db2, 'companies', 'id,domain');
  const newDomainMap = new Map();
  for (const c of newCompanies) newDomainMap.set(c.domain, c.id);

  // Existing configs to avoid duplicates
  const existingConfigs = await fetchAllPages(db2, 'career_page_configs', 'api_endpoint');
  const existingEndpoints = new Set(existingConfigs.map(c => c.api_endpoint));

  const rows = [];
  let skippedNoCompany = 0, skippedDuplicate = 0;

  for (const entry of json.working) {
    const domain = slugDomainMap.get(entry.company_slug);
    if (!domain) { skippedNoCompany++; continue; }

    const companyId = newDomainMap.get(domain);
    if (!companyId) { skippedNoCompany++; continue; }

    if (existingEndpoints.has(entry.api_endpoint)) { skippedDuplicate++; continue; }
    existingEndpoints.add(entry.api_endpoint);

    rows.push({
      company_id:          companyId,
      ats_provider:        entry.ats_provider,
      source_type:         'api',
      api_endpoint:        entry.api_endpoint,
      api_endpoint_detail: entry.api_endpoint_detail || null,
      is_verified:         true,
      last_verified_at:    json.generated_at,
      discovered_from:     'remote100k',
    });
  }

  console.log(`Prepared ${rows.length} configs`);
  console.log(`Skipped ${skippedNoCompany} (no matching company), ${skippedDuplicate} duplicates`);

  const result = await batchInsert('career_page_configs', rows);
  console.log(`✅ Inserted ${result.inserted} configs, ${result.errors} errors`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('DB2 MIGRATION');
  if (DRY_RUN) console.log('DRY RUN — no writes');
  if (ONLY_PHASE) console.log(`Only running phase ${ONLY_PHASE}`);
  console.log('══════════════════════════════════════════');

  const t0 = Date.now();

  try {
    if (!ONLY_PHASE || ONLY_PHASE === 1) await migrateDB1Companies();
    if (!ONLY_PHASE || ONLY_PHASE === 2) await migrateRemote100kCompanies();
    if (!ONLY_PHASE || ONLY_PHASE === 3) await migrateDB1Configs();
    if (!ONLY_PHASE || ONLY_PHASE === 4) await migrateRemote100kConfigs();
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Migration complete in ${elapsed}s`);

  // Final counts
  if (!DRY_RUN) {
    const { count: cc } = await db2.from('companies').select('*', { count: 'exact', head: true });
    const { count: cpc } = await db2.from('career_page_configs').select('*', { count: 'exact', head: true });
    console.log(`\nNew DB2 totals:`);
    console.log(`  companies:          ${cc}`);
    console.log(`  career_page_configs: ${cpc}`);
  }
}

main().catch(console.error);
