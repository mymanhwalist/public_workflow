-- Career Page Inspector Schema Update
-- Add new columns for API endpoint detection and parsed job data
--
-- Run this SQL in your Supabase SQL Editor to add the new columns

-- Add api_endpoint column to store detected API endpoints
-- This will help identify if the career page uses an API (Lever, Greenhouse, Workable, etc.)
-- so you can use the API directly instead of HTML scraping in the future
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS api_endpoint TEXT;

-- Add parsed_job_data column to store structured data from job detail pages
-- This stores JSON with: title, description, requirements, location, jobType,
-- and most importantly: applyButton (selector, class, ID, text, type) and applyUrl
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS parsed_job_data JSONB;

-- Add comments to document what these columns contain
COMMENT ON COLUMN career_pages.api_endpoint IS 'Detected API endpoint URL if the career page uses an API (e.g., Lever, Greenhouse, Workable)';
COMMENT ON COLUMN career_pages.parsed_job_data IS 'Structured job data parsed from job detail page: {title, description, requirements, location, jobType, applyButton{text,tag,class,id,type}, applyUrl}';

-- Verify the columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'career_pages'
AND column_name IN ('api_endpoint', 'parsed_job_data');
