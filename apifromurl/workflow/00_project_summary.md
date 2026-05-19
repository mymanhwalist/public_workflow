# Job Board — Full Project Summary
Last updated: 2026-05-17

---

## What We Are Building
A job board that scrapes jobs directly from company career pages (API endpoints, sitemaps) instead of relying on aggregators like LinkedIn or Indeed. Only fresh, verified, direct-from-company jobs.

---

## Architecture — 2 Database Design

```
DB2 — Staging DB (vmdbwpqopujirdcthgta)       Main DB — Production (new Supabase project)
─────────────────────────────────────          ────────────────────────────────────────────
companies                                       companies
career_page_configs          Scraper            jobs
raw_jobs              ──→  fetches jobs  ──→   locations
scrape_runs                      ↓             skills
                         Extraction script      job_skills
                         (GitHub Actions)
                         extracts fields
                         from raw job data
```

### DB2 — Staging DB (`buowaosqezcvdpdjcewq`) ✅ Live
**Purpose:** Company registry + scraper configs + raw job queue.

**Tables:**
- `companies` — 5,160 rows (merged from hiring.cafe + remote100k + YC discovery, deduped by domain)
- `career_page_configs` — 1,566 rows (all API verified, active)
- `raw_jobs` — growing continuously. Dedup log + extraction queue + job history
- `scrape_runs` — audit log per scrape run, tracks first scrape per company

**Scraper status:** Running. 5,757 total configs broken down as:
- **1,535 active API endpoints** (workflow 1) — all return reliable `posted_date`
- **27 no-date API endpoints** (workflow 5, Jobvite) — ID baseline collection only
- **4,181 sitemap-only configs** — need sitemap scraper (not yet built for these)
- **27 unverified API configs** — not scraped yet

New jobs with `posted_date` → `status=pending` → refiner. New jobs without `posted_date` → `status=skipped_no_date`. Already seen jobs → `last_seen_at` updated.

### Main DB — Production (`osoilvzyyjmrbjsiyrgs`) ✅ Live
**Purpose:** Clean, enriched, website-ready data only.

**Tables:** `companies`, `jobs`, `locations`, `skills`, `job_skills`, `saved_jobs`, `applied_jobs`

**New columns (2026-05-14):** `min_years_exp`, `responsibilities`, `requirements_summary`, `is_published`

**Current state (2026-05-17):**
- `jobs` — 326 with `is_published=true` (visible on website) + 563 with `is_published=false` (refined pool)
- Refine rate: ~480 jobs/day → Main DB (8 runs × 60 limit)
- Publish rate: ~30 jobs/day → flipped to `is_published=true` (visible on website)

Every row here has been:
1. Scraped from a working API with full description fetched
2. Passed through Groq LLM (llama-4-scout) for skill/category/location/salary extraction
3. Confirmed as fresh (posted within last 48h)
4. Inserted with `is_published=false` — held in pool until publisher releases it

---

## Current State of Source Data

### DB1 — hiring.cafe (`bojsbsoqpnuzikyzpjlh`) — READ ONLY going forward
| Table | Rows | Notes |
|---|---|---|
| `jobs` | 4,630 | Old hiring.cafe data — not from our scraper |
| `companies` | 2,390 | Company profiles |
| `career_pages` | 1,592 | **419 verified working API endpoints** as of 2026-02-07 |
| `skills` | 5,136 | Skills dictionary — useful for extraction |

### DB2 — Staging (`buowaosqezcvdpdjcewq`) — Current data quality
| Table | Rows | Usable | Notes |
|---|---|---|---|
| `remote100k_companies` | 475 | Partial | 290 have website, 296 have logo, 0 have founded_year, descriptions are wrong (nav boilerplate) |
| `remote100k_jobs` | 74 | Yes | ATS provider detected, application_url correct. api_endpoint is null (bug — needs re-derivation from application_url) |
| `career_pages` (wellfound) | 4,830 | Partial | 2,010 have api_endpoint (mostly sitemaps, unverified). CSS-only configs are low priority |

### Usable API sources right now
| Source | Count | Quality |
|---|---|---|
| DB1 career_pages (verified) | 419 | Best — live tested 2026-02-07 |
| remote100k_jobs (derive from application_url) | ~54 | Good — need endpoint derivation |
| wellfound sitemaps (unverified) | ~2,010 | Low — mostly generic sitemaps, many broken |

---

## The Full Pipeline (5-Step, as of 2026-05-17)

