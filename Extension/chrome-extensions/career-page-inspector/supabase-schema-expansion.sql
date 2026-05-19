-- Career Page Inspector - Expansion & Pagination Schema Update
-- Add columns for handling expand buttons, lazy loading, and special behaviors
-- Run this SQL in your Supabase SQL Editor

-- 1. Expand/Load More button selector
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS expand_button_selector TEXT;

COMMENT ON COLUMN career_pages.expand_button_selector
IS 'CSS selector for "View All", "Load More", or expand buttons that reveal hidden jobs (e.g., .revealButtonContainer)';

-- 2. Pagination type
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS pagination_type TEXT;

COMMENT ON COLUMN career_pages.pagination_type
IS 'Type of pagination: "expand" (click to expand), "scroll" (lazy load on scroll), "click" (next page), "none"';

-- 3. Requires expansion flag
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS requires_expansion BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN career_pages.requires_expansion
IS 'TRUE if expand buttons must be clicked before scraping all jobs';

-- 4. Wait time after action (milliseconds)
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS wait_time_ms INTEGER DEFAULT 1000;

COMMENT ON COLUMN career_pages.wait_time_ms
IS 'Time to wait after clicking expand/scroll in milliseconds (default 1000ms)';

-- 5. Scroll to load flag
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS scroll_to_load BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN career_pages.scroll_to_load
IS 'TRUE if page requires scrolling to trigger lazy loading of jobs';

-- 6. Special instructions (free text)
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS scraping_notes TEXT;

COMMENT ON COLUMN career_pages.scraping_notes
IS 'Free text field for special instructions, quirks, or handling notes for this career page';

-- 7. Multiple containers flag
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS has_multiple_containers BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN career_pages.has_multiple_containers
IS 'TRUE if page has multiple job containers (e.g., grouped by team/department)';

-- 8. Navigation type (how to access job details)
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS navigation_type TEXT DEFAULT 'link';

COMMENT ON COLUMN career_pages.navigation_type
IS 'How to access job details: "link" (has href), "button" (click button), "card_click" (click entire card)';

-- Verify new columns
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'career_pages'
AND column_name IN (
  'expand_button_selector',
  'pagination_type',
  'requires_expansion',
  'wait_time_ms',
  'scroll_to_load',
  'scraping_notes',
  'has_multiple_containers',
  'navigation_type'
)
ORDER BY ordinal_position;
