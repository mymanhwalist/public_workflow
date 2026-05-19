# Universal Scraper Strategies - Handling Different Layouts

## The Problem

Every job posting has different HTML:
- **Greenhouse** uses: `<div class="app-wrapper">`
- **Lever** uses: `<div class="posting">`
- **Workable** uses: `<section class="job">`
- **Custom sites** use: Anything!

**You can't hardcode selectors. You need smart detection.**

---

## Strategy 1: Multi-Selector Cascading (What You Have Now)

Try multiple selectors in priority order until one works:

```javascript
const TITLE_SELECTORS = [
  'h1[itemprop="title"]',       // Schema.org - highest confidence
  'h1.job-title',               // Common class
  'h1[class*="title"]',         // Partial match
  'h1',                         // Fallback - any h1
];

function extractTitle() {
  for (const selector of TITLE_SELECTORS) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim().length > 0) {
      return el.textContent.trim();
    }
  }
  return null;
}
```

**Pros:** Simple, works for most cases
**Cons:** Still needs selector updates for new layouts

---

## Strategy 2: Content-Based Detection (Heuristics)

Don't look for specific classes - look for **content patterns**:

### Example: Finding Job Title

```javascript
function findJobTitle() {
  // Strategy 1: Largest heading
  const headings = Array.from(document.querySelectorAll('h1, h2'));
  if (headings.length > 0) {
    // Assume the first or largest h1 is the job title
    const h1s = headings.filter(h => h.tagName === 'H1');
    if (h1s.length > 0) {
      return h1s[0].textContent.trim();
    }
  }

  // Strategy 2: Look for heading with job-related keywords nearby
  const allHeadings = document.querySelectorAll('h1, h2, h3');
  for (const heading of allHeadings) {
    const nearbyText = heading.parentElement?.textContent || '';
    // If nearby text has "location", "apply", "job", it's likely the title
    if (/location|apply|job|position|role/i.test(nearbyText)) {
      return heading.textContent.trim();
    }
  }

  return null;
}
```

### Example: Finding Location

```javascript
function findLocation() {
  // Strategy 1: Look for text near location icon (SVG path with common location shapes)
  const svgs = document.querySelectorAll('svg');
  for (const svg of svgs) {
    // Location icons usually have paths with specific patterns
    const hasLocationPath = svg.innerHTML.includes('M6') ||
                           svg.innerHTML.includes('mapPin') ||
                           svg.querySelector('[class*="location"]');

    if (hasLocationPath) {
      // Get next sibling or parent sibling
      const nextEl = svg.nextElementSibling || svg.parentElement?.nextElementSibling;
      if (nextEl && nextEl.textContent.trim()) {
        return nextEl.textContent.trim();
      }
    }
  }

  // Strategy 2: Look for text matching location patterns
  const allText = document.body.textContent;
  const locationPatterns = [
    /([A-Z][a-z]+,\s*[A-Z]{2}(?:,\s*[A-Z][a-z]+)?)/,  // "San Francisco, CA" or "London, UK"
    /(Remote|Hybrid)/i,
    /([A-Z][a-z]+,\s*[A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?)/  // "San Francisco, California, USA"
  ];

  for (const pattern of locationPatterns) {
    const match = allText.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}
```

---

## Strategy 3: Section Detection by Headers

Find sections by looking at **headings and their content**, not classes:

```javascript
function extractSections() {
  const sections = {
    summary: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    salary: null
  };

  // Find all headings (h2, h3, h4, strong, b tags)
  const headings = document.querySelectorAll('h2, h3, h4, strong, b, p > strong, p > b');

  const patterns = {
    summary: /job summary|about (the|this) (role|position)|overview|description/i,
    responsibilities: /responsibilities|duties|what you('ll| will) do|role description/i,
    requirements: /requirements|qualifications|must have|you('ll| will) need|what we('re| are) looking for/i,
    nice_to_have: /nice to have|preferred|bonus|plus|ideal candidate/i,
    benefits: /benefits|perks|what we offer|compensation|why join/i,
    salary: /salary|compensation|pay range/i
  };

  for (const heading of headings) {
    const headingText = heading.textContent.trim();

    // Check which section this heading matches
    for (const [sectionName, pattern] of Object.entries(patterns)) {
      if (pattern.test(headingText)) {
        // Extract content after this heading until next heading
        const content = extractContentAfterElement(heading);
        sections[sectionName] = content;
        break;
      }
    }
  }

  return sections;
}

function extractContentAfterElement(element) {
  const content = [];
  let current = element.nextElementSibling;

  // Collect content until we hit another heading
  while (current) {
    const tagName = current.tagName.toLowerCase();

    // Stop at next heading
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      break;
    }

    // Stop at another strong/bold that looks like a heading
    if ((tagName === 'strong' || tagName === 'b') &&
        current.textContent.length < 100) {
      break;
    }

    // Collect this content
    if (current.textContent.trim()) {
      if (tagName === 'ul' || tagName === 'ol') {
        // Extract list items
        const items = Array.from(current.querySelectorAll('li'))
          .map(li => li.textContent.trim());
        content.push(...items);
      } else {
        content.push(current.textContent.trim());
      }
    }

    current = current.nextElementSibling;
  }

  return content.join('\n');
}
```

---

## Strategy 4: Visual/Size-Based Detection

Sometimes the most important info is just **bigger** or **bolder**:

