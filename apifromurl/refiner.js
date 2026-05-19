/**
 * refiner.js — Extract + promote raw_jobs → Main DB
 *
 * Reads:  DB2 raw_jobs WHERE status='pending'
 * Writes: Main DB companies, locations, jobs
 * Marks:  raw_jobs.status one of:
 *   'promoted'       — published to website
 *   'skipped_no_desc'— had no description (useless, never retry)
 *   'skipped_junk'   — junk/internal title (never retry)
 *   'skipped_stale'  — posted_date missing or older than 5 days (never retry)
 *   (location filter removed — global strategy, all countries accepted)
 *   stays 'pending'  — hit per-company cap this run (retry next run)
 *
 * 100% rule-based — no AI, no external APIs
 *
 * Usage:
 *   node refiner.js               → process all pending jobs
 *   node refiner.js --limit=50    → process first N jobs
 *   node refiner.js --dry-run     → print only, no writes
 */

import { createClient } from '@supabase/supabase-js';
import { US_CITY_STATE } from './us-city-state.js';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DB2_URL  = process.env.DB2_URL  || 'https://buowaosqezcvdpdjcewq.supabase.co';
const DB2_KEY  = process.env.DB2_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1b3dhb3NxZXpjdmRwZGpjZXdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1ODY1MCwiZXhwIjoyMDg5NzM0NjUwfQ.BU8tVARSBvEQRWstBQguKY5-U4NV3nhta5SOACQ2nnk';
const MAIN_URL = process.env.MAIN_DB_URL || 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = process.env.MAIN_DB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';
const DB1_URL  = process.env.DB1_URL  || 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const DB1_KEY  = process.env.DB1_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const BATCH_SIZE = 100;

const CUTOFF_24H = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const DRY_RUN       = process.argv.includes('--dry-run');
const limitArg      = process.argv.find(a => a.startsWith('--limit='));
const LIMIT         = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const maxPerCoArg   = process.argv.find(a => a.startsWith('--max-per-company='));
const MAX_PER_COMPANY = maxPerCoArg ? parseInt(maxPerCoArg.split('=')[1]) : 1;

