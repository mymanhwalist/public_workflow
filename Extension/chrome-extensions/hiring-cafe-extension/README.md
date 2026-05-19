# Job Board Chrome Extension - Technical Documentation

## Overview

A Chrome extension that automatically scrapes job postings and company data from hiring.cafe and stores them in Supabase. This extension extracts comprehensive job details including company information, salary data, education requirements, and more.

## Architecture

### Components

1. **Content Scripts** (`content.js`, `contentExtractor.js`)
   - Injected into hiring.cafe pages
   - Handles job data extraction from DOM
   - Clicks through Company Info tabs to gather additional data

2. **Background Worker** (`background.js`)
   - Manages extension lifecycle
   - Coordinates between popup and content scripts
   - Stores extracted jobs in chrome.storage

3. **Popup Interface** (`popup.html`, `popup.js`)
   - User interface for controlling the extension
   - Handles Supabase uploads
   - Shows extraction progress and job counts

4. **Configuration** (`options.html`, `options.js`)
   - Supabase connection settings (URL + API Key)

## Workflow

```
1. User scrolls hiring.cafe job list
   ↓
2. Extension collects job URLs during scroll
   ↓
3. User clicks "Extract Jobs"
   ↓
4. Extension visits each job URL and extracts:
   - Job details (title, description, salary, etc.)
   - Company data (from Company Info tab)
   - Location information
   - Education requirements
   ↓
5. User clicks "Upload to Supabase"
   ↓
6. Data is normalized and uploaded to Supabase tables
```

## Data Extraction

### Job Fields Extracted

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `title` | string | JSON-LD / h2.font-extrabold | Job title |
| `description` | string (HTML) | JSON-LD / article.prose | Full job description (HTML) |
| `job_type` | string | badges | 'remote', 'hybrid', or 'onsite' |
| `commitment_type` | string | JSON-LD / badges | 'full-time', 'part-time', 'contract' |
| `category` | string | title analysis | Auto-categorized from title keywords |
| `experience_level` | string | text matching | e.g., "3-5 Years" |
| `responsibilities` | string | text matching | From "Responsibilities:" section |
| `requirement_summary` | string | text matching | From "Requirements Summary:" section |
| `skills` | array | text matching | From "Technical Tools Mentioned:" |
| `education_requirement` | array | text matching | Array of required degrees (e.g., ['MBA', 'CA', 'CFA']) |
| `education_preferred` | array | text matching | Array of preferred degrees |
| `salary_text` | string | span.rounded | Original salary text (e.g., "₹1500k-₹1800k/yr") |
| `salary_min` | number | parsed | Minimum salary amount |
| `salary_max` | number | parsed | Maximum salary amount |
| `salary_currency` | string | parsed | 'INR', 'USD', 'EUR', 'GBP', 'JPY' |
| `salary_period` | string | parsed | 'year', 'month', 'hour', 'week', 'day' |
| `salary_formatted` | string | computed | Formatted with proper comma placement |
| `posted_date` | string | JSON-LD / span.text-cyan-700 | ISO date or relative date |
| `source_url` | string | window.location.href | Original job URL |
| `application_url` | string | window.location.href | Where to apply |
| `external_id` | string | URL parsing | Extracted from /viewjob/xxxxx |

### Company Fields Extracted

Extracted from **Company Info** tab:

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `name` | string | JSON-LD / span.text-xl.font-semibold | Company name |
| `description` | string | span.text-gray-600 | Company description |
| `website` | string | base64 decode | Decoded from "View All Jobs" link |
| `logo_url` | string | img near company name | Company logo URL |
| `linkedin_url` | string | table row | LinkedIn profile URL |
| `headquarters` | UUID | table row → locations | Reference to locations table |
| `year_founded` | number | table row | Year company was founded |
| `number_employees` | number | table row | Employee count |
| `industries` | array | table row links | Array of industry names |
| `activities` | array | table row links | Array of business activities |
| `funding_stage` | string | table row | Latest investment series |
| `latest_investment` | string | table row | Investment amount (e.g., "$10M") |
| `latest_investment_year` | number | table row | Year of latest investment |
| `investors` | array | table row links | Array of investor names |

### Location Fields

| Field | Type | Description |
|-------|------|-------------|
| `city` | string | City name |
| `state` | string | State/region |
| `country` | string | Country name |
| `full_location` | string | Complete location string |
| `is_remote` | boolean | Whether job is remote |

### Education Degree Extraction

The extension extracts **all individual degrees** mentioned in job postings as arrays:

**Supported Degrees:**
- **Doctoral**: PhD, Doctorate, Doctoral, MD, MDS, MBBS, PharmD
- **Masters**: Master's, MS, MSc, MBA, M.Com, CA, CFA, PG, Post Graduate
- **Bachelors**: Bachelor's, BS, BSc, BA, BE, B.Tech
- **High School**: High School, Secondary School, Diploma

