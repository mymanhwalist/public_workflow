# Schema Update Summary - Application URL & ATS Provider

## Problem
The career-page-inspector extension had comprehensive API extraction functions from hiring-cafe-extension, but **no dedicated columns** to store:
- Application URL (where users apply for jobs)
- ATS Provider (Greenhouse, Lever, Workday, etc.)

These were either stored in `parsed_job_data` JSONB or not stored at all.

---

## Solution

### ✅ 1. Added New Supabase Columns

**File**: `supabase-schema-application-url.sql`

```sql
-- Application URL - where users apply
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS application_url TEXT;

-- ATS Provider name for filtering
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS ats_provider TEXT;

-- Optional: Company API endpoint
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS company_api_endpoint TEXT;
```

### ✅ 2. Updated Extension Code

#### **inspector.js** - Lines 349-357
Added extraction and logging:
```javascript
// Extract application URL (where users apply for jobs)
const applicationUrl = extractApplicationUrl();
inspection.application_url = applicationUrl;
console.log('[Inspector] ✓ Detected application URL:', applicationUrl);

// Detect ATS provider
const atsProvider = detectATS();
inspection.ats_provider = atsProvider;
console.log('[Inspector] ✓ Detected ATS provider:', atsProvider);
```

#### **inspector.js** - Lines 1001-1002
Added to final inspection payload:
```javascript
const finalInspection = {
  // ... existing fields
  application_url: inspection.application_url || null,
  ats_provider: inspection.ats_provider || null,
  // ... rest of fields
};
```

#### **background.js** - Lines 593-594
Added to Supabase PATCH payload:
```javascript
const payload = {
  // ... existing fields
  application_url: inspection.application_url || null,
  ats_provider: inspection.ats_provider || null,
  // ... rest of fields
};
```

#### **inspector.js** - Lines 623-638
Added UI display:
```javascript
// Show Application URL
${inspection.application_url ? `
<div style="margin-bottom: 4px;">
  <span style="opacity: 0.7;">Apply URL:</span>
  <span style="font-family: monospace; ...">
    ${inspection.application_url}
  </span>
</div>
` : ''}

// Show ATS Provider with green badge
${inspection.ats_provider ? `
<div style="margin-bottom: 4px;">
  <span style="opacity: 0.7;">ATS:</span>
  <span style="background: rgba(16, 185, 129, 0.2); color: rgba(16, 185, 129, 1); ...">
    ${inspection.ats_provider}
  </span>
</div>
` : ''}
```

---

## How to Apply Changes

### Step 1: Update Supabase Schema

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run this SQL:

```sql
-- Add new columns
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS application_url TEXT;

ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS ats_provider TEXT;

ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS company_api_endpoint TEXT;

-- Add comments
COMMENT ON COLUMN career_pages.application_url
IS 'The URL where users apply for the job (can be ATS URL like Greenhouse, Lever, Workday, etc.)';

COMMENT ON COLUMN career_pages.ats_provider
IS 'Detected ATS provider: Greenhouse, Lever, Workday, iCIMS, Taleo, etc.';

COMMENT ON COLUMN career_pages.company_api_endpoint
IS 'Company information API endpoint if available (e.g., /api/company/{id})';

-- Verify columns added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'career_pages'
AND column_name IN ('application_url', 'ats_provider', 'company_api_endpoint');
```

### Step 2: Reload Extension

1. Go to `chrome://extensions/`
2. Click **Reload** button on Career Page Inspector extension
3. Extension now uses new columns automatically

---

## Updated Schema Structure

Your `career_pages` table now has:

```
career_pages
├── id (UUID)
├── company_name (TEXT)
├── website_url (TEXT)
├── career_page_url (TEXT/JSON)
├── job_table (TEXT) - CSS selector
├── job_item (TEXT) - CSS selector
├── job_page (TEXT) - CSS selector
│
├── api_endpoint (TEXT) - Career page job list API
├── api_endpoint_detail (TEXT) - Single job detail API
├── application_url (TEXT) ⭐ NEW - Where users apply
├── ats_provider (TEXT) ⭐ NEW - Greenhouse, Lever, etc.
├── company_api_endpoint (TEXT) ⭐ NEW - Company info API
│
├── expand_button_selector (TEXT)
├── pagination_type (TEXT)
├── requires_expansion (BOOLEAN)
├── wait_time_ms (INTEGER)
├── scroll_to_load (BOOLEAN)
├── has_multiple_containers (BOOLEAN)
├── navigation_type (TEXT)
├── scraping_notes (TEXT)
│
├── parsed_job_data (JSONB)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

---

## Example Data After Update

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "company_name": "Abacus Group LLC",
  "website_url": "https://www.abacusgroupllc.com",
  "career_page_url": "https://www.abacusgroupllc.com/careers/job-openings",

  "job_table": ".job-list",
  "job_item": ".job-item",
  "job_page": "a[href*='/jobs/']",

  "api_endpoint": "https://boards-api.greenhouse.io/v1/boards/abacusgroup/jobs",
  "api_endpoint_detail": "https://boards-api.greenhouse.io/v1/boards/abacusgroup/jobs/{id}",
  "application_url": "https://boards.greenhouse.io/abacusgroup/jobs/6953081003",
  "ats_provider": "Greenhouse",
  "company_api_endpoint": null,

  "expand_button_selector": null,
  "pagination_type": "none",
  "requires_expansion": false,
  "navigation_type": "link"
}
```

---

## Benefits

### 1. **Dedicated Columns for Frequent Access**
- No need to parse JSONB to get application URL
- Fast filtering by ATS provider
- Easier SQL queries

### 2. **Better Data Organization**
```sql
-- Find all Greenhouse career pages
SELECT company_name, application_url
FROM career_pages
WHERE ats_provider = 'Greenhouse';

-- Find pages with application URLs but no API
SELECT company_name, application_url
FROM career_pages
WHERE application_url IS NOT NULL
  AND api_endpoint IS NULL;
```

### 3. **Clearer Separation of Concerns**
- `api_endpoint` = Career page job list API
- `application_url` = Where to apply for individual jobs
- `ats_provider` = Platform identifier

### 4. **Automated Detection**
The `extractApplicationUrl()` function automatically detects application URLs from 40+ ATS platforms:
- UltiPro, Taleo, Greenhouse, Lever
- Workday, iCIMS, Jobvite, SmartRecruiters
- BambooHR, Ashby, Workable, and more

---

## UI Updates

When inspecting a career page, the overlay now shows:

```
┌─────────────────────────────────────┐
│  Container: .job-list (12 found)   │
│  Item: .job-item                    │
│  Link: a[href*='/jobs/']            │
│  API (list): https://...            │
│  API (detail): https://.../{id}     │
│  Apply URL: https://boards.green... │  ⭐ NEW
│  ATS: Greenhouse                    │  ⭐ NEW (green badge)
└─────────────────────────────────────┘
```

---

## Migration (Optional)

If you have existing data in `parsed_job_data` JSONB, you can migrate it:

```sql
-- Extract application_url from parsed_job_data
UPDATE career_pages
SET application_url = parsed_job_data->>'applyUrl'
WHERE parsed_job_data->>'applyUrl' IS NOT NULL
  AND application_url IS NULL;

-- Verify migration
SELECT
  company_name,
  application_url,
  parsed_job_data->>'applyUrl' as old_apply_url
FROM career_pages
WHERE parsed_job_data->>'applyUrl' IS NOT NULL
LIMIT 5;
```

---

## Testing

### Test the New Columns:

1. **Inspect a Greenhouse Career Page**:
   - Should detect `ats_provider = "Greenhouse"`
   - Should extract `application_url` starting with `https://boards.greenhouse.io/`

2. **Inspect a Lever Career Page**:
   - Should detect `ats_provider = "Lever"`
   - Should extract `application_url` starting with `https://jobs.lever.co/`

3. **Inspect a Custom Career Page**:
   - Should detect `ats_provider = "Custom"` or null
   - Should still try to extract `application_url` from apply links

4. **Check Supabase Data**:
```sql
SELECT
  company_name,
  ats_provider,
  application_url,
  api_endpoint
FROM career_pages
ORDER BY created_at DESC
LIMIT 10;
```

---

## Summary

✅ **Added 3 new columns**: `application_url`, `ats_provider`, `company_api_endpoint`
✅ **Updated extension code** to extract and save these fields
✅ **Enhanced UI** to display application URL and ATS provider
✅ **Backward compatible** - works with existing data
✅ **No breaking changes** - all changes are additive

The extension now stores **comprehensive career page metadata** for building a universal job scraper!