const db2  = createClient(DB2_URL,  DB2_KEY);
const main = createClient(MAIN_URL, MAIN_KEY);
const db1  = createClient(DB1_URL,  DB1_KEY);

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════');
  console.log('REFINER — raw_jobs → Main DB');
  if (DRY_RUN) console.log('DRY RUN — no writes');
  console.log('══════════════════════════════════════════\n');

  // Load existing Main DB state into memory (for fast lookups)
  console.log('Loading Main DB state...');
  const { data: existingCompanies } = await main.from('companies').select('id, domain, slug');
  const { data: existingLocations } = await main.from('locations').select('id, display_name');

  // Load skills dictionary for matching — only skills with a real category (skip null and 'remove')
  let skillsMap = new Map(); // normalized slug → { id, name }
  let skillsOffset = 0;
  while (true) {
    const { data: batch } = await main.from('skills').select('id, name, slug, category')
      .not('category', 'is', null)
      .neq('category', 'remove')
      .range(skillsOffset, skillsOffset + 999);
    if (!batch || batch.length === 0) break;
    for (const s of batch) skillsMap.set(s.slug, s);
    if (batch.length < 1000) break;
    skillsOffset += 1000;
  }

  const companyByDomain = new Map((existingCompanies || []).map(c => [c.domain, c]));
  const locationByName  = new Map((existingLocations || []).map(l => [l.display_name, l]));
  const slugsUsed       = new Set((existingCompanies || []).map(c => c.slug));
  console.log(`  Companies in Main DB: ${companyByDomain.size}`);
  console.log(`  Locations in Main DB: ${locationByName.size}`);
  console.log(`  Skills loaded: ${skillsMap.size}\n`);

  // ── Pre-step: bulk-mark disqualified jobs directly in DB (no row fetching needed) ──
  // This clears the 84k backlog in a few DB queries instead of fetching everything into Node.
  if (!DRY_RUN) {
    const preTotals = { noDesc: 0, stale: 0 };

    // 1. No description → skipped_no_desc
    const { count: c1 } = await db2.from('raw_jobs')
      .update({ status: 'skipped_no_desc' }, { count: 'exact' })
      .eq('status', 'pending')
      .is('description', null);
    preTotals.noDesc = c1 || 0;

    // 2. No posted_date OR posted_date older than 5 days → skipped_stale
    const { count: c2 } = await db2.from('raw_jobs')
      .update({ status: 'skipped_stale' }, { count: 'exact' })
      .eq('status', 'pending')
      .is('posted_date', null);
    const { count: c3 } = await db2.from('raw_jobs')
      .update({ status: 'skipped_stale' }, { count: 'exact' })
      .eq('status', 'pending')
      .lt('posted_date', CUTOFF_24H);
    preTotals.stale = (c2 || 0) + (c3 || 0);

    console.log(`Pre-marked (DB-level, no fetch needed):`);
    console.log(`  skipped_no_desc: ${preTotals.noDesc}`);
    console.log(`  skipped_stale:   ${preTotals.stale}`);
    console.log(`  (remaining pending = only fresh jobs with descriptions)\n`);
  }

  // Fetch pending raw_jobs from DB2 in batches to avoid query timeout
  const FETCH_BATCH = 200;
  let rawJobs = [];
  let offset = 0;

  while (true) {
    let query = db2.from('raw_jobs')
      .select('*, companies(id, name, slug, domain, logo_url, sources), career_page_configs(ats_provider)')
      .eq('status', 'pending')
      .not('description', 'is', null)
      .order('first_seen_at', { ascending: false })
      .range(offset, offset + FETCH_BATCH - 1);

    const { data: batch, error } = await query;
    if (error) { console.error('Failed to load raw_jobs:', error.message); process.exit(1); }
    if (!batch || batch.length === 0) break;

    rawJobs = rawJobs.concat(batch);
    if (LIMIT && rawJobs.length >= LIMIT) { rawJobs = rawJobs.slice(0, LIMIT); break; }
    if (batch.length < FETCH_BATCH) break;
    offset += FETCH_BATCH;
  }

  console.log(`Pending jobs to process: ${rawJobs.length}\n`);

  const totals = { processed: 0, promoted: 0, skipped: 0, errors: 0 };
  const promotedPerCompany = {}; // company_id → count

  // Collect IDs by skip reason for bulk DB2 updates at the end
  const toMarkJunk   = []; // no title or junk title — never promotable
  const toMarkStale  = []; // stale jobs that slipped past pre-step (edge case)
  // company cap stays 'pending' — eligible again next run

  for (let i = 0; i < rawJobs.length; i++) {
    const job = rawJobs[i];
    const provider = job.career_page_configs?.ats_provider || 'Unknown';

    try {
      // 1. Extract all fields from raw_data
      const extracted = extractFields(job, provider);
      if (!extracted.title) { toMarkJunk.push(job.id); totals.skipped++; continue; }

      // Skip junk entries (internal referral programs, test postings, etc.)
      if (isJunkJob(extracted.title)) {
        if (DRY_RUN) console.log(`[${i+1}] SKIP (junk): ${extracted.title.substring(0,60)}`);
        toMarkJunk.push(job.id);
        totals.skipped++;
        continue;
      }

      // Freshness filter — only promote jobs posted within the last 5 days.
      // Only trust posted_date (all scraped providers are reliable-date ATS).
      const isFresh = job.posted_date && job.posted_date >= CUTOFF_24H;
      if (!isFresh) {
        toMarkStale.push(job.id);
        totals.skipped++;
        continue;
      }

      // Skip jobs with no location
      if (!extracted.location) {
        toMarkJunk.push(job.id);
        totals.skipped++;
        continue;
      }

      // 2. Extract skills from description
      const skillIds = extractSkills(job.description || '', skillsMap);

      // Per-company cap — stays 'pending' so it can be promoted in a future run
      const rawCompanyId = job.company_id || job.companies?.id;
      if (MAX_PER_COMPANY && rawCompanyId) {
        const count = promotedPerCompany[rawCompanyId] || 0;
        if (count >= MAX_PER_COMPANY) {
          totals.skipped++;
          continue;
        }
      }

      // 3. Find or create company in Main DB
      const companyId = await resolveCompany(job.companies, companyByDomain, slugsUsed);
      if (!companyId) { totals.skipped++; continue; }

      // 4. Find or create location in Main DB
      const locationId = await resolveLocation(extracted.location, locationByName);

      // 5. Generate unique job slug
      const slug = makeJobSlug(extracted.title, job.companies?.name || '', slugsUsed);
      slugsUsed.add(slug);

      // 7. Insert into Main DB
      if (!DRY_RUN) {
        const { error: insertErr, data: insertedJob } = await main.from('jobs').insert({
          company_id:          companyId,
          location_id:         locationId || null,
          title:               extracted.title,
          slug,
          description:         job.description || null,
          application_url:     job.application_url,
          job_type:            extracted.job_type,
          commitment_type:     extracted.commitment_type,
          experience_level:    extracted.experience_level,
          category:            extracted.category,
          salary_min:          extracted.salary_min,
          salary_max:          extracted.salary_max,
          salary_currency:     extracted.salary_currency,
          salary_period:       extracted.salary_period,
          posted_date:         job.posted_date || null,
          first_seen_at:       job.first_seen_at,
          last_seen_at:        job.last_seen_at,
          raw_job_id:          job.id,
          ats_provider:        provider,
          external_id:         job.external_id || null,
        }).select('id').single();

        if (insertErr) {
          if (insertErr.code === '23505') { totals.skipped++; continue; } // already exists
          throw insertErr;
        }

        // 8. Insert job_skills
        if (insertedJob && skillIds.length > 0) {
          const jobSkills = skillIds.map(skill_id => ({ job_id: insertedJob.id, skill_id }));
          await main.from('job_skills').upsert(jobSkills, { ignoreDuplicates: true });
        }

        // 9. Mark raw_job as promoted
        await db2.from('raw_jobs').update({
          status:       'promoted',
          is_promoted:  true,
          promoted_at:  new Date().toISOString()
        }).eq('id', job.id);

        totals.promoted++;
        if (rawCompanyId) promotedPerCompany[rawCompanyId] = (promotedPerCompany[rawCompanyId] || 0) + 1;
      } else {
        console.log(`[${i+1}] ${provider.padEnd(16)} | ${extracted.title.substring(0,40).padEnd(40)} | ${extracted.job_type || '-'} | ${extracted.experience_level || '-'} | ${extracted.category || '-'} | salary: ${extracted.salary_min ? '$'+extracted.salary_min+'-'+extracted.salary_max : '-'}`);
        totals.promoted++;
        if (rawCompanyId) promotedPerCompany[rawCompanyId] = (promotedPerCompany[rawCompanyId] || 0) + 1;
      }

      totals.processed++;
    } catch (err) {
      console.log(`  ❌ Error on job ${job.id}: ${err.message}`);
      totals.errors++;
    }

    if (!DRY_RUN && i % 100 === 0 && i > 0) {
      console.log(`  [${i}/${rawJobs.length}] promoted: ${totals.promoted} errors: ${totals.errors}`);
    }
  }

  // Bulk-mark skipped jobs in DB2 so they're never re-processed
  if (!DRY_RUN) {
    const CHUNK = 500;
    const bulkMark = async (ids, status) => {
      for (let i = 0; i < ids.length; i += CHUNK) {
        await db2.from('raw_jobs').update({ status }).in('id', ids.slice(i, i + CHUNK));
      }
    };
    if (toMarkJunk.length)  await bulkMark(toMarkJunk,  'skipped_junk');
    if (toMarkStale.length) await bulkMark(toMarkStale, 'skipped_stale');
  }

  // Final summary
  console.log('\n══════════════════════════════════════════');
  console.log('DONE');
  console.log(`Promoted:        ${totals.promoted}`);
  console.log(`Skipped total:   ${totals.skipped}`);
  console.log(`  → stale:       ${toMarkStale.length}`);
  console.log(`  → junk:        ${toMarkJunk.length}`);
  console.log(`  → company cap: ${totals.skipped - toMarkStale.length - toMarkJunk.length} (stays pending)`);
  console.log(`Errors:          ${totals.errors}`);
  console.log(`Companies:       ${Object.keys(promotedPerCompany).length} (max ${MAX_PER_COMPANY} jobs each)`);

  if (!DRY_RUN) {
    const { count } = await main.from('jobs').select('*', { count: 'exact', head: true });
    console.log(`\nMain DB jobs total: ${count}`);
  }
}

// ─── SKILL EXTRACTOR ──────────────────────────────────────────────────────────

function extractSkills(text, skillsMap) {
  if (!text || skillsMap.size === 0) return [];
  const stripped = text.replace(/<[^>]+>/g, ' ');
  const lower = stripped.toLowerCase();
  const found = [];
  for (const [slug, skill] of skillsMap) {
    const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Short names (≤3 chars like Go, R, SQL) must match exact case — avoids "go", "r" false positives
    const caseSensitive = skill.name.length <= 3;
    const src = caseSensitive ? stripped : lower;
    const pattern = caseSensitive ? escaped : escaped.toLowerCase();
    const re = new RegExp('(?<![a-z0-9])' + pattern + '(?![a-z0-9])', caseSensitive ? '' : 'i');
    if (re.test(src)) found.push(skill.id);
    if (found.length >= 8) break;
  }
  return found;
}

