-- ============================================================
-- DB2 — Staging Database Schema
-- Project: vmdbwpqopujirdcthgta
--
-- Tables:
--   1. companies             — company registry + enrichment
--   2. career_page_configs   — scraper configs (API / sitemap / CSS)
--   3. raw_jobs              — permanent job log + dedup + AI queue
--   4. scrape_runs           — audit log per scrape run
--
-- Run this in DB2 Supabase SQL editor
-- ============================================================


-- ============================================================
-- 1. COMPANIES
-- Source of truth for all company data across all sources.
-- Dedup key: domain (e.g. "stripe.com")
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- identity
  name                  varchar NOT NULL,
  slug                  varchar UNIQUE NOT NULL,          -- url-safe: "stripe"
  domain                varchar UNIQUE NOT NULL,          -- dedup key: "stripe.com"
  website               text,                             -- "https://stripe.com"

  -- enrichment (from remote100k, wellfound, linkedin)
  logo_url              text,
  description           text,
  industry              text[],                           -- ["Fintech", "Payments"]
  company_size          varchar,                          -- "1,001-5,000"
  founded_year          integer,
  headquarters          text,                             -- "San Francisco, CA"
  headquarters_country  varchar,                          -- "US"
  linkedin_url          text,
  twitter_url           text,

  -- classification
  category              varchar,                          -- startup | top500 | general

  -- where this company data came from
  sources               text[] DEFAULT '{}',              -- ["hiring_cafe","remote100k","wellfound"]

  -- status
  is_active             boolean DEFAULT true,

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_companies_domain    ON companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_slug      ON companies(slug);
CREATE INDEX IF NOT EXISTS idx_companies_category  ON companies(category);


-- ============================================================
-- 2. CAREER PAGE CONFIGS
-- One row per scraping method per company.
-- A company can have both an API config and a sitemap config.
-- ============================================================

CREATE TABLE IF NOT EXISTS career_page_configs (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- what to scrape
  career_page_url       text,                             -- "https://stripe.com/jobs"
  ats_provider          varchar,                          -- greenhouse | lever | ashby | workday | custom
  source_type           varchar NOT NULL,                 -- api | sitemap | css

  -- api config
  api_endpoint          text,                             -- job list endpoint
  api_endpoint_detail   text,                             -- single job endpoint (with {id} placeholder)

  -- sitemap config
  sitemap_url           text,

  -- css config (wellfound data — for future use)
  css_job_table         text,
  css_job_item          text,
  css_job_page          text,
  pagination_type       varchar,                          -- api | scroll | click | none
  requires_expansion    boolean DEFAULT false,
  expand_button_selector text,
  wait_time_ms          integer,
  navigation_type       varchar,                          -- link | button | card_click
  scraping_notes        text,

  -- verification status
  is_verified           boolean DEFAULT false,            -- tested and confirmed working
  last_verified_at      timestamptz,
  consecutive_failures  integer DEFAULT 0,               -- auto-disable after too many failures

  -- run tracking
  last_scraped_at       timestamptz,

  -- where this config came from
  discovered_from       varchar,                          -- hiring_cafe | wellfound | remote100k | manual

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_configs_company_id    ON career_page_configs(company_id);
CREATE INDEX IF NOT EXISTS idx_configs_source_type   ON career_page_configs(source_type);
CREATE INDEX IF NOT EXISTS idx_configs_ats_provider  ON career_page_configs(ats_provider);
CREATE INDEX IF NOT EXISTS idx_configs_is_verified   ON career_page_configs(is_verified);
CREATE INDEX IF NOT EXISTS idx_configs_last_scraped  ON career_page_configs(last_scraped_at);


-- ============================================================
-- 3. RAW JOBS
-- Permanent log of every job ever seen.
-- Serves three purposes:
--   1. Queue for extraction script (status = pending)
--   2. Dedup log (application_url UNIQUE)
--   3. History — last_seen_at, seen_count, first_seen_at
--
-- NEVER delete from this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS raw_jobs (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  config_id             uuid REFERENCES career_page_configs(id) ON DELETE SET NULL,

  -- raw data from API / sitemap (exactly as scraped)
  title                 text NOT NULL,
  description           text,                             -- raw HTML or plain text
  location_raw          text,                             -- raw string as scraped
  application_url       text UNIQUE NOT NULL,             -- PRIMARY dedup key (cleaned, no tracking params)
  external_id           varchar,                          -- ATS job ID extracted from URL
  posted_date           timestamptz,                      -- if source provides it, else null
  raw_data              jsonb,                            -- full API response payload

  -- history tracking
  first_seen_at         timestamptz DEFAULT now(),        -- proxy for posted_date when source has none
  last_seen_at          timestamptz DEFAULT now(),        -- updated every scrape this job appears
  seen_count            integer DEFAULT 1,                -- how many scrape runs this job appeared in

  -- first scrape flag
  -- true = this job was seen on the company's very first scrape run
  -- true means age unknown → do NOT promote to main DB
  is_first_scrape       boolean DEFAULT false,

  -- extraction queue status
  -- pending            = new job, ready for extraction script
  -- promoted           = processed + sent to main DB
  -- skipped_first_scrape = held back (first scrape, age unknown)
  -- failed             = extraction script errored
  status                varchar DEFAULT 'pending',

  is_promoted           boolean DEFAULT false,
  promoted_at           timestamptz,
  error_message         text,

  scraped_at            timestamptz DEFAULT now()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_raw_jobs_company_id      ON raw_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_raw_jobs_config_id       ON raw_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_raw_jobs_status          ON raw_jobs(status);
CREATE INDEX IF NOT EXISTS idx_raw_jobs_first_seen_at   ON raw_jobs(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_raw_jobs_last_seen_at    ON raw_jobs(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_raw_jobs_is_promoted     ON raw_jobs(is_promoted);
CREATE INDEX IF NOT EXISTS idx_raw_jobs_external_id     ON raw_jobs(company_id, external_id);


-- ============================================================
-- 4. SCRAPE RUNS
-- Audit log. One row per scrape run per company config.
-- Used to detect whether a company has been scraped before
-- (is_first_scrape flag).
-- ============================================================

CREATE TABLE IF NOT EXISTS scrape_runs (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  config_id             uuid REFERENCES career_page_configs(id) ON DELETE SET NULL,

  -- critical: was this the very first scrape for this company?
  is_first_scrape       boolean DEFAULT false,

  -- counts
  jobs_found            integer DEFAULT 0,                -- total jobs returned by API/sitemap
  jobs_new              integer DEFAULT 0,                -- not seen in raw_jobs before
  jobs_updated          integer DEFAULT 0,                -- already in raw_jobs, last_seen_at updated
  jobs_promoted         integer DEFAULT 0,                -- sent to main DB this run

  -- result
  started_at            timestamptz DEFAULT now(),
  completed_at          timestamptz,
  status                varchar DEFAULT 'running',        -- running | success | failed | partial
  error_message         text
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_scrape_runs_company_id   ON scrape_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_config_id    ON scrape_runs(config_id);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started_at   ON scrape_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status       ON scrape_runs(status);


-- ============================================================
-- HELPER: updated_at auto-update trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_configs_updated_at
  BEFORE UPDATE ON career_page_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
