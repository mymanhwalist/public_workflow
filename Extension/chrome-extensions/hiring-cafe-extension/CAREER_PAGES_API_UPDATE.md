# Career Pages API Update - Hiring Cafe Extension

## What Changed

Updated the Supabase function to **save career page data** with API endpoints.

---

## New Function Parameters

Added 4 optional parameters to `save_hiring_cafe_job_to_existing_schema()`:

```sql
p_career_url TEXT DEFAULT NULL,
p_api_endpoint TEXT DEFAULT NULL,
p_api_endpoint_detail TEXT DEFAULT NULL,
p_ats_provider TEXT DEFAULT NULL
```

---

## What the Function Does Now

### Step 3: Insert/Update Career Pages (NEW!)

```sql
-- Check if career page exists
SELECT id FROM career_pages WHERE career_url = p_career_url;

-- If NOT exists:
INSERT INTO career_pages (
    company_id,
    career_url,
    scraped_from,
    api_endpoint,           -- NEW
    api_endpoint_detail,    -- NEW
    application_url,        -- NEW
    ats_provider           -- NEW
) VALUES (...);

-- If EXISTS:
UPDATE career_pages
SET
    api_endpoint = COALESCE(p_api_endpoint, api_endpoint),
    api_endpoint_detail = COALESCE(p_api_endpoint_detail, api_endpoint_detail),
    application_url = COALESCE(p_application_url, application_url),
    ats_provider = COALESCE(p_ats_provider, ats_provider),
    scraped_at = NOW()
WHERE id = v_career_page_id;
```

---

## How to Apply

### 1. Run the SQL Update

Go to **Hiring Cafe Supabase** → **SQL Editor** and run:

```sql
-- Paste entire contents of UPDATED_FUNCTION_WITH_API.sql
```

This will replace the existing function with the new version.

---

## How to Use (From Extension)

### Current Call (Still Works):
```javascript
SELECT save_hiring_cafe_job_to_existing_schema(
    p_title := 'Software Engineer',
    p_company_name := 'Google',
    p_application_url := 'https://...',
    -- ... 35 other parameters
    p_skills := ARRAY['JavaScript', 'React'],
    p_benefits := ARRAY['Health Insurance']
);
```

### New Call (With Career Page Data):
```javascript
SELECT save_hiring_cafe_job_to_existing_schema(
    p_title := 'Software Engineer',
    p_company_name := 'Google',
    p_application_url := 'https://boards.greenhouse.io/google/jobs/123',
    -- ... other parameters ...
    p_skills := ARRAY['JavaScript', 'React'],
    p_benefits := ARRAY['Health Insurance'],
    -- NEW: Career page fields
    p_career_url := 'https://careers.google.com/jobs',
    p_api_endpoint := 'https://boards-api.greenhouse.io/v1/boards/google/jobs',
    p_api_endpoint_detail := 'https://boards-api.greenhouse.io/v1/boards/google/jobs/{id}',
    p_ats_provider := 'Greenhouse'
);
```

---

## Backward Compatible ✅

The new parameters have `DEFAULT NULL`, so:
- ✅ Old calls still work (without career page params)
- ✅ New calls can include career page data
- ✅ No breaking changes

---

## Example Result

After running the function with new params, your `career_pages` table will have:

```json
{
  "id": "uuid-here",
  "company_id": "google-company-uuid",
  "career_url": "https://careers.google.com/jobs",
  "scraped_from": "hiring.cafe",
  "scraped_at": "2026-01-10 10:30:00",
  "api_endpoint": "https://boards-api.greenhouse.io/v1/boards/google/jobs",
  "api_endpoint_detail": "https://boards-api.greenhouse.io/v1/boards/google/jobs/{id}",
  "application_url": "https://boards.greenhouse.io/google/jobs/123",
  "ats_provider": "Greenhouse"
}
```

---

## Next Step: Update Extension Code

To actually pass these values from the extension, you need to update `background.js`:

```javascript
// In uploadToSupabase() function
const result = await response.json();
await supabase.rpc('save_hiring_cafe_job_to_existing_schema', {
    p_title: job.title,
    p_company_name: job.company.name,
    // ... existing params ...
    p_skills: job.skills || [],
    p_benefits: job.benefits || [],
    // NEW: Add career page fields
    p_career_url: job.careerPageUrl || null,
    p_api_endpoint: job.apiEndpoint || null,
    p_api_endpoint_detail: job.apiEndpointDetail || null,
    p_ats_provider: job.atsProvider || null
});
```

But first, `contentExtractor.js` needs to extract these fields (that's step 2).

---

## Testing

After updating the function, test it:

```sql
-- Test insert
SELECT save_hiring_cafe_job_to_existing_schema(
    p_title := 'Test Job',
    p_description := 'Test description',
    p_responsibilities := 'Test responsibilities',
    p_requirement_summary := 'Test requirements',
    p_job_type := 'onsite',
    p_commitment_type := 'full-time',
    p_category := 'Engineering',
    p_experience_level := '2-5 years',
    p_salary_min := NULL,
    p_salary_max := NULL,
    p_salary_currency := NULL,
    p_salary_period := NULL,
    p_education_requirement := ARRAY['Bachelor'],
    p_education_preferred := ARRAY[]::TEXT[],
    p_application_url := 'https://boards.greenhouse.io/test/jobs/123',
    p_source_url := 'https://hiring.cafe/viewjob/test123',
    p_external_id := 'test123',
    p_posted_date := NOW(),
    p_raw_data := '{}'::JSONB,
    p_company_name := 'Test Company',
    p_company_website := 'https://test.com',
    p_company_description := 'Test company description',
    p_company_logo_url := NULL,
    p_company_linkedin_url := NULL,
    p_company_year_founded := NULL,
    p_company_employees := NULL,
    p_company_industries := ARRAY[]::TEXT[],
    p_company_activities := ARRAY[]::TEXT[],
    p_company_funding_stage := NULL,
    p_location_city := 'San Francisco',
    p_location_state := 'CA',
    p_location_country := 'USA',
    p_location_full := 'San Francisco, CA, USA',
    p_is_remote := FALSE,
    p_skills := ARRAY['JavaScript', 'React'],
    p_benefits := ARRAY['Health Insurance'],
    -- NEW: Test career page params
    p_career_url := 'https://test.com/careers',
    p_api_endpoint := 'https://boards-api.greenhouse.io/v1/boards/test/jobs',
    p_api_endpoint_detail := 'https://boards-api.greenhouse.io/v1/boards/test/jobs/{id}',
    p_ats_provider := 'Greenhouse'
);

-- Check if it worked
SELECT * FROM career_pages WHERE career_url = 'https://test.com/careers';
```

Should return a row with all the API fields populated! ✅

---

## Summary

✅ Function updated with 4 new optional parameters
✅ Creates/updates career_pages table with API data
✅ Backward compatible (old calls still work)
✅ Ready to use once you run the SQL

Next: Update extension code to pass these parameters (step 2).