// ─── JUNK FILTER ──────────────────────────────────────────────────────────────

function isJunkJob(title) {
  if (!title) return true;
  const t = title.toLowerCase();
  // SmartRecruiters internal referral program entries
  if (/\binternal\b.*referral|referral program/i.test(title)) return true;
  // Generic SmartRecruiters housekeeping entries
  if (/^(custom sources?|employee referral|talent community|join our talent pool|general application)$/i.test(title.trim())) return true;
  return false;
}

// ─── EXTRACT FIELDS ───────────────────────────────────────────────────────────

function extractFields(job, provider) {
  const rd    = job.raw_data || {};
  const title = job.title || '';
  const desc  = job.description || '';

  let job_type        = null;
  let commitment_type = null;
  let experience_level = null;
  let category        = null;
  let location        = job.location_raw || null;
  let salary_min      = null;
  let salary_max      = null;
  let salary_currency = 'USD';
  let salary_period   = 'yearly';

  // ── Provider-specific extraction ──────────────────────────────────────────

  if (provider === 'Lever') {
    job_type         = normJobType(rd.workplaceType);
    commitment_type  = normCommitment(rd.categories?.commitment);
    category         = normCategory(rd.categories?.team || title);
    location         = rd.categories?.location || location;
  }

  if (provider === 'Ashby') {
    job_type         = rd.isRemote ? 'remote' : normJobType(rd.workplaceType);
    commitment_type  = normCommitment(rd.employmentType);
    category         = normCategory(rd.team || title);
    if (!location) location = rd.locationName || rd.location || (rd.isRemote ? 'Remote' : null);
  }

  if (provider === 'SmartRecruiters') {
    const loc        = rd.location || {};
    job_type         = loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : loc.city ? 'onsite' : null;
    commitment_type  = normCommitment(rd.typeOfEmployment?.label);
    // Skip rd.experienceLevel.label — SmartRecruiters labels are often wrong (e.g. "Entry" for Sr roles)
    // Let the title-based fallback handle it instead
    // Try function.label first; if it resolves to "Other", fall back to title
    const catFromLabel = rd.function?.label ? normCategory(rd.function.label) : null;
    category = (catFromLabel && catFromLabel !== 'Other') ? catFromLabel : normCategory(title);
  }

  if (provider === 'Breezy HR') {
    commitment_type  = normCommitment(rd.type?.name || rd.type?.id);
    category         = normCategory(rd.department || title);
    const salParsed  = parseSalary(rd.salary);
    if (salParsed) {
      salary_min      = salParsed.min;
      salary_max      = salParsed.max;
      salary_currency = salParsed.currency;
      salary_period   = salParsed.period;
    }
  }

  if (provider === 'BambooHR') {
    commitment_type  = normCommitment(rd.employmentType);
    category         = normCategory(rd.department?.label || title);
    if (!location) {
      location = [rd.location?.city, rd.location?.state].filter(Boolean).join(', ')
                 || rd.location?.country || null;
    }
  }

  if (provider === 'Personio') {
    commitment_type  = normCommitment(rd.schedule || rd.employmentType);
    category         = normCategory(rd.department || rd.occupationCategory || title);
    if (!location) location = rd.office || null;
  }

  if (provider === 'Greenhouse') {
    category         = normCategory(rd.departments?.[0]?.name || title);
    if (!location) location = rd.offices?.[0]?.location?.name || rd.offices?.[0]?.name || null;
    // Greenhouse metadata sometimes has contract type
    const meta = rd.metadata || [];
    for (const m of meta) {
      if (/contract|employment|type/i.test(m.name) && m.value) {
        commitment_type = normCommitment(m.value);
      }
    }
  }

  // ── Shared fallback extractors (run on title + description) ───────────────

  if (!job_type)         job_type         = extractJobTypeFromText(title + ' ' + desc);
  if (!commitment_type)  commitment_type  = extractCommitmentFromText(title + ' ' + desc);
  if (!experience_level) experience_level = extractExperienceFromText(title, desc);
  if (!category)         category         = normCategory(title);
  if (!salary_min) {
    const salParsed = parseSalary(desc + ' ' + title);
    if (salParsed) {
      salary_min      = salParsed.min;
      salary_max      = salParsed.max;
      salary_currency = salParsed.currency;
      salary_period   = salParsed.period;
    }
  }

  return {
    title,
    job_type,
    commitment_type,
    experience_level,
    category,
    location,
    salary_min,
    salary_max,
    salary_currency,
    salary_period,
  };
}

// ─── NORMALIZERS ─────────────────────────────────────────────────────────────

function normJobType(val) {
  if (!val || typeof val !== 'string') return null;
  const v = val.toLowerCase();
  if (v.includes('remote'))  return 'remote';
  if (v.includes('hybrid'))  return 'hybrid';
  if (v.includes('onsite') || v.includes('on-site') || v.includes('office') || v.includes('in-person')) return 'onsite';
  return null;
}

function normCommitment(val) {
  if (!val || typeof val !== 'string') return null;
  const v = val.toLowerCase().replace(/[-_]/g, ' ');
  if (v.includes('full'))       return 'full_time';
  if (v.includes('part'))       return 'part_time';
  if (v.includes('contract') || v.includes('freelance')) return 'contract';
  if (v.includes('intern'))     return 'internship';
  if (v.includes('temporary') || v.includes('temp')) return 'contract';
  if (v.includes('permanent'))  return 'full_time';
  return null;
}

function normExperience(val) {
  if (!val || typeof val !== 'string') return null;
  const v = val.toLowerCase();
  if (v.includes('entry') || v.includes('junior') || v.includes('associate')) return 'entry';
  if (v.includes('mid') || v.includes('intermediate'))                         return 'mid';
  if (v.includes('senior') || v.includes('sr.') || v.includes('sr '))         return 'senior';
  if (v.includes('lead') || v.includes('staff') || v.includes('principal'))   return 'lead';
  if (v.includes('director') || v.includes('vp') || v.includes('head') || v.includes('chief') || v.includes('executive')) return 'executive';
  return null;
}

