# API Detection Added to Hiring Cafe Extension

## ✅ What Was Changed

### 1. Added New Methods to `contentExtractor.js`

#### `detectAPIEndpoint()` - Lines 1762-1855
Detects API endpoints from page source using 25+ ATS-specific regex patterns:
- Greenhouse API
- Lever API
- Workable API
- Ashby, SmartRecruiters, Jobvite, BambooHR, etc.
- Generic `/api/jobs`, `/api/careers` patterns

**Returns**: API endpoint URL or `null`

#### `detectATS()` - Lines 1860-1893
Detects ATS provider from URL and page content:
- Greenhouse
- Lever
- Workable
- Ashby
- BambooHR
- iCIMS
- Taleo
- SmartRecruiters
- Jobvite
- Workday
- UltiPro
- SuccessFactors
- Breezy HR
- JazzHR
- **JobAppNetwork** (the one from your test!)
- Custom (fallback)

**Returns**: ATS provider name string

---

### 2. Updated `extractJobData()` - Lines 89-113

Added API detection during extraction:

```javascript
// Detect API endpoint and ATS provider
const apiEndpoint = this.detectAPIEndpoint();
const atsProvider = this.detectATS();

// Generate detail API endpoint if we found a list API
let apiEndpointDetail = null;
if (apiEndpoint) {
  apiEndpointDetail = apiEndpoint.replace(/\?.*$/, '') + '/{id}';
}

const data = {
  // ... existing fields
  api_endpoint: apiEndpoint,
  api_endpoint_detail: apiEndpointDetail,
  ats_provider: atsProvider,
  // ... more fields
};
```

---

### 3. Updated `background.js` - Lines 365-369

Already updated to send these fields to Supabase:

```javascript
// Career page fields (NEW)
p_career_url: job.career_page_url || null,
p_api_endpoint: job.api_endpoint || null,
p_api_endpoint_detail: job.api_endpoint_detail || null,
p_ats_provider: job.ats_provider || null
```

---

## 🧪 How to Test

### Step 1: Reload Extension

1. Go to `chrome://extensions/`
2. Find **Hiring Cafe Extension**
3. Click **Reload** button

### Step 2: Extract a Job

1. Go to https://hiring.cafe
2. Open extension popup
3. Scroll to load jobs
4. Extract 1 job from **JobAppNetwork** (like the Bartender job)

### Step 3: Check Console Logs

You should see:
```
[Extractor] Detecting API endpoints...
[Extractor] Found API endpoints: None
[Extractor] Best API endpoint: None
[Extractor] Detected ATS: JobAppNetwork
[Extractor] Extracted data: {
  title: "Bartender",
  company: "Hilton Garden Inn - St Pete Beach",
  application_url: "https://apply.jobappnetwork.com/clients/17738/posting/10868514",
  career_page_url: "https://apply.jobappnetwork.com/clients/17738/posting",
  api_endpoint: null,
  ats_provider: "JobAppNetwork"
}
```

### Step 4: Check Supabase

After upload completes, run:

```sql
SELECT
  career_url,
  api_endpoint,
  api_endpoint_detail,
  application_url,
  ats_provider,
  scraped_from
FROM career_pages
WHERE ats_provider = 'JobAppNetwork'
ORDER BY scraped_at DESC
LIMIT 5;
```

You should see:
```json
{
  "career_url": "https://apply.jobappnetwork.com/clients/17738/posting",
  "api_endpoint": null,  // JobAppNetwork doesn't expose API in page source
  "api_endpoint_detail": null,
  "application_url": "https://apply.jobappnetwork.com/clients/17738/posting/10868514",
  "ats_provider": "JobAppNetwork",  // ← NOW POPULATED! ✅
  "scraped_from": "hiring.cafe"
}
```

---

## 📊 Expected Results

### For JobAppNetwork Jobs:
- ✅ `ats_provider`: `"JobAppNetwork"`
- ❌ `api_endpoint`: `null` (doesn't expose API publicly)
- ✅ `application_url`: Full job URL
- ✅ `career_page_url`: Career page base URL

### For Greenhouse Jobs:
- ✅ `ats_provider`: `"Greenhouse"`
- ✅ `api_endpoint`: `"https://boards-api.greenhouse.io/v1/boards/{company}/jobs"`
- ✅ `api_endpoint_detail`: `"https://boards-api.greenhouse.io/v1/boards/{company}/jobs/{id}"`
- ✅ `application_url`: Full job URL
- ✅ `career_page_url`: Career page base URL

### For Lever Jobs:
- ✅ `ats_provider`: `"Lever"`
- ✅ `api_endpoint`: `"https://api.lever.co/v0/postings/{company}"`
- ✅ `application_url`: Full job URL
- ✅ `career_page_url`: Career page base URL

---

## 🔍 Why Some Fields Are NULL

Not all ATS platforms expose their APIs in the page source:

**API Endpoints Detected:**
- ✅ Greenhouse (uses API in frontend)
- ✅ Lever (uses API in frontend)
- ✅ Ashby (uses API in frontend)
- ✅ Workable (sometimes)
- ❌ JobAppNetwork (doesn't expose API)
- ❌ Taleo (doesn't expose API)
- ❌ iCIMS (doesn't expose API)

**ATS Provider Always Detected:**
- ✅ All ATS platforms can be identified by URL/domain patterns

---

## 🎯 Summary

✅ **Added API detection methods** to contentExtractor.js
✅ **Added ATS provider detection** (15+ platforms)
✅ **Updated data extraction** to include API fields
✅ **Already integrated** with background.js upload
✅ **Already integrated** with Supabase function
✅ **Ready to use** - just reload extension!

Now when you extract jobs, the `career_pages` table will have:
- ✅ `ats_provider` populated for ALL jobs
- ✅ `api_endpoint` populated when available
- ✅ `api_endpoint_detail` auto-generated from list API
- ✅ `application_url` always populated

🚀 **Test it now!**
