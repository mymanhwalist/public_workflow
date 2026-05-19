# Career Page Tracking System

## Database Schema

### Required Migration (v1.1 → v2.0)

Run this SQL in Supabase to support multiple career page URLs per company:

```sql
-- Step 1: Add new JSONB columns
ALTER TABLE career_pages
ADD COLUMN career_page_urls JSONB,
ADD COLUMN api_endpoints JSONB;

-- Step 2: Migrate existing data (if any)
UPDATE career_pages
SET career_page_urls = CASE
    WHEN career_page_url IS NOT NULL THEN jsonb_build_array(career_page_url)
    ELSE NULL
  END,
  api_endpoints = CASE
    WHEN api_endpoint IS NOT NULL THEN jsonb_build_array(api_endpoint)
    ELSE NULL
  END
WHERE career_page_url IS NOT NULL OR api_endpoint IS NOT NULL;

-- Step 3 (OPTIONAL): Drop old columns after verifying migration
-- ALTER TABLE career_pages DROP COLUMN career_page_url;
-- ALTER TABLE career_pages DROP COLUMN api_endpoint;
```

### New Schema

| Column | Type | Example |
|--------|------|---------|
| `career_page_urls` | JSONB | `["https://company.com/careers", "https://company.com/careers/usa"]` |
| `api_endpoints` | JSONB | `["https://api.lever.co/v0/postings/company"]` |

## How Records Are Marked

| Status | career_page_urls | api_endpoints | Meaning | Will Fetch Again? |
|--------|------------------|---------------|---------|-------------------|
| **Not Processed** | `NULL` | `NULL` | Haven't looked at this yet | YES |
| **Success** | `["url1", "url2", ...]` | `["api1", ...]` or NULL | Career pages found and saved | NO |
| **Manual Skip** | `["TODO"]` | `NULL` | Reviewed but needs manual work | NO |
| **Connection Error** | `["SKIPPED"]` | `NULL` | Website broken/invalid | NO |

## Why This Works

### Fetch Query
```sql
WHERE website_url LIKE 'http%'
  AND career_page_urls IS NULL
```

This only fetches records where `career_page_urls` is **truly NULL** (not processed yet).

It **automatically excludes**:
- Successful saves (has actual URL array)
- Manual skips (has ["TODO"])
- Connection errors (has ["SKIPPED"])

### Benefits

1. **Multiple URLs**: Companies with multiple career pages (locations, departments) are fully captured
2. **Scraping Ready**: JSON arrays are easy to iterate over for scraping
3. **No Duplicates**: Once processed, it won't appear again
4. **Track Progress**: Know which companies need manual work ("TODO")
5. **Know Errors**: Know which have broken websites ("SKIPPED")
6. **Resume Anytime**: Stop and restart - only unprocessed companies fetch

## Examples

### Scenario 1: Single Career Page
```
Action: Navigate to career page -> Click "Save & Next"
Result: career_page_urls = ["https://company.com/careers"]
        api_endpoints = ["https://api.lever.co/..."]
Next fetch: Won't appear (not NULL)
```

### Scenario 2: Multiple Career Pages
```
Action: Navigate to /careers/usa -> Click "Save & Add More"
        Navigate to /careers/uk -> Click "Save & Add More"
        Navigate to /careers/india -> Click "Done with Company"
Result: career_page_urls = [
          "https://company.com/careers/usa",
          "https://company.com/careers/uk",
          "https://company.com/careers/india"
        ]
        api_endpoints = ["https://api.greenhouse.io/..."] (if found)
Next fetch: Won't appear (not NULL)
```

### Scenario 3: Manual Skip
```
Action: Click "Skip Company"
Result: career_page_urls = ["TODO"]
        api_endpoints = NULL
Next fetch: Won't appear (not NULL)
Later: Query WHERE career_page_urls = '["TODO"]' to find all manual skips
```

### Scenario 4: Connection Error
```
Action: Website fails to load (chrome-error://)
Result: career_page_urls = ["SKIPPED"]
        api_endpoints = NULL
Next fetch: Won't appear (not NULL)
```

## Finding Specific Records