```
Step 1 — Scraper (GitHub Actions: 12× daily, every 2h on the hour)
  Reliable-date providers only: Greenhouse (606), Breezy HR (311), Lever (205), Ashby (137),
  Recruitee (108), SmartRecruiters (106), Workable (41), Eightfold (3) = 1,535 endpoints
  ~180 configs/run (90-min wall limit), oldest-scraped-first
  For each job returned:
    Check raw_jobs.application_url → exists? update last_seen_at, skip
    New job + has posted_date + not first scrape? → status = pending
    New job + no posted_date + not first scrape? → status = skipped_no_date (ID only, refiner skips)
    New job + company's first scrape? → status = skipped_first_scrape (baseline)
  Log result to scrape_runs

Step 1b — Scrape No-Date Providers (GitHub Actions: 12× daily, every 2h at :30)
  ONLY Jobvite endpoints (27) — the only verified API provider that never returns posted_date
  Saves job IDs to raw_jobs as skipped_no_date (baseline collection only — refiner never touches)
  Purpose: build job ID baseline so future scrapes detect truly new IDs by delta

Step 2 — Refiner (GitHub Actions: 8× daily, every 3h at :30)
  Read raw_jobs WHERE status = 'pending' AND posted_date within last 48h
  60 jobs/run → ~480 jobs/day
  Groq LLM (llama-4-scout-17b-16e-instruct) extracts:
    skills, category, job_type, experience_level, commitment_type,
    salary_min/max, responsibilities, requirements_summary, min_years_exp, location_country
  Rule-based fallback if Groq fails or rate-limits
  Max 3 jobs per company per run
  Insert into Main DB jobs with is_published=false (pool — not visible on website)
  Update raw_jobs.status = 'promoted', is_promoted = true
  Note: GROQ_API_KEY read from env var only (not hardcoded)

Step 3 — Publisher (GitHub Actions: 5× daily at 01,06,11,16,21 UTC)
  Read Main DB jobs WHERE is_published = false, ordered by posted_date ASC
  Pick 1 job per category first (ensures category variety)
  Fill remaining slots from any category (up to 6 total per run)
  Flip is_published = true → job appears on website
  6/run × 5 runs/day = ~30 jobs/day published (natural drip for Google)

Step 4 — Markdown Generator (GitHub Actions: 5× daily at 01:30,06:30,11:30,16:30,21:30 UTC)
  Runs 30 min after publisher
  Queries Main DB: all is_published=true AND job_type=remote jobs (last 30 days)
  Groups jobs into per-category markdown files
  Pushes to public repo: github.com/jobsearchus/jobsearchus
  Files generated:
    work-from-home-jobs.md  → top 200 most recent remote jobs (cross-category)
    100k-plus-jobs.md       → jobs with salary_min >= $100K (with salary column)
    entry-level-jobs.md     → jobs with experience_level = 'entry' (with category column)
    software-engineer-jobs.md, backend-jobs.md, frontend-jobs.md, fullstack-jobs.md,
    devops-jobs.md, site-reliability-engineer-jobs.md, data-science-jobs.md,
    quality-assurance-jobs.md, product-manager-jobs.md, project-manager-jobs.md,
    ui-ux-jobs.md, marketing-jobs.md, sales-jobs.md, finance-jobs.md,
    hr-jobs.md, legal-jobs.md, operations-jobs.md, customer-support-jobs.md
  Commit message: "latest jobs updated"
  Uses GH_PAT secret for cross-repo push

Website queries Main DB WHERE is_published = true only
```

---

## Freshness Rule
```
raw_jobs status values:
  pending            → new job with posted_date — queued for Groq refiner
  skipped_first_scrape → job seen on company's first-ever scrape (age unknown, baseline only)
  skipped_no_date    → new job ID found but no posted_date — ID collected, refiner never touches
  skipped_stale      → posted_date older than 48h — refiner skipped it
  skipped_no_desc    → no description available — refiner skipped it
  promoted           → successfully refined and inserted into Main DB
  error              → refiner hit an error processing this job

First scrape of a company:
  → All jobs → raw_jobs (status = skipped_first_scrape)
  → Nothing promoted to Main DB
  → Age unknown, could be months old

Second scrape onwards:
  → Job not in raw_jobs + has posted_date = FRESH → status = pending → refiner → Main DB
  → Job not in raw_jobs + no posted_date = NEW ID → status = skipped_no_date (baseline only)
  → Job already in raw_jobs = OLD → update last_seen_at only
```

## Dedup Rule
```
application_url UNIQUE constraint on raw_jobs
  → same job from any source = blocked at DB level
  → tracking params stripped before insert (utm_*, ref=, source=)
```

---

## Groq LLM Extraction (llama-4-scout, free tier)

| Field | Method |
|---|---|
| skills | Groq extracts from description text |
| category | Groq classifies from title + description |
| job_type | Groq: remote / hybrid / onsite |
| commitment_type | Groq: full_time / part_time / contract / internship |
| experience_level | Groq: entry / mid / senior / lead / executive |
| salary_min/max | Groq + regex fallback |
| responsibilities | Groq summarizes from description |
| requirements_summary | Groq summarizes from description |
| min_years_exp | Groq extracts numeric value |
| location_country | Groq normalizes from location_raw |

Rule-based fallback kicks in if Groq fails or hits rate limit.
ATS API jobs (Greenhouse, Lever, Ashby) are pre-structured — most fields available directly.

### 21 Job Categories
`Engineering` · `Design` · `Healthcare` · `Product` · `Project Management` · `Marketing` · `Sales` · `Data` · `Finance` · `HR` · `Legal` · `Customer Support` · `Security` · `Research` · `Hospitality` · `Retail` · `Admin` · `Creative` · `Operations` · `Executive` · `Other`

