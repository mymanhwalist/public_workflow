# JobSearchUs — API Scraper Setup & Usage

## Requirements
- Node.js v18 or higher — download from https://nodejs.org (choose LTS version)

---

## Setup (one time only)

1. Unzip this folder anywhere on your PC
2. Open terminal / command prompt inside the folder
3. Run:
   ```
   npm install
   ```
   This installs `@supabase/supabase-js` and `groq-sdk`.

---

## Current State (as of 2026-05-17)

| Metric | Count |
|--------|-------|
| Companies in DB2 | 5,160 |
| Total configs | **5,757** |
| Active API endpoints (workflow 1) | **1,535** — Greenhouse (606), Breezy HR (311), Lever (205), Ashby (137), Recruitee (108), SmartRecruiters (106), Workable (41), Eightfold (3) |
| No-date API endpoints (workflow 5) | **27** — Jobvite only |
| Sitemap-only configs (not yet scraped) | **4,181** — Custom (2,032), null/unknown (2,122), BrassRing (15), iCIMS (5), SuccessFactors (7) |
| Jobs in Main DB | 326 published + 563 refined unpublished |
| Refine rate | ~480/day → Main DB (8 runs × 60 limit) |
| Publish rate | ~30/day → visible on website (is_published=true) |
| raw_jobs total | ~148,714 |

---

## Running the Scraper

### Normal run (scrape all due companies)
```
node scraper.js
```
- Scrapes all 1,566 companies that haven't been scraped in the last 6 hours
- New jobs → saved as `status=pending` in DB2
- Already seen jobs → `last_seen_at` updated only
- **90-minute wall-clock limit** — exits gracefully before GitHub's 2h job timeout
  Next scheduled run picks up from oldest-unscraped configs automatically

### Quick test (5 companies)
```
node scraper.js --limit=5
```

### Force re-scrape (ignore 6h cooldown)
```
node scraper.js --force
```

### Scrape specific ATS provider only
```
node scraper.js --provider=Greenhouse
node scraper.js --provider=Lever
node scraper.js --provider=Ashby
```

### Scrape only reliable-date providers (workflow 1 mode)
```
node scraper.js --reliable-dates-only
```

### Scrape only no-date providers (workflow 5 mode — baseline collection)
```
node scraper.js --no-date-providers
```

### Dry run (no DB writes, just prints)
```
node scraper.js --dry-run
```

---

## Running the Refiner

Promotes fresh pending jobs from DB2 → Main DB with `is_published=false` (pool).
Uses Groq LLM (`llama-4-scout-17b-16e-instruct`) to extract skills, category, job type,
experience level, salary, responsibilities, requirements summary, and location.

```
node refiner-groq.js
```

### Options
```
node refiner-groq.js --max-per-company=3   → max 3 jobs promoted per company (default: 1)
node refiner-groq.js --limit=60            → process first N jobs only (default: 60)
node refiner-groq.js --dry-run             → print only, no DB writes
node refiner-groq.js --skip-freshness      → bypass 48h freshness check (for testing)
node refiner-groq.js --from-promoted       → run on already-promoted jobs (for testing)
```

- Only promotes jobs posted within the last 48 hours (unless `--skip-freshness`)
- Inserts into Main DB with `is_published=false` — jobs are NOT visible on website yet
- Skips jobs with no description, stale jobs, junk titles
- Global strategy — no US-only filter
- Groq extracts: `skills`, `category`, `job_type`, `experience_level`, `commitment_type`,
  `salary_min/max`, `requirements_summary`, `responsibilities`, `min_years_exp`, `location_country`
- Rule-based fallback kicks in if Groq fails or is rate-limited
- Limit set to 60/run to stay within Groq free tier (500k tokens/day)

### Requires
- `GROQ_API_KEY` env var (set in GitHub Actions secret)

