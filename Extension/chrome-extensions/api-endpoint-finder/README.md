# API Endpoint Finder - Chrome Extension

A Chrome extension that automatically detects career/jobs API endpoints from websites and saves them to Supabase.

## Features

- Connects to your Supabase database
- Fetches website URLs from a specified table
- Opens each website and detects career/jobs API endpoints
- Supports 20+ ATS providers (Greenhouse, Lever, Workable, Ashby, etc.)
- Automatically saves detected endpoints (or null) back to Supabase
- Real-time progress tracking
- Error handling and recovery

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `api-endpoint-finder` folder
5. The extension icon should appear in your toolbar

## Configuration

1. Click the extension icon to open the popup
2. Fill in the configuration form:

   - **Supabase URL**: Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)
   - **Supabase API Key**: Your service_role or anon key
   - **Table Name**: Name of your table (e.g., `career_pages`)
   - **Website URL Column**: Column name containing website URLs (e.g., `website_url`)
   - **API Endpoint Column**: Column name where API endpoints will be saved (e.g., `api_endpoint`)

3. Click "Save Configuration"

## Database Setup

Your Supabase table should have at least these columns:

```sql
CREATE TABLE your_table_name (
    id SERIAL PRIMARY KEY,
    website_url TEXT NOT NULL,
    api_endpoint TEXT,
    -- other columns as needed
);
```

Example with more columns:

```sql
CREATE TABLE career_pages (
    id SERIAL PRIMARY KEY,
    company_name TEXT,
    website_url TEXT NOT NULL,
    career_page_url TEXT,
    api_endpoint TEXT,
    ats_provider TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Usage

1. Make sure your configuration is saved
2. Click "Start" to begin processing
3. The extension will:
   - Fetch all rows where `api_endpoint` is null or empty
   - Open each website in a new tab
   - Detect API endpoints (or save null if none found)
   - Save results to Supabase
   - Close the tab and move to the next website
4. Monitor progress in the popup
5. Click "Stop" anytime to pause processing

## How Detection Works

The extension searches for:

### ATS Provider APIs
- **Greenhouse**: `boards-api.greenhouse.io`, `api.greenhouse.io`
- **Lever**: `api.lever.co`, `lever.co/*/postings`
- **Workable**: `workable.com/spi`, `workable.com/api`
- **Ashby**: `api.ashbyhq.com`, `jobs.ashbyhq.com/api`
- **SmartRecruiters**: `api.smartrecruiters.com`
- **BambooHR**: `bamboohr.com/careers_api`
- And 15+ more providers

### Generic API Patterns
- `api.{domain}/jobs`
- `api.{domain}/careers`
- `{domain}/api/jobs`
- `{domain}/api/v1/positions`
- And more patterns

## Files Structure

```
api-endpoint-finder/
├── manifest.json          # Extension configuration
├── popup.html            # UI interface
├── popup.js              # UI logic
├── background.js         # Main orchestrator
├── content.js           # Injected page analyzer
├── api-detector.js      # API detection logic
├── supabase-client.js   # Supabase REST client
└── README.md           # This file
```

## Troubleshooting

### "Failed to connect to Supabase"
- Check your Supabase URL and API key
- Verify table name is correct
- Ensure your API key has read/write permissions

### "No websites to process"
- Verify your table has rows where the API endpoint column is null or empty
- Check column names match your configuration

### Extension not detecting APIs
- Some websites may block extensions or use heavy JavaScript
- APIs might be loaded dynamically after page load
- The extension waits 2 seconds for dynamic content to load

### Tabs not closing
- The extension will automatically close tabs after processing
- If a tab hangs, you can manually close it - the extension will continue

## Privacy & Security

- **Important**: Your Supabase API key is stored locally in Chrome storage
- Never share your `service_role` key publicly
- Consider using Row Level Security (RLS) policies in Supabase
- The extension only accesses websites from your database

## License

MIT License - Feel free to modify and use as needed

## Support

For issues or questions, please check:
- Chrome DevTools Console (F12) for errors
- Extension background worker logs
- Supabase dashboard for database issues
