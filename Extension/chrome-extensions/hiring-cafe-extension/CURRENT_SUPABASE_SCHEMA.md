# Current Supabase Schema for Hiring Cafe

## 📋 Main Tables

### 1. **companies**
```sql
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    website TEXT,
    linkedin_url TEXT,
    description TEXT,
    logo_url TEXT,
    year_founded INTEGER,
    number_employees INTEGER,
    industries TEXT[],
    activities TEXT[],
    funding_stage VARCHAR(100),
    slug VARCHAR UNIQUE,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### 2. **locations**
```sql
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country VARCHAR(100),
    city VARCHAR(100),
    state VARCHAR(100),
    full_location TEXT NOT NULL,
    is_remote BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### 3. **jobs**
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
    job_type VARCHAR(50), -- 'remote', 'hybrid', 'onsite'
    commitment_type VARCHAR(50), -- 'full-time', 'part-time', 'contract', etc.
    category VARCHAR(100),
    experience_level VARCHAR(50),

    -- Salary
    salary_min NUMERIC(12, 2),
    salary_max NUMERIC(12, 2),
    salary_currency VARCHAR(10) DEFAULT 'USD',
    salary_period VARCHAR(20), -- 'yearly', 'monthly', 'hourly'

    -- Education
    education_requirement TEXT[],
    education_preferred TEXT[],

    -- URLs
    application_url TEXT,
    source_url TEXT NOT NULL UNIQUE,
    external_id VARCHAR(255),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    posted_date TIMESTAMP WITH TIME ZONE,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Metadata
    raw_data JSONB,
    view_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0
);
```

---

### 4. **skills**
```sql
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL
);
```

---

### 5. **job_skills** (Junction Table)
```sql
CREATE TABLE job_skills (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, skill_id)
);
```

---

### 6. **career_pages** ⭐ (For API Detection)
```sql
CREATE TABLE career_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),

    -- URLs
    career_url TEXT UNIQUE NOT NULL,

    -- API Detection Fields (NEW)
    api_endpoint TEXT,
    api_endpoint_detail TEXT,
    application_url TEXT,
    ats_provider TEXT,

    -- Scraping Info
    scraped_from TEXT, -- 'hiring.cafe', 'career-page-inspector', etc.
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 🔄 Supabase Function

### **save_hiring_cafe_job_to_existing_schema()**

**Parameters (43 total):**
```sql
-- Job fields
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
p_source_url TEXT,
p_external_id VARCHAR,

-- Dates
p_posted_date TIMESTAMP WITH TIME ZONE,
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

-- NEW: Career Page Fields (Added via UPDATED_FUNCTION_WITH_API.sql)
p_career_url TEXT DEFAULT NULL,
p_api_endpoint TEXT DEFAULT NULL,
p_api_endpoint_detail TEXT DEFAULT NULL,
p_ats_provider TEXT DEFAULT NULL
```

**Returns:** `UUID` (job_id)

---

## 📊 What Gets Saved from Extension

### **When Extracting a Job:**

```javascript
// Extension sends this data:
{
  // Job info → jobs table
  title: "Senior Engineer",
  description: "...",
  application_url: "https://...",

  // Company info → companies table (or finds existing)
  company: {
    name: "AbbVie",
    website: "https://abbvie.com",
    // ...
  },

  // Location info → locations table (or finds existing)
  location: {
    city: "New York",
    state: "NY",
    country: "US"
  },

  // Skills → skills table + job_skills junction
  skills: ["JavaScript", "React"],

  // NEW: Career page info → career_pages table
  career_page_url: "https://jobs.smartrecruiters.com/AbbVie",
  api_endpoint: "https://api.smartrecruiters.com/...",
  api_endpoint_detail: "https://api.smartrecruiters.com/.../
{id}",
  ats_provider: "SmartRecruiters"
}
```

---

## 🎯 Recent Schema Updates

### ✅ **Added to career_pages table:**
```sql
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS api_endpoint TEXT,
ADD COLUMN IF NOT EXISTS api_endpoint_detail TEXT,
ADD COLUMN IF NOT EXISTS application_url TEXT,
ADD COLUMN IF NOT EXISTS ats_provider TEXT;
```

### ✅ **Updated Function Parameters:**
Added 4 new parameters to `save_hiring_cafe_job_to_existing_schema()`:
- `p_career_url`
- `p_api_endpoint`
- `p_api_endpoint_detail`
- `p_ats_provider`

---

## 📝 Notes

1. **jobs.source_url** is UNIQUE - prevents duplicate job entries
2. **companies** are matched by `name` OR `website` before creating new
3. **locations** are matched by `full_location` before creating new
4. **skills** are matched by `name` before creating new
5. **career_pages** are matched by `career_url` before creating new (via function)
6. **Function handles** all INSERT/UPDATE logic automatically

---

## 🔍 Quick Check Queries

### **Check recent jobs:**
```sql
SELECT
  j.title,
  c.name as company,
  l.full_location as location,
  j.application_url,
  j.scraped_at
FROM jobs j
LEFT JOIN companies c ON j.company_id = c.id
LEFT JOIN locations l ON j.location_id = l.id
ORDER BY j.scraped_at DESC
LIMIT 10;
```

### **Check career pages with APIs:**
```sql
SELECT
  cp.career_url,
  cp.api_endpoint,
  cp.ats_provider,
  c.name as company_name,
  cp.scraped_at
FROM career_pages cp
LEFT JOIN companies c ON cp.company_id = c.id
WHERE cp.api_endpoint IS NOT NULL
ORDER BY cp.scraped_at DESC
LIMIT 10;
```

### **Check career pages without APIs:**
```sql
SELECT
  cp.career_url,
  cp.ats_provider,
  c.name as company_name
FROM career_pages cp
LEFT JOIN companies c ON cp.company_id = c.id
WHERE cp.api_endpoint IS NULL
ORDER BY cp.scraped_at DESC;
```

---

## 🎯 Summary

**Core Tables:** companies, locations, jobs, skills
**Junction Tables:** job_skills
**Special Tables:** career_pages (for API detection)
**Function:** save_hiring_cafe_job_to_existing_schema() handles all inserts

**Total Fields in career_pages:**
- ✅ id, company_id
- ✅ career_url (unique)
- ✅ api_endpoint, api_endpoint_detail (NEW)
- ✅ application_url, ats_provider (NEW)
- ✅ scraped_from, scraped_at
- ✅ created_at, updated_at
