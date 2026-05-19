# Todo List — Job Board Build
Last updated: 2026-05-14

Ordered by phase. Do not skip phases — each one feeds the next.

---

## PHASE 0 — Already Done ✅
- [x] ATS detector built (`ats-detector.js`) — 12 providers with public API
- [x] API endpoint finder built (`check-all-urls.js`)
- [x] Sitemap finder built (`sitemap-finder.js`)
- [x] Job scraper built (`job-scraper.js`) — Lever, Greenhouse, Ashby, SmartRecruiters, Jobvite, Eightfold, Breezy HR, sitemaps
- [x] API verifier built (`verify-apis.js`)
- [x] Scheduler built (`scheduler.js`)
- [x] remote100k scraper built (`scrapers/remote100k/scrape.js`)
- [x] Chrome extension built (`extension/`) — for remote100k scraping
- [x] DB1 career_pages populated — 419 verified working API endpoints (as of 2026-02-07)
- [x] DB2 remote100k_companies populated — 475 rows
- [x] DB2 remote100k_jobs populated — 74 rows with ATS detected
- [x] DB2 career_pages (wellfound) — 4,830 rows
- [x] DB2 staging schema designed and SQL written (`sql/db2_staging_schema.sql`)

---

## PHASE 1 — Set Up DB2 Permanent Schema ✅ DONE
> New DB2: `buowaosqezcvdpdjcewq`

- [x] Run `sql/db2_staging_schema.sql` in DB2 Supabase SQL editor
- [x] Verify all 4 tables created with correct columns and indexes

---

## PHASE 2 — Create Main DB
> New Supabase project for production data

- [ ] Create new Supabase project (Main DB)
- [ ] Write `sql/main_db_schema.sql`
- [ ] Run SQL to create: `companies`, `locations`, `jobs`, `skills`, `job_skills`
- [ ] Add indexes: `posted_date`, `job_type`, `experience_level`, `company_id`, full-text search
- [ ] Seed `skills` table from DB1 skills (5,136 entries)
- [ ] Save Main DB project URL + keys to `.env`

---

## PHASE 3 — Migrate Data into DB2 Permanent Tables ✅ DONE
> Completed via `migrate-to-db2.js`

- [x] Migrate DB1 companies → DB2 `companies` (2,991 total, deduped by domain)
- [x] Migrate remote100k_companies → DB2 `companies` (merged, category=top500)
- [x] Migrate DB1 career_pages → DB2 `career_page_configs` (434 API verified)
- [x] Derive + migrate remote100k verified APIs → DB2 `career_page_configs` (158 working)
- [x] Sitemap configs migrated (843 sitemap configs)

---

## PHASE 4 — Verify All Configs ✅ DONE
- [x] 434 API configs verified and active (is_verified=true)
- [x] Scraper auto-disables configs after 3 consecutive failures

---

## PHASE 5 — Build New Scraper ✅ DONE
> `scraper.js` — live and running

- [x] Scraper built — routes by ats_provider (Greenhouse, Lever, Ashby, SmartRecruiters, Breezy HR, Workable, Jobvite)
- [x] First scrape logic — `skipped_first_scrape` status
- [x] Second scrape onwards — new jobs get `status=pending`
- [x] Dedup via `application_url` UNIQUE constraint
- [x] Tracking param stripping (utm_*, ref=, source=)
- [x] `scrape_runs` audit log
- [x] First full scrape completed — 66,455+ jobs in raw_jobs
- [x] Scraper zip packaged for running on other PCs (`JobSearchUs-Scraper.zip`)
- [x] Detail API fetch added for new jobs — Greenhouse, SmartRecruiters, Breezy HR now save full description on insert
- [x] `--max-jobs=N` flag added — limits jobs fetched per config (useful for fresh sample runs)

---

## BACKLOG — Fix Workable Scraper ✅ DONE (2026-05-10)
- [x] Root cause: Workable v3 API requires POST with `{limit: 100, nextPage}` — was using GET
- [x] Added `scrapeFromWorkable()` in `job-scraper.js` — POST with cursor pagination
- [x] `posted_date` mapped from `raw.created_at` (reliable date source)

---

## BACKLOG — iCIMS API Endpoints
- [ ] Query DB2 for iCIMS sitemap URLs to extract customer IDs
- [ ] Derive correct `api.icims.com/customers/{customerId}/search/portals/jobs` endpoint for each company
- [ ] Update those rows: `source_type = 'api'`, `api_endpoint` filled in, `ats_provider = 'iCIMS'`
- [ ] Build iCIMS scraper in `scraper.js` (later — endpoint discovery first)

---

