# Main DB Schema — Production
Last updated: 2026-04-13

**Purpose:** Clean, enriched, website-ready data only.
**Project:** `osoilvzyyjmrbjsiyrgs` (Supabase) ✅ Live
**Source of data:** `refiner.js` reads DB2 `raw_jobs` WHERE description IS NOT NULL → processes → inserts here.
**SQL file:** `workflow/sql/main_db_schema.sql`
**Current state:** 730 jobs · 139 companies · 212 locations · 6,836 skills · 15,552 job_skills · 21 categories

Every job here has been:
- Scraped from a verified API or sitemap
- Passed through the rule-based extraction script
- Confirmed as a fresh job (not from first scrape, or has explicit posted_date)

---

## Tables

### `companies`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `slug` | text UNIQUE | URL-safe: `stripe` |
| `domain` | text UNIQUE | Dedup key: `stripe.com` |
| `website_url` | text | |
| `logo_url` | text | |
| `description` | text | |
| `linkedin_url` | text | From DB1 |
| `industries` | text[] | `["Fintech", "Payments"]` |
| `funding_stage` | text | `seed` / `series_a` / `public` / `bootstrapped` |
| `is_public` | boolean | Public vs private company |
| `category` | text | `general` / `top500` / `startup` |
| `is_featured` | boolean | For future monetization |
| `employee_count` | int | Exact headcount from DB1 |
| `headquarters` | text | City |
| `headquarters_country` | text | Country |
| `year_founded` | int | |
| `job_count` | int | Active jobs count |
| `sources` | text[] | `['hiring_cafe', 'remote100k', 'wellfound']` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `locations`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `city` | text | nullable |
| `state` | text | nullable |
| `country` | text NOT NULL | default `US` |
| `country_code` | text | ISO: `US`, `IN`, `DE` |
| `display_name` | text UNIQUE | `"San Francisco, CA"` / `"Remote"` |
| `is_remote` | boolean | default false |
| `created_at` | timestamptz | |

---

### `skills`
Seeded from DB1's 5,136-entry skills table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text UNIQUE NOT NULL | Display: `JavaScript` |
| `slug` | text UNIQUE NOT NULL | URL-safe: `javascript` |
| `category` | text | `language` / `framework` / `tool` / `soft_skill` |
| `created_at` | timestamptz | |

---

### `jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → companies | |
| `location_id` | uuid FK → locations | nullable |
| `title` | text NOT NULL | |
| `slug` | text UNIQUE | SEO URL: `software-engineer-at-stripe-sf` |
| `description` | text | Raw from scraper |
| `requirements_summary` | text | Extracted summary |
| `application_url` | text NOT NULL | Apply button URL |
| `job_type` | text | `remote` / `hybrid` / `onsite` |
| `commitment_type` | text | `full_time` / `part_time` / `contract` / `internship` |
| `experience_level` | text | `entry` / `mid` / `senior` / `lead` / `executive` |
| `category` | text | `Engineering` / `Design` / `Marketing` / `Sales` etc. |
| `salary_min` | int | nullable |
| `salary_max` | int | nullable |
| `salary_currency` | text | default `USD` |
| `salary_period` | text | `yearly` / `hourly` / `monthly` |
| `posted_date` | timestamptz | |
| `expires_at` | timestamptz | nullable |
| `first_seen_at` | timestamptz | |
| `last_seen_at` | timestamptz | |
| `raw_job_id` | uuid | Reference to DB2 raw_jobs.id |
| `ats_provider` | text | `Greenhouse` / `Lever` / `Ashby` etc. |
| `external_id` | text | ATS job ID |
| `click_count` | int | default 0 |
| `is_active` | boolean | default true |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `job_skills`
| Column | Type | Notes |
|---|---|---|
| `job_id` | uuid FK → jobs | |
| `skill_id` | uuid FK → skills | |
| PRIMARY KEY | `(job_id, skill_id)` | |

---

### `saved_jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | Supabase Auth |
| `job_id` | uuid FK → jobs | |
| `saved_at` | timestamptz | |
| UNIQUE | `(user_id, job_id)` | |

---

### `applied_jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | Supabase Auth |
| `job_id` | uuid FK → jobs | |
| `applied_at` | timestamptz | |
| `notes` | text | User notes |
| UNIQUE | `(user_id, job_id)` | |

---

## Frontend Filter Capabilities

| Filter | Column |
|---|---|
| Remote / hybrid / onsite | `jobs.job_type` |
| Salary range | `jobs.salary_min`, `jobs.salary_max` |
| Experience level | `jobs.experience_level` |
| Date posted | `jobs.posted_date` |
| Job category | `jobs.category` |
| Commitment type | `jobs.commitment_type` |
| Skills | `job_skills` → `skills.name` |
| Location | `locations.city`, `locations.state` |
| Company | `jobs.company_id` |
| Industry | `companies.industries[]` |
| Full-text search | GIN index on `title + description` |

---

## Pages & Features Supported

| Feature | Tables used |
|---|---|
| Job listings page | `jobs`, `companies`, `locations` |
| Job detail page | `jobs`, `companies`, `locations`, `job_skills`, `skills` |
| Company profile page | `companies`, `jobs` |
| Save job | `saved_jobs` |
| Mark as applied | `applied_jobs` |
| Apply history | `applied_jobs` + `jobs` |
| User accounts | Supabase Auth |

---

## What Is NOT Here
- Scraper configs → DB2 `career_page_configs`
- Raw unprocessed jobs → DB2 `raw_jobs`
- Benefits table — add later when reliably extractable
- Job alerts / newsletter — Phase 8+
