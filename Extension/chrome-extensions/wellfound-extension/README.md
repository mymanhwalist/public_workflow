# Wellfound Companies Chrome Extension

Chrome extension to scrape company data from Wellfound.com and automatically save to Supabase.

## Files

- **manifest.json** - Extension configuration
- **background.js** - Background service worker with auto-sync
- **content.js** - Content script for scraping Wellfound pages
- **popup.html** - Extension popup UI
- **popup.js** - Popup functionality
- **config.js** - Supabase configuration (URL and API key)
- **supabase-client.js** - Lightweight Supabase client
- **icon16.png, icon48.png, icon128.png** - Extension icons

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select this `wellfound-extension` folder

## Features

- Auto-extracts company data (name, website, career page) from Wellfound
- Automatically syncs to Supabase database
- Tracks company name, website URL, career page URL
- Stores HTML inspection data for future scraper development

## Database Schema

Supabase table: `career_pages`
- company_name
- website_url (unique)
- career_page_url
- job_table (for future scraper)
- job_item (for future scraper)
- job_page (for future scraper)
- job_page_table (for future scraper)
- created_at

## Current Status

- ✅ 4,013 unique companies scraped
- ✅ Auto-sync enabled
- ✅ Pages 1-946 scraped (scattered coverage)
- ⏳ Career page detection pending