function normCategory(val) {
  if (!val || typeof val !== 'string') return null;
  const v = val.toLowerCase();

  // Engineering & Tech
  if (/engineer|develop|programm|software|frontend|backend|fullstack|devops|sre|platform|mobile|ios|android|cloud|\bml\b|machine learning|infrastructure|architect|information technology|\bqa\b|quality assurance|test automation|integration specialist|systems admin|it support|it manager|helpdesk/.test(v)) return 'Engineering';

  // Design
  if (/\bdesign\b|\bux\b|\bui\b|graphic|motion|illustrat|figma|creative direct/.test(v)) return 'Design';

  // Healthcare (before Research — clinical/medical roles, not scientists)
  if (/\bnurs\b|\bdoctor\b|\bphysician\b|\bsurgeon\b|dentist|dental|therapist|pharmacist|healthcare|health care|patient care|caregiver|paramedic|radiolog|veterinar|immunis|immuniz|medical officer|anaesth|obstetric|midwif|optometr|dietitian|audiolog|occupational health|\bbehavior analyst\b/.test(v)) return 'Healthcare';

  // Product Management
  if (/product manager|product owner|product director|product lead|head of product|vp of product|chief product|product management/.test(v)) return 'Product';

  // Project / Program Management
  if (/project manager|programme manager|program manager|delivery manager|scrum master|agile coach|\bpmo\b|project lead/.test(v)) return 'Project Management';

  // Marketing & Communications
  if (/market|growth hacker|\bseo\b|\bsem\b|social media|demand gen|campaign|brand manager|brand director|brand strateg|content strateg|communications|public relation/.test(v)) return 'Marketing';

  // Sales & Business Development
  if (/\bsales\b|account exec|account manag|business dev|business development|\bbdr\b|\bsdr\b|revenue|pre-sales|presales|client partner|client solution/.test(v)) return 'Sales';

  // Data & Analytics
  if (/data science|data analyst|data engineer|\banalytics\b|business intelligence|\bbi\b|reporting analyst|data warehouse|\betl\b|database admin/.test(v)) return 'Data';

  // Finance & Accounting
  if (/financ|accountant|accounting|payroll|\btax\b|\baudit\b|controller|\bcfo\b|bookkeep|treasurer|fp&a|financial plan|underwriter|actuar|credit analyst|\baml\b|anti.money/.test(v)) return 'Finance';

  // HR & People
  if (/\bhr\b|human resource|recruiter|recruiting|talent acqui|talent manag|people ops|people partner|people & org|compensation|benefit|workforce/.test(v)) return 'HR';

  // Legal & Compliance
  if (/\blegal\b|compliance|counsel|attorney|solicitor|paralegal|privacy|gdpr|regulatory affairs/.test(v)) return 'Legal';

  // Customer Support & Service
  if (/customer success|customer support|customer experience|customer service|customer care|support agent|helpdesk|client service/.test(v)) return 'Customer Support';

  // Security
  if (/security|infosec|cybersec|\bsoc\b|penetration|threat intel|vulnerability|\bsiem\b|identity access/.test(v)) return 'Security';

  // Research & Science
  if (/research|scientist|\bphd\b|laboratory|scientific|genomic|biolog|chemi|physicist|\br&d\b/.test(v)) return 'Research';

  // Hospitality & Food Service
  if (/\bchef\b|\bcook\b|culinary|hospitality|restaurant|\bhotel\b|kitchen|catering|barista|bartender|sommelier|food.beverage/.test(v)) return 'Hospitality';

  // Retail & Merchandise
  if (/\bretail\b|cashier|store associate|shop assistant|visual merchandis|store manager|shop manager/.test(v)) return 'Retail';

  // Admin & Executive Support
  if (/secretary|receptionist|administrative assist|personal assist|executive assist|office manager|office admin|\bclerk\b|data entry/.test(v)) return 'Admin';

  // Creative & Content
  if (/\bwriter\b|\beditor\b|copywriter|journalist|content creat|scriptwriter|technical writer|game design|gameplay|unreal engine|unity engine|\bproducer\b/.test(v)) return 'Creative';

  // Operations & Logistics
  if (/operations|supply chain|logistics|procurement|warehouse|fleet|dispatch|fulfillment|distribution/.test(v)) return 'Operations';

  // Executive / Leadership
  if (/\bceo\b|\bcoo\b|\bcto\b|\bcfo\b|\bcpo\b|chief.*officer|vice president|general manager|managing director/.test(v)) return 'Executive';

  return 'Other';
}

// ─── TEXT-BASED FALLBACK EXTRACTORS ──────────────────────────────────────────

function extractJobTypeFromText(text) {
  const t = text.toLowerCase();
  if (/\bremote\b|work from home|fully remote|wfh\b/.test(t))         return 'remote';
  if (/\bhybrid\b/.test(t))                                            return 'hybrid';
  if (/\bonsite\b|\bon-site\b|\bin.office\b|\bin person\b/.test(t))   return 'onsite';
  return null;
}

function extractCommitmentFromText(text) {
  const t = text.toLowerCase();
  if (/full.time|fulltime/.test(t))                                    return 'full_time';
  if (/part.time|parttime/.test(t))                                    return 'part_time';
  if (/\bcontract\b|\bfreelance\b/.test(t))                            return 'contract';
  if (/\bintern(ship)?\b/.test(t))                                     return 'internship';
  return null;
}

function extractExperienceFromText(title, desc) {
  const t = (title || '').toLowerCase();
  const d = (desc  || '').toLowerCase();

  // ── Title-only signals (most reliable, no false positives) ────────────────
  if (/\b(chief|ceo|coo|cto|cfo|cpo|president|vice president|\bvp\b|svp|evp)\b/.test(t))  return 'executive';
  if (/\b(director|head of|managing director|general manager)\b/.test(t))                  return 'executive';
  if (/\b(staff engineer|principal |senior lead|lead [a-z])/i.test(title))                return 'lead';
  if (/\bsenior\b|\bsr\.?\s|\bsr\b/.test(t))                                               return 'senior';
  if (/\b(manager|management)\b/.test(t))                                                  return 'senior';
  if (/\b(junior|jr\.?\s|\bjr\b|entry.level|entry level|graduate)\b/.test(t))             return 'entry';
  if (/\b(intern(ship)?|trainee|apprentice|student worker|werkstudent|stagiai)\b/.test(t)) return 'entry';
  if (/\b(associate|coordinator|specialist|consultant|advisor|analyst)\b/.test(t))        return 'mid';

  // ── Description: years of experience required (very specific phrase) ──────
  const yearsMatches = [...d.matchAll(/(\d+)\+?\s*(?:to\s*(\d+)\s*)?years?\s*(?:of\s*)?(?:relevant\s*)?(?:experience|exp\.?)/g)];
  if (yearsMatches.length > 0) {
    const yrs = parseInt(yearsMatches[0][1]);
    if (yrs <= 1)  return 'entry';
    if (yrs <= 3)  return 'mid';
    if (yrs <= 6)  return 'senior';
    if (yrs > 6)   return 'lead';
  }

  // ── Description: explicit level phrases only ──────────────────────────────
  if (/\b(entry.level|entry level|no experience required|0.1 years)\b/.test(d)) return 'entry';
  if (/\b(mid.level|intermediate level|experienced professional)\b/.test(d))     return 'mid';
  if (/\b(senior.level|senior position|senior role)\b/.test(d))                  return 'senior';

  return null;
}

