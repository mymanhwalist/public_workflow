# 🔍 Career Page Inspector

Chrome extension to manually navigate to career pages and automatically inspect job listing structures for building scrapers.

## What It Does

This extension helps you inspect ~4000 company websites by:

1. **Opens** company website from Supabase
2. **You navigate** to the correct career page manually
3. **You click** the floating button to save the career page
4. **Auto-inspects** and detects:
   - `job_table`: CSS selector for the main container holding all jobs
   - `job_item`: CSS selector for individual job items
   - `job_page`: Pattern for job detail page URLs
5. **Saves** everything to Supabase (career page URL + inspection data)
6. **Moves** to next website automatically

## Why This Workflow?

Many career page URLs in databases are wrong or outdated. This extension lets you:
- Manually find the correct career page
- Verify it has job listings
- Save the correct URL before inspection
- Process thousands of sites efficiently

## How It Works

### The New Workflow

```
1. Extension fetches websites from Supabase (where job_table is null)
2. Opens website_url in new tab
3. Shows floating purple button in top-right corner
4. You navigate to career page manually
5. You click "Save Career Page & Inspect" button
6. Extension:
   - Saves current URL as career_page_url
   - Inspects the page automatically
   - Detects job table and item selectors
   - Saves all data to Supabase
7. Tab closes, moves to next website
```

### Smart Detection Algorithm

The inspector uses intelligent algorithms to:
- Find job containers (tables, lists, or div containers)
- Score elements based on job-related keywords
- Detect repeated patterns (job items)
- Generate accurate CSS selectors
- Extract job link patterns

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `career-page-inspector` folder

## Setup

1. Click the extension icon to open the popup
2. Enter your Wellfound Supabase configuration:
   - **Supabase URL**: `https://vmdbwpqopujirdcthgta.supabase.co`
   - **Service Role Key**: Your Supabase service_role key
3. Click **Save Configuration**

## Usage

### Step 1: Fetch Websites
- Click **Fetch Career Pages** in the popup
- It loads all companies with `website_url` but missing `job_table`

### Step 2: Start Inspection
- Click **Start Inspection**
- First website opens automatically

### Step 3: Navigate to Career Page
- Website opens in a new tab
- You see a **purple floating button** in the top-right corner
- Navigate to the career page (e.g., click "Careers", "Jobs", etc.)
- **If link opens in new tab**: Button automatically appears in the new tab too!

### Step 4: Save and Inspect
- Once on the career page, click the floating button (in any tab)
- Button shows "Inspecting page..."
- Extension automatically detects job structure
- Shows success with **two options**:
  - **📄 Save Another Career Page**: Keep tabs open, navigate to another career page (e.g., Retail → Corporate → Engineering)
  - **➡️ Next Company**: Done with this company, move to next

### Step 4a: Multiple Career Pages (Optional)
- Some companies have multiple career pages (Retail, Corporate, Distribution, etc.)
- After first save, click **"Save Another Career Page"**
- Navigate to the next career page
- Click the purple button again to save it
- Repeat for all career pages
- When done, click **"Next Company"**
- All URLs saved as JSON array: `["url1", "url2", "url3"]`

### Step 5: Repeat
- Process continues automatically
- You just navigate and click the button for each site
- Progress shows in the popup

## Features

- **Beautiful Overlay Button**: Purple gradient button with company name
- **Multiple Career Pages**: Save retail, corporate, engineering pages separately!
- **Works in New Tabs**: If "Careers" opens in new tab, button appears there too!
- **Smart Detection**: Uses keyword scoring and pattern recognition
- **Multiple Formats**: Detects tables, lists, and div-based layouts
- **Auto-Save**: Saves both career URLs and inspection data
- **Progress Tracking**: Real-time progress bar and logs
- **5-Minute Timeout**: Skips to next if no action taken
- **Auto-Close All Tabs**: Closes original + any new tabs after saving
- **Error Handling**: Shows error state if inspection fails

## Database Schema

The extension expects a `career_pages` table with these columns:

```sql
- id (uuid, primary key)
- company_name (varchar)
- website_url (text) ← Extension opens this
- career_page_url (text) ← Extension saves this
- job_table (text) ← Extension fills this
- job_item (text) ← Extension fills this
- job_page (text) ← Extension fills this
- job_page_table (text) ← For later use
- created_at (timestamp)
```

## Example Inspection Results

### Single Career Page
For a typical career page, the extension saves:

```json
{
  "career_page_url": "https://company.com/careers",
  "job_table": "div.jobs-list",
  "job_item": "div.job-card",
  "job_page": "https://company.com/careers/jobs/{id}"
}
```

### Multiple Career Pages (e.g., Barnes & Noble)
When a company has multiple career pages, they're saved as JSON array:

```json
{
  "career_page_url": "[\"https://careers.barnesandnoble.com/retail-jobs\",\"https://careers.barnesandnoble.com/corporate-jobs\",\"https://careers.barnesandnoble.com/distribution-jobs\"]",
  "job_table": "div.jobs-listing",
  "job_item": "div.job-row",
  "job_page": "https://careers.barnesandnoble.com/jobs/{id}"
}
```

**Note**: Inspection data (job_table, job_item) comes from the first career page saved.

## Tips

- **Navigate quickly**: You have 5 minutes per site (plenty of time)
- **Look for keywords**: "Careers", "Jobs", "Join Us", "Opportunities"
- **Check footer links**: Career pages often linked in footer
- **Skip if no jobs**: Just don't click the button, it'll timeout and move on
- **Review logs**: Check popup to see success/error messages

## Keyboard Shortcut Ideas

You can navigate faster by:
- Using tab key to jump between links
- Ctrl+F to search for "career" on the page
- Opening navigation menus if careers link is hidden

## Next Steps

After inspecting all 4000 websites, you'll have:

1. **Verified career page URLs** for each company
2. **CSS selectors** for job tables and items
3. **Link patterns** for job detail pages
4. **Ready-to-use data** for building scrapers

You can then build automated scrapers using the saved selectors!

## Troubleshooting

**Button doesn't appear?**
- Check browser console for errors
- Reload the page (extension will re-inject)
- Make sure extension is loaded in chrome://extensions

**Career link opened in new tab?**
- No problem! The extension automatically detects new tabs
- Button will appear in the new tab within 2-3 seconds
- Click it in whichever tab has the career page
- All tabs will close automatically after saving

**Wrong selectors detected?**
- The algorithm uses heuristics and may not be 100% accurate
- You can manually adjust selectors in Supabase later
- Most common formats are detected correctly

**Timeout happens too fast?**
- Default is 5 minutes per site
- Edit background.js line 95 to increase timeout
- 300000ms = 5 minutes, change to 600000ms for 10 minutes

**Extension stuck?**
- Click **Stop Inspection** in popup
- Refresh the extension
- Click **Start Inspection** again

## Architecture

- **popup.html/js**: UI for configuration and control
- **background.js**: Batch processing orchestrator with 5-min timeout
- **inspector.js**: Floating button, page analysis, selector detection
- **manifest.json**: Extension configuration

## Performance

- Processes 1 site every ~30 seconds (manual navigation + inspection)
- Can process ~120 sites per hour
- 4000 sites = ~33 hours of work
- Run in multiple sessions, progress is saved

## Privacy & Safety

- Only accesses sites you choose to inspect
- No data sent to third parties
- All data saved to your Supabase instance
- Extension works offline (except Supabase calls)

## License

Private use only.
