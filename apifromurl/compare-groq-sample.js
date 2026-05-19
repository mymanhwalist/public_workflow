/**
 * compare-groq-sample.js
 *
 * Fetches raw jobs from DB2, runs Groq extraction, and saves a side-by-side
 * comparison JSON so you can inspect raw vs refined before applying to the site.
 *
 * Extra fields extracted (beyond refiner-groq.js):
 *   - visa_sponsorship  (boolean | null)
 *   - requires_degree   ("none" | "bachelor" | "master" | "phd" | null)
 *   - benefits          (string[])
 *   - is_management     (boolean | null)  — does the role manage people?
 *   - min_years_exp     (number | null)   — minimum years of experience
 *   - languages         (string[])        — human languages required (Spanish, French…)
 *
 * Usage:
 *   node compare-groq-sample.js              → 20 jobs, saves sample-comparison.json
 *   node compare-groq-sample.js --limit=30   → 30 jobs
 *   node compare-groq-sample.js --category=Sales  → filter by category (rule-based)
 */

import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import { writeFileSync } from 'fs';

const DB2_URL      = process.env.DB2_URL      || 'https://buowaosqezcvdpdjcewq.supabase.co';
const DB2_KEY      = process.env.DB2_KEY      || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1b3dhb3NxZXpjdmRwZGpjZXdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1ODY1MCwiZXhwIjoyMDg5NzM0NjUwfQ.BU8tVARSBvEQRWstBQguKY5-U4NV3nhta5SOACQ2nnk';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL   = 'meta-llama/llama-4-scout-17b-16e-instruct';

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT    = limitArg ? parseInt(limitArg.split('=')[1]) : 20;
const catArg   = process.argv.find(a => a.startsWith('--category='));
const CATEGORY = catArg ? catArg.split('=')[1] : null;

const OUT_FILE = 'sample-comparison.json';
const BATCH    = 10;     // jobs per Groq call
const TRUNC    = 1800;   // chars sent to model