### Main DB columns (all added — no action needed)
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS min_years_exp smallint;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS responsibilities text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements_summary text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_published boolean DEFAULT false;
```

---

## Running the Publisher

Flips up to 6 jobs per run from `is_published=false` → `is_published=true` (visible on website).
Picks 1 job per category first (coverage), then fills remaining slots from any category.

```
node publisher.js
```

### Options
```
node publisher.js --limit=6    → publish N jobs (default: 6)
node publisher.js --dry-run    → print only, no DB writes
```

- Publishes 6/run × 5 runs/day = **30 jobs/day** on website
- Covers all categories evenly over the course of a day
- Jobs appear gradually (every ~5 hours) — looks natural to Google

---

## Offline Sample Comparison (compare-groq-sample.js)

Fetches 20 jobs from DB2 and runs Groq on them locally. Saves `sample-comparison.json`
with both raw and refined data side-by-side — useful for testing before deploying.

```
node compare-groq-sample.js
```

---

## Running the Markdown Generator

Generates per-category remote job markdown files and writes them to a local directory.
Pushes to `github.com/jobsearchus/jobsearchus` via GitHub Actions (workflow 4).

```
node markdown-generator.js
```

### Options
```
node markdown-generator.js --output-dir=../jobsearchus-repo   → where to write files (default: ./jobs-output)
node markdown-generator.js --days=30                          → include jobs from last N days (default: 30)
node markdown-generator.js --dry-run                          → print counts, no files written
```

### Files generated
| File | Contents |
|------|----------|
| `work-from-home-jobs.md` | Top 200 most recent remote jobs (cross-category) |
| `100k-plus-jobs.md` | Jobs with salary_min ≥ $100,000 — includes salary column |
| `entry-level-jobs.md` | Jobs with experience_level = 'entry' — includes category column |
| `software-engineer-jobs.md` | Engineering: software engineer titles |
| `backend-jobs.md` | Engineering: backend / server-side titles |
| `frontend-jobs.md` | Engineering: frontend / React / Vue titles |
| `fullstack-jobs.md` | Engineering: fullstack titles |
| `devops-jobs.md` | Engineering: DevOps / infrastructure / platform titles |
| `site-reliability-engineer-jobs.md` | Engineering: SRE titles |
| `data-science-jobs.md` | Data: data scientist / ML / analytics titles |
| `quality-assurance-jobs.md` | Engineering: QA / test engineer titles |
| `product-manager-jobs.md` | Product category |
| `project-manager-jobs.md` | Project Management category |
| `ui-ux-jobs.md` | Design category |
| `marketing-jobs.md` | Marketing category |
| `sales-jobs.md` | Sales category |
| `customer-support-jobs.md` | Customer Support category |
| `finance-jobs.md` | Finance category |
| `hr-jobs.md` | HR category |
| `legal-jobs.md` | Legal category |
| `operations-jobs.md` | Operations category |

### Requires
- `MAIN_DB_URL` and `MAIN_DB_KEY` env vars

---

## Running Cleanup

Removes jobs older than 7 days from Main DB. Run manually when needed.

```
node cleanup.js
node cleanup.js --dry-run   → preview only
```

---

## Discovering New Companies (discover-companies.js)

Probes ATS APIs to find new companies and add their endpoints to DB2.

### Full run (YC + existing DB2 companies)
```
node discover-companies.js
```

### YC companies only (~23,500 companies)
```
node discover-companies.js --yc-only
```

### Existing DB2 companies without API endpoint
```
node discover-companies.js --db-only
```

### Batch mode (1,000 companies at a time — recommended to avoid crashes)
```
node discover-companies.js --yc-only --limit=1000              → pages 1–10
node discover-companies.js --yc-only --start-page=11 --limit=1000  → pages 11–20
node discover-companies.js --yc-only --start-page=21 --limit=1000  → pages 21–30
```
Each batch = ~10 pages = ~1,000 companies. 235 pages total = 24 batches.

### Run all 24 batches automatically
```bash
for start in 1 11 21 31 41 51 61 71 81 91 101 111 121 131 141 151 161 171 181 191 201 211 221 231; do
  node discover-companies.js --yc-only --start-page=$start --limit=1000
