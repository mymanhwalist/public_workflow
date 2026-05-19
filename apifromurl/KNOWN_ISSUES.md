# Known Issues & How to Deal With Them

Problems encountered during development and how to handle them.

---

## 1. SmartRecruiters sends unreliable location data

**Problem:** SmartRecruiters API sends `us` as the country code for jobs that are actually in Poland, Malta, Ukraine, and other non-US countries. Their location data cannot be trusted.

**Same issue with dates:** SmartRecruiters also returns today's date as `releasedDate` for every job regardless of when it was actually posted.

**Fix applied:**
- `scraper.js` — `--reliable-dates-only` flag restricts scraping to Greenhouse, Lever, Ashby, Workable, Eightfold only
- `seed-now.js` — filters to reliable providers before checking US location
- `refiner-groq.js` — `RELIABLE_ATS` set for date trust; SmartRecruiters excluded

**Rule of thumb:** Never trust SmartRecruiters for dates or location. If you need to include them in the future, compare against a previous scrape snapshot to detect genuinely new jobs.

---

## 2. Location parser ambiguity — fixed with Groq country hint

**Problem:** `parseLocation()` had several failure modes:
- Single-city names (e.g. `Chicago`, `Munich`) → country was `null`, dropped from results
- Ambiguous 2-letter codes (e.g. `Québec City, CA`) → parsed as California instead of Canada
- Garbage country strings (e.g. `Washington, D.C.` or `DMV Area`) → country assigned incorrectly

**Fix applied (refiner-groq.js):**
- Groq now returns `location_country` — a 2-letter ISO code from the job description context
- `resolveLocation()` passes this as `countryHint` to `parseLocation()`
- Three override cases:
  1. `country` is null → fill from hint
  2. `state` assigned but hint says non-US → clear state, use hint country
  3. Garbage country string (not 2-letter ISO) → replace with hint
- `country` initializes as `null` (never defaults to `US`)

**If you see wrong countries:** check `location_raw` in DB2 and trace through `parseLocation()` manually.

---

## 3. Remote jobs — location and badge must never mix

**Problem:** Early implementation showed `Remote (Germany)` in the location field, mixing the work-type badge with the geographic location.

**Rule:** Location field shows WHERE (city/country). Remote badge comes from `job_type` field. These two are always separate.

**Fix applied (refiner-groq.js):**
- `extractRemoteCountry()` strips "remote" from location strings and returns only the country code (e.g. `Remote, de` → `DE`, `Pakistan - Remote` → `PK`, `Worldwide` → `null`)
- `parseLocation()` remote block returns `display_name = country name only` (e.g. `Germany`) or `Worldwide` — never `Remote (Germany)`
- `is_remote: true` stored on location row; `job_type = 'remote'` drives the badge on the frontend
- Frontend reads badge from `job_type`, not from `display_name`

---

## 4. Ambiguous 2-letter codes (US state vs country)

**Problem:** Some 2-letter codes are both a US state abbreviation and a country code:

| Code | US State | Country |
|------|----------|---------|
| CA | California | Canada |
| IN | Indiana | India |
| DE | Delaware | Germany |
| GA | Georgia (state) | Georgia (country) |
| MT | Montana | Malta |

**Fix applied:** These are in the `AMBIGUOUS` map in `parseLocation()` and are treated as country codes (not US states). This means jobs in California/Indiana/Delaware/Georgia-state/Montana that use the 2-letter abbreviation will be misclassified as non-US.

**Workaround:** ATS providers that include the full state name (e.g. "San Francisco, California") or full city+state (e.g. "San Jose, CA, United States") are handled correctly. The 3-part format always wins. The Groq `location_country` hint also catches most of these at runtime.

---

## 5. Not enough fresh jobs during bootstrapping

**Problem:** When running the pipeline for the first time, all 500+ companies are "first scrape". Their jobs get `status = skipped_first_scrape` and are unavailable for promotion. Even companies with reliable date APIs only contribute pending jobs if they posted something in the last 24h.

**Result:** Trying to seed 20 fresh US jobs manually was very difficult — we kept running out of eligible jobs.

**How to deal with it:**
- Wait for the second scrape cycle (6 hours after first run) — companies become non-first-scrape and new jobs flow to pending normally
- For manual seeding, use `first_seen_at >= 24h` + `is_first_scrape = false` to find genuinely new jobs from already-known companies
- Use `--skip-freshness` flag on `refiner-groq.js` for local testing only
- Don't manually update `posted_date` in DB2 to force jobs through — it corrupts the freshness audit trail

---

## 6. First-scrape companies count as "scraped" after any scrape

**Problem:** The original scraper didn't write to `scrape_runs`. When we checked if a company was "first scrape" by querying `scrape_runs`, all companies showed as first-scrape even after being scraped.

**Fix applied:** `scraper.js` now checks BOTH `scrape_runs` AND `raw_jobs` to determine if a company has been scraped before:
```javascript
const scrapedCompanies = new Set([
  ...(priorRuns || []).map(r => r.company_id),
  ...(rawJobCos || []).map(r => r.company_id),
]);
```

---

## 7. Domino's / large SmartRecruiters companies stall the scraper

**Problem:** SmartRecruiters paginates through all jobs, so companies with thousands of listings (Domino's had 24,553) would stall the scraper for 10-15 minutes on first scrape.

**Fix applied:** First-scrape companies are capped at 100 jobs in `scraper.js`:
```javascript
if (isFirstScrape && jobs.length > 100) jobs = jobs.slice(0, 100);
```

---

## 8. Groq rate limiting during large batches

**Problem:** Groq free-tier has token-per-minute limits. On large runs (100+ jobs) the refiner can hit `429 Too Many Requests`.

**Fix applied:** `refiner-groq.js` reads `x-ratelimit-remaining-tokens` from each Groq response header and auto-waits before the next batch when tokens are low. Also retries on 429 with the `retry-after` header value.

**Rule of thumb:** If you need to process many jobs at once, use `--limit=20` per run rather than one giant batch. The GitHub Actions workflow defaults to `--limit=5` per scheduled run which stays well within rate limits.

---

## 9. Non-tech skills appearing on non-tech job cards

**Problem:** Old rule-based refiner (`refiner.js`) matched skill keywords from any part of the description, so Sales and Finance jobs would show skills like `YARA`, `HTTP`, `R`.

**Fix applied:** `refiner-groq.js` instructs Groq to extract skills only from the requirements/qualifications/responsibilities section, and only skills appropriate to the job category. `filterSkillsByCategory()` also post-filters tech skills off non-tech categories (Sales, Finance, HR, Operations, etc.).