// ─── SALARY PARSER ────────────────────────────────────────────────────────────

function parseSalary(text) {
  if (!text || typeof text !== 'string') return null;

  const patterns = [
    // $120k - $150k / £50k-£70k
    { re: /([£$€])(\d+(?:\.\d+)?)k?\s*[-–to]+\s*[£$€]?(\d+(?:\.\d+)?)k/i, fn: (m) => ({ currency: currencyFromSymbol(m[1]), min: Math.round(parseFloat(m[2]) * (m[2].includes('k') || parseFloat(m[2]) < 1000 ? 1000 : 1)), max: Math.round(parseFloat(m[3]) * 1000), period: 'yearly' }) },
    // $120,000 - $150,000
    { re: /([£$€])(\d{2,3}),(\d{3})\s*[-–to]+\s*[£$€]?(\d{2,3}),(\d{3})/i, fn: (m) => ({ currency: currencyFromSymbol(m[1]), min: parseInt(m[2]+m[3]), max: parseInt(m[4]+m[5]), period: 'yearly' }) },
    // $45/hr or $45 per hour
    { re: /([£$€])(\d+(?:\.\d+)?)\s*(?:\/hr|per hour|\/hour)/i, fn: (m) => ({ currency: currencyFromSymbol(m[1]), min: Math.round(parseFloat(m[2])), max: Math.round(parseFloat(m[2])), period: 'hourly' }) },
    // Single value: $120k
    { re: /([£$€])(\d+)k/i, fn: (m) => ({ currency: currencyFromSymbol(m[1]), min: parseInt(m[2]) * 1000, max: parseInt(m[2]) * 1000, period: 'yearly' }) },
    // $750.00 (Breezy HR style)
    { re: /([£$€])(\d+\.\d{2})/, fn: (m) => ({ currency: currencyFromSymbol(m[1]), min: Math.round(parseFloat(m[2])), max: Math.round(parseFloat(m[2])), period: 'yearly' }) },
  ];

  for (const { re, fn } of patterns) {
    const m = text.match(re);
    if (m) {
      try { return fn(m); } catch { continue; }
    }
  }
  return null;
}

function currencyFromSymbol(sym) {
  if (sym === '£') return 'GBP';
  if (sym === '€') return 'EUR';
  return 'USD';
}

// ─── RESOLVE COMPANY ──────────────────────────────────────────────────────────

async function resolveCompany(db2Company, companyByDomain, slugsUsed) {
  if (!db2Company) return null;

  let domain = db2Company.domain;
  // Invalid domain (too short, no dot, or N/A artifacts) — derive from slug/name instead
  if (!domain || domain.length < 4 || !domain.includes('.')) {
    domain = db2Company.slug || makeSlug(db2Company.name, new Set());
  }

  // Already in Main DB?
  if (companyByDomain.has(domain)) return companyByDomain.get(domain).id;

  // Enrich from DB1
  let enrichment = {};
  try {
    const { data: db1Companies } = await db1.from('companies')
      .select('linkedin_url, year_founded, number_employees, industries, funding_stage, is_public, headquarters, headquarters_country, description')
      .ilike('website', '%' + domain + '%')
      .limit(1);
    if (db1Companies?.[0]) enrichment = db1Companies[0];
  } catch { /* enrichment optional */ }

  const slug = makeSlug(db2Company.name, slugsUsed);
  slugsUsed.add(slug);

  if (!DRY_RUN) {
    const { data: inserted, error } = await main.from('companies').insert({
      name:                 db2Company.name,
      slug,
      domain,
      logo_url:             db2Company.logo_url || null,
      linkedin_url:         enrichment.linkedin_url || null,
      year_founded:         enrichment.year_founded || null,
      employee_count:       enrichment.number_employees || null,
      industries:           enrichment.industries || null,
      funding_stage:        enrichment.funding_stage || null,
      is_public:            enrichment.is_public || false,
      headquarters:         enrichment.headquarters || null,
      headquarters_country: enrichment.headquarters_country || null,
      description:          enrichment.description || null,
      sources:              db2Company.sources || [],
    }).select('id').single();

    if (error) {
      if (error.code === '23505') {
        // Inserted by a concurrent run — fetch it
        const { data: existing } = await main.from('companies').select('id').eq('domain', domain).single();
        if (existing) { companyByDomain.set(domain, existing); return existing.id; }
      }
      return null;
    }
    companyByDomain.set(domain, inserted);
    return inserted.id;
  }

  return 'dry-run-company-id';
}

// ─── RESOLVE LOCATION ─────────────────────────────────────────────────────────

async function resolveLocation(locationRaw, locationByName) {
  if (!locationRaw) return null;

  const parsed  = parseLocation(locationRaw);
  const display = parsed.display_name;

  if (locationByName.has(display)) return locationByName.get(display).id;

  if (!DRY_RUN) {
    const { data: inserted, error } = await main.from('locations').insert(parsed).select('id').single();
    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await main.from('locations').select('id').eq('display_name', display).single();
        if (existing) { locationByName.set(display, existing); return existing.id; }
      }
      return null;
    }
    locationByName.set(display, inserted);
    return inserted.id;
  }

  return 'dry-run-location-id';
}

