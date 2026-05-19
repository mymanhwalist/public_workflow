# Job Page Scraping Guide for Universal Scraper

## Overview
This document defines the comprehensive data structure that should be extracted from ANY job posting page to build a universal scraper.

---

## Core Job Data Structure

### 1. **Job Identification**
```json
{
  "job_id": "6953081003",              // Greenhouse job ID or other unique identifier
  "internal_id": "gh_jid=6953081003",  // Query parameter or URL identifier
  "url": "https://...",                // Full job posting URL
  "scraped_at": "2025-01-05T10:30:00Z" // Timestamp when scraped
}
```

**How to extract:**
- `job_id`: From URL query params (`gh_jid`, `job_id`, `posting_id`, etc.)
- `internal_id`: From URL path or query string
- Extract from common patterns:
  - `?gh_jid=123` (Greenhouse)
  - `/jobs/123/` (Lever)
  - `/job-openings/123` (Workable)
  - `/careers/123` (Custom)

---

### 2. **Job Title** ⭐ CRITICAL
```json
{
  "title": "Client Support Technician",
  "title_metadata": {
    "selector_used": "h1.section-header",
    "confidence": "high"  // high, medium, low based on selector specificity
  }
}
```

**Selectors to try (in order):**
```javascript
[
  'h1',                                    // Most common
  '[class*="job-title"]',
  '[class*="title"]',
  '[data-ui="job-title"]',
  '.section-header',
  'h1[itemprop="title"]',                  // Schema.org
  '[role="heading"][aria-level="1"]'
]
```

---

### 3. **Location** ⭐ CRITICAL
```json
{
  "location": {
    "raw": "London, England, United Kingdom",
    "parsed": {
      "city": "London",
      "state": "England",
      "country": "United Kingdom",
      "is_remote": false,
      "is_hybrid": false
    }
  }
}
```

**Selectors to try:**
```javascript
[
  '[class*="location"]',
  '[data-ui="job-location"]',
  'svg[class*="location"] + div',          // Icon + text pattern
  '[itemprop="jobLocation"]',              // Schema.org
  '.job__location'
]
```

**Location parsing logic:**
```javascript
function parseLocation(locationText) {
  const isRemote = /remote|work from home|wfh/i.test(locationText);
  const isHybrid = /hybrid/i.test(locationText);

  // Split by comma
  const parts = locationText.split(',').map(s => s.trim());

  return {
    raw: locationText,
    parsed: {
      city: parts[0] || null,
      state: parts[1] || null,
      country: parts[parts.length - 1] || null,
      is_remote: isRemote,
      is_hybrid: isHybrid
    }
  };
}
```

---

### 4. **Job Description** ⭐ CRITICAL
```json
{
  "description": {
    "full_html": "<div>...</div>",        // Complete HTML
    "full_text": "Job Summary: ...",     // Plain text
    "summary": "As Client Support...",    // First 500 chars
    "sections": {
      "summary": "...",
      "responsibilities": "...",
      "requirements": "...",
      "nice_to_have": "...",
      "benefits": "...",
      "schedule": "...",
      "salary": "..."
    }
  }
}
```

**Selectors to try:**
```javascript
[
  '[class*="description"]',
  '[class*="job-desc"]',
  '.job__description',
  '[data-ui="job-description"]',
  '[itemprop="description"]',
  '.content',
  'main article'
]
```

**Section extraction patterns:**
```javascript
const sectionPatterns = {
  summary: /job summary|about (the|this) (role|position)|overview/i,
  responsibilities: /responsibilities|duties|what you('ll| will) do/i,
  requirements: /requirements|qualifications|must have|you('ll| will) need/i,
  nice_to_have: /nice to have|preferred|bonus|plus/i,
  benefits: /benefits|perks|what we offer|compensation/i,
  schedule: /schedule|hours|working hours/i,
  salary: /salary|compensation|pay/i
};
```

---

### 5. **Requirements & Qualifications**
```json
{
  "requirements": {
    "must_have": [
      "Minimum 2 years' experience working for a Managed Service Provider",
      "Experience with Microsoft 365 suite"
    ],
    "nice_to_have": [
      "Microsoft certified",
      "Experience in Financial services"
    ],
    "technical_skills": [
      "Active Directory",
      "Microsoft Exchange",
      "Azure Active Directory",
      "VMware vSphere"
    ],
    "experience_years": {
      "min": 2,
      "max": null,
      "extracted_from": "Minimum 2 years' experience"
    }
  }
}
```

