# Job Page Inspector Feature

## Overview
Add manual inspection capability for individual job detail pages, allowing users to visually select and identify different parts of a job posting.

---

## Feature Design

### Use Case
When the automated parser fails or extracts wrong data (like "Jump to main content"), users can manually teach the extension where to find:
- Job Title
- Location
- Description sections
- Requirements
- Benefits
- Salary
- Apply Button

### User Flow

```
Career Page → [Existing workflow] → Job Detail Page Opens
                                           ↓
                                    [NEW] "Inspect Job Page" button appears
                                           ↓
                                    User clicks → Visual picker mode
                                           ↓
                                    User clicks elements to identify:
                                    - "This is the Title"
                                    - "This is the Location"
                                    - "This is the Description"
                                    - etc.
                                           ↓
                                    Extension saves custom selectors
                                           ↓
                                    Uses custom selectors for all future jobs from this ATS
```

---

## UI Design

### 1. Overlay Button on Job Pages
When a job detail page loads during inspection, show floating button:

```
┌─────────────────────────────┐
│  🔍 Inspect This Job Page   │
└─────────────────────────────┘
```

### 2. Inspection Mode UI
When clicked, show instruction overlay:

```
┌───────────────────────────────────────────────────────┐
│                  Job Page Inspector                    │
├───────────────────────────────────────────────────────┤
│                                                        │
│  Click elements to identify:                          │
│                                                        │
│  ☐ Title        [Click to select]  [Test] [Clear]    │
│  ☐ Location     [Click to select]  [Test] [Clear]    │
│  ☐ Description  [Click to select]  [Test] [Clear]    │
│  ☐ Requirements [Click to select]  [Test] [Clear]    │
│  ☐ Benefits     [Click to select]  [Test] [Clear]    │
│  ☐ Salary       [Click to select]  [Test] [Clear]    │
│  ☐ Apply Button [Click to select]  [Test] [Clear]    │
│                                                        │
│  [Save Selectors]  [Cancel]                          │
└───────────────────────────────────────────────────────┘
```

### 3. Visual Picker Mode
When user clicks "[Click to select]":
1. Enter picker mode (similar to existing visual picker)
2. Hover highlights elements
3. Click captures selector
4. Show captured selector: `.attrax-job-information-widget__freetext-field-value`

---

## Data Structure

### Storage in Supabase
Add new column: `job_page_selectors` (JSONB)

```json
{
  "ats_provider": "Custom",
  "domain": "careers.achieve.com",
  "selectors": {
    "title": {
      "selector": "h1 .header__text",
      "confidence": "manual",
      "tested_on": "2026-01-05"
    },
    "location": {
      "selector": ".attrax-job-information-widget__freetext-field-value",
      "confidence": "manual",
      "tested_on": "2026-01-05"
    },
    "description": {
      "selector": ".description-widget [aria-label='Job description']",
      "confidence": "manual",
      "tested_on": "2026-01-05"
    },
    "requirements": {
      "selector": ".jobad-qualifications + p",
      "confidence": "manual",
      "tested_on": "2026-01-05"
    },
    "benefits": {
      "selector": ".jobad-additionalInformation + p",
      "confidence": "manual",
      "tested_on": "2026-01-05"
    },
    "apply_button": {
      "selector": ".jobApplyBtn",
      "confidence": "manual",
      "tested_on": "2026-01-05"
    }
  },
  "notes": "Custom ATS platform used by Achieve.com"
}
```

---

## Implementation Plan

### Phase 1: UI Components
1. Add "Inspect Job Page" overlay button
2. Create inspection panel with field list
3. Add visual picker integration for each field
4. Add test buttons to validate selectors

### Phase 2: Selector Capture
1. Implement click-to-capture for each field type
2. Generate optimal CSS selector from clicked element
3. Show preview of captured content
4. Allow manual editing of selectors

