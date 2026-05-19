# Expansion & Pagination Features

## Overview
The extension now captures metadata about how to handle special page behaviors like expand buttons, lazy loading, and pagination.

---

## New Supabase Columns

### 1. `expand_button_selector` (TEXT)
**Purpose:** Selector for "View All" / "Load More" buttons

**Example:**
```
.revealButtonContainer
```

**When to use:**
- Page has "View All Openings" buttons
- Jobs hidden behind expand buttons
- Multiple sections that need expanding

---

### 2. `pagination_type` (TEXT)
**Purpose:** How pagination/loading works on this page

**Values:**
- `"expand"` - Click buttons to expand sections
- `"scroll"` - Lazy load on scroll
- `"click"` - Next/Previous page buttons
- `"none"` - All jobs visible, no pagination

**Example:**
```
expand
```

---

### 3. `requires_expansion` (BOOLEAN)
**Purpose:** Flag indicating if expansion is required before scraping

**Values:**
- `TRUE` - Must click expand buttons first
- `FALSE` - All jobs already visible

**Example:**
```
TRUE
```

---

### 4. `wait_time_ms` (INTEGER)
**Purpose:** How long to wait after clicking/scrolling (milliseconds)

**Default:** `1000` (1 second)

**Example:**
```
1500
```

**When to increase:**
- Slow animations
- Heavy pages
- Lots of jobs loading

---

### 5. `scroll_to_load` (BOOLEAN)
**Purpose:** Whether scrolling triggers lazy loading

**Values:**
- `TRUE` - Scroll to bottom to load all jobs
- `FALSE` - No scroll needed

**Example:**
```
FALSE
```

---

### 6. `scraping_notes` (TEXT)
**Purpose:** Free text for special instructions

**Example:**
```
Must click all "View All Openings in [Team]" buttons.
Page has 5 team sections. Wait 500ms between clicks.
```

---

### 7. `has_multiple_containers` (BOOLEAN)
**Purpose:** Whether page has multiple job list containers

**Values:**
- `TRUE` - Jobs grouped by team/department
- `FALSE` - Single job list

**Example:**
```
TRUE
```

---

### 8. `navigation_type` (TEXT)
**Purpose:** How to access job detail pages

**Values:**
- `"link"` - Has `<a href>` tags
- `"button"` - Click `<button>` elements
- `"card_click"` - Click entire card/container

**Default:** `"link"`

**Example:**
```
link
```

---

## Example: 2U.com Career Page

**URL:** `https://2u.com/careers`

**Saved Data:**
```json
{
  "company_name": "2U",
  "career_page_url": "https://2u.com/careers",

  // Selectors
  "job_table": "section.jobListSectionContainer",
  "job_item": ".jobPostTeamListItemContainer",
  "job_page": "https://2u.com/careers/jobs/{id}/",

  // APIs
  "api_endpoint": null,
  "api_endpoint_detail": null,

  // Expansion metadata
  "expand_button_selector": ".revealButtonContainer",
  "pagination_type": "expand",
  "requires_expansion": true,
  "wait_time_ms": 1000,
  "scroll_to_load": false,
  "has_multiple_containers": true,
  "navigation_type": "link",
  "scraping_notes": "Page has 5 team sections (Corporate, Marketing, Partnerships, Tech, University). Each section may have a 'View All Openings' button. Click all buttons before scraping."
}
```

---

## Bot Usage Example

### Python Selenium Bot:

```python
def scrape_career_page(page_data):
    driver.get(page_data['career_page_url'])

    # 1. Handle expansion if needed
    if page_data['requires_expansion']:
        expand_buttons = driver.find_elements(
            By.CSS_SELECTOR,
            page_data['expand_button_selector']
        )

        for button in expand_buttons:
            try:
                button.click()
                time.sleep(page_data['wait_time_ms'] / 1000)
            except:
                print(f"Could not click expand button")

    # 2. Handle lazy loading if needed
    if page_data['scroll_to_load']:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(page_data['wait_time_ms'] / 1000)

    # 3. NOW scrape all jobs
    container = driver.find_element(By.CSS_SELECTOR, page_data['job_table'])
    jobs = container.find_elements(By.CSS_SELECTOR, page_data['job_item'])

    print(f"Found {len(jobs)} jobs after expansion")

    # 4. Click each job based on navigation type
    for job in jobs:
        if page_data['navigation_type'] == 'link':
            link = job.find_element(By.TAG_NAME, 'a')
            link.click()
        elif page_data['navigation_type'] == 'button':
            button = job.find_element(By.TAG_NAME, 'button')
            button.click()
        else:  # card_click
            job.click()

        # Scrape job details
        scrape_job_details()
        driver.back()
```

---

## Query Examples

### Find pages that need expansion:
```sql
SELECT company_name, expand_button_selector, scraping_notes
FROM career_pages
WHERE requires_expansion = TRUE;
```

### Find pages with multiple containers:
```sql
SELECT company_name, job_table, has_multiple_containers
FROM career_pages
WHERE has_multiple_containers = TRUE;
```

### Find pages by pagination type:
```sql
SELECT company_name, pagination_type, expand_button_selector
FROM career_pages
WHERE pagination_type = 'expand';
```

### Find pages with special handling needs:
```sql
SELECT company_name, scraping_notes
FROM career_pages
WHERE scraping_notes IS NOT NULL;
```

---

## Summary

With these new fields, your bot can:
- ✅ Know which buttons to click before scraping
- ✅ Handle lazy loading and pagination
- ✅ Wait appropriate times for content to load
- ✅ Handle different navigation patterns
- ✅ Store special instructions for edge cases

**Your bot becomes truly universal - it knows exactly how to handle each page!** 🚀