done
```

### Dry run (no DB writes)
```
node discover-companies.js --dry-run
```

### Reliable ATS providers probed
| ATS | Notes |
|-----|-------|
| Greenhouse | 404 for unknown slugs ✓ |
| Lever | 404 for unknown slugs ✓ |
| Ashby | 404 for unknown slugs ✓ |
| Recruitee | 404 for unknown slugs ✓ |
| Breezy HR | 404 for unknown slugs ✓ |
| Eightfold | 404 for unknown slugs ✓ |
| SmartRecruiters | ❌ excluded — returns 200 for any slug |
| Workable | ❌ excluded — returns 403 for everything |

---

## GitHub Actions Workflows

Hosted on `github.com/mymanhwalist/public_workflow` (public repo — unlimited minutes).

| Workflow | Schedule | What it does |
|----------|----------|--------------|
| 1 — Scrape | **12× daily** (every 2h, on the hour) | Reliable-date providers only (1,118 endpoints) → DB2 raw_jobs |
| 2 — Refine | **8× daily** (every 3h, :30 past) | 60 jobs/run → Main DB (`is_published=false`) |
| 3 — Publish | 5× daily (01, 06, 11, 16, 21 UTC) | 6 jobs/run → flip `is_published=true` on website |
| 4 — Markdown | 5× daily (01:30, 06:30, 11:30, 16:30, 21:30 UTC) | Generate .md files → push to jobsearchus/jobsearchus |
| 5 — Scrape All | **12× daily** (every 2h, :30 past) | All 5,757 endpoints → collect job IDs as baseline |

- Workflow 1: `--reliable-dates-only` — **1,535 endpoints**: Greenhouse, Lever, Ashby, Workable, Eightfold, Recruitee, SmartRecruiters, Breezy HR. Each endpoint hit ~2×/day
- Workflow 2: 8 runs × 60 limit = **~480 jobs/day** refined. Max 3 jobs per company per run
- Workflow 3: picks 1 job per category first, fills to 6. ~30/day visible on website
- Workflow 4: generates category markdown files, commits "latest jobs updated"
- Workflow 5: `--no-date-providers` — **27 Jobvite endpoints** only (only truly no-date provider). Builds job ID baseline so new IDs = new jobs
- No workflow auto-deletes jobs. Run `cleanup.js` manually to remove stale jobs.

**ATS Provider Status:**
| Provider | Endpoints | Has Date? | Workflow |
|---|---|---|---|
| Greenhouse | 606 | ✅ 100% | 1 |
| Breezy HR | 311 | ✅ 100% | 1 |
| Lever | 205 | ✅ 100% | 1 |
| Ashby | 137 | ✅ 100% | 1 |
| Recruitee | 108 | ✅ 100% | 1 |
| SmartRecruiters | 106 | ✅ 100% | 1 |
| Workable | 41 | ✅ 100% | 1 (fixed 2026-05-17) |
| Eightfold | 3 | ✅ 100% | 1 |
| Jobvite | 27 | ❌ 0% | 5 (ID baseline only) |
| Custom | 2,032 | — | ❌ sitemap only |
| null/unknown | 2,122 | — | ❌ sitemap only |
| BrassRing/iCIMS/SF | 27 | — | ❌ sitemap only |

**⚠️ Note:** Workflows hosted on `mymanhwalist/public_workflow`. Previous host `jobsearchus/workflow` hit usage limits.

---

## DB2 Supabase Project
- URL: `https://buowaosqezcvdpdjcewq.supabase.co`
- Tables: `companies`, `career_page_configs`, `raw_jobs`, `scrape_runs`

## Main DB Supabase Project
- URL: `https://osoilvzyyjmrbjsiyrgs.supabase.co`
- Tables: `jobs`, `companies`, `locations`, `job_skills`, `skills`
- New columns: `min_years_exp`, `responsibilities`, `requirements_summary` (2026-05-09), `is_published` (2026-05-14)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `node: command not found` | Install Node.js from nodejs.org |
| `Cannot find module` | Run `npm install` first |
| `Invalid API key` | Set env vars: `DB2_URL`, `DB2_KEY`, `MAIN_DB_URL`, `MAIN_DB_KEY`, `GROQ_API_KEY` |
| Scraper stops mid-run | Just run again — skips already-scraped configs (6h cooldown) |
| Discovery script crashes | Restart — skips already-found domains automatically |
| No new jobs on website | Run `node refiner-groq.js` then `node publisher.js` |
| All jobs show stale | Normal if no new scrape in 48h — use `--skip-freshness` for testing |
| Groq rate limit hit | Script auto-waits and retries — just leave it running |
| GitHub Actions not running | Check billing at github.com/settings/billing (jobsearchus account) |
| Markdown files not updating | Verify `GH_PAT` secret is set in jobsearchus/workflow → Settings → Secrets |
