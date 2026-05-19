-- ============================================================
-- Main DB Schema — JobSearchUs Production Database
-- Project: osoilvzyyjmrbjsiyrgs
-- Run this in the Supabase SQL editor
-- ============================================================

-- ─── COMPANIES ───────────────────────────────────────────────
CREATE TABLE companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  domain              TEXT UNIQUE,

  -- Identity
  website_url         TEXT,
  logo_url            TEXT,
  description         TEXT,

  -- Social
  linkedin_url        TEXT,

  -- Classification
  industries          TEXT[],
  funding_stage       TEXT,      -- 'seed', 'series_a', 'series_b', 'public', 'bootstrapped'
  is_public           BOOLEAN DEFAULT FALSE,
  category            TEXT,      -- 'general', 'top500', 'startup'
  is_featured         BOOLEAN DEFAULT FALSE,

  -- Size & Location
  employee_count      INT,
  headquarters        TEXT,      -- city
  headquarters_country TEXT,

  -- Founded
  year_founded        INT,

  -- Stats
  job_count           INT DEFAULT 0,

  -- Source tracking
  sources             TEXT[],    -- ['hiring_cafe', 'remote100k', 'wellfound']

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_slug        ON companies(slug);
CREATE INDEX idx_companies_domain      ON companies(domain);
CREATE INDEX idx_companies_category    ON companies(category);
CREATE INDEX idx_companies_is_featured ON companies(is_featured);
CREATE INDEX idx_companies_industries  ON companies USING GIN(industries);

-- ─── LOCATIONS ───────────────────────────────────────────────
CREATE TABLE locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city         TEXT,
  state        TEXT,
  country      TEXT NOT NULL DEFAULT 'US',
  country_code TEXT,
  display_name TEXT NOT NULL,   -- "San Francisco, CA" / "Remote" / "New York, NY"
  is_remote    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_locations_display ON locations(display_name);
CREATE INDEX idx_locations_country        ON locations(country);
CREATE INDEX idx_locations_remote         ON locations(is_remote);
CREATE INDEX idx_locations_state          ON locations(state);

-- ─── SKILLS ──────────────────────────────────────────────────
CREATE TABLE skills (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  category   TEXT,   -- 'language', 'framework', 'tool', 'soft_skill'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_skills_slug ON skills(slug);

-- ─── JOBS ────────────────────────────────────────────────────
CREATE TABLE jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID NOT NULL REFERENCES companies(id),
  location_id          UUID REFERENCES locations(id),

  -- Core
  title                TEXT NOT NULL,
  slug                 TEXT UNIQUE NOT NULL,
  description          TEXT,
  requirements_summary TEXT,
  application_url      TEXT NOT NULL,

  -- Classification
  job_type             TEXT,    -- 'remote', 'hybrid', 'onsite'
  commitment_type      TEXT,    -- 'full_time', 'part_time', 'contract', 'internship'
  experience_level     TEXT,    -- 'entry', 'mid', 'senior', 'lead', 'executive'
  category             TEXT,    -- 'Engineering', 'Design', 'Marketing', 'Sales', etc.

  -- Salary
  salary_min           INT,
  salary_max           INT,
  salary_currency      TEXT DEFAULT 'USD',
  salary_period        TEXT DEFAULT 'yearly',  -- 'yearly', 'hourly', 'monthly'

  -- Dates
  posted_date          TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  first_seen_at        TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ DEFAULT NOW(),

  -- Source tracking
  raw_job_id           UUID,    -- reference back to DB2 raw_jobs.id
  ats_provider         TEXT,
  external_id          TEXT,

  -- Engagement
  click_count          INT DEFAULT 0,

  -- Status
  is_active            BOOLEAN DEFAULT TRUE,

  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_company_id       ON jobs(company_id);
CREATE INDEX idx_jobs_location_id      ON jobs(location_id);
CREATE INDEX idx_jobs_job_type         ON jobs(job_type);
CREATE INDEX idx_jobs_commitment_type  ON jobs(commitment_type);
CREATE INDEX idx_jobs_experience_level ON jobs(experience_level);
CREATE INDEX idx_jobs_category         ON jobs(category);
CREATE INDEX idx_jobs_posted_date      ON jobs(posted_date DESC);
CREATE INDEX idx_jobs_is_active        ON jobs(is_active);
CREATE INDEX idx_jobs_salary_min       ON jobs(salary_min);
CREATE INDEX idx_jobs_ats_provider     ON jobs(ats_provider);

-- Full-text search
CREATE INDEX idx_jobs_fts ON jobs
  USING GIN(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- ─── JOB SKILLS ──────────────────────────────────────────────
CREATE TABLE job_skills (
  job_id   UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, skill_id)
);

CREATE INDEX idx_job_skills_skill_id ON job_skills(skill_id);
CREATE INDEX idx_job_skills_job_id   ON job_skills(job_id);

-- ─── SAVED JOBS ──────────────────────────────────────────────
CREATE TABLE saved_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX idx_saved_jobs_user_id ON saved_jobs(user_id);
CREATE INDEX idx_saved_jobs_job_id  ON saved_jobs(job_id);

-- ─── APPLIED JOBS ────────────────────────────────────────────
CREATE TABLE applied_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  notes      TEXT,
  UNIQUE (user_id, job_id)
);

CREATE INDEX idx_applied_jobs_user_id ON applied_jobs(user_id);
CREATE INDEX idx_applied_jobs_job_id  ON applied_jobs(job_id);

-- ─── AUTO-UPDATE updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
