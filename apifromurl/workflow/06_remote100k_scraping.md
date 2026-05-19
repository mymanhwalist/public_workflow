# remote100k.com Scraping Plan

## Site Analysis
- **Technology:** Framer (not Next.js, no API endpoints)
- **Companies:** 473 total (not 500 as marketed)
- **Pagination:** None — all 473 rendered on one page
- **Best approach:** Framer search index JSON (1 request = all companies)

## Data Source

### Step 1 — Search Index JSON (1 request, all 473 companies)
```
GET https://framerusercontent.com/sites/2TTRWPnbHRv1n35otWC5BY/searchIndex-sSVTRoLYfWAf.json
```

**Fields available from index:**
- `name` (from h1)
- `description` (from p[] — needs parsing, skip nav boilerplate)
- `hq` — raw string e.g. "Sunnyvale, CA"
- `size` — e.g. "501-1,000"
- `founded` — e.g. "2013"
- `industry` — raw string e.g. "Computer and Network Security, Cybersecurity"
- `profile_url` — e.g. `https://remote100k.com/remote-companies/illumio`

**NOT in the index (need Step 2):**
- `website_url` — actual company website
- `logo_url` — company logo image

### Step 2 — Individual Profile Pages (473 requests)
```
GET https://remote100k.com/remote-companies/{slug}
```

Scrape each profile page for:
- Company website URL (link to their site)
- Logo URL (image src)

CSS selectors from HTML:
- Card: `a.framer-1h5aq7a[href*="/remote-companies/"]`
- Company name: `a.framer-1h5aq7a h2.framer-text`
- Description: `a.framer-1h5aq7a p.framer-text.framer-styles-preset-21ogod`
- Logo: `img[alt$=" logo"]`

---

## DB2 New Table — `remote100k_companies`
Add to wellfound Supabase (`vmdbwpqopujirdcthgta`)

```sql
CREATE TABLE remote100k_companies (
  id                  uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name                varchar NOT NULL,
  slug                varchar UNIQUE NOT NULL,
  profile_url         text,
  website_url         text,
  logo_url            text,
  description         text,
  hq_raw              text,
  hq_city             varchar,
  hq_country          varchar,
  company_size        varchar,
  founded_year        integer,
  industry_raw        text,
  industry_array      text[],
  career_page_url     text,
  scraped_at          timestamptz DEFAULT now(),
  profile_scraped_at  timestamptz,
  raw_data            jsonb
);
```

### Column notes
| Column | Source | Notes |
|---|---|---|
| `slug` | Search index URL path | e.g. `illumio` |
| `profile_url` | Search index | `https://remote100k.com/remote-companies/illumio` |
| `website_url` | Profile page scrape | Their actual website — needed for career page discovery |
| `logo_url` | Profile page scrape | Company logo |
| `hq_raw` | Search index p[] | Raw: `"Sunnyvale, CA"` |
| `hq_city` | Parsed from hq_raw | `"Sunnyvale"` |
| `hq_country` | Parsed from hq_raw | `"CA"` or infer country from city/state |
| `company_size` | Search index p[] | `"501-1,000"` |
| `founded_year` | Search index p[] | `2013` |
| `industry_raw` | Search index p[] | `"Computer and Network Security, Cybersecurity"` |
| `industry_array` | Split industry_raw by `,` | `["Computer and Network Security", "Cybersecurity"]` |
| `career_page_url` | TBD | Discover after we have website_url |
| `profile_scraped_at` | Set after Step 2 | Tracks when profile page was scraped |
| `raw_data` | Search index full entry | Store full JSON for reference |

---

## Tables Created (in DB2 — vmdbwpqopujirdcthgta)
- `remote100k_companies` — one row per company, all profile data
- `remote100k_jobs` — all jobs found on each company's page, with application URLs + ATS provider

SQL file: `workflow/sql/remote100k_tables.sql`

---

## Scraper Script Plan (Node.js + TypeScript)

```
script: scrape-remote100k.ts

Step 1: Fetch search index JSON
  → Filter entries where URL contains '/remote-companies/' and not root
  → Parse p[] array for each company:
      - Skip nav boilerplate items
      - Extract HQ, Size, Founded, Industry using label pairs
      - First long paragraph that isn't a label = description
  → Insert all 473 rows into remote100k_companies
     (name, slug, profile_url, description, hq_raw, company_size, founded_year, industry_raw, raw_data)

Step 2: For each company, fetch profile page
  → GET https://remote100k.com/remote-companies/{slug}
  → Extract:
      - website_url   → first external link that is NOT linkedin/twitter/x.com
      - linkedin_url  → a[href*="linkedin.com"]
      - twitter_url   → a[href*="x.com"] or a[href*="twitter.com"]
      - logo_url      → img[alt$=" logo"] src attribute (framerusercontent.com URL)
  → Download logo image
      - Fetch logo_url bytes
      - Upload to Supabase Storage bucket "company-logos" as "{slug}.jpg"
      - Set logo_stored_url = public URL from Supabase Storage
  → Extract jobs listed on the page:
      - Each job card: a.framer-1bb67qg.framer-17l4brk
      - title         → h3.framer-text (job title)
      - job_page_url  → href attribute of job card (relative → absolute)
      - application_url → "Apply for This Job" button href (the actual ATS URL)
      - remote_location → remote location text (e.g. "🇺🇸 USA")
      - category      → category text (e.g. "Engineering")
      - salary_raw    → salary text (e.g. "$184,000 - $356,500")
      - commitment_type → "Full-Time" / "Part-Time" etc
      - posted_ago    → age text (e.g. "14d", "47d")
      - ats_domain    → extract hostname from application_url
      - ats_provider  → map ats_domain to provider name (see ATS domain map below)
  → INSERT all jobs into remote100k_jobs
  → UPDATE remote100k_companies SET website_url, logo_url, logo_stored_url,
      linkedin_url, twitter_url, total_jobs_listed, profile_scraped_at

Step 3: Post-processing
  → Parse hq_raw → hq_city, hq_country
  → Split industry_raw by comma → industry_array
  → UPDATE rows with parsed fields

Step 4: ATS provider detection (from application_url domain)
  ats_domain → ats_provider mapping:
    *.greenhouse.io / boards.greenhouse.io      → "greenhouse"
    *.lever.co / jobs.lever.co                  → "lever"
    *.myworkdayjobs.com                         → "workday"
    *.icims.com                                 → "icims"
    *.taleo.net                                 → "taleo"
    *.smartrecruiters.com                       → "smartrecruiters"
    *.ashbyhq.com                               → "ashby"
    *.rippling.com                              → "rippling"
    *.bamboohr.com                              → "bamboohr"
    *.jobvite.com                               → "jobvite"
    *.successfactors.com                        → "successfactors"
    *.breezy.hr                                 → "breezy"
    *.recruitee.com                             → "recruitee"
    *.workable.com                              → "workable"
    anything else                               → "custom"

Rate limiting: 1 request per second for profile pages (473 seconds ~ 8 minutes total)
```

---

## What Happens After Scraping
Once `remote100k_companies` is populated with `website_url`:
1. These company websites feed into **career page discovery** (find /careers, /jobs pages)
2. Career page configs go into `career_page_configs` table in Layer 1
3. These companies eventually land in Layer 3 main DB as `category = 'top500'`

---

## Search Index URL Note
The search index URL contains a hash that may change when the site is republished.
If the hardcoded URL returns 404:
1. Fetch `https://remote100k.com/remote-companies`
2. Look for `<link rel="prefetch" href="https://framerusercontent.com/sites/.../searchIndex-*.json">`
3. Use that URL instead
