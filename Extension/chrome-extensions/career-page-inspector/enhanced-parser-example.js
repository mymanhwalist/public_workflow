/**
 * ENHANCED JOB PARSER - Handles Different Layouts
 *
 * This is an example implementation showing how to parse job postings
 * that have different HTML structures.
 */

// ============================================================================
// STRATEGY 1: Multi-Selector Extraction with Confidence
// ============================================================================

function extractWithSelectors(selectors, validationFn = null) {
  for (const config of selectors) {
    const el = document.querySelector(config.selector);
    if (el && el.textContent.trim()) {
      const value = el.textContent.trim();

      // Optional validation
      if (validationFn && !validationFn(value)) {
        continue;
      }

      return {
        value: value,
        confidence: config.confidence,
        selector: config.selector
      };
    }
  }

  return { value: null, confidence: 'none', selector: null };
}

// ============================================================================
// TITLE EXTRACTION
// ============================================================================

const TITLE_SELECTORS = [
  { selector: 'h1[itemprop="title"]', confidence: 'high' },
  { selector: 'h1.job-title', confidence: 'high' },
  { selector: 'h1[class*="title"]', confidence: 'medium' },
  { selector: '.section-header h1', confidence: 'medium' },
  { selector: 'h1', confidence: 'low' }  // Fallback
];

function extractTitle() {
  // Try selectors first
  const result = extractWithSelectors(TITLE_SELECTORS, (text) => {
    // Validate: title should be 3-100 chars, not a URL
    return text.length > 3 && text.length < 100 && !text.includes('http');
  });

  if (result.value) return result;

  // Fallback: Find largest heading
  const headings = Array.from(document.querySelectorAll('h1, h2'));
  if (headings.length > 0) {
    const h1s = headings.filter(h => h.tagName === 'H1');
    if (h1s.length > 0) {
      return {
        value: h1s[0].textContent.trim(),
        confidence: 'low',
        selector: 'h1 (first)'
      };
    }
  }

  return { value: null, confidence: 'none', selector: null };
}

// ============================================================================
// LOCATION EXTRACTION
// ============================================================================

const LOCATION_SELECTORS = [
  { selector: '[itemprop="jobLocation"]', confidence: 'high' },
  { selector: '.job__location', confidence: 'high' },
  { selector: '[class*="location"]', confidence: 'medium' },
  { selector: '[data-ui="location"]', confidence: 'medium' }
];

function extractLocation() {
  // Try selectors first
  const result = extractWithSelectors(LOCATION_SELECTORS, (text) => {
    // Validate: should not contain URLs or be too long
    return !text.includes('http') && text.length < 200;
  });

  if (result.value) return result;

  // Fallback: Look for SVG icons (location icon pattern)
  const svgs = document.querySelectorAll('svg');
  for (const svg of svgs) {
    // Check if this looks like a location icon
    const paths = svg.querySelectorAll('path');
    let hasLocationPattern = false;

    for (const path of paths) {
      const d = path.getAttribute('d') || '';
      // Location icons typically start with "M" and have specific patterns
      if (d.startsWith('M') && (
        d.includes('18.') || d.includes('12.') || d.includes('6.')
      )) {
        hasLocationPattern = true;
        break;
      }
    }

    if (hasLocationPattern) {
      // Get adjacent text
      const parent = svg.parentElement;
      const nextEl = svg.nextElementSibling || parent?.nextElementSibling;

      if (nextEl && nextEl.textContent.trim()) {
        const text = nextEl.textContent.trim();
        if (text.length > 3 && text.length < 200 && !text.includes('http')) {
          return {
            value: text,
            confidence: 'medium',
            selector: 'svg icon + text'
          };
        }
      }
    }
  }

  // Last resort: Pattern matching in page text
  const bodyText = document.body.textContent;
  const locationPatterns = [
    /([A-Z][a-z]+,\s*[A-Z]{2,}(?:,\s*[A-Z][a-z]+)?)/,  // "London, UK" or "London, England, UK"
    /(Remote|Hybrid)/i
  ];

  for (const pattern of locationPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      return {
        value: match[0],
        confidence: 'low',
        selector: 'text pattern'
      };
    }
  }

  return { value: null, confidence: 'none', selector: null };
}

