# API Endpoint Finder

Finds API endpoints from job application URLs stored in Supabase.

## How It Works

1. Reads `application_url` from your `jobs` table
2. Detects the ATS provider (Lever, Greenhouse, Workable, etc.)
3. Constructs the public API endpoint for that ATS
4. Updates the `career_pages` table with the API endpoint

## Supported ATS Providers

### With Public API (will find endpoints)
- Lever
- Greenhouse
- Ashby
- Workable
- SmartRecruiters
- Jobvite
- BambooHR
- Recruitee
- Personio
- JazzHR
- Breezy HR

### Without Public API (detected but no endpoint)
- Workday
- Taleo
- BrassRing
- iCIMS
- SuccessFactors
- SAP
- Oracle
- ADP
- Paylocity
- UKG/UltiPro
- Dayforce
- Indeed
- LinkedIn

## Setup

```bash
cd /Users/maze/Desktop/project/job/apifromurl
npm install
```

## Usage

### Test Detection (without database)
```bash
npm test
```

### Dry Run (see what would be updated)
```bash
npm run dry-run
```

### Run (update database)
```bash
npm start
```

## Output Example

```
===========================================
API ENDPOINT FINDER
===========================================
Mode: LIVE (will update database)

Processing batch: 1 to 100
  ✅ Updated: Lever → https://api.lever.co/v0/postings/acme-corp...
  ✅ Created: Greenhouse → https://boards-api.greenhouse.io/v1/boards/stripe/jobs...

===========================================
SUMMARY
===========================================
Total jobs processed: 823
API endpoints found: 156
No public API available: 667
Errors: 0

By ATS Provider:
  BrassRing: 245
  Workday: 189
  Custom: 156
  Lever: 89
  Greenhouse: 67
  ...
```

## Configuration

Edit `index.js` to change:
- `SUPABASE_URL` - Your Supabase URL
- `SUPABASE_KEY` - Your Supabase API key
- `BATCH_SIZE` - Number of jobs to process per batch (default: 100)