```javascript
function findMostProminentText() {
  const elements = Array.from(document.querySelectorAll('h1, h2, h3, div, span, p'));

  let largest = null;
  let largestSize = 0;

  for (const el of elements) {
    const style = window.getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    const fontWeight = style.fontWeight;

    // Score based on size and weight
    const score = fontSize * (fontWeight >= 600 ? 1.5 : 1);

    if (score > largestSize && el.textContent.trim().length > 5) {
      largestSize = score;
      largest = el;
    }
  }

  return largest?.textContent.trim() || null;
}
```

---

## Strategy 5: Smart Apply Button Detection

The apply button is CRITICAL. Use multiple strategies:

```javascript
function findApplyButton() {
  // Strategy 1: Look for buttons/links with "apply" in attributes
  const applySelectors = [
    'button[aria-label*="Apply" i]',
    'a[aria-label*="Apply" i]',
    'button[class*="apply" i]',
    'a[class*="apply" i]',
    '[data-qa*="apply" i]',
    '[data-ui*="apply" i]'
  ];

  for (const selector of applySelectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  // Strategy 2: Look for buttons/links with "Apply" text
  const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    const value = btn.getAttribute('value')?.toLowerCase() || '';

    if (text.includes('apply') || value.includes('apply')) {
      return btn;
    }
  }

  // Strategy 3: Look for prominent buttons (likely the apply button)
  const prominentButtons = buttons.filter(btn => {
    const style = window.getComputedStyle(btn);
    const bg = style.backgroundColor;
    const fontSize = parseFloat(style.fontSize);

    // Filter out small or transparent buttons
    return fontSize > 14 && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  });

  // Return the largest prominent button
  if (prominentButtons.length > 0) {
    prominentButtons.sort((a, b) => {
      const sizeA = parseFloat(window.getComputedStyle(a).fontSize);
      const sizeB = parseFloat(window.getComputedStyle(b).fontSize);
      return sizeB - sizeA;
    });
    return prominentButtons[0];
  }

  return null;
}
```

---

## Strategy 6: Machine Learning / Pattern Recognition

For truly universal scraping, use AI:

### Option A: Use Claude API (or other LLM)

```javascript
async function parseJobWithAI(htmlContent) {
  const prompt = `
Extract structured data from this job posting HTML:

${htmlContent.substring(0, 10000)}  // First 10k chars

Return JSON with:
- title
- location
- description
- requirements (array)
- salary (if present)
- apply_url
`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': YOUR_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',  // Fast + cheap
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  const data = await response.json();
  return JSON.parse(data.content[0].text);
}
```

**Cost:** ~$0.001 per job (with Haiku)
**Accuracy:** Very high
**Speed:** 1-2 seconds per job

### Option B: Train a Custom Model

Train a model on 1000+ job postings to recognize patterns.

---

## Strategy 7: Confidence Scoring

Always track **how confident** you are about extracted data:

```javascript
function extractWithConfidence(field, strategies) {
  for (const strategy of strategies) {
    const result = strategy.extract();
    if (result) {
      return {
        value: result,
        confidence: strategy.confidence,  // 'high', 'medium', 'low'
        method: strategy.name
      };
    }
  }
  return {
    value: null,
    confidence: 'none',
    method: null
  };
}

// Example usage
const title = extractWithConfidence('title', [
  {
    name: 'schema.org',
    confidence: 'high',
    extract: () => document.querySelector('h1[itemprop="title"]')?.textContent
  },
  {
    name: 'class-based',
    confidence: 'medium',
    extract: () => document.querySelector('h1[class*="title"]')?.textContent
  },
  {
    name: 'largest-heading',
    confidence: 'low',
    extract: () => document.querySelector('h1')?.textContent
  }
]);

console.log(title);
// { value: "Client Support Technician", confidence: "medium", method: "class-based" }
```

---

## Recommended Implementation

### Hybrid Approach (Best Results)

```javascript
function extractJobData() {
  return {
    // Use multi-selector for structured fields
    title: extractWithSelectors(TITLE_SELECTORS),

    // Use content detection for location
    location: findLocation(),

    // Use section detection for description
    sections: extractSections(),

    // Use smart detection for apply button
    apply: findApplyButton(),

    // Add confidence scores
    confidence: calculateOverallConfidence()
  };
}
```

### Priority Order:

1. **Structured Data** (Schema.org, JSON-LD) - If present, use it first
2. **ATS-Specific Selectors** - Detect ATS (Greenhouse, Lever, etc.) and use known selectors
3. **Content-Based Detection** - Fall back to heuristics
4. **AI Parsing** - Last resort for complex/unusual layouts

---

## Testing Strategy

Test your scraper on these different layouts:

1. **Greenhouse** - `https://boards.greenhouse.io/*/jobs/*`
2. **Lever** - `https://jobs.lever.co/*/`
3. **Workable** - `https://apply.workable.com/*/j/*`
4. **Ashby** - `https://jobs.ashbyhq.com/*`
5. **Custom** - Your example from Abacus Group

Create test cases:
```javascript
const testCases = [
  {
    url: 'https://boards.greenhouse.io/example/jobs/123',
    expected: {
      title: 'Software Engineer',
      location: 'San Francisco, CA',
      // ...
    }
  },
  // ... more test cases
];
```

---

## Next Steps

1. **Implement hybrid extraction** in `inspector.js`
2. **Add confidence scoring** to all extracted fields
3. **Create ATS detection** to use optimal selectors
4. **Add fallback strategies** for each field
5. **Test on 20+ different job boards**
6. **Consider AI parsing** for complex cases

The goal: **80%+ success rate across ANY job board**
