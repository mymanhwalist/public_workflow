# 📍 Career Page Finder

A simplified Chrome extension to find and save career page URLs to Supabase.

## What It Does

This extension helps you collect career page URLs and API endpoints for thousands of companies by:

1. **Opens** company website from Supabase
2. **You navigate** to the career page manually (even if it opens in a new tab!)
3. **Auto-detects** API endpoints on the page
4. **You click** "Save This Career Page" button
5. **Saves** both URL and API endpoint to Supabase
6. **Moves** to next company automatically

## Why This Extension?

- **Simple & Focused**: Only handles career page URL collection (no inspection, no scraping)
- **Lightweight**: Minimal code, faster performance
- **Easy to Use**: Just navigate and click save
- **Efficient**: Process hundreds of companies quickly

## Comparison with Career Page Inspector

| Feature | Career Page Finder | Career Page Inspector |
|---------|-------------------|----------------------|
| **Saves career page URL** | ✅ | ✅ |
| **Inspects job selectors** | ❌ | ✅ |
| **Scrapes job data** | ❌ | ✅ |
| **API detection** | ❌ | ✅ |
| **Visual picker** | ❌ | ✅ |
| **Complexity** | Simple | Complex |
| **File size** | ~10KB | ~100KB |

**Use Career Page Finder when:** You just need career page URLs
**Use Career Page Inspector when:** You need full inspection and scraping data

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `career-page-finder` folder

## Setup

1. Click the extension icon to open the popup
2. Enter your Supabase configuration:
   - **Supabase URL**: `https://xxx.supabase.co`
   - **Service Role Key**: Your service role key
3. Click **Save Configuration**
4. Click **Test Connection** to verify

## Usage

### Step 1: Fetch Companies
- Click **Fetch Companies** in the popup
- Loads all companies with `website_url` but missing `career_page_url`

### Step 2: Start Collection
- Click **Start Collection**
- First website opens automatically

### Step 3: Navigate & Save
- Website opens in a new tab
- You see a **purple floating button** in the top-right corner
- Navigate to the career page (click "Careers", "Jobs", etc.)
- Click **"Save This Career Page"** button
- URL is saved to Supabase and moves to next company

### Step 4: Repeat
- Process continues automatically
- You just navigate and click save for each site
- Progress shows in the popup

## Features

- **Beautiful Overlay Button**: Purple gradient button with company name
- **Navigation Tracking**: Works even when career page opens in a new tab or URL changes
- **Auto-Detects API Endpoints**: Automatically finds Lever, Greenhouse, Workable, and other ATS APIs
- **Auto-Save**: Saves career page URL and API endpoint directly to Supabase
- **Progress Tracking**: Real-time progress bar and logs
- **5-Minute Timeout**: Skips to next if no action taken
- **Auto-Close**: Closes tab after saving
- **Error Handling**: Skips invalid URLs automatically

## Database Schema

The extension expects a `career_pages` table with these columns:

```sql
- id (uuid, primary key)
- company_name (varchar)
- website_url (text) ← Extension opens this
- career_page_url (text) ← Extension saves this
- api_endpoint (text) ← Extension auto-detects and saves this
- created_at (timestamp)
```

## Example

When you save a career page, the extension updates:

```json
{
  "career_page_url": "https://company.com/careers",
  "api_endpoint": "https://api.lever.co/v0/postings/100ms"
}
```

Simple! Just the URL and API endpoint (if detected).

## Tips

- **Navigate quickly**: You have 5 minutes per site
- **Look for keywords**: "Careers", "Jobs", "Join Us"
- **Check footer links**: Career pages often linked in footer
- **Skip if unclear**: Just click skip button

## Workflow Comparison

### Career Page Finder Workflow (Simple)
```
1. Extension opens website
2. You navigate to career page
3. Click "Save This Career Page"
4. Done! → Next company
```

### Career Page Inspector Workflow (Complex)
```
1. Extension opens website
2. You navigate to career page
3. Click "Save Career Page & Inspect"
4. Review/edit selectors
5. Confirm selectors
6. Choose to scrape or skip
7. Wait for scraping to complete
8. Done! → Next company
```

## Performance

- **Speed**: ~20 seconds per company (just navigation + save)
- **Throughput**: ~180 companies per hour
- **4000 companies**: ~22 hours of work
- **No complexity**: No inspection or scraping overhead

## Troubleshooting

**Button doesn't appear?**
- Check browser console for errors
- Reload the page
- Make sure extension is loaded in chrome://extensions

**Wrong URL saved?**
- No problem! Just update it manually in Supabase later
- Or run the company through again

**Extension stuck?**
- Click **Stop Collection** in popup
- Refresh the extension
- Click **Start Collection** again

## Next Steps

After collecting all career page URLs with this extension, you can:

1. **Use Career Page Inspector** to inspect job selectors for those URLs
2. **Build scrapers** using the saved URLs
3. **Verify URLs** by batch checking them

## Privacy & Safety

- Only accesses sites you choose to process
- No data sent to third parties
- All data saved to your Supabase instance
- Extension works offline (except Supabase calls)

## Architecture

- **popup.html/js**: UI for configuration and control
- **background.js**: Batch processing orchestrator
- **finder.js**: Floating button and URL capture
- **manifest.json**: Extension configuration

## License

Private use only.