**Extraction strategy:**
- Look for headers like "Requirements", "Qualifications", "Must Have"
- Extract bullet points (`<li>` tags) under those sections
- Parse for years of experience: `/(\d+)\+?\s*years?/i`
- Identify technical skills vs soft skills

---

### 6. **Job Type & Employment Details**
```json
{
  "job_type": "Full-time",               // Full-time, Part-time, Contract, etc.
  "employment_type": "Permanent",
  "department": "IT Support",
  "level": "Mid-level",                  // Entry, Mid, Senior, Executive
  "remote_status": "On-site",            // Remote, Hybrid, On-site
  "schedule": {
    "hours": "Monday to Friday, 8 am to 5 pm",
    "on_call": true,
    "flexible": false
  }
}
```

**Detection patterns:**
```javascript
const jobTypePatterns = {
  'Full-time': /full.time|full time|fulltime/i,
  'Part-time': /part.time|part time|parttime/i,
  'Contract': /contract|contractor/i,
  'Temporary': /temp|temporary/i,
  'Internship': /intern/i
};

const levelPatterns = {
  'Entry-level': /entry|junior|graduate|associate/i,
  'Mid-level': /mid.level|intermediate|experienced/i,
  'Senior': /senior|sr\.|lead/i,
  'Executive': /director|vp|vice president|chief|c-level/i
};
```

---

### 7. **Apply Button & Application Process** ⭐ CRITICAL
```json
{
  "apply": {
    "button": {
      "text": "Apply",
      "tag": "button",
      "class": "btn btn--pill",
      "id": null,
      "type": "button",
      "selector": "button[aria-label='Apply']"
    },
    "url": "https://boards.greenhouse.io/abacusgroup/jobs/6953081003",
    "method": "external",                // external, form, email, redirect
    "form_action": null,
    "email": null,
    "requires_account": null,
    "ats_provider": "Greenhouse"         // Greenhouse, Lever, Workable, etc.
  }
}
```

**ATS Detection:**
```javascript
const atsPatterns = {
  'Greenhouse': /greenhouse\.io|gh_jid=/i,
  'Lever': /lever\.co|lever-apply/i,
  'Workable': /workable\.com|apply\.workable/i,
  'Ashby': /ashbyhq\.com/i,
  'BambooHR': /bamboohr\.com/i,
  'JazzHR': /jazzhr\.com/i,
  'iCIMS': /icims\.com/i,
  'Taleo': /taleo\.net/i,
  'SmartRecruiters': /smartrecruiters\.com/i
};
```

**Apply button selectors (priority order):**
```javascript
[
  'button[aria-label*="Apply" i]',
  'a[aria-label*="Apply" i]',
  'button[class*="apply" i]',
  'a[class*="apply" i]',
  'a[href*="apply"]',
  'button:has-text("Apply")',           // Playwright syntax
  '.apply-button',
  '#apply-button',
  'input[type="submit"][value*="Apply"]'
]
```

---

### 8. **Company Information**
```json
{
  "company": {
    "name": "Abacus Group LLC",
    "logo_url": "https://...",
    "description": "...",
    "size": "50-200 employees",
    "industry": "Technology",
    "website": "https://www.abacusgroupllc.com"
  }
}
```

---

### 9. **Salary & Compensation**
```json
{
  "compensation": {
    "salary": {
      "min": 50000,
      "max": 70000,
      "currency": "GBP",
      "period": "year",                  // year, month, hour
      "raw_text": "£50,000 - £70,000 per year"
    },
    "equity": null,
    "bonus": "Performance-based",
    "benefits": [
      "Generous annual leave",
      "Gym discount",
      "Life insurance",
      "Private Medical and Dental Insurance",
      "Contributory pension scheme"
    ]
  }
}
```

**Salary extraction patterns:**
```javascript
const salaryPatterns = [
  /\$?([\d,]+)\s*-\s*\$?([\d,]+)\s*(?:per\s+)?(year|yr|annually|month|mo|hour|hr)?/i,
  /£([\d,]+)k?\s*-\s*£?([\d,]+)k?/i,
  /€([\d,]+)\s*-\s*€?([\d,]+)/i
];
```

---

### 10. **Posting Metadata**
```json
{
  "posted_date": "2024-12-01",
  "closing_date": "2025-02-01",
  "updated_date": "2024-12-15",
  "views_count": null,
  "applicants_count": null,
  "status": "active"                     // active, closed, filled
}
```

---

### 11. **Contact Information**
```json
{
  "contact": {
    "recruiter_name": null,
    "recruiter_email": null,
    "hiring_manager": null,
    "hr_email": "careers@abacusgroup.com"
  }
}
```

