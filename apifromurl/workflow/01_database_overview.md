# Database Overview
Last updated: 2026-03-23

---

## DB1 — hiring.cafe (`bojsbsoqpnuzikyzpjlh`)
**Status:** Read-only going forward. Source of scraper configs and skills dictionary.
**Do not write new data here.**

### Tables

| Table | Rows | Notes |
|---|---|---|
| `jobs` | 4,630 | Old hiring.cafe scrape data — not from our scraper |
| `companies` | 2,390 | Company profiles |
| `locations` | 2,649 | City/country/state |
| `skills` | 5,136 | **Skills dictionary — import into extraction script** |
| `career_pages` | 1,592 | ATS endpoints per company — **419 verified working as of 2026-02-07** |
| `job_skills` | 8,656 | Junction |
| `job_benefits` | 5,715 | Junction |

### What We Take From DB1
- `career_pages` where `api_endpoint` is not null and was verified working → migrate to DB2 `career_page_configs`
- `skills` table (5,136 entries) → use as extraction dictionary
- `companies` data → merge into DB2 `companies` (dedup by domain)

### Key Fields in `career_pages` (DB1)
- `company_id` → links to companies
- `career_url` — company careers page
- `api_endpoint` — job list API (Greenhouse/Lever/etc.)
- `api_endpoint_detail` — single job detail endpoint
- `ats_provider` — Greenhouse, Lever, Workday, etc.
- `last_jobs_scraped_at` — last time this was successfully scraped

---

## DB2 — Staging (`vmdbwpqopujirdcthgta`)
**Status:** Being repurposed as the permanent staging database.
**New schema:** `companies`, `career_page_configs`, `raw_jobs`, `scrape_runs`
**Temp tables** (to be migrated then deleted): `remote100k_companies`, `remote100k_jobs`, `career_pages` (wellfound)

### New Permanent Tables (schema in `sql/db2_staging_schema.sql`)

| Table | Purpose |
|---|---|
| `companies` | Company registry. Dedup by `domain`. All sources merged here. |
| `career_page_configs` | Working API endpoints + sitemaps. One row per method per company. |
| `raw_jobs` | Permanent job log. Dedup key. Extraction queue. History. |
| `scrape_runs` | Audit log. Tracks first scrape per company. |

### Temp Tables — Current Data Quality

#### `remote100k_companies` — 475 rows
| Field | Populated | Coverage | Notes |
|---|---|---|---|
| name, slug | 475/475 | 100% | |
| website_url | 290/475 | 61% | |
| logo_url | 296/475 | 62% | Supabase storage URLs (uploaded via extension) |
| industry_raw / industry_array | 282/475 | 59% | |
| description | ~475 | 100% | **WRONG** — many have nav boilerplate "Stop applying to jobs manually..." |
| founded_year | 0/475 | 0% | Completely missing — search index parsing failed |
| hq_raw / hq_city / hq_country | Partial | ~60% | |
| logo_stored_url | 0/475 | 0% | Node.js scraper had blank service key — not uploaded via that path |

**Action:** Re-scrape or fix descriptions before migrating. founded_year missing for all.

#### `remote100k_jobs` — 74 rows
Only 74 jobs captured — most companies had no visible jobs on their remote100k page at scrape time.

| Field | Status | Notes |
|---|---|---|
| title | ✅ | Correct |
| application_url | ✅ | Correct |
| ats_provider | ✅ | Correctly detected |
| salary_raw | ✅ | Raw string e.g. "$184,000 - $356,500" |
| api_endpoint | ❌ | **Always null — bug in scraper** (accessed `.apiEndpoint` but detector returns `.buildAPI`) |
| posted_ago | Partial | Raw string "14d", "47d" — needs parsing |

**ATS breakdown of 74 jobs:**
| Provider | Count | Public API? |
|---|---|---|
| Greenhouse | 29 | ✅ Yes |
| Ashby | 18 | ✅ Yes |
| Custom | 10 | ❌ No |
| Lever | 6 | ✅ Yes |
| Workday | 4 | ❌ No |
| Unknown | 4 | ❌ No |
| iCIMS | 3 | ❌ No |
| SmartRecruiters | 1 | ✅ Yes |
| Rippling | 1 | ❌ No |

**Usable:** 54 jobs from companies with public APIs. `api_endpoint` must be re-derived from `application_url` using ats-detector.

#### `career_pages` (wellfound) — 4,830 rows
| Segment | Count | Notes |
|---|---|---|
| Has api_endpoint | 2,010 | **Mostly sitemaps** (`/sitemap.xml`), not ATS APIs. Unverified. |
| CSS-only (no api_endpoint) | 2,820 | CSS selectors only. Not usable until CSS scraper is built. |
| career_page_url = null or "TODO" | Many | Stubs — incomplete configs |

Sample api_endpoints are mostly generic sitemaps (e.g. `https://company.com/sitemap.xml`). Quality is low — many will have no job URLs when tested.

---

## Main DB — Production (new Supabase project)
**Status:** Not yet created.
**Schema:** See `sql/main_db_schema.sql` (to be written).

### Tables
| Table | Purpose |
|---|---|
| `companies` | Promoted from DB2. Only companies with at least 1 active job. |
| `jobs` | AI-extracted, enriched. Raw description included. |
| `locations` | Normalized city/country. |
| `skills` | Skill taxonomy. |
| `job_skills` | Junction: which skills a job requires. |

---

## Migration Plan (DB1 + temp DB2 → permanent DB2 → Main DB)

```
1. Migrate DB1 career_pages (verified working) → DB2 career_page_configs
2. Migrate DB1 companies → DB2 companies (dedup by domain)
3. Migrate remote100k_companies → DB2 companies (merge, domain dedup)
4. Derive API endpoints from remote100k_jobs.application_url → DB2 career_page_configs
5. Migrate wellfound career_pages (API/sitemap only, skip CSS-only) → DB2 career_page_configs
6. Verify all imported configs (hit each endpoint, mark is_verified)
7. Create Main DB project + run schema SQL
8. Delete temp tables from DB2 (remote100k_companies, remote100k_jobs, old career_pages)
```
