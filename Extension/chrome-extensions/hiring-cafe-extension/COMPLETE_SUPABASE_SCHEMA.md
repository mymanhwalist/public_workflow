# Complete Supabase Schema - Hiring Cafe
**Generated:** 2026-01-11
**For:** Frontend Development

---

## 📊 Database Overview

**Total Tables:** 13
**Junction Tables:** 4 (job_skills, job_benefits, job_certifications, job_languages)
**Core Entity Tables:** 9

---

## 🗂️ Tables

### 1. **companies**
Stores company information

```sql
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    website TEXT,
    linkedin_url TEXT,
    description TEXT,
    logo_url TEXT,

    -- Location
    headquarters UUID REFERENCES locations(id),

    -- Company Details
    year_founded INTEGER,
    number_employees INTEGER,
    industries TEXT[],
    activities TEXT[],

    -- Funding
    funding_stage VARCHAR(100),
    latest_investment VARCHAR(100),
    latest_investment_year INTEGER,
    is_public BOOLEAN DEFAULT FALSE,

    -- Meta
    slug TEXT UNIQUE,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `companies_pkey` (id) - PRIMARY KEY
- `idx_companies_slug` (slug) - UNIQUE
- `idx_companies_name` (name) - B-tree
- `idx_companies_industries` (industries) - GIN array search

**Foreign Keys:**
- `headquarters` → `locations(id)`

---

### 2. **locations**
Stores job and company locations

```sql
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country VARCHAR(100),
    city VARCHAR(100),
    state VARCHAR(100),
    full_location TEXT NOT NULL,
    is_remote BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `locations_pkey` (id) - PRIMARY KEY
- `idx_locations_country` (country) - B-tree
- `idx_locations_city` (city) - B-tree
- `idx_locations_full_location_trgm` (full_location) - GIN trigram for fuzzy search

---

### 3. **jobs**
Main jobs table

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Basic Info
    title VARCHAR(500) NOT NULL,
    slug VARCHAR(500) UNIQUE,
    company_id UUID REFERENCES companies(id),
    location_id UUID REFERENCES locations(id),
    description TEXT,
    responsibilities TEXT,
    requirement_summary TEXT,

    -- Job Type
    job_type VARCHAR(50),              -- 'remote', 'hybrid', 'onsite'
    commitment_type VARCHAR(50),        -- 'full-time', 'part-time', 'contract'
    category VARCHAR(100),
    experience_level VARCHAR(50),

    -- Compensation
    salary_min NUMERIC(12, 2),
    salary_max NUMERIC(12, 2),
    salary_currency VARCHAR(10) DEFAULT 'USD',
    salary_period VARCHAR(20),          -- 'yearly', 'monthly', 'hourly'
    equity_offered BOOLEAN DEFAULT FALSE,
    equity_range TEXT,

    -- Education
    education_requirement TEXT[],
    education_preferred TEXT[],

    -- URLs
    application_url TEXT,
    source_url TEXT NOT NULL UNIQUE,
    external_id VARCHAR(255),

    -- Status & Dates
    is_active BOOLEAN DEFAULT TRUE,
    posted_date TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Analytics
    view_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,

    -- Raw Data
    raw_data JSONB
);
```

**Indexes:**
- `jobs_pkey` (id) - PRIMARY KEY
- `jobs_slug_key` (slug) - UNIQUE
- `unique_source_url` (source_url) - UNIQUE
- `unique_source_external_id` (source_url, external_id) - UNIQUE composite
- `idx_jobs_company_id` (company_id)
- `idx_jobs_location_id` (location_id)
- `idx_jobs_category` (category)
- `idx_jobs_job_type` (job_type)
- `idx_jobs_commitment_type` (commitment_type)
- `idx_jobs_experience_level` (experience_level)
- `idx_jobs_active` (is_active WHERE is_active = true) - Partial index
- `idx_jobs_posted_date` (posted_date DESC)
- `idx_jobs_scraped_at` (scraped_at DESC)
- `idx_jobs_salary_range` (salary_min, salary_max)
- `idx_jobs_title_trgm` (title) - GIN trigram for fuzzy search
- `idx_jobs_description_trgm` (description) - GIN trigram
- `idx_jobs_responsibilities_trgm` (responsibilities) - GIN trigram
- `idx_jobs_requirement_summary_trgm` (requirement_summary) - GIN trigram
- `idx_jobs_raw_data` (raw_data) - GIN JSONB search

**Foreign Keys:**
- `company_id` → `companies(id)`
- `location_id` → `locations(id)`

---

### 4. **skills**
Stores technical and soft skills

```sql
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50),
    normalized_name VARCHAR(100)
);
```

**Indexes:**
- `skills_pkey` (id) - PRIMARY KEY
- `skills_name_key` (name) - UNIQUE
- `idx_skills_normalized_name` (normalized_name)

---

### 5. **benefits**
Stores job benefits/perks

```sql
CREATE TABLE benefits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50),
    normalized_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `benefits_pkey` (id) - PRIMARY KEY