---

## Complete Extraction Strategy

### Priority Levels:
1. **CRITICAL** (Must have for scraper to work):
   - Job Title
   - Location
   - Description
   - Apply Button/URL

2. **HIGH** (Important for job seekers):
   - Requirements
   - Job Type
   - Salary
   - Benefits

3. **MEDIUM** (Nice to have):
   - Company info
   - Posted date
   - Department

4. **LOW** (Optional):
   - View counts
   - Applicant counts

---

## Implementation in Extension

### Current Structure:
```javascript
// inspector.js line ~2090
function parseJobDetailPage() {
  const data = {
    title: null,
    description: null,
    requirements: null,
    location: null,
    jobType: null,
    applyButton: null,
    applyUrl: null
  };
  // ... extraction logic
}
```

### Recommended Enhanced Structure:
```javascript
function parseJobDetailPageEnhanced() {
  const data = {
    // Identification
    job_id: extractJobId(),
    url: window.location.href,
    scraped_at: new Date().toISOString(),

    // Core fields
    title: extractTitle(),
    location: extractLocation(),
    description: extractDescription(),

    // Requirements
    requirements: extractRequirements(),

    // Employment details
    job_type: extractJobType(),
    employment_type: null,
    department: null,
    level: extractLevel(),
    remote_status: extractRemoteStatus(),

    // Compensation
    salary: extractSalary(),
    benefits: extractBenefits(),

    // Apply process
    apply: extractApplyInfo(),

    // Company
    company: extractCompanyInfo(),

    // Metadata
    posted_date: extractPostedDate(),
    ats_provider: detectATS()
  };

  return data;
}
```

---

## Selectors Library for Universal Scraper

### Job Title Selectors (Ordered by Priority)
```javascript
const TITLE_SELECTORS = [
  'h1[itemprop="title"]',                // Schema.org (highest confidence)
  'h1.job-title',
  'h1[class*="title"]',
  'h1.section-header',
  '[data-ui="job-title"]',
  '[data-qa="job-title"]',
  'h1',                                   // Fallback
];
```

### Location Selectors
```javascript
const LOCATION_SELECTORS = [
  '[itemprop="jobLocation"]',
  '[class*="location"]',
  '[data-ui="location"]',
  'svg[class*="location"] + *',
  '.job__location',
  '.location',
];
```

### Description Selectors
```javascript
const DESCRIPTION_SELECTORS = [
  '[itemprop="description"]',
  '[class*="description"]',
  '.job__description',
  '[data-ui="description"]',
  'article',
  '.content',
  'main',
];
```

### Apply Button Selectors
```javascript
const APPLY_BUTTON_SELECTORS = [
  'a[href*="apply"][class*="btn"]',      // Link styled as button
  'button[aria-label*="Apply" i]',
  'a[aria-label*="Apply" i]',
  'button[class*="apply" i]',
  'a[class*="apply" i]',
  '[data-ui="apply"]',
  '[data-qa="apply"]',
  'button.btn:has-text("Apply")',
  'a.button:has-text("Apply")',
];
```

---

## Testing Your Scraper

### Test Cases:
1. **Greenhouse Jobs** (like your example)
   - URL: `https://boards.greenhouse.io/*/jobs/*`
   - Test: Extract `gh_jid` parameter

2. **Lever Jobs**
   - URL: `https://jobs.lever.co/*/jobs/*`
   - Test: Extract job ID from URL path

3. **Workable Jobs**
   - URL: `https://apply.workable.com/*/j/*`
   - Test: Extract apply URL and form action

4. **Custom Career Pages**
   - Test: Fallback selectors work
   - Test: Can find apply button without specific classes

---

## Next Steps

1. **Update `parseJobDetailPage()` function** in `inspector.js`
2. **Add new Supabase columns** for enhanced fields
3. **Build selector confidence scoring** (high/medium/low based on specificity)
4. **Add ATS detection** to help future scraping decisions
5. **Create validation** to ensure minimum required fields are extracted

---

## Example: Enhanced Supabase Schema

```sql
ALTER TABLE career_pages
ADD COLUMN IF NOT EXISTS parsed_job_enhanced JSONB;

COMMENT ON COLUMN career_pages.parsed_job_enhanced
IS 'Enhanced job data with complete structure: job_id, title, location, description sections, requirements, salary, benefits, apply info, company info, posting metadata';
```

Store the complete enhanced structure as JSONB for maximum flexibility.
