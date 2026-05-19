-- =============================================
-- CAREER PAGE FINDER - SUPABASE SCHEMA
-- Used by: Chrome Extension (Career Page Finder)
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- CAREER PAGES TABLE
-- =============================================

CREATE TABLE career_pages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_name VARCHAR NOT NULL,
  website_url TEXT NOT NULL,
  career_page_url TEXT,
  api_endpoint TEXT,
  api_endpoint_detail TEXT,
  job_table TEXT,
  job_item TEXT,
  job_page TEXT,
  job_page_table TEXT,
  parsed_job_data JSONB,
  expand_button_selector TEXT,
  pagination_type TEXT,
  navigation_type TEXT,
  requires_expansion BOOLEAN,
  has_multiple_containers BOOLEAN,
  scroll_to_load BOOLEAN,
  wait_time_ms INTEGER,
  scraping_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_career_pages_company_name ON career_pages(company_name);
CREATE INDEX idx_career_pages_website_url ON career_pages(website_url);
CREATE INDEX idx_career_pages_career_page_url ON career_pages(career_page_url);