- `benefits_name_key` (name) - UNIQUE
- `idx_benefits_normalized_name` (normalized_name)

**Example categories:** Health Insurance, Remote Work, 401k, PTO, Stock Options, etc.

---

### 6. **certifications**
Stores professional certifications

```sql
CREATE TABLE certifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) UNIQUE NOT NULL,
    issuing_organization VARCHAR(200),
    category VARCHAR(50),
    normalized_name VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `certifications_pkey` (id) - PRIMARY KEY
- `certifications_name_key` (name) - UNIQUE
- `idx_certifications_normalized_name` (normalized_name)

**Examples:** AWS Certified, PMP, CISSP, CPA, etc.

---

### 7. **languages**
Stores spoken/written languages

```sql
CREATE TABLE languages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(10),                    -- ISO 639-1 code (e.g., 'en', 'es', 'fr')
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `languages_pkey` (id) - PRIMARY KEY
- `languages_name_key` (name) - UNIQUE

**Examples:** English (en), Spanish (es), Mandarin (zh), etc.

---

### 8. **job_skills** (Junction Table)
Links jobs to required/preferred skills

```sql
CREATE TABLE job_skills (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (job_id, skill_id)
);
```

**Indexes:**
- `job_skills_pkey` (job_id, skill_id) - PRIMARY KEY
- `idx_job_skills_skill_id` (skill_id)

**Foreign Keys:**
- `job_id` → `jobs(id)` ON DELETE CASCADE
- `skill_id` → `skills(id)` ON DELETE CASCADE

---

### 9. **job_benefits** (Junction Table)
Links jobs to benefits offered

```sql
CREATE TABLE job_benefits (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    benefit_id UUID REFERENCES benefits(id) ON DELETE CASCADE,
    details TEXT,                         -- Optional: "4 weeks PTO", "$500/month", etc.
    PRIMARY KEY (job_id, benefit_id)
);
```

**Indexes:**
- `job_benefits_pkey` (job_id, benefit_id) - PRIMARY KEY
- `idx_job_benefits_benefit_id` (benefit_id)

**Foreign Keys:**
- `job_id` → `jobs(id)` ON DELETE CASCADE
- `benefit_id` → `benefits(id)` ON DELETE CASCADE

---

### 10. **job_certifications** (Junction Table)
Links jobs to required/preferred certifications

```sql
CREATE TABLE job_certifications (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    certification_id UUID REFERENCES certifications(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT FALSE,
    is_preferred BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (job_id, certification_id)
);
```

**Indexes:**
- `job_certifications_pkey` (job_id, certification_id) - PRIMARY KEY
- `idx_job_certifications_certification_id` (certification_id)

**Foreign Keys:**
- `job_id` → `jobs(id)` ON DELETE CASCADE
- `certification_id` → `certifications(id)` ON DELETE CASCADE

---

### 11. **job_languages** (Junction Table)
Links jobs to language requirements

```sql
CREATE TABLE job_languages (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    language_id UUID REFERENCES languages(id) ON DELETE CASCADE,
    proficiency_required VARCHAR(50),     -- 'native', 'fluent', 'professional', 'conversational'
    is_required BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (job_id, language_id)
);
```