**Example Extraction:**
```javascript
// Input text: "Qualifications: CA / MBA / CFA / M.Com"
{
  education_requirement: ['CA', 'MBA', 'CFA', 'M.Com'],
  education_preferred: []
}

// Input text: "Required: Bachelor's | Preferred: MBA or PhD"
{
  education_requirement: ["Bachelor's"],
  education_preferred: ['MBA', 'PhD']
}
```

## Supabase Schema

### Tables

#### `jobs`
```sql
- id (UUID, PK)
- title (text)
- description (text)
- company_id (UUID, FK → companies)
- location_id (UUID, FK → locations)
- job_type (text)
- commitment_type (text)
- category (text)
- experience_level (text)
- education_requirement (text[])  -- Array of degree names
- education_preferred (text[])    -- Array of degree names
- salary_min (numeric)
- salary_max (numeric)
- salary_currency (text)
- salary_period (text)
- salary_text (text)
- posted_date (text)
- source_url (text)
- application_url (text)
- external_id (text)
- skills (jsonb)
- responsibilities (text)
- requirement_summary (text)
- created_at (timestamp)
- updated_at (timestamp)
```

#### `companies`
```sql
- id (UUID, PK)
- name (text, unique)
- description (text)
- website (text)
- logo_url (text)
- linkedin_url (text)
- headquarters (UUID, FK → locations)
- year_founded (integer)
- number_employees (integer)
- industries (text[])
- activities (text[])
- funding_stage (text)
- latest_investment (text)
- latest_investment_year (integer)
- investors (text[])
- created_at (timestamp)
- updated_at (timestamp)
```

#### `locations`
```sql
- id (UUID, PK)
- city (text)
- state (text)
- country (text)
- full_location (text)
- is_remote (boolean)
- created_at (timestamp)
- updated_at (timestamp)
```

## Key Extraction Logic

### 1. Company Website Extraction
Website URLs are base64-encoded in the "View All Jobs" link:
```javascript
// URL format: /?company=ZXVfbGV2ZXJfX19wbmxmaW5fX19GaW5vbV9fX2Zpbm9tLmNv
// Decodes to: eu_lever___pnlfin___Finom___finom.co
// Format: region___platform___companyName___domain
// Extract: last part (domain)
```

### 2. Salary Parsing
Handles multiple formats and currencies with proper comma placement:
```javascript
// Examples:
"₹1500k-₹1800k/yr" → { min: 1500000, max: 1800000, currency: 'INR', period: 'year' }
"$80,000-$100,000/year" → { min: 80000, max: 100000, currency: 'USD', period: 'year' }
```

### 3. Headquarters Location
Headquarters creates/finds a location record and stores UUID reference:
```javascript
// "Headquarters Country: India" from table
// → Creates/finds location { country: 'India', city: null }
// → Stores location.id in companies.headquarters
```

### 4. Async Tab Switching
Company Info tab data requires waiting for DOM rendering:
```javascript
// Click "Company Info" tab
btn.click();
// Wait for browser to render
await new Promise(r => setTimeout(r, 1000));
// Extract table data
const table = document.querySelector('table');
```

## Setup Instructions

### 1. Install Extension
```bash
# Load unpacked extension in Chrome
1. Navigate to chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the /extension folder
```

### 2. Configure Supabase
```bash
# Create Supabase project and run schema
1. Create project at supabase.com
2. Run SQL schema to create tables (jobs, companies, locations)
3. Get API URL and anon key
4. Click extension icon → Settings
5. Enter Supabase URL and API Key
```

### 3. Update Schema for Education Arrays
```sql
ALTER TABLE jobs
ALTER COLUMN education_requirement TYPE text[] USING
  CASE
    WHEN education_requirement IS NULL THEN NULL
    ELSE ARRAY[education_requirement]
  END;

ALTER TABLE jobs
ALTER COLUMN education_preferred TYPE text[] USING
  CASE
    WHEN education_preferred IS NULL THEN NULL
    ELSE ARRAY[education_preferred]
  END;
```

## Usage

1. **Navigate** to hiring.cafe job listings
2. **Click** extension icon
3. **Set** max scrolls (e.g., 10)
4. **Click** "Start Auto-Scroll" to collect job URLs
5. **Set** job limit (optional, 0 = all)
6. **Click** "Extract Jobs" to scrape each job
7. **Wait** for extraction to complete
8. **Click** "Upload to Supabase" to store data
9. **Download** JSON if needed (optional)

## Data Format for AI Training

### Extracted Job JSON Structure
```json
{
  "title": "Senior Financial Analyst",
  "description": "<article>Full HTML job description...</article>",
  "company": {
    "name": "Tata Capital",
    "description": "Leading financial services company...",
    "website": "https://tatacapital.com",
    "industries": ["Financial Services Companies", "Investment Companies"],
    "activities": ["financial services", "lending", "investment"],
    "year_founded": 2007,
    "number_employees": 5561
  },
  "location": {
    "city": "Mumbai",
    "state": "Maharashtra",
    "country": "India",
    "full_location": "Mumbai, Maharashtra, India",
    "is_remote": false
  },
  "job_type": "hybrid",
  "commitment_type": "full-time",
  "category": "Finance",
  "experience_level": "3-5 Years",
  "education_requirement": ["MBA", "CA", "CFA"],
  "education_preferred": ["PhD"],
  "skills": ["Excel", "Financial Modeling", "SQL", "Python"],
  "salary_min": 1500000,
  "salary_max": 1800000,
  "salary_currency": "INR",
  "salary_period": "year",
  "responsibilities": "Analyze financial data, create reports...",
  "requirement_summary": "3+ years in financial analysis, strong Excel skills..."
}
```

