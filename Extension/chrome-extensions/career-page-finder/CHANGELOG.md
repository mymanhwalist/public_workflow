# Changelog - Career Page Finder

## Version 1.1.0 (Latest)

### Fixed
- ✅ **Navigation tracking** - Button now appears when URL changes (e.g., 100ms.live → jobs.lever.co/100ms)
- ✅ **New tab detection** - Button appears when career page opens in new tab
- ✅ **Skip behavior** - Manual skips don't save anything (leaves null for later)
- ✅ **Error handling** - Only saves "SKIPPED" for:
  - Invalid URLs
  - Website connection errors (chrome-error://)
  - Content script injection failures
  - 5-minute timeout
- ✅ **Loop continuation** - Fixed potential issues preventing loop from moving to next company
- ✅ **Better debugging** - Added detailed console logs to track progress

### Added
- ✅ **API endpoint detection** - Auto-detects 20+ ATS APIs:
  - Lever API
  - Greenhouse API
  - Workable API
  - Ashby API
  - SmartRecruiters API
  - Jobvite API
  - Breezy HR API
  - BambooHR API
  - And more!
- ✅ **API display in UI** - Shows detected API when saving
- ✅ **API save to Supabase** - Saves both `career_page_url` and `api_endpoint`

### What Gets Saved

| Scenario | career_page_url | api_endpoint | Next Fetch? |
|----------|----------------|--------------|-------------|
| User saves page | ✅ Actual URL | ✅ If detected | ❌ No (done) |
| User manually skips | `TODO` | ❌ NULL | ❌ No (add later) |
| Content script fails | ❌ NULL | ❌ NULL | ✅ Yes (retry) |
| Invalid URL | `SKIPPED` | ❌ NULL | ❌ No (broken) |
| Website error | `SKIPPED` | ❌ NULL | ❌ No (broken) |
| 5-min timeout | `SKIPPED` | ❌ NULL | ❌ No (no action) |

**Key**:
- `NULL` = Not processed yet (will fetch again)
- `TODO` = Reviewed but needs manual work (won't fetch again)
- `SKIPPED` = Connection error (won't fetch again)
- Actual URL = Successfully saved (won't fetch again)

### Testing

To test the fixes:

1. **Navigation Test**:
   - Start collection
   - Let it open https://www.100ms.live/
   - Click "Careers" link (opens https://jobs.lever.co/100ms)
   - Purple button should appear on the Lever page ✅

2. **API Detection Test**:
   - Go to any Lever page (e.g., jobs.lever.co/100ms)
   - Open Browser Console (F12)
   - Type: `document.querySelectorAll('script')`
   - Look for script tags containing "api.lever.co"
   - When you save, should see: "API: https://api.lever.co/..." ✅

3. **Skip Test**:
   - Start collection
   - Wait for site to load
   - Click "Skip This Company"
   - Check Supabase: `career_page_url` should still be NULL ✅
   - Next company should open automatically ✅

4. **Error Test**:
   - Add a company with invalid URL (e.g., "http://invalid-domain-xyz-123.com")
   - Start collection
   - Extension should mark it as "SKIPPED" automatically
   - Next company should open ✅

### Known Issues
None currently!

### Upgrade Instructions

1. Open chrome://extensions
2. Click "Remove" on old Career Page Finder
3. Click "Load unpacked"
4. Select the `career-page-finder` folder
5. Done! Start collecting.

## Version 1.0.0 (Initial)

- Basic career page URL collection
- Supabase integration
- Manual navigation
- 5-minute timeout
- Progress tracking
