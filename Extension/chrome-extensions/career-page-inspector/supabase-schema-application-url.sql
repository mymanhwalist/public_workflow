-- Career Page Inspector - Application URL Schema Update
-- Add columns for storing application URLs and company information
-- Run this SQL in your Supabase SQL Editor

-- ============================================================================
-- APPLICATION URL COLUMN
-- ============================================================================
-- Store the actual application URL where users apply for jobs
-- This is extracted by extractApplicationUrl() function
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS application_url TEXT;

COMMENT ON COLUMN career_pages.application_url
IS 'The URL where users apply for the job (can be ATS URL like Greenhouse, Lever, Workday, etc.)';

-- ============================================================================
-- COMPANY API COLUMN (OPTIONAL)
-- ============================================================================
-- Store company-specific API endpoints if found
-- This is different from api_endpoint (which is for job listings)
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS company_api_endpoint TEXT;

COMMENT ON COLUMN career_pages.company_api_endpoint
IS 'Company information API endpoint if available (e.g., /api/company/{id})';

-- ============================================================================
-- ATS PROVIDER COLUMN
-- ============================================================================
-- Store detected ATS provider name for easier filtering
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS ats_provider TEXT;

COMMENT ON COLUMN career_pages.ats_provider
IS 'Detected ATS provider: Greenhouse, Lever, Workday, iCIMS, Taleo, etc.';

-- ============================================================================
-- CAREER PAGE URL ARRAY (IF NOT ALREADY TEXT[])
-- ============================================================================
-- Some career pages have multiple URLs (e.g., by department)
-- This ensures the column can store arrays
DO $$
BEGIN
    -- Check if career_page_url is TEXT (not TEXT[])
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'career_pages'
        AND column_name = 'career_page_url'
        AND data_type = 'text'
    ) THEN
        -- Career page URL is already TEXT, might be storing JSON array as string
        -- Add a note about this
        COMMENT ON COLUMN career_pages.career_page_url
        IS 'Career page URL(s). Can be single URL (text) or JSON array of URLs (e.g., ["url1", "url2"])';
    END IF;
END $$;

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'career_pages'
AND column_name IN (
    'application_url',
    'company_api_endpoint',
    'ats_provider',
    'api_endpoint',
    'api_endpoint_detail',
    'career_page_url'
)
ORDER BY ordinal_position;

-- ============================================================================
-- EXAMPLE DATA
-- ============================================================================
/*
After running this update, your data will look like:

{
  "company_name": "Abacus Group",
  "website_url": "https://www.abacusgroupllc.com",
  "career_page_url": "https://www.abacusgroupllc.com/careers/job-openings",
  "job_table": ".job-list-item",

  -- NEW: Specific columns for URLs
  "application_url": "https://boards.greenhouse.io/abacusgroup/jobs/6953081003",
  "api_endpoint": "https://boards-api.greenhouse.io/v1/boards/abacusgroup/jobs",
  "api_endpoint_detail": "https://boards-api.greenhouse.io/v1/boards/abacusgroup/jobs/{id}",
  "company_api_endpoint": null,
  "ats_provider": "Greenhouse",

  -- Existing columns
  "parsed_job_data": {
    "title": "Client Support Technician",
    "description": "...",
    "applyUrl": "https://boards.greenhouse.io/abacusgroup/jobs/6953081003"
  }
}
*/

-- ============================================================================
-- MIGRATION QUERY (OPTIONAL)
-- ============================================================================
-- If you want to extract application_url from existing parsed_job_data:
/*
UPDATE career_pages
SET application_url = parsed_job_data->>'applyUrl'
WHERE parsed_job_data->>'applyUrl' IS NOT NULL
  AND application_url IS NULL;
*/