**Indexes:**
- `job_languages_pkey` (job_id, language_id) - PRIMARY KEY
- `idx_job_languages_language_id` (language_id)

**Foreign Keys:**
- `job_id` → `jobs(id)` ON DELETE CASCADE
- `language_id` → `languages(id)` ON DELETE CASCADE

---

### 12. **career_pages**
Stores career page URLs and API detection data

```sql
CREATE TABLE career_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),

    -- URLs
    career_url TEXT NOT NULL,

    -- API Detection (for scraping)
    api_endpoint TEXT,
    api_endpoint_detail TEXT,
    application_url TEXT,
    ats_provider TEXT,

    -- Metadata
    scraped_from TEXT,                    -- 'hiring.cafe', 'career-page-inspector'
    scraped_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `career_pages_pkey` (id) - PRIMARY KEY
- `idx_career_pages_company_id` (company_id)
- `unique_company_career_url` (company_id, career_url) - UNIQUE composite

**Foreign Keys:**
- `company_id` → `companies(id)`

---

## 🔧 Functions

### **Main Functions (For Extension Use)**

#### 1. `save_hiring_cafe_job_to_existing_schema()`
**Returns:** UUID (job_id)

Main function to save a complete job from the extension. Handles:
- Company upsert (by name/website)
- Location upsert (by full_location)
- Skills upsert and linking
- Career page upsert (with API detection data)
- Job insertion

**Parameters (43 total):**

```sql
-- Job Fields
p_title VARCHAR,
p_description TEXT,
p_responsibilities TEXT,
p_requirement_summary TEXT,
p_job_type VARCHAR,
p_commitment_type VARCHAR,
p_category VARCHAR,
p_experience_level VARCHAR,

-- Salary
p_salary_min NUMERIC,
p_salary_max NUMERIC,
p_salary_currency VARCHAR,
p_salary_period VARCHAR,

-- Education
p_education_requirement TEXT[],
p_education_preferred TEXT[],

-- URLs
p_application_url TEXT,
p_source_url TEXT,              -- REQUIRED (unique constraint)
p_external_id VARCHAR,

-- Dates
p_posted_date TIMESTAMPTZ,
p_raw_data JSONB,

-- Company
p_company_name VARCHAR,
p_company_website TEXT,
p_company_description TEXT,
p_company_logo_url TEXT,
p_company_linkedin_url TEXT,
p_company_year_founded INTEGER,
p_company_employees INTEGER,
p_company_industries TEXT[],
p_company_activities TEXT[],
p_company_funding_stage VARCHAR,

-- Location
p_location_city VARCHAR,
p_location_state VARCHAR,
p_location_country VARCHAR,
p_location_full TEXT,
p_is_remote BOOLEAN,

-- Skills & Benefits
p_skills TEXT[],
p_benefits TEXT[],