// ============================================================================
// SECTION EXTRACTION (Description, Requirements, Benefits, etc.)
// ============================================================================

function extractSections() {
  const sections = {};

  const patterns = {
    summary: /job summary|about (the|this) (role|position)|overview|description/i,
    responsibilities: /responsibilities|duties|what you('ll| will) do|your role/i,
    requirements: /requirements|qualifications|must have|what we need|you('ll| will) need/i,
    nice_to_have: /nice to have|preferred|bonus|plus|ideal/i,
    benefits: /benefits|perks|what we offer|why join|package/i,
    salary: /salary|compensation|pay/i,
    schedule: /schedule|hours|working hours/i
  };

  // Find all potential section headers
  const headings = document.querySelectorAll('h2, h3, h4, strong, b, p > strong');

  for (const heading of headings) {
    const headingText = heading.textContent.trim();

    // Check which section this matches
    for (const [sectionName, pattern] of Object.entries(patterns)) {
      if (pattern.test(headingText)) {
        const content = extractContentAfterHeading(heading);
        if (content && content.length > 10) {
          sections[sectionName] = {
            title: headingText,
            content: content,
            confidence: 'medium'
          };
        }
        break;
      }
    }
  }

  return sections;
}

function extractContentAfterHeading(heading) {
  const content = [];
  let current = heading.nextElementSibling;

  while (current) {
    const tagName = current.tagName.toLowerCase();

    // Stop at next heading
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      break;
    }

    // Stop at bold text that looks like a heading
    if ((tagName === 'strong' || tagName === 'b') && current.textContent.length < 100) {
      break;
    }

    // Collect content
    if (current.textContent.trim()) {
      if (tagName === 'ul' || tagName === 'ol') {
        const items = Array.from(current.querySelectorAll('li'))
          .map(li => '• ' + li.textContent.trim());
        content.push(...items);
      } else if (tagName === 'p' || tagName === 'div') {
        content.push(current.textContent.trim());
      }
    }

    current = current.nextElementSibling;
  }

  return content.join('\n\n');
}

// ============================================================================
// APPLY BUTTON EXTRACTION
// ============================================================================

const APPLY_BUTTON_SELECTORS = [
  { selector: 'button[aria-label*="Apply" i]', confidence: 'high' },
  { selector: 'a[aria-label*="Apply" i]', confidence: 'high' },
  { selector: 'button[class*="apply" i]', confidence: 'high' },
  { selector: 'a[class*="apply" i]', confidence: 'high' },
  { selector: 'a[href*="apply"]', confidence: 'medium' },
  { selector: '[data-qa*="apply"]', confidence: 'high' },
  { selector: 'button.btn', confidence: 'low' },
  { selector: 'a.button', confidence: 'low' }
];

function extractApplyButton() {
  // Try selectors first
  for (const config of APPLY_BUTTON_SELECTORS) {
    const el = document.querySelector(config.selector);
    if (el) {
      return {
        element: el,
        button: {
          text: el.textContent.trim() || el.value || 'Apply',
          tag: el.tagName.toLowerCase(),
          class: el.className,
          id: el.id,
          type: el.type || null
        },
        url: extractApplyUrl(el),
        confidence: config.confidence,
        selector: config.selector
      };
    }
  }

  // Fallback: Search by text content
  const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    const value = btn.getAttribute('value')?.toLowerCase() || '';

    if (text === 'apply' || text === 'apply now' || value.includes('apply')) {
      return {
        element: btn,
        button: {
          text: btn.textContent.trim() || btn.value,
          tag: btn.tagName.toLowerCase(),
          class: btn.className,
          id: btn.id,
          type: btn.type || null
        },
        url: extractApplyUrl(btn),
        confidence: 'medium',
        selector: 'text match'
      };
    }
  }

  return { element: null, button: null, url: null, confidence: 'none', selector: null };
}

function extractApplyUrl(element) {
  // Check if element is a link
  if (element.tagName === 'A' && element.href) {
    return element.href;
  }

  // Check if button is inside a link
  const parentLink = element.closest('a');
  if (parentLink && parentLink.href) {
    return parentLink.href;
  }

  // Check form action
  const form = element.closest('form');
  if (form && form.action) {
    return form.action;
  }

  // Check for data attributes
  if (element.dataset.url || element.dataset.href || element.dataset.link) {
    return element.dataset.url || element.dataset.href || element.dataset.link;
  }

  return null;
}