## Job Categories for AI Agent

The AI agent should categorize jobs into these categories:

### **Technology** (4 sub-categories)
- Engineering
- Software Development
- Information Technology
- Data and Analytics

### **Design and Creative** (2 sub-categories)
- Design
- Creative and Art Services

### **Business Operations** (7 sub-categories)
- Project and Program Management
- Product Management
- Business Operations
- Legal and Compliance
- Finance and Accounting
- Human Resources
- Administrative & Clerical Support

### **Sales and Marketing** (4 sub-categories)
- Sales
- Marketing
- Communications and Public Affairs
- Business Development

### **Healthcare** (5 sub-categories)
- Healthcare Services - Advanced Practice
- Healthcare Services - Allied Health
- Healthcare Services - Nursing
- Healthcare Services - Pharmacy
- Healthcare Services - Veterinary

### **Education** (1 sub-category)
- Education services

### **Customer and Social Services** (2 sub-categories)
- Customer Service
- Social Services

### **Skilled Trades** (5 sub-categories)
- Skilled Trades - Construction
- Skilled Trades - Mechanical and Electrical
- Skilled Trades - Manufacturing and Industrial
- Skilled Trades - Maintenance and Repair
- Skilled Trades - General Labor

### **Transportation and Logistics** (2 sub-categories)
- Transportation Services
- Supply Chain / Logistics / Procurement

### **Quality and Safety** (2 sub-categories)
- Quality Assurance
- Environment, Health, and Safety

### **Research and Development** (1 sub-category)
- Research and Development (R&D)

### **Food and Hospitality** (1 sub-category)
- Food and Beverage Services

### **Protective Services** (1 sub-category)
- Protective Services

### **Custodial Services** (1 sub-category)
- Custodial Services

## Training Data Format

For AI agent training, each job should have:
```json
{
  "job_data": {
    "title": "...",
    "description": "...",
    "skills": [...],
    "education_requirement": [...],
    "company": {
      "industries": [...],
      "activities": [...]
    },
    "responsibilities": "...",
    "requirement_summary": "..."
  },
  "category": "Technology",
  "sub_category": "Software Development"
}
```

**Training Dataset:**
- 50 pre-labeled jobs per category
- Total: ~50 jobs × 37 sub-categories = ~1,850 labeled examples
- Use for supervised learning / few-shot prompting

## AI Agent Recommendations

### Features to Use for Categorization:
1. **Job Title** - Primary indicator (e.g., "Software Engineer" → Technology)
2. **Skills** - Technical keywords (e.g., ["Python", "React"] → Software Development)
3. **Education Requirements** - Domain indicators (e.g., ["MD", "MBBS"] → Healthcare)
4. **Company Industries** - Context (e.g., ["Financial Services"] → Finance roles likely)
5. **Responsibilities** - Action verbs and domain terms
6. **Requirement Summary** - Detailed qualifications

### Suggested Approach:
1. **Rule-based baseline** - Keyword matching on title/skills
2. **LLM-based classification** - Use Claude/GPT with few-shot examples
3. **Embeddings + similarity** - Embed job descriptions, find nearest category
4. **Hybrid approach** - Combine rules + LLM for edge cases

### Example Prompt for LLM Categorization:
```
Given this job data, categorize it into one of the following categories and sub-categories:

[List of 37 sub-categories]

Job Data:
- Title: {title}
- Skills: {skills}
- Education: {education_requirement}
- Description: {description}
- Responsibilities: {responsibilities}

Category: ?
Sub-category: ?
```

## File Structure
```
extension/
├── manifest.json           # Extension configuration
├── background.js           # Background service worker
├── content.js             # Content script injector
├── contentExtractor.js    # Main extraction logic
├── popup.html             # Extension popup UI
├── popup.js               # Popup controller
├── options.html           # Settings page UI
├── options.js             # Settings controller
├── icon.png               # Extension icon
└── README.md              # This file
```

## Known Issues & Limitations

1. **Tab switching timing** - 1 second delay for Company Info tab may need adjustment for slow connections
2. **Education extraction** - Relies on text patterns, may miss non-standard formats
3. **Website extraction** - Depends on base64 encoding format, may fail if hiring.cafe changes structure
4. **Rate limiting** - No delay between job extractions, may trigger rate limits on large batches

## Future Enhancements

1. Add retry logic for failed extractions
2. Implement rate limiting between requests
3. Add duplicate detection before upload
4. Support for bulk category assignment via AI
5. Export training data in standard ML formats (CSV, JSONL)
6. Add extraction progress persistence (resume interrupted batches)

## License

MIT

## Contributors

Developed for automated job board data collection and AI-powered categorization.