### Phase 3: Storage & Reuse
1. Save custom selectors to Supabase
2. Load custom selectors when scraping same ATS/domain
3. Prioritize manual selectors over automated detection
4. Build selector library across multiple sites

### Phase 4: Testing & Validation
1. Add "Test" button for each field
2. Show extracted content preview
3. Highlight matched elements on page
4. Confidence scoring for manual selectors

---

## Benefits

1. **Handle Any Job Board**: Works on custom ATS platforms the automated parser can't handle
2. **Build Selector Library**: Create reusable patterns for common ATS platforms
3. **User Control**: Users can fix wrong extractions immediately
4. **Learn & Improve**: Manual selections teach the extension new patterns
5. **Fallback Strategy**: When automation fails, manual inspection succeeds

---

## Example Usage

### Scenario: Achieve.com Job Page

**Problem**: Automated parser extracts "Jump to main content" instead of real description.

**Solution**:
1. Click "Inspect Job Page"
2. Click "[Click to select]" next to "Description"
3. Hover over real description content
4. Click to capture selector: `.description-widget [aria-label="Job description"]`
5. Click "Test" - sees real description content
6. Click "Save Selectors"
7. All future Achieve.com jobs use this selector ✅

---

## Advanced Features (Future)

### 1. Selector Templates
Create templates for common ATS platforms:
- "Greenhouse Template"
- "Lever Template"
- "Workable Template"
- "Custom Template"

### 2. Smart Suggestions
When user clicks element, suggest related elements:
- "Found 3 similar elements on page"
- "Apply to all?"

### 3. Export/Import
Share selector sets between users:
```javascript
// Export
{
  "achieve.com": { /* selectors */ },
  "greenhouse.io": { /* selectors */ }
}
```

### 4. Confidence Tracking
Track success rate of manual selectors:
- Used 50 times
- Success rate: 96%
- Last tested: 2026-01-05

---

## Technical Implementation

### New Functions to Add:

```javascript
// inspector.js

function showJobPageInspector() {
  // Show inspection overlay with field list
}

function startFieldPicker(fieldType) {
  // Enter visual picker mode for specific field
  // fieldType: 'title', 'location', 'description', etc.
}

function captureFieldSelector(fieldType, element) {
  // Generate optimal CSS selector for clicked element
  // Store in temporary state
}

function testFieldSelector(fieldType) {
  // Test selector and show preview of extracted content
}

function saveJobPageSelectors() {
  // Save all captured selectors to Supabase
  // Associate with ATS provider and domain
}

function loadCustomSelectors(domain) {
  // Load previously saved selectors for this domain
  // Use in parseJobDetailPage()
}

function parseJobDetailPageWithCustomSelectors(customSelectors) {
  // Enhanced parser that prioritizes custom selectors
}
```

### Integration with Existing Code:

```javascript
// In parseJobDetailPage()
function parseJobDetailPage() {
  // 1. Check if custom selectors exist for this domain
  const domain = new URL(window.location.href).hostname;
  const customSelectors = await loadCustomSelectors(domain);

  // 2. If custom selectors exist, use them first (highest confidence)
  if (customSelectors) {
    return parseWithCustomSelectors(customSelectors);
  }

  // 3. Otherwise, use automated extraction (current logic)
  return parseWithAutomatedLogic();
}
```

---

## Next Steps

1. Implement Phase 1 (UI Components)
2. Test on Achieve.com job page
3. Validate selector storage
4. Add to existing workflow
5. Test on multiple ATS platforms
6. Build selector library

---

## Questions to Consider

1. Should selectors be site-specific or ATS-specific?
   - Site: `careers.achieve.com`
   - ATS: All sites using "attrax" platform

2. Should users test each field before saving?
   - Required testing vs optional

3. How to handle selector updates?
   - What if site changes HTML structure?
   - Version selectors?

4. Should we allow regex patterns for complex extractions?
   - More powerful but more complex

Ready to implement this feature?