-- Career Page / API Detection
p_career_url TEXT DEFAULT NULL,
p_api_endpoint TEXT DEFAULT NULL,
p_api_endpoint_detail TEXT DEFAULT NULL,
p_ats_provider TEXT DEFAULT NULL
```

**Logic:**
1. Upsert company (match by name OR website)
2. Upsert location (match by full_location)
3. Insert job (source_url must be unique)
4. Upsert skills and link via job_skills
5. Upsert career_page if p_career_url provided

---

#### 2. `save_career_page()`
**Returns:** UUID (career_page_id)

Standalone function to save career page data.

**Parameters:**
```sql
p_company_name VARCHAR,
p_company_website TEXT,
p_career_url TEXT,
p_scraped_from TEXT
```

---

#### 3. `upsert_company()`
**Returns:** UUID (company_id)

Finds existing company by name or website, or creates new.

---

#### 4. `upsert_location()`
**Returns:** UUID (location_id)

Finds existing location by full_location, or creates new.

---

#### 5. `upsert_job()`
**Returns:** UUID (job_id)

Standalone job upsert function.

---

### **Junction Table Functions**

#### 6. `add_skill_to_job()`
**Parameters:**
```sql
p_job_id UUID,
p_skill_name VARCHAR,
p_is_required BOOLEAN
```

Links a skill to a job (creates skill if doesn't exist).

---

#### 7. `add_benefit_to_job()`
**Parameters:**
```sql
p_job_id UUID,
p_benefit_name VARCHAR,
p_details TEXT
```

---

#### 8. `add_certification_to_job()`
**Parameters:**
```sql
p_job_id UUID,
p_certification_name VARCHAR,
p_issuing_organization VARCHAR,
p_category VARCHAR,
p_is_required BOOLEAN,
p_is_preferred BOOLEAN
```

---

#### 9. `add_language_to_job()`
**Parameters:**
```sql
p_job_id UUID,
p_language_name VARCHAR,
p_language_code VARCHAR,
p_proficiency_required VARCHAR,
p_is_required BOOLEAN
```

---

### **Analytics Functions**

#### 10. `increment_view_count(job_id UUID)`
Increments jobs.view_count by 1.

---

#### 11. `increment_click_count(job_id UUID)`
Increments jobs.click_count by 1.

---

### **Search Functions**

#### 12. `search_jobs()`
**Returns:** SETOF RECORD

Advanced job search function (uses trigram indexes for fuzzy matching).

---

### **Trigger Functions**

#### 13. `generate_job_slug()`
Automatically generates URL slug from job title on insert.

---

#### 14. `update_updated_at_column()`
Automatically updates updated_at timestamp on row update.

---

## 📊 Entity Relationships

```
companies
├─── jobs (company_id → companies.id)
├─── career_pages (company_id → companies.id)
└─── headquarters → locations.id

locations
├─── jobs (location_id → locations.id)
└─── companies.headquarters

jobs
├─── job_skills (job_id)
│    └─── skills (skill_id)
├─── job_benefits (job_id)
│    └─── benefits (benefit_id)
├─── job_certifications (job_id)
│    └─── certifications (certification_id)
└─── job_languages (job_id)
     └─── languages (language_id)