### All Unprocessed (Not Started)
```sql
SELECT * FROM career_pages
WHERE career_page_urls IS NULL
ORDER BY company_name;
```

### All Manual Skips (Need Manual Work)
```sql
SELECT * FROM career_pages
WHERE career_page_urls = '["TODO"]'::jsonb
ORDER BY company_name;
```

### All Connection Errors
```sql
SELECT * FROM career_pages
WHERE career_page_urls = '["SKIPPED"]'::jsonb
ORDER BY company_name;
```

### All Successfully Processed
```sql
SELECT * FROM career_pages
WHERE career_page_urls IS NOT NULL
  AND career_page_urls != '["TODO"]'::jsonb
  AND career_page_urls != '["SKIPPED"]'::jsonb
ORDER BY company_name;
```

### Companies with Multiple Career Pages
```sql
SELECT company_name, jsonb_array_length(career_page_urls) as url_count
FROM career_pages
WHERE career_page_urls IS NOT NULL
  AND jsonb_array_length(career_page_urls) > 1
ORDER BY url_count DESC;
```

### With API Detected
```sql
SELECT * FROM career_pages
WHERE api_endpoints IS NOT NULL
ORDER BY company_name;
```

### Expand URLs for Scraping
```sql
SELECT
  cp.id,
  cp.company_name,
  url.value as career_page_url
FROM career_pages cp,
LATERAL jsonb_array_elements_text(cp.career_page_urls) as url(value)
WHERE cp.career_page_urls IS NOT NULL
  AND cp.career_page_urls != '["TODO"]'::jsonb
  AND cp.career_page_urls != '["SKIPPED"]'::jsonb
ORDER BY cp.company_name;
```

## Reset Commands

### Reset All TODO Back to NULL (Re-process Manual Skips)
```sql
UPDATE career_pages
SET career_page_urls = NULL
WHERE career_page_urls = '["TODO"]'::jsonb;
```

### Reset All SKIPPED Back to NULL (Re-try Errors)
```sql
UPDATE career_pages
SET career_page_urls = NULL
WHERE career_page_urls = '["SKIPPED"]'::jsonb;
```

### Complete Reset (Start Fresh)
```sql
UPDATE career_pages
SET
  career_page_urls = NULL,
  api_endpoints = NULL
WHERE career_page_urls IS NOT NULL;
```

## Statistics Queries

### Count by Status
```sql
SELECT
  CASE
    WHEN career_page_urls IS NULL THEN 'Not Processed'
    WHEN career_page_urls = '["TODO"]'::jsonb THEN 'Manual Skip'
    WHEN career_page_urls = '["SKIPPED"]'::jsonb THEN 'Connection Error'
    ELSE 'Success'
  END as status,
  COUNT(*) as count
FROM career_pages
GROUP BY status
ORDER BY status;
```

### URL Count Distribution
```sql
SELECT
  jsonb_array_length(career_page_urls) as urls_per_company,
  COUNT(*) as company_count
FROM career_pages
WHERE career_page_urls IS NOT NULL
  AND career_page_urls != '["TODO"]'::jsonb
  AND career_page_urls != '["SKIPPED"]'::jsonb
GROUP BY urls_per_company
ORDER BY urls_per_company;
```

### Total URLs Collected
```sql
SELECT
  COUNT(*) as total_companies,
  SUM(jsonb_array_length(career_page_urls)) as total_urls,
  SUM(COALESCE(jsonb_array_length(api_endpoints), 0)) as total_apis
FROM career_pages
WHERE career_page_urls IS NOT NULL
  AND career_page_urls != '["TODO"]'::jsonb
  AND career_page_urls != '["SKIPPED"]'::jsonb;
```

## Workflow

1. **Start Collection**: Fetches all NULL records
2. **Process Each**:
   - Save & Add More -> Add URL to list, stay on company
   - Done with Company -> Save all URLs, move to next
   - Skip -> ["TODO"] (won't fetch again)
   - Error -> ["SKIPPED"] (website broken)
3. **Resume Later**: Only unprocessed (NULL) records fetch
4. **Manual Work**: Query TODO records, add career pages manually
5. **Scrape**: Use "Expand URLs" query to get flat list for scraping

This system ensures you capture ALL career pages per company!
