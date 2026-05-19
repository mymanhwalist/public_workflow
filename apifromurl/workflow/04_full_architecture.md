# Full Architecture
Last updated: 2026-03-23

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  DB2 — STAGING DATABASE (vmdbwpqopujirdcthgta)                  │
│                                                                  │
│  companies              ← merged from DB1 + remote100k +        │
│                            wellfound (dedup by domain)          │
│                                                                  │
│  career_page_configs    ← verified API endpoints + sitemaps     │
│                            from all sources                      │
│                                                                  │
│  raw_jobs               ← permanent job log                     │
│                            dedup key: application_url           │
│                            extraction queue: status=pending      │
│                            history: first_seen_at, last_seen_at  │
│                                                                  │
│  scrape_runs            ← audit log, tracks first scrape        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   SCRAPER           │
                    │   (GitHub Actions)  │
                    │                     │
                    │  reads: configs     │
                    │  hits: API/sitemap  │
                    │  writes: raw_jobs   │
                    │  logs: scrape_runs  │
                    └──────────┬──────────┘
                               │ raw_jobs WHERE status='pending'
                    ┌──────────▼──────────┐
                    │  EXTRACTION SCRIPT  │
                    │  (GitHub Actions)   │
                    │  zero cost          │
                    │                     │
                    │  regex: salary      │
                    │  keywords: job_type │
                    │  keywords: skills   │
                    │  keywords: level    │
                    │  keywords: category │
                    └──────────┬──────────┘
                               │ promoted jobs
┌──────────────────────────────▼──────────────────────────────────┐
│  MAIN DB — PRODUCTION (new Supabase project)                    │
│                                                                  │
│  companies    jobs    locations    skills    job_skills          │
│                                                                  │
│  Only clean, fresh, extracted data                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │     WEBSITE         │
                    │   (frontend)        │
                    │                     │
                    │  job listings       │
                    │  job detail page    │
                    │  company page       │
                    │  filters + search   │
                    └─────────────────────┘
```

---

## DB2 — Staging Database

### `companies`
All company data merged from all sources. Dedup by `domain`.

**Sources (in merge order):**
1. DB1 companies (hiring.cafe — 2,390 rows)
2. remote100k_companies (475 rows — top500 category)
3. wellfound career_pages (company names/websites — startup category)

**Enrichment priority when same company in multiple sources:**
| Field | Best source |
|---|---|
| logo_url | remote100k (stored in Supabase Storage) |
| description | remote100k (once fixed — currently has boilerplate bug) |
| industry, company_size, founded_year, HQ | remote100k |
| linkedin_url, twitter_url | remote100k |
| career_page_url | DB1 or wellfound |
| api_endpoint | DB1 (verified) > remote100k derived > wellfound |

### `career_page_configs`
One row per scraping method per company. Multiple rows allowed per company.

**Sources:**
- DB1 `career_pages` WHERE api_endpoint is not null (419 verified)
- remote100k_jobs → re-derive API endpoint from application_url using ats-detector
- wellfound `career_pages` WHERE api_endpoint is not null (sitemaps, unverified)
- CSS configs kept but flagged — not scraped until CSS scraper is built

**Only configs with `is_verified = true` are used by the scraper.**

### `raw_jobs`
The most important table. Permanent — never deleted.

**Three roles in one table:**
1. **Dedup:** `application_url UNIQUE` blocks re-inserting same job
2. **Queue:** `status = 'pending'` → extraction script picks these up
3. **History:** `first_seen_at`, `last_seen_at`, `seen_count` track job age

**Status flow:**
```
Scraper finds job
       ↓
application_url already in raw_jobs?
  YES → UPDATE last_seen_at, increment seen_count → DONE
  NO  → Is this company's first scrape?
          YES → INSERT status='skipped_first_scrape' → DONE (age unknown)
          NO  → INSERT status='pending'
                       ↓
               Extraction script picks it up
                       ↓
               INSERT into Main DB
                       ↓
               UPDATE status='promoted', is_promoted=true
```

---

## Scraper Logic

```
For each career_page_config WHERE is_verified = true:

  1. Check scrape_runs → has this company been scraped before?
     NO  → is_first_scrape = true
     YES → is_first_scrape = false

  2. Hit api_endpoint (GET) or sitemap_url
     On failure → increment consecutive_failures
     After 3 failures → mark config as is_verified = false (disabled)

  3. For each job returned:
     a. Clean application_url (strip utm_*, ref=, source= params)
     b. Check raw_jobs WHERE application_url = cleaned_url
        FOUND → UPDATE last_seen_at = now(), seen_count++
        NOT FOUND:
          → INSERT raw_jobs with:
              status = is_first_scrape ? 'skipped_first_scrape' : 'pending'
              is_first_scrape = [flag from step 1]
              first_seen_at = now()
              posted_date = source date if available, else null

  4. Log to scrape_runs (jobs_found, jobs_new, jobs_promoted, status)
  5. UPDATE career_page_configs.last_scraped_at = now()
```

---

## Extraction Script Logic

```
Read raw_jobs WHERE status = 'pending' ORDER BY scraped_at ASC

For each raw_job:

  1. Run extraction on title + description:
     - salary_min/max     → regex patterns
     - salary_currency    → $ £ € symbols
     - job_type           → remote/hybrid/onsite keywords
     - commitment_type    → full-time/part-time/contract keywords
     - experience_level   → senior/junior/mid/lead/entry + X+ years
     - category           → title keyword map
     - skills             → match against skills dictionary
     - location           → parse location_raw string

  2. Resolve company:
     Look up DB2 companies by domain
     Find or create in Main DB companies

  3. Resolve location:
     Find or create in Main DB locations

  4. posted_date:
     Source provides date? → use it
     No date? → use raw_jobs.first_seen_at as proxy

  5. INSERT into Main DB jobs
     INSERT into Main DB job_skills (one row per matched skill)

  6. UPDATE DB2 raw_jobs:
     status = 'promoted'
     is_promoted = true
     promoted_at = now()
```

---

## GitHub Actions Schedule

```yaml
Scraper job:      runs every 6 hours
Extraction job:   runs every 6 hours (30 min after scraper)
Verification job: runs once per week (re-tests all configs)
```

---

## Source Data Summary

| Source | Companies | Verified configs | Category |
|---|---|---|---|
| DB1 career_pages | ~400 | 419 (live tested 2026-02-07) | general |
| remote100k_jobs | ~30-40 unique | 54 jobs → re-derive | top500 |
| wellfound career_pages | 4,830 | 0 (unverified sitemaps) | startup |

---

## Promotion Rules

### Job gets promoted to Main DB when ALL of these are true:
- [ ] `is_first_scrape = false` (not from initial company onboarding batch)
- [ ] `application_url` not already in Main DB jobs
- [ ] Extraction script completed without error

OR override: source provides explicit `posted_date` → promote regardless of first_scrape

### Company gets promoted to Main DB when:
- [ ] Has at least 1 job successfully promoted
- [ ] Company record exists in DB2 companies
