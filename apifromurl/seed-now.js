/**
 * seed-now.js — One-time manual seed: promote 20 fresh tier-1 jobs to Main DB
 *
 * Picks the best tier-1 job per company from raw_jobs posted in last 24h,
 * skips junk roles, promotes up to 20 to Main DB.
 *
 * Usage: node seed-now.js [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';

const DB2_URL  = process.env.DB2_URL  || 'https://buowaosqezcvdpdjcewq.supabase.co';
const DB2_KEY  = process.env.DB2_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1b3dhb3NxZXpjdmRwZGpjZXdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1ODY1MCwiZXhwIjoyMDg5NzM0NjUwfQ.BU8tVARSBvEQRWstBQguKY5-U4NV3nhta5SOACQ2nnk';
const MAIN_URL = process.env.MAIN_DB_URL || 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = process.env.MAIN_DB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';
const DB1_URL  = process.env.DB1_URL  || 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const DB1_KEY  = process.env.DB1_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET  = 20;

const db2  = createClient(DB2_URL,  DB2_KEY);
const main = createClient(MAIN_URL, MAIN_KEY);
const db1  = createClient(DB1_URL,  DB1_KEY);

// Jobs to exclude — service/low-tier roles
const isJunk = (t) => /\bdriver\b|delivery driver|warehouse|cashier|\bcook\b|food service|barista|bartender|dishwasher|cleaner|janitor|housekeeper|security guard|crew member|team member|shift lead|pizza|taco|burger|customer service rep|referral program|talent community|general application/i.test(t);

async function run() {
  console.log('══════════════════════════════════════════');
  console.log('SEED-NOW — Fresh tier-1 jobs → Main DB');
  if (DRY_RUN) console.log('DRY RUN — no writes');
  console.log('══════════════════════════════════════════\n');

  const CUTOFF = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch all fresh pending jobs with description
  const { data: raw, error } = await db2.from('raw_jobs')
    .select('*, companies(id, name, slug, domain, logo_url, sources), career_page_configs(ats_provider)')
    .eq('status', 'pending')
    .not('description', 'is', null)
    .gte('posted_date', CUTOFF)
    .order('posted_date', { ascending: false });

  if (error) { console.error('DB2 fetch error:', error.message); process.exit(1); }
  console.log(`Fresh pending jobs (24h): ${raw.length}`);

  // Pick best tier-1 US/remote job per company
  // Only use reliable providers — SmartRecruiters location data is unreliable (sends 'us' for non-US jobs)
  const RELIABLE = new Set(['Greenhouse', 'Lever', 'Ashby', 'Workable', 'Eightfold']);
  const TIER1_BOOST = /senior|lead|staff|principal|director|manager|engineer|developer|architect|scientist|analyst|specialist/i;
  const US_LOC = /\b(remote|united states|\bus\b|, [A-Z]{2}$|california|texas|new york|florida|washington|illinois|georgia|colorado|virginia|massachusetts|pennsylvania|ohio|north carolina|michigan|new jersey|arizona|nevada|oregon|utah|minnesota|seattle|chicago|boston|austin|dallas|denver|atlanta|miami|san francisco|los angeles|brooklyn|manhattan|new york city)\b/i;
  const byCompany = {};
  for (const j of raw) {
    if (isJunk(j.title)) continue;
    const provider = j.career_page_configs?.ats_provider;
    if (!RELIABLE.has(provider)) continue; // skip unreliable location data
    const name = j.companies?.name;
    if (!name) continue;
    const loc = (j.location_raw || '').toLowerCase();
    const isRemote = /\bremote\b/.test(loc);
    if (!isRemote && !US_LOC.test(j.location_raw || '')) continue;
    if (!byCompany[name]) {
      byCompany[name] = j;
    } else if (TIER1_BOOST.test(j.title) && !TIER1_BOOST.test(byCompany[name].title)) {
      byCompany[name] = j;
    }
  }

  const selected = Object.values(byCompany).slice(0, TARGET);
  console.log(`Companies with tier-1 jobs: ${Object.keys(byCompany).length}`);
  console.log(`Seeding: ${selected.length} jobs\n`);

  // Load Main DB state
  const { data: existingCompanies } = await main.from('companies').select('id, domain, slug');
  const { data: existingLocations } = await main.from('locations').select('id, display_name');
  const companyByDomain = new Map((existingCompanies || []).map(c => [c.domain, c]));
  const locationByName  = new Map((existingLocations || []).map(l => [l.display_name, l]));
  const slugsUsed       = new Set((existingCompanies || []).map(c => c.slug));

  // Load skills
  let skillsMap = new Map();
  let sOff = 0;
  while (true) {
    const { data: sb } = await main.from('skills').select('id, name, slug').range(sOff, sOff + 999);
    if (!sb || sb.length === 0) break;
    for (const s of sb) skillsMap.set(s.slug, s);
    if (sb.length < 1000) break;
    sOff += 1000;
  }

  const totals = { promoted: 0, skipped: 0, errors: 0 };

  for (const job of selected) {
    const provider = job.career_page_configs?.ats_provider || 'Unknown';
    try {
      const extracted = extractFields(job, provider);
      if (!extracted.title) { totals.skipped++; continue; }

      // Resolve company
      const companyId = await resolveCompany(job.companies, companyByDomain, slugsUsed);
      if (!companyId) { totals.skipped++; continue; }

      // Resolve location
      const locationId = await resolveLocation(extracted.location, locationByName);

      // Skill extraction
      const skillIds = extractSkills(job.description || '', skillsMap);

      // Slug
      const slug = makeJobSlug(extracted.title, job.companies?.name || '', slugsUsed);
      slugsUsed.add(slug);

      if (DRY_RUN) {
        console.log(`✅ ${job.companies?.name?.padEnd(25)} | ${provider.padEnd(14)} | ${job.posted_date?.substring(0,10)} | ${extracted.title?.substring(0,55)}`);
        totals.promoted++;
        continue;
      }

      const { error: insertErr, data: inserted } = await main.from('jobs').insert({
        company_id:       companyId,
        location_id:      locationId || null,
        title:            extracted.title,
        slug,
        description:      job.description || null,
        application_url:  job.application_url,
        job_type:         extracted.job_type,
        commitment_type:  extracted.commitment_type,
        experience_level: extracted.experience_level,
        category:         extracted.category,
        salary_min:       extracted.salary_min,
        salary_max:       extracted.salary_max,
        salary_currency:  extracted.salary_currency,
        salary_period:    extracted.salary_period,
        posted_date:      job.posted_date || null,
        first_seen_at:    job.first_seen_at,
        last_seen_at:     job.last_seen_at,
        raw_job_id:       job.id,
        ats_provider:     provider,
        external_id:      job.external_id || null,
      }).select('id').single();

      if (insertErr) {
        if (insertErr.code === '23505') { totals.skipped++; continue; }
        throw insertErr;
      }

      if (inserted && skillIds.length > 0) {
        await main.from('job_skills').upsert(skillIds.map(skill_id => ({ job_id: inserted.id, skill_id })), { ignoreDuplicates: true });
      }

      await db2.from('raw_jobs').update({ status: 'promoted', is_promoted: true, promoted_at: new Date().toISOString() }).eq('id', job.id);

      console.log(`✅ ${job.companies?.name?.padEnd(25)} | ${provider.padEnd(14)} | ${job.posted_date?.substring(0,10)} | ${extracted.title?.substring(0,55)}`);
      totals.promoted++;
    } catch (err) {
      console.log(`❌ ${job.companies?.name} | ${err.message}`);
      totals.errors++;
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`Promoted: ${totals.promoted}  Skipped: ${totals.skipped}  Errors: ${totals.errors}`);

  if (!DRY_RUN) {
    const { count } = await main.from('jobs').select('*', { count: 'exact', head: true });
    console.log(`Main DB jobs total: ${count}`);
  }
}

// ── Helpers (copied from refiner.js) ─────────────────────────────────────────

function extractSkills(text, skillsMap) {
  if (!text || skillsMap.size === 0) return [];
  const t = text.toLowerCase().replace(/<[^>]+>/g, ' ');
  const found = [];
  for (const [slug, skill] of skillsMap) {
    const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z0-9])' + escaped.toLowerCase() + '(?![a-z0-9])', 'i');
    if (re.test(t)) found.push(skill.id);
    if (found.length >= 30) break;
  }
  return found;
}

function extractFields(job, provider) {
  const rd = job.raw_data || {};
  const title = job.title || '';
  const desc  = job.description || '';
  let job_type, commitment_type, experience_level, category;
  let location        = job.location_raw || null;
  let salary_min = null, salary_max = null, salary_currency = 'USD', salary_period = 'yearly';

  if (provider === 'Lever') {
    job_type        = normJobType(rd.workplaceType);
    commitment_type = normCommitment(rd.categories?.commitment);
    category        = normCategory(rd.categories?.team || title);
    location        = rd.categories?.location || location;
  }
  if (provider === 'Ashby') {
    job_type        = rd.isRemote ? 'remote' : normJobType(rd.workplaceType);
    commitment_type = normCommitment(rd.employmentType);
    category        = normCategory(rd.team || title);
  }
  if (provider === 'Greenhouse') {
    category        = normCategory(rd.departments?.[0]?.name || title);
  }
  if (provider === 'SmartRecruiters') {
    const loc       = rd.location || {};
    job_type        = loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : loc.city ? 'onsite' : null;
    commitment_type = normCommitment(rd.typeOfEmployment?.label);
    const catFromLabel = rd.function?.label ? normCategory(rd.function.label) : null;
    category        = (catFromLabel && catFromLabel !== 'Other') ? catFromLabel : normCategory(title);
  }

  if (!job_type)         job_type         = extractJobTypeFromText(title + ' ' + desc);
  if (!commitment_type)  commitment_type  = extractCommitmentFromText(title + ' ' + desc);
  if (!experience_level) experience_level = extractExperienceFromText(title, desc);
  if (!category)         category         = normCategory(title);
  if (!salary_min) {
    const s = parseSalary(desc + ' ' + title);
    if (s) { salary_min = s.min; salary_max = s.max; salary_currency = s.currency; salary_period = s.period; }
  }

  return { title, job_type, commitment_type, experience_level, category, location, salary_min, salary_max, salary_currency, salary_period };
}

function normJobType(val) {
  if (!val) return null;
  const v = val.toLowerCase();
  if (v.includes('remote')) return 'remote';
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('onsite') || v.includes('on-site') || v.includes('office')) return 'onsite';
  return null;
}
function normCommitment(val) {
  if (!val) return null;
  const v = val.toLowerCase().replace(/[-_]/g, ' ');
  if (v.includes('full'))    return 'full_time';
  if (v.includes('part'))    return 'part_time';
  if (v.includes('contract') || v.includes('freelance')) return 'contract';
  if (v.includes('intern'))  return 'internship';
  if (v.includes('permanent')) return 'full_time';
  return null;
}
function normCategory(val) {
  if (!val) return null;
  const v = val.toLowerCase();
  if (/engineer|develop|programm|software|frontend|backend|fullstack|devops|sre|platform|mobile|ios|android|cloud|\bml\b|machine learning|infrastructure|architect|\bqa\b|quality assurance|test automation|it support|it manager|helpdesk/.test(v)) return 'Engineering';
  if (/\bdesign\b|\bux\b|\bui\b|graphic|motion|figma|creative direct/.test(v)) return 'Design';
  if (/product manager|product owner|product director|head of product/.test(v)) return 'Product';
  if (/project manager|programme manager|program manager|scrum master/.test(v)) return 'Project Management';
  if (/market|growth|\bseo\b|\bsem\b|social media|demand gen|campaign|brand|content strat|communications|public relation/.test(v)) return 'Marketing';
  if (/\bsales\b|account exec|account manag|business dev|\bbdr\b|\bsdr\b|revenue|pre-sales/.test(v)) return 'Sales';
  if (/data science|data analyst|data engineer|\banalytics\b|business intelligence|\bbi\b|data warehouse/.test(v)) return 'Data';
  if (/financ|accountant|accounting|payroll|\btax\b|\baudit\b|controller|\bcfo\b/.test(v)) return 'Finance';
  if (/\bhr\b|human resource|recruiter|recruiting|talent acqui|people ops/.test(v)) return 'HR';
  if (/\blegal\b|compliance|counsel|attorney|paralegal|privacy/.test(v)) return 'Legal';
  if (/customer success|customer support|customer experience|customer service/.test(v)) return 'Customer Support';
  if (/security|infosec|cybersec|\bsoc\b|penetration|threat|vulnerability/.test(v)) return 'Security';
  if (/research|scientist|\bphd\b|laboratory|scientific/.test(v)) return 'Research';
  if (/operations|supply chain|logistics|procurement|warehouse|fulfillment/.test(v)) return 'Operations';
  if (/\bceo\b|\bcoo\b|\bcto\b|\bcfo\b|chief.*officer|vice president|general manager/.test(v)) return 'Executive';
  return 'Other';
}
function extractJobTypeFromText(text) {
  const t = text.toLowerCase();
  if (/\bremote\b|work from home|fully remote/.test(t)) return 'remote';
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\bonsite\b|\bon-site\b|\bin.office\b/.test(t)) return 'onsite';
  return null;
}
function extractCommitmentFromText(text) {
  const t = text.toLowerCase();
  if (/full.time|fulltime/.test(t)) return 'full_time';
  if (/part.time|parttime/.test(t)) return 'part_time';
  if (/\bcontract\b|\bfreelance\b/.test(t)) return 'contract';
  if (/\bintern(ship)?\b/.test(t)) return 'internship';
  return null;
}
function extractExperienceFromText(title, desc) {
  const t = (title || '').toLowerCase();
  const d = (desc || '').toLowerCase();
  if (/\b(chief|ceo|coo|cto|cfo|president|vice president|\bvp\b)\b/.test(t)) return 'executive';
  if (/\b(director|head of|managing director)\b/.test(t)) return 'executive';
  if (/\b(staff engineer|principal |senior lead|lead [a-z])/i.test(title)) return 'lead';
  if (/\bsenior\b|\bsr\.?\s|\bsr\b/.test(t)) return 'senior';
  if (/\b(manager|management)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?\s|\bjr\b|entry.level|graduate)\b/.test(t)) return 'entry';
  if (/\b(intern(ship)?|trainee|apprentice)\b/.test(t)) return 'entry';
  if (/\b(associate|coordinator|specialist|consultant|analyst)\b/.test(t)) return 'mid';
  const ym = [...d.matchAll(/(\d+)\+?\s*years?\s*(?:of\s*)?experience/g)];
  if (ym.length > 0) {
    const y = parseInt(ym[0][1]);
    if (y <= 1) return 'entry'; if (y <= 3) return 'mid'; if (y <= 6) return 'senior'; return 'lead';
  }
  return null;
}
function parseSalary(text) {
  if (!text) return null;
  const patterns = [
    { re: /([£$€])(\d+(?:\.\d+)?)k?\s*[-–to]+\s*[£$€]?(\d+(?:\.\d+)?)k/i, fn: m => ({ currency: cs(m[1]), min: Math.round(parseFloat(m[2]) * (parseFloat(m[2]) < 1000 ? 1000 : 1)), max: Math.round(parseFloat(m[3]) * 1000), period: 'yearly' }) },
    { re: /([£$€])(\d{2,3}),(\d{3})\s*[-–to]+\s*[£$€]?(\d{2,3}),(\d{3})/i, fn: m => ({ currency: cs(m[1]), min: parseInt(m[2]+m[3]), max: parseInt(m[4]+m[5]), period: 'yearly' }) },
    { re: /([£$€])(\d+(?:\.\d+)?)\s*(?:\/hr|per hour)/i, fn: m => ({ currency: cs(m[1]), min: Math.round(parseFloat(m[2])), max: Math.round(parseFloat(m[2])), period: 'hourly' }) },
    { re: /([£$€])(\d+)k/i, fn: m => ({ currency: cs(m[1]), min: parseInt(m[2])*1000, max: parseInt(m[2])*1000, period: 'yearly' }) },
  ];
  for (const { re, fn } of patterns) { const m = text.match(re); if (m) { try { return fn(m); } catch {} } }
  return null;
}
function cs(sym) { if (sym === '£') return 'GBP'; if (sym === '€') return 'EUR'; return 'USD'; }

async function resolveCompany(db2Co, companyByDomain, slugsUsed) {
  if (!db2Co) return null;
  let domain = db2Co.domain;
  if (!domain || domain.length < 4 || !domain.includes('.')) domain = db2Co.slug || makeSlug(db2Co.name, new Set());
  if (companyByDomain.has(domain)) return companyByDomain.get(domain).id;

  let enrichment = {};
  try {
    const { data } = await db1.from('companies').select('linkedin_url,year_founded,number_employees,industries,funding_stage,is_public,headquarters,headquarters_country,description').ilike('website', '%' + domain + '%').limit(1);
    if (data?.[0]) enrichment = data[0];
  } catch {}

  const slug = makeSlug(db2Co.name, slugsUsed);
  slugsUsed.add(slug);

  if (!DRY_RUN) {
    const { data: inserted, error } = await main.from('companies').insert({
      name: db2Co.name, slug, domain, logo_url: db2Co.logo_url || null,
      linkedin_url: enrichment.linkedin_url || null, year_founded: enrichment.year_founded || null,
      employee_count: enrichment.number_employees || null, industries: enrichment.industries || null,
      funding_stage: enrichment.funding_stage || null, is_public: enrichment.is_public || false,
      headquarters: enrichment.headquarters || null, headquarters_country: enrichment.headquarters_country || null,
      description: enrichment.description || null, sources: db2Co.sources || [],
    }).select('id').single();
    if (error) {
      if (error.code === '23505') {
        const { data: ex } = await main.from('companies').select('id').eq('domain', domain).single();
        if (ex) { companyByDomain.set(domain, ex); return ex.id; }
      }
      return null;
    }
    companyByDomain.set(domain, inserted);
    return inserted.id;
  }
  return 'dry-company';
}

async function resolveLocation(locationRaw, locationByName) {
  if (!locationRaw) return null;
  const parsed  = parseLocation(locationRaw);
  const display = parsed.display_name;
  if (locationByName.has(display)) return locationByName.get(display).id;
  if (!DRY_RUN) {
    const { data: inserted, error } = await main.from('locations').insert(parsed).select('id').single();
    if (error) {
      if (error.code === '23505') {
        const { data: ex } = await main.from('locations').select('id').eq('display_name', display).single();
        if (ex) { locationByName.set(display, ex); return ex.id; }
      }
      return null;
    }
    locationByName.set(display, inserted);
    return inserted.id;
  }
  return 'dry-location';
}

function parseLocation(raw) {
  if (!raw) return { display_name: 'Unknown', country: 'US', is_remote: false };
  const t = raw.toLowerCase().trim();
  if (/\bremote\b/.test(t)) return { display_name: 'Remote', country: 'US', is_remote: true };
  const cleaned = raw.replace(/,?\s*\[object Object\]/g, '').trim();
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
  const US_STATE_NAMES = { 'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY','district of columbia':'DC' };
  const FULL_COUNTRY_NAMES = { 'united states':'US','united states of america':'US','usa':'US','united kingdom':'GB','great britain':'GB','ukraine':'UA','india':'IN','germany':'DE','france':'FR','canada':'CA','australia':'AU','brazil':'BR','mexico':'MX','spain':'ES','italy':'IT','netherlands':'NL','singapore':'SG','poland':'PL','sweden':'SE','portugal':'PT','switzerland':'CH','belgium':'BE','austria':'AT','ireland':'IE','denmark':'DK','norway':'NO','finland':'FI','israel':'IL','turkey':'TR','south korea':'KR','hong kong':'HK','taiwan':'TW','new zealand':'NZ','south africa':'ZA' };
  const COUNTRY_CODES = new Set(['us','uk','gb','de','fr','ca','au','in','nl','sg','jp','br','mx','pl','es','it','se','no','dk','fi','ch','be','at','pt','ie','nz','za','ae','tr','il','kr','hk','tw','uz','ua','mt','ph','ng','ke','gh','rw','et','eg','ma','pk','bd','lk','mm','th','vn','id','my']);
  const AMBIGUOUS = { CA:'CA', IN:'IN', DE:'DE', GA:'GE', MT:'MT' };
  let city = null, state = null, country = null, countryCode = null;
  if (parts.length >= 2) {
    city = parts[0];
    const second = parts[1].trim(), secondUp = second.toUpperCase(), secondLo = second.toLowerCase();
    if (parts.length >= 3) {
      const stateAbbr = US_STATE_NAMES[secondLo] || (US_STATES.has(secondUp) ? secondUp : null);
      state = stateAbbr || null;
      const third = parts[2].trim(), thirdLo = third.toLowerCase();
      if (FULL_COUNTRY_NAMES[thirdLo]) country = FULL_COUNTRY_NAMES[thirdLo];
      else if (COUNTRY_CODES.has(thirdLo)) { countryCode = thirdLo; country = countryCode.toUpperCase() === 'UK' ? 'GB' : countryCode.toUpperCase(); }
      else country = third;
    } else if (US_STATE_NAMES[secondLo]) { state = US_STATE_NAMES[secondLo]; country = 'US'; }
    else if (COUNTRY_CODES.has(secondLo) && !US_STATES.has(secondUp)) { countryCode = secondLo; country = countryCode === 'uk' ? 'GB' : countryCode.toUpperCase(); }
    else if (US_STATES.has(secondUp) && !(secondUp in AMBIGUOUS)) { state = secondUp; country = 'US'; }
    else if (secondUp in AMBIGUOUS) { countryCode = secondLo; country = countryCode === 'uk' ? 'GB' : countryCode.toUpperCase(); }
    else if (FULL_COUNTRY_NAMES[secondLo]) country = FULL_COUNTRY_NAMES[secondLo];
    else country = second;
  } else {
    const singleLo = (parts[0] || cleaned).toLowerCase();
    if (FULL_COUNTRY_NAMES[singleLo]) { country = FULL_COUNTRY_NAMES[singleLo]; city = null; }
    else if (COUNTRY_CODES.has(singleLo)) { country = singleLo === 'uk' ? 'GB' : singleLo.toUpperCase(); city = null; }
    else { city = parts[0] || cleaned; }
  }
  if (state && !country) country = 'US';
  const display = [city, state || (country && country !== 'US' ? country : null)].filter(Boolean).join(', ');
  return { city, state: state || null, country: country || null, country_code: countryCode?.toUpperCase() || null, display_name: display || cleaned, is_remote: false };
}

function makeSlug(text, usedSlugs) {
  let base = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60).replace(/^-|-$/g, '');
  let slug = base, i = 2;
  while (usedSlugs.has(slug)) slug = base + '-' + i++;
  return slug;
}
function makeJobSlug(title, company, usedSlugs) {
  const base = makeSlug(title + '-at-' + company, new Set());
  let slug = base, i = 2;
  while (usedSlugs.has(slug)) slug = base + '-' + i++;
  return slug;
}

run().catch(console.error);