---

## Tech Stack
- **Runtime:** Node.js (ESM)
- **HTTP/Scraping:** native fetch + Cheerio (static HTML) + Playwright (JS-heavy sites, future CSS scrapers)
- **Database client:** @supabase/supabase-js
- **Scheduler:** GitHub Actions (cron schedule) — hosted on mymanhwalist/public_workflow (public repo = unlimited minutes)
- **LLM Extraction:** Groq API — llama-4-scout-17b-16e-instruct (free tier, 500k tokens/day)
- **Frontend:** Next.js App Router, deployed on Vercel

## GitHub Actions Workflows (mymanhwalist/public_workflow)
| Workflow | Schedule | What it does |
|---|---|---|
| 1 — Scrape | **12× daily** (every 2h, on the hour) | 1,535 reliable-date endpoints → DB2 raw_jobs (`pending`) |
| 2 — Refine | **8× daily** (every 3h, at :30) | 60 jobs/run → Main DB (`is_published=false`) ~480/day |
| 3 — Publish | 5× daily (01,06,11,16,21 UTC) | 6 jobs/run → flip `is_published=true` on website |
| 4 — Markdown | 5× daily (01:30,06:30,11:30,16:30,21:30 UTC) | Generate .md files → push to jobsearchus/jobsearchus |
| 5 — Scrape No-Date | **12× daily** (every 2h, at :30) | 27 Jobvite endpoints → `skipped_no_date` baseline only |

**ATS Provider breakdown (workflow 1 — reliable dates):**
| Provider | Endpoints | Has Date? |
|---|---|---|
| Greenhouse | 606 | ✅ 100% |
| Breezy HR | 311 | ✅ 100% |
| Lever | 205 | ✅ 100% |
| Ashby | 137 | ✅ 100% |
| Recruitee | 108 | ✅ 100% |
| SmartRecruiters | 106 | ✅ 100% |
| Workable | 41 | ✅ 100% (fixed 2026-05-17) |
| Eightfold | 3 | ✅ 100% |
| **Total** | **1,535** | |

**No-date providers (workflow 5 — ID baseline only):**
| Provider | Endpoints | Has Date? |
|---|---|---|
| Jobvite | 27 | ❌ 0% |

**Not scraped yet (sitemap-only — need sitemap scraper):**
| Provider | Configs |
|---|---|
| Custom / unknown | 4,154 |
| BrassRing / iCIMS / SuccessFactors | 27 |

## Supabase Projects
| Role | Project ID | Status |
|---|---|---|
| DB1 — hiring.cafe (read-only source) | `bojsbsoqpnuzikyzpjlh` | Existing, read-only |
| DB2 — Staging DB | `buowaosqezcvdpdjcewq` | ✅ Live, 1,566 configs active |
| Main DB — Production | `osoilvzyyjmrbjsiyrgs` | ✅ Live, 326 published + 563 unpublished |

---

## Frontend Filters (Main DB supports all of these)
- Remote / hybrid / onsite
- Salary range
- Experience level
- Date posted (24h / 1 week / 2 weeks / 1 month)
- Industry (from companies.industry[])
- Company
- Job type / commitment type
- Skills
- Full-text search (title + description)
- Location (city / country)

---

## Social Media Accounts

| Platform | Status | URL |
|---|---|---|
| Instagram | ✅ Created | instagram.com/jobsearchus_ |
| X (Twitter) | ✅ Created | x.com/JobSearchUss |
| Threads | ✅ Created | threads.com/@jobsearchus_ |
| Pinterest | ✅ Created | pinterest.com/JobSearchUsa |
| YouTube | ✅ Created | youtube.com/@JobSearchUs |
| Bluesky | ✅ Created | bsky.app/profile/jobsearchus.bsky.social |
| Truth Social | ✅ Created | truthsocial.com/@JobSearchUs |
| LinkedIn | ✅ Created | linkedin.com/company/jobsearchus |
| Facebook | ✅ Created | facebook.com/jobsearchuss |
| TikTok | ⏳ Skipped | Banned in India — add later |
| Snapchat | ⏳ Remaining | Temporarily blocked — retry later |
| Reddit | ❓ Consider | r/jobs, r/cscareerquestions, r/remotework |

---

## Files in This Folder
| File | Contents |
|---|---|
| `00_project_summary.md` | This file — full project summary |
| `01_database_overview.md` | Current state of all source databases |
| `02_main_db_schema.md` | Main DB (production) table definitions |
| `03_schema_flowchart.md` | Mermaid diagrams |
| `04_full_architecture.md` | Full pipeline architecture |
| `05_todo_list.md` | Ordered build phases and current progress |
| `06_remote100k_scraping.md` | remote100k scraping plan and data quality notes |
| `sql/db2_staging_schema.sql` | DB2 staging schema SQL — run in vmdbwpqopujirdcthgta |
| `sql/main_db_schema.sql` | Main DB schema SQL — run in new Supabase project |
| `sql/remote100k_tables.sql` | Temp remote100k tables (to be deleted after migration) |
