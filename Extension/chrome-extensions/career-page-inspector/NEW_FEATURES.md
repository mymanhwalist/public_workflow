# New Features Added

## Overview
The Career Page Inspector now automatically detects and saves three critical pieces of data when scraping career pages:

1. **API Endpoint Detection** - Finds API URLs used by the career page
2. **Parsed Job Detail Data** - Extracts structured data from job detail pages
3. **Apply Button Capture** - Identifies and saves apply button information

---

## 1. API Endpoint Detection

### What it does
When scraping a career page, the extension searches for API endpoints in the page source. This helps identify if the page uses a jobs API (like Lever, Greenhouse, Workable, etc.).

### How it works
- Scans all `<script>` tags on the career page
- Uses regex patterns to detect common ATS APIs:
  - `https://api.lever.co/...`
  - `https://boards-api.greenhouse.io/...`
  - `https://api.workable.com/...`
  - `https://*.applytojob.com/...`
  - Generic `/api/...` endpoints

### Where it's saved
- **Supabase column**: `api_endpoint` (TEXT)
- **Example**: `"https://api.lever.co/v0/postings/hashtagpaid?mode=json"`

### Why it's useful
If an API is detected, you can use it directly for future scraping instead of parsing HTML. APIs are faster, more reliable, and provide structured JSON data.

---

## 2. Parsed Job Detail Data

### What it does
When opening a job detail page, the extension extracts structured information about the job posting.

### Data extracted
- **Job Title** - From `<h1>`, `<title>`, or role-related headings
- **Location** - City, state, country, or "Remote"
- **Description** - First 500 characters of the job description
- **Requirements** - First 5 bullet points from requirements section
- **Job Type** - Full-time, Part-time, Contract, etc.

### Where it's saved
- **Supabase column**: `parsed_job_data` (JSONB)
- **Example structure**:
```json
{
  "title": "Senior Software Engineer",
  "location": "San Francisco, CA / Remote",
  "description": "We're looking for an experienced engineer to join our platform team...",
  "requirements": [
    "5+ years of experience with React",
    "Strong understanding of TypeScript",
    "Experience with Node.js and PostgreSQL"
  ],
  "jobType": "Full-time",
  "applyButton": { ... },
  "applyUrl": "..."
}
```

---

## 3. Apply Button Capture (MOST IMPORTANT)

### What it does
Identifies the apply button on job detail pages and captures all information needed to automate job applications.

### Data captured

#### Apply Button Details
- **text**: Button text (e.g., "Apply Now", "Submit Application")
- **tag**: HTML tag name (e.g., "button", "a", "input")
- **class**: CSS classes (e.g., "btn-primary apply-button")
- **id**: Element ID if present
- **type**: Button type (e.g., "submit", "button")

#### Apply URL
- Extracted from:
  - `<a>` tag's `href` attribute
  - Parent `<form>` tag's `action` attribute
- **Example**: `"https://apply.workable.com/360dialog-gmbh/j/AECA8C7B0E/apply/"`

### Where it's saved
- **Supabase column**: `parsed_job_data.applyButton` (nested in JSONB)
- **Supabase column**: `parsed_job_data.applyUrl` (nested in JSONB)

### Example saved data
```json
{
  "applyButton": {
    "text": "Apply for this job",
    "tag": "a",
    "class": "postings-btn template-btn-submit",
    "id": "apply-btn",
    "type": null
  },
  "applyUrl": "https://jobs.lever.co/hashtagpaid/abc123/apply"
}
```

---

## How to Use

### Step 1: Update Supabase Schema
Run the SQL in `supabase-schema-update.sql` in your Supabase SQL Editor:

```sql
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS api_endpoint TEXT;

ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS parsed_job_data JSONB;
```

### Step 2: Reload the Extension
1. Go to `chrome://extensions/`
2. Click the reload icon on "Career Page Inspector"

### Step 3: Use the Extension
The workflow remains the same:
1. Click "Start Workflow"
2. Navigate to career page
3. Click "Save Career Page & Inspect"
4. Click "Scrape Job Data Now"

The new data is automatically captured and saved!

### Step 4: View the Data in Supabase

Query to see all new data:
```sql
SELECT
  company_name,
  api_endpoint,
  parsed_job_data->>'title' as job_title,
  parsed_job_data->>'location' as location,
  parsed_job_data->'applyButton'->>'text' as apply_button_text,
  parsed_job_data->>'applyUrl' as apply_url
FROM career_pages
WHERE parsed_job_data IS NOT NULL;
```

Query to find companies with detected APIs:
```sql
SELECT company_name, api_endpoint
FROM career_pages
WHERE api_endpoint IS NOT NULL;
```

Query to find apply button info:
```sql
SELECT
  company_name,
  parsed_job_data->'applyButton' as apply_button,
  parsed_job_data->>'applyUrl' as apply_url
FROM career_pages
WHERE parsed_job_data->'applyButton' IS NOT NULL;
```

---

## Debugging

### Check Console Logs
All detected data is logged to the browser console:

```
[Inspector] ✓ Detected API endpoint: https://api.lever.co/...
[Background] API endpoint: https://api.lever.co/...
[Background] Parsed job data: {title: "...", applyButton: {...}}
[Background] ✓ Found apply button: {text: "Apply Now", ...}
[Background] ✓ Apply URL: https://...
[Background] ✓ Saved table (12345 chars) + job detail (67890 chars) + API endpoint + apply button
```

### What if data is missing?
- **No API endpoint**: Normal - not all career pages use APIs
- **No apply button**: The page might use a non-standard apply method (email, external form, etc.)
- **No parsed data**: Check if the job detail page loaded correctly

---

## Summary

The extension now captures everything you need to:
1. **Use APIs directly** (if available) instead of HTML scraping
2. **Understand job structure** before building scrapers
3. **Automate applications** by knowing exactly where the apply button is and where it leads

All data is automatically saved to Supabase in the `api_endpoint` and `parsed_job_data` columns.
