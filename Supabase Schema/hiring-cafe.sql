-- =============================================
-- JOB BOARD - SUPABASE SCHEMA
-- Full job board database with companies, jobs, skills, etc.
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- LOOKUP TABLES
-- =============================================

CREATE TABLE locations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  country VARCHAR,
  city VARCHAR,
  state VARCHAR,
  full_location TEXT NOT NULL,
  is_remote BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE skills (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR NOT NULL,
  category VARCHAR,
  normalized_name VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE benefits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR NOT NULL,
  category VARCHAR,
  normalized_name VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE certifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR NOT NULL,
  issuing_organization VARCHAR,
  category VARCHAR,
  normalized_name VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE languages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR NOT NULL,
  code VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- MAIN TABLES
-- =============================================

CREATE TABLE companies (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug TEXT,
  website TEXT,
  linkedin_url TEXT,
  description TEXT,
  logo_url TEXT,
  headquarters UUID REFERENCES locations(id),
  headquarters_country VARCHAR,
  year_founded INTEGER,
  number_employees INTEGER,
  industries TEXT[],
  activities TEXT[],
  funding_stage VARCHAR,
  latest_investment VARCHAR,
  latest_investment_year INTEGER,
  is_public BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE career_pages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  career_url TEXT NOT NULL,
  scraped_from TEXT,
  scraped_at TIMESTAMPTZ,
  api_endpoint TEXT,
  api_endpoint_detail TEXT,
  application_url TEXT,
  ats_provider TEXT
);

CREATE TABLE jobs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title VARCHAR NOT NULL,
  slug VARCHAR,
  company_id UUID REFERENCES companies(id),
  location_id UUID REFERENCES locations(id),
  description TEXT,
  responsibilities TEXT,
  requirement_summary TEXT,
  job_type VARCHAR,
  commitment_type VARCHAR,
  category VARCHAR,
  experience_level VARCHAR,
  salary_min NUMERIC,
  salary_max NUMERIC,
  salary_currency VARCHAR DEFAULT 'USD',
  salary_period VARCHAR,
  equity_offered BOOLEAN DEFAULT FALSE,
  equity_range TEXT,
  education_requirement TEXT[],
  education_preferred TEXT[],
  application_url TEXT,
  source_url TEXT NOT NULL,
  external_id VARCHAR,
  is_active BOOLEAN DEFAULT TRUE,
  posted_date TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  raw_data JSONB,
  view_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0
);

-- =============================================
-- JUNCTION TABLES
-- =============================================

CREATE TABLE job_skills (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  is_required BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (job_id, skill_id)
);

CREATE TABLE job_benefits (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  benefit_id UUID NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  details TEXT,
  PRIMARY KEY (job_id, benefit_id)
);

CREATE TABLE job_certifications (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  certification_id UUID NOT NULL REFERENCES certifications(id) ON DELETE CASCADE,
  is_required BOOLEAN DEFAULT FALSE,
  is_preferred BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (job_id, certification_id)
);

CREATE TABLE job_languages (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  language_id UUID NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  proficiency_required VARCHAR,
  is_required BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (job_id, language_id)
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_companies_slug ON companies(slug);
CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_jobs_company_id ON jobs(company_id);
CREATE INDEX idx_jobs_location_id ON jobs(location_id);
CREATE INDEX idx_jobs_is_active ON jobs(is_active);
CREATE INDEX idx_jobs_posted_date ON jobs(posted_date);
CREATE INDEX idx_jobs_category ON jobs(category);
CREATE INDEX idx_career_pages_company_id ON career_pages(company_id);
CREATE INDEX idx_locations_country ON locations(country);
CREATE INDEX idx_locations_city ON locations(city);
CREATE INDEX idx_skills_name ON skills(name);
CREATE INDEX idx_skills_category ON skills(category);