## BACKLOG — DB1 New Application URLs
- [ ] 672 rows in DB1 `career_pages` have `application_url` but no `api_endpoint`
- [ ] 178 of them can have API endpoints derived via detectATS() (Greenhouse: 63, Ashby: 41, Lever: 29, SmartRecruiters: 16, BambooHR: 14, Breezy HR: 10, Jobvite: 3, Workable: 2)
- [ ] Live-test derived endpoints → save working ones to DB2 `career_page_configs`
- [ ] Script ready — just needs approval to run

---

## PHASE 2 — Create Main DB ✅ DONE

- [x] Create new Supabase project (Main DB) — `osoilvzyyjmrbjsiyrgs`
- [x] Write `sql/main_db_schema.sql`
- [x] Run SQL — tables created: `companies`, `locations`, `skills`, `jobs`, `job_skills`, `saved_jobs`, `applied_jobs`
- [x] Verified all tables created correctly

---

## PHASE 6 — Build Extraction Script ✅ DONE
> `refiner.js` — live and tested

- [x] Rule-based extractor built — no AI, no external APIs
- [x] Provider-specific extraction: Greenhouse, Lever, Ashby, SmartRecruiters, Breezy HR
- [x] Salary regex: `$120k`, `$120,000`, `£50k-£70k`, `$45/hr`
- [x] job_type, commitment_type, experience_level, category from title + description
- [x] Company resolver: find or create in Main DB, enriched from DB1
- [x] Location resolver: parse location_raw → find or create
- [x] Junk filter: skips internal referral programs and placeholder postings
- [x] Only processes jobs WHERE description IS NOT NULL (skips old jobs without descriptions)
- [x] Batch fetch (200/batch) to avoid Supabase query timeout
- [x] `--dry-run` and `--limit=N` flags
- [x] 730 jobs promoted to Main DB — 100% have descriptions, 73% experience_level, 100% company+location connected
- [x] Skills seeded from DB1 — 6,836 skills in Main DB
- [x] Skill extraction added to refiner — matches description text against skills dictionary
- [x] `backfill-skills.js` — backfilled 724/730 existing jobs → 15,552 job_skills rows
- [x] Location country parsing fixed (CA=Canada not California, DE=Germany, IN=India)
- [x] `seed-skills.js` — run once to seed skills from DB1
- [x] 21 job categories added (was 13) — Healthcare, Product, Project Management, Creative, Retail, Admin, Hospitality, Executive, etc.
- [x] Category backfill run on existing 730 jobs

---

## PHASE 10 — Website ✅ LIVE (deployed 2026-05-14)
> Next.js App Router frontend, queries Main DB only (is_published=true filter everywhere)