function preProcessLocation(raw) {
  let s = raw.trim();
  if (/home.?based/i.test(s)) return 'Remote';

  // Strip trailing zip codes
  s = s.replace(/,?\s*\b\d{5}(?:-\d{4})?\b\s*$/, '').trim();

  // Street address "123 Street Name, City, ST" → extract city after street suffix, or drop first segment
  if (/^\d+\s+\w/.test(s) && s.includes(',')) {
    const parts = s.split(',');
    const firstPart = parts[0];
    // City embedded after suffix: "5600 3rd St. San Francisco" → "San Francisco"
    const afterSuffix = firstPart.match(/\b(?:St\.?|Street|Ave\.?|Avenue|Blvd\.?|Boulevard|Dr\.?|Drive|Rd\.?|Road|Way|Ln\.?|Lane|Ct\.?|Court|Pl\.?|Place|Pkwy\.?|Parkway|Hwy\.?|Highway|Loop|Trl\.?|Trail|NW|NE|SW|SE)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/);
    if (afterSuffix && parts.length > 1) {
      parts[0] = afterSuffix[1];
      s = parts.join(',');
    } else {
      s = parts.slice(1).join(',').trim();
    }
    s = s.replace(/,?\s*\b\d{5}(?:-\d{4})?\b\s*$/, '').trim();
  }

  // Strip work-mode parentheticals: (Hybrid), (Remote), (On-site), etc.
  s = s.replace(/\s*\([^)]*(?:hybrid|remote|on.?site|in\s*office|flex)[^)]*\)/gi, '').trim();
  s = s.replace(/\s+in\s+office.*$/i, '').trim();

  // "[Hybrid/Remote] - City" → "City"
  s = s.replace(/^(?:hybrid|remote|on.?site)\s*[-–]\s*/i, '').trim();

  // "[XX] Office [City]" e.g. "IN Office Bangalore" → "Bangalore, IN"
  const codeOfficeCity = s.match(/^([A-Z]{2})\s+[Oo]ffice\s+(.+)$/);
  if (codeOfficeCity) return codeOfficeCity[2].trim() + ', ' + codeOfficeCity[1];

  // Strip trailing " Office" or " - HQ" suffixes
  s = s.replace(/\s+[Oo]ffice\s*$/, '').trim();
  s = s.replace(/\s*[-–]\s*(?:hq|headquarters|main\s+office|office)\s*$/i, '').trim();

  // Handle "A - B" (SPACES required around dash — avoids splitting hyphenated city names)
  const dashMatch = s.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (dashMatch) {
    const before   = dashMatch[1].trim();
    const after    = dashMatch[2].trim();
    const beforeLo = before.toLowerCase();
    const looksLikeCountry = ['france','italy','germany','spain','ireland','mexico','india',
      'uk','usa','us','united states','united kingdom','australia','canada','brazil',
      'netherlands','poland','portugal','switzerland','belgium','austria','sweden',
      'norway','denmark','finland','new zealand','south africa'].includes(beforeLo);
    if (looksLikeCountry) {
      let city = after.replace(/\s+[Oo]ffice\s*$/i, '').trim();
      const stateTrail = city.match(/^(.+?)\s+([A-Z]{2})\s*$/);
      if (stateTrail) return stateTrail[1].trim() + ', ' + stateTrail[2] + ', ' + before;
      return city + ', ' + before;
    } else {
      return before;
    }
  }

  return s;
}

