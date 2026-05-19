/**
 * Job Page Data Extractor
 * Extracts structured job data from HTML pages using JSON-LD, meta tags, and HTML patterns.
 */

/** Extract all JSON-LD blocks from HTML, return the first JobPosting */
export function extractJsonLd(html) {
  const blocks = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const content = block.replace(/<script[^>]*>/, '').replace(/<\/script>/i, '').trim();
    try {
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'JobPosting') return item;
        if (item['@graph']) {
          const posting = item['@graph'].find(g => g['@type'] === 'JobPosting');
          if (posting) return posting;
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }
  return null;
}

/** Extract a meta tag value by name or property */
export function extractMeta(html, attr) {
  const patterns = [
    new RegExp(`<meta[^>]*property\\s*=\\s*["']${attr}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*property\\s*=\\s*["']${attr}["']`, 'i'),
    new RegExp(`<meta[^>]*name\\s*=\\s*["']${attr}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*name\\s*=\\s*["']${attr}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

/** Extract the first <h1> text content */
export function extractH1(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (match) return stripHtml(match[1]).trim();
  return null;
}

/** Extract job description from common CSS class/id patterns */
export function extractDescriptionHtml(html) {
  const patterns = [
    /<div[^>]*class\s*=\s*["'][^"']*job[-_]?desc(?:ription)?[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*jd[-_]?content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*posting[-_]?desc(?:ription)?[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*job[-_]?detail[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*job[-_]?body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class\s*=\s*["'][^"']*description[-_]?content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id\s*=\s*["']job[-_]?desc(?:ription)?["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id\s*=\s*["']posting[-_]?desc(?:ription)?["'][^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*class\s*=\s*["'][^"']*job[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
    /<section[^>]*class\s*=\s*["'][^"']*job[-_]?desc[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 50) {
      return stripHtml(match[1]).trim();
    }
  }
  return null;
}

/** Strip HTML tags, decode entities, collapse whitespace */
export function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Format JSON-LD jobLocation into a readable string */
export function formatLocation(loc) {
  if (!loc) return null;
  if (typeof loc === 'string') return loc;
  if (Array.isArray(loc)) {
    return loc.map(l => formatLocation(l)).filter(Boolean).join('; ');
  }
  const addr = loc.address;
  if (!addr) return loc.name || loc.description || null;
  if (typeof addr === 'string') return addr;
  if (typeof addr === 'object') {
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry].filter(Boolean);
    return parts.join(', ') || null;
  }
  return null;
}

/** Normalize employment type strings (FULL_TIME -> Full-time, etc.) */
export function normalizeEmploymentType(type) {
  if (!type) return null;
  if (Array.isArray(type)) return type.map(t => normalizeEmploymentType(t)).filter(Boolean).join(', ');
  const map = {
    'FULL_TIME': 'Full-time',
    'PART_TIME': 'Part-time',
    'CONTRACT': 'Contract',
    'TEMPORARY': 'Temporary',
    'INTERN': 'Internship',
    'INTERNSHIP': 'Internship',
    'VOLUNTEER': 'Volunteer',
    'PER_DIEM': 'Per Diem',
    'OTHER': 'Other',
  };
  return map[type.toUpperCase()] || type;
}

/** Extract a readable title from URL slug as last resort */
function extractTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(p => p);
    const jobPart = parts.find(p =>
      p !== 'job' && p !== 'jobs' && p !== 'career' && p !== 'careers' &&
      p !== 'position' && p !== 'opening' && p !== 'vacancy' &&
      !/^\d+$/.test(p)
    );
    if (!jobPart) return null;
    return decodeURIComponent(jobPart)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || null;
  } catch {
    return null;
  }
}

/**
 * Main extraction: cascade JSON-LD -> meta tags -> HTML elements -> URL fallback
 * @param {string} html - Raw HTML of the job page
 * @param {string} url - The job page URL
 * @param {string|null} lastmod - Sitemap lastmod date
 * @returns {object} Extracted job details
 */
export function extractJobDetails(html, url, lastmod) {
  const result = {
    title: null,
    description: null,
    location: null,
    company: null,
    employment_type: null,
    posted_date: lastmod || null,
    source_url: url,
    extraction_method: 'none',
  };

  // 1. JSON-LD (richest source)
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    result.extraction_method = 'json_ld';
    result.title = jsonLd.title || null;
    result.company = jsonLd.hiringOrganization?.name || null;
    result.employment_type = normalizeEmploymentType(jsonLd.employmentType);
    result.posted_date = jsonLd.datePosted || lastmod || null;

    if (jsonLd.jobLocation) {
      result.location = formatLocation(jsonLd.jobLocation);
    }
    if (jsonLd.description) {
      result.description = stripHtml(jsonLd.description);
    }
  }

  // 2. Meta tags — fill gaps
  if (!result.title) {
    result.title = extractMeta(html, 'og:title');
    if (result.title && result.extraction_method === 'none') {
      result.extraction_method = 'meta_tags';
    }
  }
  if (!result.company) {
    result.company = extractMeta(html, 'og:site_name');
  }
  if (!result.description) {
    const metaDesc = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    if (metaDesc && metaDesc.length > 20) {
      result.description = metaDesc;
      if (result.extraction_method === 'none') result.extraction_method = 'meta_tags';
    }
  }

  // 3. HTML elements — fill remaining gaps
  if (!result.title) {
    const h1 = extractH1(html);
    if (h1 && h1.length > 2) {
      result.title = h1;
      if (result.extraction_method === 'none') result.extraction_method = 'html_elements';
    }
  }
  if (!result.description) {
    const htmlDesc = extractDescriptionHtml(html);
    if (htmlDesc) {
      result.description = htmlDesc;
      if (result.extraction_method === 'none') result.extraction_method = 'html_elements';
    }
  }

  // 4. URL fallback for title
  if (!result.title) {
    result.title = extractTitleFromUrl(url);
    if (result.title && result.extraction_method === 'none') {
      result.extraction_method = 'url_fallback';
    }
  }

  // Truncate very long descriptions
  if (result.description && result.description.length > 5000) {
    result.description = result.description.substring(0, 5000) + '...';
  }

  return result;
}