```

---

## 🔍 Common Queries for Frontend

### **1. Get Job with All Related Data**

```sql
SELECT
    j.*,
    c.name as company_name,
    c.website as company_website,
    c.logo_url as company_logo,
    c.industries as company_industries,
    l.full_location,
    l.city,
    l.state,
    l.country,
    l.is_remote,

    -- Aggregate skills
    ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) as skills,

    -- Aggregate benefits
    ARRAY_AGG(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as benefits,

    -- Aggregate certifications
    ARRAY_AGG(DISTINCT cert.name) FILTER (WHERE cert.name IS NOT NULL) as certifications,

    -- Aggregate languages
    ARRAY_AGG(DISTINCT lang.name) FILTER (WHERE lang.name IS NOT NULL) as languages

FROM jobs j
LEFT JOIN companies c ON j.company_id = c.id
LEFT JOIN locations l ON j.location_id = l.id
LEFT JOIN job_skills js ON j.id = js.job_id
LEFT JOIN skills s ON js.skill_id = s.id
LEFT JOIN job_benefits jb ON j.id = jb.job_id
LEFT JOIN benefits b ON jb.benefit_id = b.id
LEFT JOIN job_certifications jc ON j.id = jc.job_id
LEFT JOIN certifications cert ON jc.certification_id = cert.id
LEFT JOIN job_languages jl ON j.id = jl.job_id
LEFT JOIN languages lang ON jl.language_id = lang.id

WHERE j.id = $1

GROUP BY j.id, c.id, l.id;
```

---

### **2. Search Jobs with Filters**

```sql
SELECT
    j.id,
    j.title,
    j.slug,
    c.name as company_name,
    c.logo_url as company_logo,
    l.full_location,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.job_type,
    j.commitment_type,
    j.posted_date
FROM jobs j
LEFT JOIN companies c ON j.company_id = c.id
LEFT JOIN locations l ON j.location_id = l.id
WHERE
    j.is_active = true
    AND ($1::text IS NULL OR j.title ILIKE '%' || $1 || '%')
    AND ($2::text IS NULL OR j.category = $2)
    AND ($3::text IS NULL OR j.job_type = $3)
    AND ($4::text IS NULL OR j.experience_level = $4)
    AND ($5::numeric IS NULL OR j.salary_min >= $5)
    AND ($6::text IS NULL OR l.city = $6)
ORDER BY j.posted_date DESC NULLS LAST
LIMIT $7 OFFSET $8;
```

**Parameters:**
- $1: search_query (title search)
- $2: category
- $3: job_type
- $4: experience_level
- $5: min_salary
- $6: city
- $7: limit
- $8: offset

---

### **3. Get Jobs by Company**

```sql
SELECT
    j.id,
    j.title,
    j.slug,
    j.category,
    j.job_type,
    l.full_location,
    j.posted_date
FROM jobs j
LEFT JOIN locations l ON j.location_id = l.id
WHERE j.company_id = $1
    AND j.is_active = true
ORDER BY j.posted_date DESC;
```

---

### **4. Get Jobs by Skill**

```sql
SELECT
    j.id,
    j.title,
    c.name as company_name,
    l.full_location
FROM jobs j
JOIN job_skills js ON j.id = js.job_id
JOIN skills s ON js.skill_id = s.id
LEFT JOIN companies c ON j.company_id = c.id
LEFT JOIN locations l ON j.location_id = l.id
WHERE
    s.name = $1
    AND j.is_active = true
ORDER BY j.posted_date DESC;
```

---

### **5. Get Companies with Job Counts**

```sql
SELECT
    c.id,
    c.name,
    c.website,
    c.logo_url,
    c.industries,
    c.funding_stage,
    COUNT(j.id) as active_jobs
FROM companies c
LEFT JOIN jobs j ON c.id = j.company_id AND j.is_active = true
GROUP BY c.id
ORDER BY active_jobs DESC;
```

---

### **6. Get Career Pages with API Endpoints**

```sql
SELECT
    cp.career_url,
    cp.api_endpoint,
    cp.api_endpoint_detail,
    cp.ats_provider,
    c.name as company_name,
    c.website
FROM career_pages cp
LEFT JOIN companies c ON cp.company_id = c.id
WHERE cp.api_endpoint IS NOT NULL
ORDER BY cp.scraped_at DESC;
```

---

### **7. Get Skills with Job Counts**

```sql
SELECT
    s.name,
    s.category,
    COUNT(js.job_id) as job_count
FROM skills s
LEFT JOIN job_skills js ON s.id = js.skill_id
LEFT JOIN jobs j ON js.job_id = j.id AND j.is_active = true
GROUP BY s.id
ORDER BY job_count DESC
LIMIT 50;
```

---

## 🎯 Frontend Data Models (TypeScript)

### **Job Interface**

```typescript
interface Job {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  responsibilities: string | null;
  requirement_summary: string | null;

  // Type
  job_type: 'remote' | 'hybrid' | 'onsite' | null;
  commitment_type: 'full-time' | 'part-time' | 'contract' | 'internship' | null;
  category: string | null;
  experience_level: 'entry' | 'mid' | 'senior' | 'lead' | 'executive' | null;

  // Compensation
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: 'yearly' | 'monthly' | 'hourly' | null;
  equity_offered: boolean;
  equity_range: string | null;

  // Education
  education_requirement: string[] | null;
  education_preferred: string[] | null;

  // URLs
  application_url: string | null;
  source_url: string;
  external_id: string | null;

  // Status
  is_active: boolean;
  posted_date: string | null;
  expires_at: string | null;

  // Analytics
  view_count: number;
  click_count: number;

  // Relations
  company_id: string | null;
  location_id: string | null;

  // Timestamps
  scraped_at: string;
  updated_at: string;

  // JSONB
  raw_data: Record<string, any> | null;
}
```

---

### **Company Interface**

```typescript
interface Company {
  id: string;
  name: string;
  website: string | null;
  linkedin_url: string | null;
  description: string | null;
  logo_url: string | null;
  slug: string | null;

  // Location
  headquarters: string | null; // UUID

  // Details
  year_founded: number | null;
  number_employees: number | null;
  industries: string[] | null;
  activities: string[] | null;

  // Funding
  funding_stage: string | null;
  latest_investment: string | null;
  latest_investment_year: number | null;
  is_public: boolean;

  // Meta
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}
```

---

### **Location Interface**

```typescript
interface Location {
  id: string;
  country: string | null;
  city: string | null;
  state: string | null;
  full_location: string;
  is_remote: boolean;
  created_at: string;
  updated_at: string;
}
```

---

### **Skill Interface**

```typescript
interface Skill {
  id: string;
  name: string;
  category: string | null;
  normalized_name: string | null;
}
```

---

### **JobSkill Interface** (Junction)

```typescript
interface JobSkill {
  job_id: string;
  skill_id: string;
  is_required: boolean;
}
```

---

### **Benefit Interface**

```typescript
interface Benefit {
  id: string;
  name: string;
  category: string | null;
  normalized_name: string | null;
  created_at: string;
}
```

---

### **JobBenefit Interface** (Junction)

```typescript
interface JobBenefit {
  job_id: string;
  benefit_id: string;
  details: string | null;
}
```

---

### **Certification Interface**

```typescript
interface Certification {
  id: string;
  name: string;
  issuing_organization: string | null;
  category: string | null;
  normalized_name: string | null;
  created_at: string;
}
```

---

### **JobCertification Interface** (Junction)

```typescript
interface JobCertification {
  job_id: string;
  certification_id: string;
  is_required: boolean;
  is_preferred: boolean;
}
```

---

### **Language Interface**

```typescript
interface Language {
  id: string;
  name: string;
  code: string | null; // ISO 639-1
  created_at: string;
}
```

---

### **JobLanguage Interface** (Junction)

```typescript
interface JobLanguage {
  job_id: string;
  language_id: string;
  proficiency_required: 'native' | 'fluent' | 'professional' | 'conversational' | null;
  is_required: boolean;
}
```

---

### **CareerPage Interface**

```typescript
interface CareerPage {
  id: string;
  company_id: string | null;
  career_url: string;

  // API Detection
  api_endpoint: string | null;
  api_endpoint_detail: string | null;
  application_url: string | null;
  ats_provider: string | null;

  // Meta
  scraped_from: string | null;
  scraped_at: string;
}
```

---

## 📝 Important Notes

### **Unique Constraints**

1. **jobs.source_url** - MUST be unique (prevents duplicate scraping)
2. **jobs.slug** - Auto-generated, unique
3. **companies.slug** - Unique
4. **skills.name** - Unique (case-sensitive)
5. **benefits.name** - Unique
6. **certifications.name** - Unique
7. **languages.name** - Unique
8. **career_pages (company_id, career_url)** - Composite unique

### **Cascade Deletions**

All junction tables have `ON DELETE CASCADE`:
- Deleting a job will delete all job_skills, job_benefits, job_certifications, job_languages
- Deleting a skill/benefit/certification/language will remove junction table entries

### **Trigram Indexes (Fuzzy Search)**

The following fields have trigram GIN indexes for fuzzy text search:
- jobs.title
- jobs.description
- jobs.responsibilities
- jobs.requirement_summary
- locations.full_location

Use `ILIKE` or `similarity()` function for fuzzy matching.

### **GIN Array Indexes**

- companies.industries - Fast array containment searches (`@>` operator)

### **JSONB Index**

- jobs.raw_data - Fast JSON queries (`->`, `->>`, `@>` operators)

---

## 🚀 Ready for Frontend!

This schema supports:
- ✅ Full job listings with filters
- ✅ Company profiles with job counts
- ✅ Advanced search (fuzzy text matching)
- ✅ Skills, benefits, certifications, languages
- ✅ Location-based filtering
- ✅ Salary range filtering
- ✅ Analytics (view/click tracking)
- ✅ Career page API detection
- ✅ Normalized names for better matching

**Total Tables:** 13
**Total Functions:** 14+ (excluding PostgreSQL internal functions)
**Total Indexes:** 50+
