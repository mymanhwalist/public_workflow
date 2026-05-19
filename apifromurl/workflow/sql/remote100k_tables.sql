-- ============================================================
-- remote100k scraping tables
-- Run this in DB2 Supabase SQL editor (vmdbwpqopujirdcthgta)
-- ============================================================

-- Table 1: Company profiles scraped from remote100k
CREATE TABLE IF NOT EXISTS remote100k_companies (
  id                  uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name                varchar NOT NULL,
  slug                varchar UNIQUE NOT NULL,         -- e.g. "nvidia"
  profile_url         text,                            -- https://remote100k.com/remote-companies/nvidia
  website_url         text,                            -- https://www.nvidia.com
  logo_url            text,                            -- framerusercontent.com image (original source)
  logo_stored_url     text,                            -- our own stored copy (after downloading)
  description         text,
  linkedin_url        text,
  twitter_url         text,
  hq_raw              text,                            -- raw: "Sunnyvale, CA"
  hq_city             varchar,
  hq_country          varchar,
  company_size        varchar,                         -- "501-1,000"
  founded_year        integer,
  industry_raw        text,                            -- "Computer and Network Security, Cybersecurity"
  industry_array      text[],                          -- ["Computer and Network Security", "Cybersecurity"]
  total_jobs_listed   integer DEFAULT 0,               -- count of jobs found on their remote100k page
  scraped_at          timestamptz DEFAULT now(),
  raw_data            jsonb                            -- full search index entry
);

-- Table 2: Jobs found on each company's remote100k profile page
-- These are used to discover ATS provider and career page endpoints
CREATE TABLE IF NOT EXISTS remote100k_jobs (
  id                  uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id          uuid REFERENCES remote100k_companies(id) ON DELETE CASCADE,
  company_slug        varchar NOT NULL,
  title               text NOT NULL,
  job_page_url        text,                            -- remote100k job detail URL e.g. /remote-job/nvidia-senior-ai-engineer-...
  application_url     text,                            -- the Apply button href e.g. https://nvidia.wd5.myworkdayjobs.com/...
  ats_domain          varchar,                         -- extracted from application_url e.g. "nvidia.wd5.myworkdayjobs.com"
  ats_provider        varchar,                         -- derived: "workday" / "greenhouse" / "lever" / "icims" / "unknown"
  remote_location     text,                            -- raw: "🇺🇸 USA"
  category            text,                            -- "Engineering", "Marketing" etc
  salary_raw          text,                            -- raw: "$184,000 - $356,500"
  commitment_type     varchar,                         -- "Full-Time" / "Part-Time" / "Contract"
  posted_ago          varchar,                         -- raw from page: "14d", "47d", "3h" etc
  scraped_at          timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_remote100k_jobs_company_id    ON remote100k_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_remote100k_jobs_ats_provider  ON remote100k_jobs(ats_provider);
CREATE INDEX IF NOT EXISTS idx_remote100k_jobs_ats_domain    ON remote100k_jobs(ats_domain);
CREATE INDEX IF NOT EXISTS idx_remote100k_companies_slug     ON remote100k_companies(slug);

-- Unique constraint for upsert on jobs (needed for onConflict)
CREATE UNIQUE INDEX IF NOT EXISTS idx_remote100k_jobs_upsert ON remote100k_jobs(company_slug, title);


 CREATE POLICY "Allow anon uploads"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'company-logos');