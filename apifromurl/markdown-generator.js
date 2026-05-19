/**
 * markdown-generator.js — Generate per-category job markdown files
 *
 * Mirrors the work-from-anywhere repo structure:
 *   backend-jobs.md, frontend-jobs.md, fullstack-jobs.md, devops-jobs.md,
 *   software-engineer-jobs.md, site-reliability-engineer-jobs.md,
 *   data-science-jobs.md, quality-assurance-jobs.md,
 *   product-manager-jobs.md, project-manager-jobs.md, ui-ux-jobs.md,
 *   developer-jobs.md, entry-level-jobs.md
 *
 * Usage:
 *   node markdown-generator.js
 *   node markdown-generator.js --output-dir=../jobsearchus-repo
 *   node markdown-generator.js --days=30   (optional, default = all jobs)
 *   node markdown-generator.js --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const MAIN_URL = process.env.MAIN_DB_URL;
const MAIN_KEY = process.env.MAIN_DB_KEY;

if (!MAIN_URL || !MAIN_KEY) {
  console.error('Missing MAIN_DB_URL or MAIN_DB_KEY');
  process.exit(1);
}

const db = createClient(MAIN_URL, MAIN_KEY);

const outputDirArg = process.argv.find(a => a.startsWith('--output-dir='));
const OUTPUT_DIR   = outputDirArg ? outputDirArg.split('=').slice(1).join('=') : './jobs-output';

const daysArg = process.argv.find(a => a.startsWith('--days='));
const DAYS    = daysArg ? parseInt(daysArg.split('=')[1]) : 0; // 0 = no cutoff, include all refined jobs

const DRY_RUN = process.argv.includes('--dry-run');

// ─── CATEGORY CONFIG ─────────────────────────────────────────────────────────

const CATEGORIES = [
  // ── Featured cross-category files ──
  { slug: 'work-from-home',             file: 'work-from-home-jobs.md',             title: 'Work From Home Jobs',                  virtual: true },
  { slug: '100k-plus',                  file: '100k-plus-jobs.md',                  title: '$100K+ Remote Jobs',                   virtual: true },
  { slug: 'entry-level',                file: 'entry-level-jobs.md',                title: 'Entry Level Remote Jobs',              virtual: true },
  // ── Tech categories ──
  { slug: 'software-engineer',          file: 'software-engineer-jobs.md',          title: 'Software Engineer Jobs' },
  { slug: 'backend',                    file: 'backend-jobs.md',                    title: 'Backend Jobs' },
  { slug: 'frontend',                   file: 'frontend-jobs.md',                   title: 'Frontend Jobs' },
  { slug: 'fullstack',                  file: 'fullstack-jobs.md',                  title: 'Fullstack Jobs' },
  { slug: 'developer',                  file: 'developer-jobs.md',                  title: 'Developer Jobs' },
  { slug: 'devops',                     file: 'devops-jobs.md',                     title: 'DevOps Jobs' },
  { slug: 'site-reliability-engineer',  file: 'site-reliability-engineer-jobs.md',  title: 'Site Reliability Engineer Jobs' },
  { slug: 'data-science',               file: 'data-science-jobs.md',               title: 'Data Science Jobs' },
  { slug: 'quality-assurance',          file: 'quality-assurance-jobs.md',          title: 'Quality Assurance Jobs' },
  // ── Business categories ──
  { slug: 'product-manager',            file: 'product-manager-jobs.md',            title: 'Product Manager Jobs' },
  { slug: 'project-manager',            file: 'project-manager-jobs.md',            title: 'Project Manager Jobs' },
  { slug: 'ui-ux',                      file: 'ui-ux-jobs.md',                      title: 'UI/UX Jobs' },
  { slug: 'marketing',                  file: 'marketing-jobs.md',                  title: 'Marketing Jobs' },
  { slug: 'sales',                      file: 'sales-jobs.md',                      title: 'Sales Jobs' },
  { slug: 'customer-support',           file: 'customer-support-jobs.md',           title: 'Customer Support Jobs' },
  { slug: 'finance',                    file: 'finance-jobs.md',                    title: 'Finance Jobs' },
  { slug: 'hr',                         file: 'hr-jobs.md',                         title: 'HR Jobs' },
  { slug: 'legal',                      file: 'legal-jobs.md',                      title: 'Legal Jobs' },
  { slug: 'operations',                 file: 'operations-jobs.md',                 title: 'Operations Jobs' },
  { slug: 'security',                  file: 'security-jobs.md',                   title: 'Security Jobs' },
  { slug: 'creative',                  file: 'creative-jobs.md',                   title: 'Creative Jobs' },
  { slug: 'admin',                     file: 'admin-jobs.md',                      title: 'Admin Jobs' },
  { slug: 'extra',                     file: 'extra-jobs.md',                      title: 'More Remote Jobs' },
];

// ─── CATEGORIZER ─────────────────────────────────────────────────────────────
// Maps a DB job (title + db category) → one of our slugs above

function resolveSlug(title, dbCategory, experienceLevel) {
  const t = (title || '').toLowerCase();
  const c = dbCategory || '';

  // Entry-level gets its own cross-category file
  if (experienceLevel === 'entry') return 'entry-level';

  // Non-engineering DB categories map directly
  if (c === 'Design')            return 'ui-ux';
  if (c === 'Product')           return 'product-manager';
  if (c === 'Project Management') return 'project-manager';
  if (c === 'Marketing')         return 'marketing';
  if (c === 'Sales')             return 'sales';
  if (c === 'Customer Support')  return 'customer-support';
  if (c === 'Finance')           return 'finance';
  if (c === 'HR')                return 'hr';
  if (c === 'Legal')             return 'legal';
  if (c === 'Operations')        return 'operations';
  if (c === 'Security')          return 'security';
  if (c === 'Creative')          return 'creative';
  if (c === 'Admin')             return 'admin';

  // Engineering + Data — split by title keywords
  if (c === 'Engineering' || c === 'Data' || c === 'Research') {
    if (/\bsre\b|site.reliability/.test(t))                                    return 'site-reliability-engineer';
    if (/\bdevops\b|dev.ops|devsecops|platform engineer|infrastructure/.test(t)) return 'devops';
    if (/\bqa\b|quality.assur|test engineer|automation engineer/.test(t))      return 'quality-assurance';
    if (/data.scien|data scientist|\bml\b|machine learning|ai engineer/.test(t)) return 'data-science';
    if (/frontend|front.end|react developer|vue developer|angular developer/.test(t)) return 'frontend';
    if (/backend|back.end|node developer|rails developer|django developer/.test(t))   return 'backend';
    if (/fullstack|full.stack/.test(t))                                        return 'fullstack';
    if (/software engineer|software developer/.test(t))                        return 'software-engineer';
    if (/developer|programmer|coder/.test(t))                                  return 'developer';
    return 'software-engineer'; // default for engineering
  }

  return 'extra'; // everything else — Healthcare, Hospitality, Retail, Other, uncategorized
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const cutoff = DAYS > 0
    ? new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : null;
  console.log(cutoff ? `Fetching refined remote jobs since ${cutoff}...` : 'Fetching ALL refined remote jobs (no date limit)...');

  let allJobs = [];
  let offset = 0;
  const BATCH = 1000;

  while (true) {
    let query = db
      .from('jobs')
      .select('id, title, category, experience_level, salary_min, salary_max, salary_currency, salary_period, posted_date, application_url, companies(name, domain)')
      .order('posted_date', { ascending: false })
      .range(offset, offset + BATCH - 1);

    if (cutoff) query = query.gte('posted_date', cutoff);

    const { data, error } = await query;

    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allJobs = allJobs.concat(data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }

  console.log(`Total remote jobs fetched: ${allJobs.length}`);

  const bySlug = new Map();
  for (const { slug } of CATEGORIES) bySlug.set(slug, []);

  for (const job of allJobs) {
    // Virtual: work-from-home = remote jobs only
    if (job.job_type === 'remote') bySlug.get('work-from-home').push(job);

    // Virtual: $100K+ salary
    if (job.salary_min && normalizeToAnnual(job.salary_min, job.salary_period) >= 100000) {
      bySlug.get('100k-plus').push(job);
    }

    // Virtual: entry-level
    if (job.experience_level === 'entry') {
      bySlug.get('entry-level').push(job);
    }

    // Primary category file
    const slug = resolveSlug(job.title, job.category, null);
    if (slug && bySlug.has(slug)) {
      bySlug.get(slug).push(job);
    }
  }


  // Print summary
  for (const { slug } of CATEGORIES) {
    const n = bySlug.get(slug)?.length || 0;
    if (n > 0) console.log(`  ${slug.padEnd(30)}: ${n} jobs`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — no files written.');
    return;
  }

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const JOBS_DIR = join(OUTPUT_DIR, 'jobs');
  if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true });

  const today = new Date().toISOString().split('T')[0];
  let filesWritten = 0;

  for (const { slug, file, title } of CATEGORIES) {
    const jobs = bySlug.get(slug) || [];
    if (jobs.length === 0) continue;
    const md = buildMarkdown(title, jobs, today, slug);
    writeFileSync(join(JOBS_DIR, file), md, 'utf8');
    console.log(`  Wrote jobs/${file} (${jobs.length} jobs)`);
    filesWritten++;
  }

  // README stays at root
  const readme = buildReadme(bySlug, allJobs.length, today);
  writeFileSync(join(OUTPUT_DIR, 'README.md'), readme, 'utf8');
  console.log(`  Wrote README.md`);

  console.log(`\nDone. ${filesWritten} category files + README written to ${OUTPUT_DIR}`);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizeToAnnual(amount, period) {
  if (!amount) return 0;
  const p = (period || '').toLowerCase();
  if (p === 'hour')  return amount * 2080;
  if (p === 'month') return amount * 12;
  return amount; // assume yearly
}

function formatSalary(min, max, currency, period) {
  if (!min) return null;
  const cur = (currency || 'USD').toUpperCase();
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : `${cur} `;
  const fmt = n => n >= 1000 ? `${sym}${Math.round(n / 1000)}K` : `${sym}${n}`;
  const annual = normalizeToAnnual(min, period);
  const annualMax = max ? normalizeToAnnual(max, period) : null;
  if (annualMax && annualMax !== annual) return `${fmt(annual)}–${fmt(annualMax)}/yr`;
  return `${fmt(annual)}/yr`;
}

// ─── CATEGORY DESCRIPTIONS ───────────────────────────────────────────────────

const CATEGORY_DESC = {
  'work-from-home':            'Fully remote jobs across all roles and industries. No office. No commute. Apply directly from company career pages.',
  '100k-plus':                 'Remote roles paying $100,000 or more per year. Salary data pulled directly from job postings.',
  'entry-level':               'Remote jobs open to candidates with 0–2 years of experience. A real way in — no degree gatekeeping.',
  'software-engineer':         'Remote software engineering roles at companies hiring directly. Sourced fresh from Greenhouse, Lever, Ashby and more.',
  'backend':                   'Backend, server-side, and API engineering roles. Node.js, Python, Go, Ruby, Java and beyond.',
  'frontend':                  'Frontend engineering roles. React, Vue, Angular, TypeScript — direct from company career pages.',
  'fullstack':                 'Full-stack engineering roles across product, platform, and startup companies.',
  'developer':                 'General developer and programmer roles that did not fit a more specific category.',
  'devops':                    'DevOps, platform engineering, and infrastructure roles. AWS, GCP, Kubernetes, Terraform.',
  'site-reliability-engineer': 'SRE and reliability engineering roles at companies that take uptime seriously.',
  'data-science':              'Data science, machine learning, and AI engineering roles. Python, SQL, PyTorch, and beyond.',
  'quality-assurance':         'QA, test automation, and SDET roles. Manual and automated testing across all stacks.',
  'product-manager':           'Product manager roles at companies building real products. Sourced directly from career pages.',
  'project-manager':           'Project and program management roles across tech, operations, and enterprise.',
  'ui-ux':                     'UX design, UI design, and product design roles. Figma, research, and end-to-end product work.',
  'marketing':                 'Remote marketing roles across growth, content, brand, and performance channels.',
  'sales':                     'Remote sales roles — account executives, SDRs, and enterprise deals.',
  'customer-support':          'Remote customer support and success roles across SaaS, e-commerce, and tech.',
  'finance':                   'Remote finance, accounting, and analyst roles at companies of all sizes.',
  'hr':                        'Remote HR, recruiting, and people operations roles.',
  'legal':                     'Remote legal, compliance, and counsel roles.',
  'operations':                'Remote operations and business operations roles across industries.',
  'security':                  'Remote cybersecurity, information security, and security engineering roles.',
  'creative':                  'Remote creative roles — copywriters, content creators, graphic designers, and brand specialists.',
  'admin':                     'Remote administrative and executive assistant roles across industries.',
  'extra':                     'Remote jobs across healthcare, retail, hospitality, and other industries not covered by the main categories.',
};

// ─── MARKDOWN BUILDERS ───────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildMarkdown(title, jobs, today, slug) {
  const hasSalary = jobs.some(j => j.salary_min);
  const desc = CATEGORY_DESC[slug] || '';

  const cols = hasSalary
    ? ['Job Title', 'Company', 'Salary', 'Posted', 'Apply']
    : ['Job Title', 'Company', 'Posted', 'Apply'];

  const sep = cols.map(() => '---');

  const lines = [
    `# ${title}`,
    ``,
    desc,
    ``,
    `**${jobs.length} open roles** — Last updated: ${today}`,
    ``,
    `> Browse the full board and filter by salary, skills, and experience at **[jobsearchus.com](https://www.jobsearchus.com)**`,
    ``,
    `| ${cols.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
  ];

  for (const job of jobs) {
    const role    = (job.title || 'Untitled').replace(/\|/g, '-');
    const company = (job.companies?.name || 'Unknown').replace(/\|/g, '-');
    const domain  = job.companies?.domain;
    const url     = job.application_url || '#';
    const salary  = formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period);
    const posted  = formatDate(job.posted_date);

    const companyStr = domain ? `[${company}](https://${domain})` : company;
    if (hasSalary) {
      lines.push(`| ${role} | ${companyStr} | ${salary || '—'} | ${posted} | [Apply](${url}) |`);
    } else {
      lines.push(`| ${role} | ${companyStr} | ${posted} | [Apply](${url}) |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`**[← All categories](../README.md)** · [jobsearchus.com](https://www.jobsearchus.com) · [X](https://x.com/JobSearchUss) · [LinkedIn](https://linkedin.com/company/jobsearchus)`);
  lines.push('');

  return lines.join('\n');
}

function buildReadme(bySlug, totalJobs, today) {
  const totalCats = CATEGORIES.filter(c => !c.virtual && (bySlug.get(c.slug)?.length || 0) > 0).length;

  const featured   = CATEGORIES.filter(c => c.virtual);
  const byCategory = CATEGORIES.filter(c => !c.virtual);

  const badgeLabel = 'jobs';
  const badgeCount = totalJobs.toLocaleString('en-US').replace(/,/g, '%2C');
  const badgeUrl   = `https://img.shields.io/badge/${badgeLabel}-${badgeCount}-blue?style=flat-square`;

  const lines = [
    `# JobSearchUs — Looking for Your Next Job? Just Search Us`,
    ``,
    `[![${totalJobs} jobs](${badgeUrl})](https://www.jobsearchus.com)  [![Updated ${today}](https://img.shields.io/badge/updated-${today}-lightgrey?style=flat-square)](https://github.com/jobsearchus/jobsearchus)`,
    ``,
    `**${totalJobs} jobs** across ${totalCats} categories — updated ${today}`,
    ``,
    `Fresh jobs pulled straight from company career pages — not recycled from job boards.`,
    `Updated 5 times a day across 5,500+ companies worldwide.`,
    ``,
    `Full job board with filters: **[jobsearchus.com](https://www.jobsearchus.com)**`,
    ``,
    `---`,
    ``,
    `## How it works`,
    ``,
    `1. We track 1,500+ company career pages directly`,
    `2. New job postings are detected within hours of going live`,
    `3. Each listing is verified, categorized, and added here — no duplicates, no spam`,
    ``,
    `---`,
    ``,
    `## Browse by Category`,
    ``,
  ];

  lines.push('| Category | Open Roles | Link |');
  lines.push('| --- | --- | --- |');

  for (const { slug, file, title } of [...featured, ...byCategory]) {
    const count = bySlug.get(slug)?.length || 0;
    if (count === 0) continue;
    lines.push(`| ${title} | ${count} | [View →](jobs/${file}) |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Follow us');
  lines.push('');
  lines.push('Stay updated when new jobs drop:');
  lines.push('');
  lines.push('- **Website:** [jobsearchus.com](https://www.jobsearchus.com)');
  lines.push('- **X (Twitter):** [@JobSearchUss](https://x.com/JobSearchUss)');
  lines.push('- **LinkedIn:** [jobsearchus](https://linkedin.com/company/jobsearchus)');
  lines.push('- **Instagram:** [@jobsearchus_](https://instagram.com/jobsearchus_)');
  lines.push('- **Bluesky:** [jobsearchus.bsky.social](https://bsky.app/profile/jobsearchus.bsky.social)');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*Updated ${today} · Jobs sourced directly from company career pages · [jobsearchus.com](https://www.jobsearchus.com)*`);
  lines.push('');

  return lines.join('\n');
}

main().catch(err => { console.error(err); process.exit(1); });