const db2  = createClient(DB2_URL, DB2_KEY);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function cleanDesc(html) {
  if (!html) return '';
  return html
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function smartTruncate(text, max) {
  if (text.length <= max) return text;
  const markers = [
    /\b(requirements?|qualifications?|what (you|we) need|must.have|about you|minimum qualifications?)\b/i,
    /\b(responsibilities|what you.ll do|your role|key duties|in this role)\b/i,
  ];
  for (const m of markers) {
    const idx = text.search(m);
    if (idx > 80 && idx < text.length - 200) return text.substring(idx, idx + max);
  }
  return text.substring(0, max);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── GROQ PROMPT ──────────────────────────────────────────────────────────────

function buildPrompt(jobs) {
  const jobsText = jobs.map((job, i) => {
    const full = cleanDesc(job.description || '');
    const desc = smartTruncate(full, TRUNC);
    const loc  = job.location_raw ? `Location hint: ${job.location_raw}` : '';
    return `[JOB ${i}]\nTitle: ${job.title || 'Unknown'}\n${loc}\n${desc}`.trim();
  }).join('\n\n');

  return `Extract structured data from each job posting below.

RULES:
- job_type: Use "Location hint" as primary signal. "Remote" in hint = "remote". City name = "onsite". "Hybrid" = "hybrid". Ambiguous = null.
- skills: Specific named tools, platforms, certifications only (e.g. Salesforce, HubSpot, Jira, AWS, Python). NO soft skills. NO generic terms (cloud, software, data, web). For non-tech roles only extract tools the person uses daily. Return [] if fewer than 2 genuinely specific skills.
- requirements_summary: One sentence — years of experience + key tools + domain. Null if only company intro visible.
- responsibilities: One sentence — what the person does day-to-day. Null if not visible.
- visa_sponsorship: true if employer explicitly offers visa/work permit sponsorship. false if explicitly denied. null if not mentioned.
- requires_degree: "none" if degree explicitly not required. "bachelor" / "master" / "phd" based on stated minimum. null if not mentioned.
- benefits: Array of specific benefits named (e.g. "equity", "401k", "health insurance", "dental", "vision", "unlimited PTO", "remote work", "parental leave", "stock options"). Empty array if none mentioned.
- is_management: true if the role involves managing/leading a team of people. false if individual contributor. null if unclear.
- min_years_exp: Minimum years of experience as a number (e.g. 3 for "3+ years"). null if not stated.
- languages: Human languages required beyond English (e.g. ["Spanish", "French", "Mandarin"]). Empty array if only English or not mentioned.

VALID VALUES:
- job_type: "remote" | "hybrid" | "onsite" | null
- commitment_type: "full_time" | "part_time" | "contract" | "internship" | null
- experience_level: "entry" | "mid" | "senior" | "lead" | "executive" | null
- category: Engineering | Design | Product | Marketing | Sales | Data | Finance | HR | Legal | Customer Support | Security | Research | Healthcare | Hospitality | Retail | Admin | Creative | Operations | Project Management | Executive | Other

RETURN FORMAT (JSON only, no other text):
{"jobs":[{
  "job_type":"...","commitment_type":"...","experience_level":"...","category":"...",
  "skills":[...],"requirements_summary":"...","responsibilities":"...",
  "visa_sponsorship":null,"requires_degree":null,"benefits":[],"is_management":null,
  "min_years_exp":null,"languages":[]
}]}

--- JOBS ---

${jobsText}`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════════════════');
  console.log('GROQ COMPARISON SAMPLE');
  console.log(`Model : ${GROQ_MODEL}`);
  console.log(`Jobs  : ${LIMIT}${CATEGORY ? '  category=' + CATEGORY : ''}`);
  console.log(`Output: ${OUT_FILE}`);
  console.log('══════════════════════════════════════════════════════\n');

  // Fetch jobs — try pending first, fall back to promoted
  const baseSelect = 'id, title, description, location_raw, posted_date, raw_data, career_page_configs(ats_provider), companies(name, domain, logo_url)';

  let { data: jobs } = await db2.from('raw_jobs')
    .select(baseSelect)
    .eq('status', 'pending')
    .not('description', 'is', null)
    .not('title', 'is', null)
    .order('first_seen_at', { ascending: false })
    .limit(LIMIT);

  if (!jobs || jobs.length === 0) {
    console.log('No pending jobs — trying promoted...\n');
    ({ data: jobs } = await db2.from('raw_jobs')
      .select(baseSelect)
      .eq('status', 'promoted')
      .not('description', 'is', null)
      .not('title', 'is', null)
      .order('promoted_at', { ascending: false })
      .limit(LIMIT));
  }

  if (!jobs || jobs.length === 0) {
    console.log('No promoted jobs — using skipped_stale (has descriptions, just old — fine for comparison).\n');
    ({ data: jobs } = await db2.from('raw_jobs')
      .select(baseSelect)
      .eq('status', 'skipped_stale')
      .not('description', 'is', null)
      .not('title', 'is', null)
      .order('first_seen_at', { ascending: false })
      .limit(LIMIT));
  }

  if (!jobs?.length) { console.log('No jobs found in DB2.'); return; }
  console.log(`Fetched ${jobs.length} jobs from DB2\n`);

  // Run Groq in batches
  const groqResults = [];
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const end   = Math.min(i + BATCH, jobs.length);
    process.stdout.write(`  Groq batch ${i+1}–${end} / ${jobs.length}...\r`);

    let attempt = 0;
    let batchResults = null;

    while (attempt < 3) {
      try {
        const { data: completion, response } = await groq.chat.completions.create({
          model:           GROQ_MODEL,
          messages:        [
            { role: 'system', content: 'You are a job posting data extractor. Return ONLY a valid JSON object.' },
            { role: 'user',   content: buildPrompt(batch) },
          ],
          response_format: { type: 'json_object' },
          temperature:     0,
          max_tokens:      3000,
        }).withResponse();

        // Rate limit guard
        const remaining = parseInt(response.headers.get('x-ratelimit-remaining-tokens') || '30000');
        const resetStr  = response.headers.get('x-ratelimit-reset-tokens') || '0s';
        const resetMs   = parseFloat(resetStr) * 1000;
        if (remaining < 5000 && resetMs > 0) {
          console.log(`\n  ⏳ Tokens low (${remaining}), waiting ${Math.ceil(resetMs/1000)}s...`);
          await sleep(resetMs + 500);
        }

        const parsed = JSON.parse(completion.choices[0].message.content);
        batchResults = parsed.jobs || parsed.results || parsed.data || [];
        break;

      } catch (err) {
        if (err?.status === 429) {
          const wait = parseInt(err.headers?.['retry-after'] || '15');
          console.log(`\n  ⏳ Rate limited, waiting ${wait}s...`);
          await sleep(wait * 1000); attempt++; continue;
        }
        console.log(`\n  ⚠️  Groq error: ${err.message?.substring(0, 80)}`);
        batchResults = batch.map(() => null);
        break;
      }
    }

    for (let j = 0; j < batch.length; j++) {
      groqResults.push(batchResults?.[j] || null);
    }
  }
  console.log(`\n  Groq done — ${groqResults.filter(Boolean).length}/${jobs.length} extracted\n`);

  // Build comparison records
  const records = jobs.map((job, i) => {
    const g   = groqResults[i];
    const raw = job.raw_data || {};
    const provider = job.career_page_configs?.ats_provider || 'Unknown';
    const descClean = cleanDesc(job.description || '');

    return {
      // ── Identifiers ──────────────────────────────────────────
      raw_job_id:   job.id,
      ats_provider: provider,
      company_name: job.companies?.name || null,
      company_domain: job.companies?.domain || null,

      // ── Raw data (from DB2 as-is) ────────────────────────────
      raw: {
        title:        job.title,
        location_raw: job.location_raw,
        posted_date:  job.posted_date,
        // Provider-specific structured fields stored in raw_data
        raw_job_type:        raw.workplaceType || raw.type?.name || null,
        raw_commitment:      raw.categories?.commitment || raw.employmentType || raw.type?.id || null,
        raw_department:      raw.categories?.team || raw.departments?.[0]?.name || raw.department || raw.team || null,
        raw_salary:          raw.salary || raw.compensation || null,
        raw_remote_flag:     raw.isRemote ?? raw.location?.remote ?? null,
        description_length:  descClean.length,
        description_preview: descClean.substring(0, 300) + (descClean.length > 300 ? '…' : ''),
      },

      // ── Groq-refined data ────────────────────────────────────
      refined: g ? {
        job_type:            g.job_type             || null,
        commitment_type:     g.commitment_type      || null,
        experience_level:    g.experience_level     || null,
        category:            g.category             || null,
        skills:              Array.isArray(g.skills)    ? g.skills    : [],
        requirements_summary: g.requirements_summary || g.requirement_summary || null,
        responsibilities:    g.responsibilities     || null,
        // ── New fields ──────────────────────────────────────────
        visa_sponsorship:    g.visa_sponsorship     ?? null,
        requires_degree:     g.requires_degree      || null,
        benefits:            Array.isArray(g.benefits)  ? g.benefits  : [],
        is_management:       g.is_management        ?? null,
        min_years_exp:       g.min_years_exp        ?? null,
        languages:           Array.isArray(g.languages) ? g.languages : [],
      } : null,

      groq_failed: g === null,
    };
  });

  // Save JSON
  const out = {
    generated_at:  new Date().toISOString(),
    model:         GROQ_MODEL,
    total_jobs:    records.length,
    groq_success:  records.filter(r => !r.groq_failed).length,
    groq_failed:   records.filter(r => r.groq_failed).length,
    fields_explained: {
      'raw.*':              'Exactly what DB2 has — untouched ATS data',
      'refined.job_type':   '"remote" | "hybrid" | "onsite" | null',
      'refined.skills':     'Specific named tools/certs from requirements section only',
      'refined.requirements_summary': 'One-sentence: experience + tools + domain',
      'refined.responsibilities':     'One-sentence: what the person does daily',
      'refined.visa_sponsorship':     'true/false/null — only from explicit statement',
      'refined.requires_degree':      '"none"|"bachelor"|"master"|"phd"|null',
      'refined.benefits':             'Named perks: equity, 401k, unlimited PTO, etc.',
      'refined.is_management':        'true = manages people, false = IC, null = unclear',
      'refined.min_years_exp':        'Minimum years as a number, null if not stated',
      'refined.languages':            'Non-English human languages required',
    },
    jobs: records,
  };

  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`✅  Saved → ${OUT_FILE}  (${records.length} jobs)\n`);

  // Print a quick terminal summary
  console.log('QUICK SUMMARY');
  console.log('─'.repeat(80));
  for (const r of records) {
    const g = r.refined;
    if (!g) { console.log(`  [FAILED] ${r.raw.title}`); continue; }
    const newFields = [
      g.visa_sponsorship !== null ? `visa=${g.visa_sponsorship}` : null,
      g.requires_degree            ? `degree=${g.requires_degree}` : null,
      g.benefits.length            ? `benefits(${g.benefits.length})` : null,
      g.is_management !== null     ? (g.is_management ? 'manager' : 'IC') : null,
      g.min_years_exp !== null     ? `${g.min_years_exp}yr+` : null,
      g.languages.length           ? `lang:${g.languages.join('+')}` : null,
    ].filter(Boolean).join('  ');

    console.log(`\n  [${(r.ats_provider || '?').padEnd(14)}] ${r.raw.title}`);
    console.log(`  ${(g.category||'?').padEnd(20)} ${g.job_type||'?'}  ${g.experience_level||'?'}  skills(${g.skills.length})`);
    if (g.skills.length)  console.log(`  Skills:   ${g.skills.join(', ')}`);
    if (g.responsibilities) console.log(`  Role:     ${g.responsibilities}`);
    if (newFields)          console.log(`  Extra:    ${newFields}`);
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`\nFull data saved to: ${OUT_FILE}`);
  console.log('Open it in any JSON viewer / VS Code to compare raw vs refined side by side.\n');
}

run().catch(console.error);