// ============================================================================
// ATS DETECTION
// ============================================================================

function detectATS() {
  const url = window.location.href;
  const html = document.documentElement.innerHTML;

  const atsPatterns = [
    { name: 'Greenhouse', patterns: [/greenhouse\.io/i, /gh_jid=/i] },
    { name: 'Lever', patterns: [/lever\.co/i, /lever-apply/i] },
    { name: 'Workable', patterns: [/workable\.com/i, /apply\.workable/i] },
    { name: 'Ashby', patterns: [/ashbyhq\.com/i, /jobs\.ashby/i] },
    { name: 'BambooHR', patterns: [/bamboohr\.com/i] },
    { name: 'iCIMS', patterns: [/icims\.com/i] },
    { name: 'Taleo', patterns: [/taleo\.net/i] },
    { name: 'SmartRecruiters', patterns: [/smartrecruiters\.com/i] }
  ];

  for (const ats of atsPatterns) {
    for (const pattern of ats.patterns) {
      if (pattern.test(url) || pattern.test(html)) {
        return ats.name;
      }
    }
  }

  return 'Custom';
}

// ============================================================================
// JOB ID EXTRACTION
// ============================================================================

function extractJobId() {
  const url = window.location.href;

  // Common patterns
  const patterns = [
    /gh_jid=([^&]+)/,           // Greenhouse
    /jobs?\/([^\/\?]+)/,        // Generic /jobs/123
    /posting[s]?\/([^\/\?]+)/,  // Lever /postings/123
    /job-openings\/([^\/\?]+)/  // Workable
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Fallback: Last segment of path
  const pathParts = new URL(url).pathname.split('/').filter(p => p);
  return pathParts[pathParts.length - 1] || null;
}

// ============================================================================
// SALARY EXTRACTION
// ============================================================================

function extractSalary() {
  const bodyText = document.body.textContent;

  // Common salary patterns
  const patterns = [
    // $50,000 - $70,000
    /\$\s?([\d,]+)\s*-\s*\$?\s?([\d,]+)\s*(?:per\s+)?(year|yr|annually|k)?/i,
    // £50k - £70k
    /£\s?([\d,]+)k?\s*-\s*£?\s?([\d,]+)k?/i,
    // €50,000 - €70,000
    /€\s?([\d,]+)\s*-\s*€?\s?([\d,]+)/i
  ];

  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match) {
      return {
        min: parseInt(match[1].replace(/,/g, '')),
        max: parseInt(match[2].replace(/,/g, '')),
        currency: match[0].includes('$') ? 'USD' : match[0].includes('£') ? 'GBP' : 'EUR',
        raw: match[0],
        confidence: 'medium'
      };
    }
  }

  return { min: null, max: null, currency: null, raw: null, confidence: 'none' };
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

function parseJobPageUniversal() {
  console.log('[Parser] Starting universal job extraction...');

  const data = {
    // Metadata
    url: window.location.href,
    scraped_at: new Date().toISOString(),
    job_id: extractJobId(),
    ats_provider: detectATS(),

    // Core fields
    title: extractTitle(),
    location: extractLocation(),

    // Sections
    sections: extractSections(),

    // Apply info
    apply: extractApplyButton(),

    // Compensation
    salary: extractSalary(),

    // Overall confidence score
    overall_confidence: null  // Calculate below
  };

  // Calculate overall confidence
  const confidenceScores = {
    'high': 3,
    'medium': 2,
    'low': 1,
    'none': 0
  };

  const scores = [
    confidenceScores[data.title.confidence],
    confidenceScores[data.location.confidence],
    confidenceScores[data.apply.confidence]
  ];

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  data.overall_confidence = avgScore >= 2.5 ? 'high' :
                           avgScore >= 1.5 ? 'medium' :
                           avgScore >= 0.5 ? 'low' : 'none';

  console.log('[Parser] Extraction complete:', data);
  return data;
}

// ============================================================================
// USAGE
// ============================================================================

/*
// In your extension's content script:

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobDetail') {
    const jobData = parseJobPageUniversal();
    sendResponse({
      success: true,
      data: jobData
    });
  }
  return true;
});
*/