### Done
- [x] Next.js project created (`jobsearchus/`) — App Router, Supabase JS client wired up
- [x] Navbar — logo, Reddit subreddit button, Sign In button; sticky with blur backdrop
- [x] SearchBar — keyword + location fields with live autocomplete (250ms debounce, DB suggestions), X clear buttons, popular tag shortcuts that fill + search, syncs state from URL params
- [x] Job listings page (`/`) — search + sidebar filters (work type, experience, job type, salary range) + toolbar filters (Has Salary toggle, Category dropdown, Last Updated)
- [x] JobCard — logo, title, company (clickable → company profile), location, salary, tags; salary $0k display fix
- [x] JobsGrid — pagination (15/page), async buildQuery (pre-fetches company/location IDs to avoid Supabase foreign-table OR bug), grid/list toggle UI
- [x] Sidebar — work type, experience level, job type, salary min/max filters; clear all; active filter count badge
- [x] Job detail page (`/jobs/[id]`) — HTML description rendering, breadcrumb, pill tags, Apply/Save/Share buttons, Job Details sidebar, Company sidebar, Similar Jobs section
- [x] Company profile page (`/companies/[slug]`) — hero banner, logo, stats, Overview tab (about + recent jobs), Jobs tab (full list); Reviews/Culture/Benefits tabs removed pending real data
- [x] Footer — near-black (#1C1E21) background, 9 social platforms with brand SVGs, centered layout
- [x] `is_published=true` filter added to all queries: home page, jobs grid, sitemap, job detail, company page
- [x] Deployed to Vercel — live at jobsearchus.com

### Remaining
- [ ] `view_count` / `click_count` tracking on job clicks
- [ ] Sign In button — Google OAuth via Supabase (see Phase 8)
- [ ] Sign-in wall — logged-in users see full job pool (is_published=false included)
- [x] Work-from-anywhere style GitHub repo — `jobsearchus/jobsearchus` (2026-05-14)
  - markdown-generator.js + workflow 4 live
  - Files: work-from-home, 100k-plus, entry-level, + 18 category files
  - NOTE: jobsearchus account billing issue blocking Actions — fix at github.com/settings/billing
- [ ] JobPosting schema on job detail page (see Phase 8)

---

## PHASE 7 — GitHub Actions Setup ✅ DONE (2026-05-14)
> Automate everything, zero cost. Moved to mymanhwalist/workflow (public repo = unlimited minutes)

- [x] `.github/workflows/1-scrape-jobs.yml` — 5× daily (00,05,10,15,20 UTC), 1,000 endpoints/run
- [x] `.github/workflows/2-refine-jobs.yml` — 5× daily (30min offset), 60 jobs/run (~300/day), max 3/company
- [x] `.github/workflows/3-publish-jobs.yml` — 5× daily (01,06,11,16,21 UTC), 6 jobs/run (~30/day visible)
- [x] `.github/workflows/4-markdown-jobs.yml` — 5× daily (01:30,06:30,11:30,16:30,21:30 UTC), pushes .md files to jobsearchus/jobsearchus
- [x] Refiner uses Groq LLM (llama-4-scout) for skill/location/category extraction
- [x] `is_published` column added to Main DB jobs — refiner inserts `false`, publisher flips `true`
- [x] `publisher.js` built — picks 1/category for coverage, fills to limit, flips is_published=true
- [x] `markdown-generator.js` built — generates per-category .md files from published remote jobs
- [x] Moved from asuranovel (2,000 min/month limit hit) → jobsearchus/workflow (public = unlimited)
- [x] All hardcoded keys removed from public repo — all from env vars only
- [x] Secrets set: DB2_URL, DB2_KEY, MAIN_DB_URL, MAIN_DB_KEY, DB1_URL, DB1_KEY, GROQ_API_KEY, GH_PAT
- [x] Full cycle confirmed: scraper → refiner (hidden pool) → publisher (website) → markdown (GitHub repo)
- [x] 90-minute wall-clock cutoff added to scraper — exits cleanly before GitHub's 2h job timeout

---

## PHASE 8 — SEO & Growth ← CURRENT
> Site is live. Focus is now on Google visibility and content volume.

### SEO (do first)
- [ ] Add `JobPosting` schema markup to job detail page (`/jobs/[slug]`) — biggest SEO win, makes Google treat pages as job listings not generic content
- [ ] Ensure all published jobs have description ≥ 200 chars (quality gate in publisher.js)

### Publish rate ramp-up (gradual, to avoid spam flag)
- [ ] Week 1–2: keep 30/day (current — 6/run × 5 runs)
- [ ] Week 3–4: increase to 50/day (10/run × 5 runs)
- [ ] Week 5–6: increase to 75/day (15/run × 5 runs)
- [ ] Week 7–8: increase to 100/day (20/run × 5 runs)

### Auth & sign-in wall
- [ ] Enable Supabase Google OAuth
- [ ] Wire up "Sign In" button in Navbar
- [ ] Logged-in users: skip `is_published=true` filter (see full pool of ~500+ jobs)
- [ ] Not logged-in: see only published 250+ jobs (current behaviour)

### Scale infrastructure
- [ ] Monitor scrape_runs logs — check consecutive_failures > 0 configs
- [ ] Fix any broken configs (re-verify or disable)
- [ ] Re-run verification on wellfound sitemaps — promote working ones to is_verified=true

---

## PHASE 9 — CSS Scraper (future)
> For wellfound companies with no API or sitemap

- [ ] Build Playwright CSS scraper using `css_job_table`, `css_job_item` selectors
- [ ] Handle pagination types: scroll, click, expand
- [ ] Test with 5 wellfound companies
- [ ] Add to GitHub Actions workflow

---

## PHASE 10 — Website (duplicate entry — see above)

---

## BACKLOG — Company Profile Enrichment
- [ ] Add `culture_tags` (text[]) column to Main DB `companies` table
- [ ] Add `benefits` (jsonb) column to Main DB `companies` table
- [ ] Add `reviews` table: company_id, reviewer_title, rating, pros, cons, date
- [ ] Add `ratings` jsonb column to `companies` (Work-Life Balance, Compensation, Culture, Career Growth, Management)
- [ ] Once data exists, re-enable Reviews, Culture, Benefits tabs on `/companies/[slug]` page

---

## OPEN DECISIONS
- [x] Main DB Supabase project — created (`osoilvzyyjmrbjsiyrgs`)
- [x] Category keyword map — defined and running in refiner.js (21 categories)
- [ ] Skill synonym map — build after first batch of jobs scraped
- [ ] CSS scraper — deferred, not in scope for initial launch
- [ ] LinkedIn company enrichment — deferred (founded_year, specialties missing from remote100k)