function parseLocation(raw) {
  if (!raw) return { display_name: 'Unknown', country: 'US', is_remote: false };

  const t = raw.toLowerCase().trim();

  if (/\bremote\b/.test(t)) return { display_name: 'Remote', country: 'US', is_remote: true };

  const preprocessed = preProcessLocation(raw);
  if (preprocessed === 'Remote') return { display_name: 'Remote', country: 'US', is_remote: true };

  // Clean up [object Object] artifacts from Breezy HR
  const cleaned = preprocessed.replace(/,?\s*\[object Object\]/g, '').trim();

  // Parse "City, ST" or "City, Country"
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);

  const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
  const US_STATE_NAMES = { 'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY','district of columbia':'DC' };
  const COUNTRY_CODES = new Set(['us','uk','gb','de','fr','ca','au','in','nl','sg','jp','br','mx','pl','es','it','se','no','dk','fi','ch','be','at','pt','ie','nz','za','ae','tr','il','kr','hk','tw','uz','ua','mt','ph','ng','ke','gh','rw','et','eg','ma','pk','bd','lk','mm','th','vn','id','my','ro','cz','gr','ar','cl','co','pe','ve','ec','gt','cr','pa','do','pr','cu','jm','tt','bo','py','uy','hn','sv','ni','bz','gy','sr','ge','am','az','kz','kg','tj','tm','mn','np','af','ir','iq','sa','jo','lb','sy','ye','om','kw','bh','qa','ly','tn','dz','sd','so','tz','ug','mz','zm','zw','bw','na','mw','mg','ci','cm','sn','ml','bf','ne','td','cg','ao','rw','bi','mz','ls','sz','er','dj']);
  const FULL_COUNTRY_NAMES = {
    'united states':'US','united states of america':'US','usa':'US',
    'united kingdom':'GB','great britain':'GB','england':'GB','scotland':'GB','wales':'GB',
    'ukraine':'UA','india':'IN','germany':'DE','france':'FR','canada':'CA','australia':'AU',
    'brazil':'BR','mexico':'MX','spain':'ES','italy':'IT','netherlands':'NL','holland':'NL',
    'singapore':'SG','poland':'PL','sweden':'SE','portugal':'PT','switzerland':'CH',
    'belgium':'BE','austria':'AT','ireland':'IE','denmark':'DK','norway':'NO','finland':'FI',
    'israel':'IL','turkey':'TR','south korea':'KR','korea':'KR','hong kong':'HK','taiwan':'TW',
    'new zealand':'NZ','south africa':'ZA','greece':'GR','romania':'RO','czech republic':'CZ',
    'czechia':'CZ','hungary':'HU','slovakia':'SK','croatia':'HR','serbia':'RS','bulgaria':'BG',
    'lithuania':'LT','latvia':'LV','estonia':'EE','slovenia':'SI','luxembourg':'LU',
    'malta':'MT','cyprus':'CY','iceland':'IS',
    'united arab emirates':'AE','uae':'AE','dubai':'AE','abu dhabi':'AE',
    'saudi arabia':'SA','ksa':'SA','qatar':'QA','kuwait':'KW','bahrain':'BH','oman':'OM',
    'jordan':'JO','lebanon':'LB','egypt':'EG','morocco':'MA','tunisia':'TN','algeria':'DZ',
    'nigeria':'NG','kenya':'KE','ghana':'GH','ethiopia':'ET','tanzania':'TZ','uganda':'UG',
    'south africa':'ZA','zimbabwe':'ZW','zambia':'ZM','mozambique':'MZ','angola':'AO',
    'cameroon':'CM','senegal':'SN','ivory coast':'CI',"cote d'ivoire":'CI',
    'rwanda':'RW','mali':'ML','burkina faso':'BF',
    'pakistan':'PK','bangladesh':'BD','sri lanka':'LK','nepal':'NP','afghanistan':'AF',
    'myanmar':'MM','burma':'MM','thailand':'TH','vietnam':'VN','viet nam':'VN',
    'indonesia':'ID','malaysia':'MY','philippines':'PH','cambodia':'KH','laos':'LA',
    'china':'CN','japan':'JP','mongolia':'MN',
    'argentina':'AR','chile':'CL','colombia':'CO','peru':'PE','venezuela':'VE',
    'ecuador':'EC','bolivia':'BO','paraguay':'PY','uruguay':'UY',
    'guatemala':'GT','costa rica':'CR','panama':'PA','dominican republic':'DO',
    'puerto rico':'PR','cuba':'CU','jamaica':'JM',
    'uzbekistan':'UZ','kazakhstan':'KZ','georgia':'GE','armenia':'AM','azerbaijan':'AZ',
    'russia':'RU','belarus':'BY','moldova':'MD',
  };

  let city = null, state = null, country = null, countryCode = null;

  if (parts.length >= 2) {
    city = parts[0];
    const second = parts[1].trim();
    const secondUp = second.toUpperCase();
    const secondLo = second.toLowerCase();

    // Ambiguous 2-letter codes: both a US state AND a country code.
    // defaultToUS:true  → `cities` = foreign cities; unknown city → US state
    // defaultToUS:false → `cities` = US cities (tiny state); unknown city → country
    const AMBIGUOUS = {
      CA: { country: 'CA', defaultToUS: true,  cities: new Set(['toronto','vancouver','montreal','calgary','ottawa','edmonton','winnipeg','hamilton','kitchener','waterloo','london','halifax','victoria','saskatoon','regina','kelowna','barrie','guelph','abbotsford','surrey','burnaby','richmond','mississauga','brampton','oshawa','lethbridge','red deer','medicine hat','grande prairie','sherwood park','kamloops','prince george','moncton','fredericton','saint john','charlottetown','whitehorse','yellowknife','iqaluit','markham','vaughan','pickering','ajax','newmarket','aurora','richmond hill','oakville','burlington','st catharines','niagara falls','windsor','kingston','sudbury','thunder bay','nanaimo','prince albert']) },
      CO: { country: 'CO', defaultToUS: true,  cities: new Set(['bogota','bogotá','medellin','medellín','cali','barranquilla','cartagena','cucuta','cúcuta','bucaramanga','pereira','santa marta','manizales','ibague','ibagué','envigado','bello','itagüi','palmira','armenia','villavicencio','soacha','pasto','neiva','montería','sincelejo','valledupar','tunja','riohacha']) },
      IN: { country: 'IN', defaultToUS: true,  cities: new Set(['mumbai','delhi','new delhi','bangalore','bengaluru','hyderabad','ahmedabad','chennai','kolkata','surat','pune','jaipur','lucknow','kanpur','nagpur','visakhapatnam','bhopal','patna','ludhiana','agra','nashik','vadodara','faridabad','meerut','rajkot','noida','gurgaon','gurugram','thane','navi mumbai','kochi','indore','coimbatore','bhubaneswar','chandigarh','mysore','mysuru','trichy','tiruchirappalli','jabalpur','gwalior','vijayawada','jodhpur','raipur','kota','guwahati','thiruvananthapuram','trivandrum','amritsar','ranchi','howrah']) },
      DE: { country: 'DE', defaultToUS: false, cities: new Set(['wilmington','dover','newark','middletown','smyrna','milford','lewes','georgetown','seaford','bridgeville','claymont','bear','elsmere','edgemoor']) },
      GA: { country: 'GE', defaultToUS: true,  cities: new Set(['tbilisi','kutaisi','batumi','rustavi','zugdidi','gori','poti','telavi','akhaltsikhe','ozurgeti','senaki','zestafoni','marneuli']) },
      MT: { country: 'MT', defaultToUS: true,  cities: new Set(['valletta','birkirkara','qormi','mosta','zabbar','fgura','zejtun','sliema','st julians','paola','hamrun','swieqi','naxxar','mellieha','rabat','mdina','victoria','san gwann','msida','gzira','marsaskala','marsaxlokk','birgu','senglea']) },
      IL: { country: 'IL', defaultToUS: true,  cities: new Set(['tel aviv','jerusalem','haifa','rishon lezion','petah tikva','ashdod','netanya','beer sheva','beersheba','holon','bnei brak','bat yam','rehovot','ashkelon','herzliya','kfar saba','modiin','ramat gan','lod','raanana','ramat hasharon','givatayim','kiryat gat','nazareth','eilat','rishon le-zion','rishon le zion']) },
      ID: { country: 'ID', defaultToUS: true,  cities: new Set(['jakarta','surabaya','bandung','bekasi','medan','tangerang','depok','semarang','palembang','makassar','batam','bogor','pekanbaru','bandar lampung','malang','padang','denpasar','samarinda','tasikmalaya','pontianak','balikpapan','cimahi','yogyakarta','mataram','banjarmasin','manado','jayapura','ambon','kupang','kendari','gorontalo','ternate','sorong']) },
    };

    if (parts.length >= 3) {
      // "City, State, Country" — third part is country
      city  = parts[0];
      const stateAbbr = US_STATE_NAMES[secondLo] || (US_STATES.has(secondUp) ? secondUp : null);
      state = stateAbbr || null;
      const third = parts[2].trim();
      const thirdLo = third.toLowerCase();
      if (FULL_COUNTRY_NAMES[thirdLo]) {
        country = FULL_COUNTRY_NAMES[thirdLo];
      } else if (COUNTRY_CODES.has(thirdLo)) {
        countryCode = thirdLo;
        country = countryCode.toUpperCase() === 'UK' ? 'GB' : countryCode.toUpperCase();
      } else {
        country = third;
      }
    } else if (US_STATE_NAMES[secondLo]) {
      // Full state name e.g. "Des Moines, Iowa"
      state = US_STATE_NAMES[secondLo];
      country = 'US';
    } else if (secondUp in AMBIGUOUS) {
      // 3-tier disambiguation for ambiguous 2-letter codes:
      // 1. DB1 city lookup (3643 real US cities) → confirmed US state
      // 2. Foreign city whitelist → confirmed foreign country
      // 3. Default (per code)
      const amb    = AMBIGUOUS[secondUp];
      const cityLo = city.toLowerCase().trim();
      if (amb.defaultToUS) {
        // cities = known foreign cities
        if (amb.cities.has(cityLo)) {
          country = amb.country;
        } else if (US_CITY_STATE[cityLo] === secondUp) {
          // DB1 confirms this city is specifically in this state
          state = secondUp; country = 'US';
        } else {
          state = secondUp; country = 'US';
        }
      } else {
        // cities = known US cities (small state like DE); default → foreign country
        if (amb.cities.has(cityLo)) { state = secondUp; country = 'US'; }
        else { country = amb.country; }
      }
    } else if (secondUp === 'SA') {
      // SA = South Africa (ZA) by default; Saudi cities → SA
      const SAUDI_CITIES = new Set(['riyadh','jeddah','mecca','medina','dammam','khobar','al khobar','tabuk','abha','taif','buraidah','khamis mushait','jubail','yanbu','najran','hail','hofuf','al ahsa']);
      country = SAUDI_CITIES.has(city.toLowerCase().trim()) ? 'SA' : 'ZA';
    } else if (COUNTRY_CODES.has(secondLo) && !US_STATES.has(secondUp)) {
      // Unambiguous country code
      countryCode = secondLo;
      country = countryCode === 'uk' ? 'GB' : countryCode.toUpperCase();
    } else if (US_STATES.has(secondUp)) {
      // Unambiguous US state abbreviation
      state = secondUp;
      country = 'US';
    } else if (FULL_COUNTRY_NAMES[secondLo]) {
      country = FULL_COUNTRY_NAMES[secondLo];
    } else {
      country = second; // full country name
    }
  } else {
    // Single part — check if it's a known country name, otherwise just a city (country unknown)
    const singleLo = (parts[0] || cleaned).toLowerCase();
    if (FULL_COUNTRY_NAMES[singleLo]) {
      country = FULL_COUNTRY_NAMES[singleLo];
      city = null;
    } else if (COUNTRY_CODES.has(singleLo)) {
      country = singleLo === 'uk' ? 'GB' : singleLo.toUpperCase();
      city = null;
    } else {
      city = parts[0] || cleaned;
    }
  }

  // If a US state was detected, confirm country is US
  if (state && !country) country = 'US';

  // Expand 2-letter codes to full country names for display (US keeps state abbrev)
  const CODE_TO_FULL = {
    'GB':'United Kingdom','DE':'Germany','FR':'France','IN':'India','NL':'Netherlands',
    'SG':'Singapore','JP':'Japan','BR':'Brazil','MX':'Mexico','PL':'Poland','ES':'Spain',
    'IT':'Italy','SE':'Sweden','PT':'Portugal','CH':'Switzerland','BE':'Belgium',
    'AT':'Austria','IE':'Ireland','DK':'Denmark','NO':'Norway','FI':'Finland',
    'IL':'Israel','TR':'Turkey','KR':'South Korea','HK':'Hong Kong','TW':'Taiwan',
    'NZ':'New Zealand','ZA':'South Africa','AE':'UAE','UA':'Ukraine','MT':'Malta',
    'PH':'Philippines','NG':'Nigeria','KE':'Kenya','GH':'Ghana','AU':'Australia',
    'RO':'Romania','CZ':'Czech Republic','GE':'Georgia','PK':'Pakistan','BD':'Bangladesh',
    'TH':'Thailand','VN':'Vietnam','ID':'Indonesia','MY':'Malaysia','EG':'Egypt',
    'MA':'Morocco','ET':'Ethiopia','CA':'Canada','UZ':'Uzbekistan','RW':'Rwanda',
    'LK':'Sri Lanka','MM':'Myanmar','GR':'Greece','HU':'Hungary','SK':'Slovakia',
    'HR':'Croatia','RS':'Serbia','BG':'Bulgaria','LT':'Lithuania','LV':'Latvia',
    'EE':'Estonia','SI':'Slovenia','LU':'Luxembourg','CY':'Cyprus','IS':'Iceland',
    'SA':'Saudi Arabia','QA':'Qatar','KW':'Kuwait','BH':'Bahrain','OM':'Oman',
    'JO':'Jordan','LB':'Lebanon','DZ':'Algeria','TN':'Tunisia','LY':'Libya',
    'TZ':'Tanzania','UG':'Uganda','ZW':'Zimbabwe','ZM':'Zambia','MZ':'Mozambique',
    'AO':'Angola','CM':'Cameroon','SN':'Senegal','CI':'Ivory Coast','ML':'Mali',
    'BF':'Burkina Faso','NP':'Nepal','AF':'Afghanistan','KH':'Cambodia','LA':'Laos',
    'CN':'China','MN':'Mongolia','AR':'Argentina','CL':'Chile','CO':'Colombia',
    'PE':'Peru','VE':'Venezuela','EC':'Ecuador','BO':'Bolivia','PY':'Paraguay',
    'UY':'Uruguay','GT':'Guatemala','CR':'Costa Rica','PA':'Panama','DO':'Dominican Republic',
    'PR':'Puerto Rico','CU':'Cuba','JM':'Jamaica','KZ':'Kazakhstan','AM':'Armenia',
    'AZ':'Azerbaijan','RU':'Russia','BY':'Belarus','MD':'Moldova',
    'TT':'Trinidad and Tobago','HN':'Honduras','SV':'El Salvador','NI':'Nicaragua',
    'BZ':'Belize','GY':'Guyana','SR':'Suriname','KG':'Kyrgyzstan','TJ':'Tajikistan',
    'TM':'Turkmenistan','IR':'Iran','IQ':'Iraq','SY':'Syria','YE':'Yemen',
    'SD':'Sudan','SO':'Somalia','BW':'Botswana','NA':'Namibia','MW':'Malawi',
    'MG':'Madagascar','NE':'Niger','TD':'Chad','CG':'Congo','BI':'Burundi',
    'LS':'Lesotho','SZ':'Eswatini','ER':'Eritrea','DJ':'Djibouti',
  };
  // Full state names for US (abbrev → full)
  const US_STATE_FULL = {
    'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
    'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
    'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
    'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
    'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri',
    'MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
    'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio',
    'OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
    'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
    'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia',
  };
  const fullCountry = country ? (CODE_TO_FULL[country] || (country === 'US' ? 'United States' : country)) : null;
  const fullState   = state ? (US_STATE_FULL[state] || state) : null;
  const display = [city, fullState, fullCountry].filter(Boolean).join(', ');

  return {
    city,
    state:        state || null,
    country:      country || null,
    country_code: countryCode?.toUpperCase() || null,
    display_name: display || cleaned,
    is_remote:    false,
  };
}

// ─── SLUG HELPERS ─────────────────────────────────────────────────────────────

function makeSlug(text, usedSlugs) {
  let base = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60)
    .replace(/^-|-$/g, '');

  let slug = base;
  let i = 2;
  while (usedSlugs.has(slug)) { slug = base + '-' + i++; }
  return slug;
}

function makeJobSlug(title, company, usedSlugs) {
  const base = makeSlug(title + '-at-' + company, new Set());
  let slug = base;
  let i = 2;
  while (usedSlugs.has(slug)) { slug = base + '-' + i++; }
  return slug;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(console.error);
