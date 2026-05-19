/**
 * Content Extractor for Hiring.cafe
 * Uses JSON-LD + CSS selectors specific to hiring.cafe
 */

console.log('[Extractor] Loading...');

class HiringCafeJobExtractor {
  constructor() {
    this._jsonLd = null;
    console.log('[Extractor] Initialized');
  }

  /**
   * Extract JSON-LD structured data (most reliable)
   */
  getJsonLd() {
    if (this._jsonLd !== null) return this._jsonLd;

    try {
      const script = document.querySelector('script[type="application/ld+json"]');
      if (script && script.textContent) {
        this._jsonLd = JSON.parse(script.textContent);
        console.log('[Extractor] JSON-LD found:', this._jsonLd);
        return this._jsonLd;
      }
    } catch (error) {
      console.warn('[Extractor] JSON-LD parse failed:', error);
    }

    this._jsonLd = false;
    return null;
  }

  /**
   * Main extraction method
   */
  async extractJobData() {
    try {
      const salaryData = this.extractSalary();

      const educationData = this.extractEducation();

      const sourceUrl = window.location.href;
      let applicationUrl = this.extractApplicationUrl();

      // Enhanced retry logic if application_url matches source_url
      if (applicationUrl === sourceUrl) {
        console.warn('[Extractor] ⚠️ Application URL matches source URL on first attempt - starting retry sequence...');

        // Attempt 1: Wait 2 seconds for dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
        applicationUrl = this.extractApplicationUrl();

        if (applicationUrl === sourceUrl) {
          console.warn('[Extractor] ⚠️ Still matches after 2s - waiting 2 more seconds...');

          // Attempt 2: Wait additional 2 seconds (total 4s)
          await new Promise(resolve => setTimeout(resolve, 2000));
          applicationUrl = this.extractApplicationUrl();

          if (applicationUrl === sourceUrl) {
            console.warn('[Extractor] ⚠️ Still matches after 4s - trying one final time after 3s...');

            // Attempt 3: Final wait of 3 seconds (total 7s)
            await new Promise(resolve => setTimeout(resolve, 3000));
            applicationUrl = this.extractApplicationUrl();

            if (applicationUrl === sourceUrl) {
              console.warn('[Extractor] ⚠️ Application URL still matches source URL after all retries - setting to null');
              applicationUrl = null;
            } else {
              console.log('[Extractor] ✓ Found different application URL on final retry:', applicationUrl);
            }
          } else {
            console.log('[Extractor] ✓ Found different application URL on second retry:', applicationUrl);
          }
        } else {
          console.log('[Extractor] ✓ Found different application URL on first retry:', applicationUrl);
        }
      }

      // Extract description first so we can use it for benefits
      const description = this.extractDescription();

      // Extract career page URL by finding actual links in the page
      const careerPageUrl = this.extractCareerPageUrl();

      // Detect API endpoint and ATS provider
      const apiEndpoint = this.detectAPIEndpoint();
      const atsProvider = this.detectATS();

      // Generate detail API endpoint if we found a list API
      let apiEndpointDetail = null;
      if (apiEndpoint) {
        apiEndpointDetail = apiEndpoint.replace(/\?.*$/, '') + '/{id}';
      }

      const data = {
        title: this.extractTitle(),
        description: description,
        company: await this.extractCompanyData(),
        location: this.extractLocationData(),
        job_type: this.extractJobType(),
        commitment_type: this.extractCommitmentType(),
        posted_date: this.extractPostedDate(),
        source_url: sourceUrl,
        external_id: this.extractExternalId(),
        application_url: applicationUrl,
        career_page_url: careerPageUrl,
        api_endpoint: apiEndpoint,
        api_endpoint_detail: apiEndpointDetail,
        ats_provider: atsProvider,
        category: this.extractCategory(),
        experience_level: this.extractExperienceLevel(),
        responsibilities: this.extractResponsibilities(),
        requirement_summary: this.extractRequirements(),
        skills: this.extractSkills(),
        education_requirement: educationData.requirement,
        education_preferred: educationData.preferred,
        salary_text: salaryData.text,
        salary_min: salaryData.min,
        salary_max: salaryData.max,
        salary_currency: salaryData.currency,
        salary_period: salaryData.period,
        salary_formatted: salaryData.formatted,
        benefits: this.extractBenefits(description),
        raw_data: {
          scraped_from: 'hiring.cafe',
          scraped_at: new Date().toISOString(),
          full_text: document.body.innerText.substring(0, 5000)
        }
      };

      console.log('[Extractor] Extracted data:', {
        title: data.title,
        company: data.company.name,
        location: data.location.full_location,
        type: data.job_type,
        application_url: data.application_url,
        career_page_url: data.career_page_url,
        api_endpoint: data.api_endpoint,
        ats_provider: data.ats_provider
      });

      // Must have at least a title
      if (!data.title) {
        console.error('[Extractor] FAILED: No title found');
        console.error('[Extractor] Available h2 elements:', document.querySelectorAll('h2').length);
        console.error('[Extractor] First 500 chars:', document.body.innerHTML.substring(0, 500));
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Extractor] Error:', error);
      return null;
    }
  }

  extractTitle() {
    let title = null;

    // Try JSON-LD first
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.title) {
      title = jsonLd.title;
    }

    // hiring.cafe specific: h2.font-extrabold.text-3xl
    if (!title) {
      const h2 = document.querySelector('h2.font-extrabold.text-3xl');
      if (h2) {
        title = h2.textContent.trim();
      }
    }

    // Clean up title - remove parentheses and everything inside them
    if (title) {
      // Remove anything in parentheses (including nested ones)
      title = title.replace(/\s*\([^)]*\)\s*/g, ' ');

      // Clean up extra whitespace
      title = title.replace(/\s+/g, ' ').trim();

      console.log('[Extractor] Cleaned title:', title);
      return title;
    }

    // Fallback
    const anyH2 = document.querySelector('h2');
    if (anyH2) {
      let fallbackTitle = anyH2.textContent.trim();
      // Clean up fallback title too
      fallbackTitle = fallbackTitle.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      console.log('[Extractor] Title from any h2 (cleaned):', fallbackTitle);
      return fallbackTitle;
    }

    console.warn('[Extractor] No title found');
    return null;
  }

  extractDescription() {
    let description = null;

    // Try JSON-LD first (keep raw HTML)
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.description) {
      description = jsonLd.description;
    }

    // hiring.cafe specific: article.prose (keep raw HTML)
    if (!description) {
      const article = document.querySelector('article.prose');
      if (article) {
        description = article.innerHTML;
      }
    }

    // Clean up description HTML
    if (description) {
      description = this.cleanDescriptionHTML(description);
    }

    return description;
  }

  /**
   * Clean up HTML in job descriptions
   * - Convert SafeLinks URLs to clean URLs
   * - Remove escape characters
   */
  cleanDescriptionHTML(html) {
    if (!html) return html;

    // Convert Outlook SafeLinks to clean URLs
    // Pattern: https://aus01.safelinks.protection.outlook.com/?url=ACTUAL_URL&data=...
    html = html.replace(
      /https?:\/\/[a-z0-9]+\.safelinks\.protection\.outlook\.com\/\?url=([^&"']+)&[^"']*/gi,
      (match, encodedUrl) => {
        try {
          // Decode the URL parameter
          return decodeURIComponent(encodedUrl);
        } catch (e) {
          // If decoding fails, return original
          return match;
        }
      }
    );

    // Remove actual carriage return and line feed characters
    html = html.replace(/\r/g, '');
    html = html.replace(/\n/g, '');

    return html;
  }

  /**
   * Extract and parse salary information
   * Format: ₹1500k-₹1800k/yr or $50,000-$80,000/year
   */
  extractSalary() {
    const result = {
      text: null,
      min: null,
      max: null,
      currency: null,
      period: null
    };

    // Try to find salary span with specific classes
    const salarySpan = document.querySelector('span.rounded.text-xs.px-3.py-1.border.border-gray-400.font-bold');
    if (!salarySpan) {
      return result;
    }

    const salaryText = salarySpan.textContent.trim();
    if (!salaryText || salaryText.toLowerCase().includes('not disclosed')) {
      return result;
    }

    // Filter out non-salary text (job type, commitment type, etc.)
    const nonSalaryTerms = /^(onsite|remote|hybrid|full[- ]?time|part[- ]?time|contract|temporary|permanent|freelance)$/i;
    if (nonSalaryTerms.test(salaryText)) {
      console.log('[Extractor] Skipping non-salary text:', salaryText);
      return result;
    }

    // Preserve original formatted text
    result.text = salaryText;

    console.log('[Extractor] Salary text:', salaryText);

    // Extract currency symbol (₹, $, €, £, etc.)
    const currencyMatch = salaryText.match(/^([₹$€£¥])/);
    if (currencyMatch) {
      const symbol = currencyMatch[1];
      // Map symbols to currency codes
      const currencyMap = {
        '₹': 'INR',
        '$': 'USD',
        '€': 'EUR',
        '£': 'GBP',
        '¥': 'JPY'
      };
      result.currency = currencyMap[symbol] || symbol;
    }

    // Extract period (yr, year, month, hour, etc.)
    const periodMatch = salaryText.match(/\/(yr|year|month|mo|hour|hr|week|wk|day)$/i);
    if (periodMatch) {
      const period = periodMatch[1].toLowerCase();
      // Normalize periods
      if (period === 'yr' || period === 'year') {
        result.period = 'year';
      } else if (period === 'mo' || period === 'month') {
        result.period = 'month';
      } else if (period === 'hr' || period === 'hour') {
        result.period = 'hour';
      } else if (period === 'wk' || period === 'week') {
        result.period = 'week';
      } else if (period === 'day') {
        result.period = 'day';
      }
    }

    // Extract salary range or single value
    // Pattern: ₹1500k-₹1800k or $50,000-$80,000
    const rangeMatch = salaryText.match(/([₹$€£¥])?(\d+(?:,\d{3})*(?:\.\d+)?)(k|K|m|M)?[\s]*-[\s]*([₹$€£¥])?(\d+(?:,\d{3})*(?:\.\d+)?)(k|K|m|M)?/);

    if (rangeMatch) {
      // Range found
      let minValue = parseFloat(rangeMatch[2].replace(/,/g, ''));
      let maxValue = parseFloat(rangeMatch[5].replace(/,/g, ''));

      // Handle k (thousands) or m (millions) multipliers
      if (rangeMatch[3]) {
        const multiplier = rangeMatch[3].toLowerCase();
        if (multiplier === 'k') minValue *= 1000;
        if (multiplier === 'm') minValue *= 1000000;
      }

      if (rangeMatch[6]) {
        const multiplier = rangeMatch[6].toLowerCase();
        if (multiplier === 'k') maxValue *= 1000;
        if (multiplier === 'm') maxValue *= 1000000;
      }

      result.min = minValue;
      result.max = maxValue;
    } else {
      // Try single value: $80,000 or ₹1500k
      const singleMatch = salaryText.match(/([₹$€£¥])?(\d+(?:,\d{3})*(?:\.\d+)?)(k|K|m|M)?/);
      if (singleMatch) {
        let value = parseFloat(singleMatch[2].replace(/,/g, ''));

        // Handle k (thousands) or m (millions)
        if (singleMatch[3]) {
          const multiplier = singleMatch[3].toLowerCase();
          if (multiplier === 'k') value *= 1000;
          if (multiplier === 'm') value *= 1000000;
        }

        result.min = value;
        result.max = value;
      }
    }

    // Format numbers with proper commas based on currency
    if (result.min !== null && result.currency) {
      result.formatted = this.formatSalaryByCurrency(result.min, result.max, result.currency, result.period);
    }

    console.log('[Extractor] Parsed salary:', result);
    return result;
  }

  /**
   * Format salary with proper comma placement based on currency
   */
  formatSalaryByCurrency(min, max, currency, period) {
    const formatNumber = (num, curr) => {
      if (!num) return '';

      const numStr = num.toString();

      // INR uses Indian numbering system: X,XX,XXX
      if (curr === 'INR') {
        // Split into last 3 digits and the rest
        const lastThree = numStr.slice(-3);
        const otherDigits = numStr.slice(0, -3);

        if (otherDigits !== '') {
          // Add comma every 2 digits from right for the rest
          const formatted = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
          return formatted;
        }
        return lastThree;
      }

      // Western format (USD, EUR, GBP, etc.): XXX,XXX,XXX
      return num.toLocaleString('en-US');
    };

    const currencySymbols = {
      'INR': '₹',
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥'
    };

    const symbol = currencySymbols[currency] || currency;
    const periodSuffix = period ? `/${period}` : '';

    if (min === max) {
      return `${symbol}${formatNumber(min, currency)}${periodSuffix}`;
    } else {
      return `${symbol}${formatNumber(min, currency)}-${symbol}${formatNumber(max, currency)}${periodSuffix}`;
    }
  }

  extractCompanyName() {
    // Try JSON-LD first
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.hiringOrganization && jsonLd.hiringOrganization.name) {
      return jsonLd.hiringOrganization.name;
    }

    // hiring.cafe specific: span.text-xl.font-semibold (remove "@ " prefix)
    const span = document.querySelector('span.text-xl.font-semibold.text-gray-700');
    if (span) {
      return span.textContent.trim().replace(/^@\s*/, '');
    }

    return null;
  }

  async extractCompanyData() {
    const name = this.extractCompanyName();
    const website = this.extractCompanyWebsite();

    // Initialize company object with all fields
    const company = {
      name: name,
      description: null,
      website: website,
      logo_url: null,
      linkedin_url: null,
      year_founded: null,
      number_employees: null,
      headquarters: null,
      industries: null,
      activities: null,
      funding_stage: null,
      latest_investment: null,
      latest_investment_year: null,
      investors: null
    };

    // FIRST: Check if Company Info table is already in DOM (hidden or not)
    console.log('[Extractor] Searching for company table in DOM...');

    let table = null;
    const allTables = document.querySelectorAll('table');
    console.log(`[Extractor] Found ${allTables.length} tables on page`);

    // Look for the company info table by checking content
    for (const tbl of allTables) {
      const firstRow = tbl.querySelector('tbody tr td');
      if (firstRow) {
        const cellText = firstRow.textContent.trim();
        console.log(`[Extractor] Table first cell: "${cellText}"`);
        if (cellText === 'Year Founded' || cellText === 'Num Employees' || cellText === 'Industries') {
          console.log('[Extractor] ✓ Found company info table in DOM!');
          table = tbl;
          break;
        }
      }
    }

    // If not found in DOM, try clicking Company Info button
    if (!table) {
      console.log('[Extractor] Table not in DOM, trying click...');
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim() === 'Company Info') {
          console.log('[Extractor] Clicking Company Info tab...');
          btn.click();
          break;
        }
      }

      // Wait longer for Company Info content to load (increased from 1s to 3s)
      console.log('[Extractor] Waiting 3 seconds for Company Info content to load...');
      await new Promise(r => setTimeout(r, 3000));

      // Try finding again
      table = document.querySelector('table');
      console.log('[Extractor] After click, table found:', !!table);
    }

    // Extract company data from table if found
    if (table) {
      const rows = table.querySelectorAll('tbody tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const field = cells[0].textContent.trim();
          const valueCell = cells[1];
          const links = valueCell.querySelectorAll('a');

          if (field === 'Year Founded') {
            company.year_founded = parseInt(valueCell.textContent.trim()) || null;
          } else if (field === 'Num Employees') {
            company.number_employees = parseInt(valueCell.textContent.trim().replace(/,/g, '')) || null;
          } else if (field === 'Industries') {
            company.industries = links.length > 0
              ? Array.from(links).map(a => a.textContent.trim())
              : null;
          } else if (field === 'Activities') {
            company.activities = links.length > 0
              ? Array.from(links).map(a => a.textContent.trim())
              : null;
          } else if (field === 'Latest Investment Amount') {
            company.latest_investment = valueCell.textContent.trim() || null;
          } else if (field === 'Latest Investment Year') {
            company.latest_investment_year = parseInt(valueCell.textContent.trim()) || null;
          } else if (field === 'Latest Investment Series') {
            company.funding_stage = links.length > 0
              ? links[0].textContent.trim()
              : valueCell.textContent.trim() || null;
          } else if (field === 'Investors') {
            company.investors = links.length > 0
              ? Array.from(links).map(a => a.textContent.trim())
              : null;
          } else if (field === 'Headquarters Country') {
            company.headquarters = valueCell.textContent.trim() || null;
          } else if (field === 'Linkedin Url') {
            const link = valueCell.querySelector('a');
            company.linkedin_url = link ? link.href : (links.length > 0 ? links[0].textContent.trim() : null);
          } else if (field === 'Parent Company') {
            company.parent_company = links.length > 0
              ? Array.from(links).map(a => a.textContent.trim())
              : null;
          }
        }
      });
    }

    // ALWAYS extract company description after Company Info tab is loaded
    // (whether table was found or not, description is in the same section)
    console.log('[Extractor] Attempting to extract company description...');
    company.description = this.extractCompanyDescription();

    // Extract logo
    company.logo_url = this.extractCompanyLogo();

    // Click back to Job Info tab
    this.clickTabByText('Job Info');
    await new Promise(r => setTimeout(r, 300));

    return company;
  }

  extractCompanyDescription() {
    // Strategy 1: Look for span.text-gray-600 near the company name (most reliable)
    // Company name can be either font-bold or font-semibold
    const companyNameSpan = document.querySelector('span.text-xl.font-bold.text-gray-700, span.text-xl.font-semibold.text-gray-700');

    if (companyNameSpan) {
      // Get the parent flex-col container
      const container = companyNameSpan.closest('div.flex.flex-col');
      if (container) {
        // Look for span.text-gray-600 in this container
        const descSpans = container.querySelectorAll('span.text-gray-600');

        for (const descSpan of descSpans) {
          const desc = descSpan.textContent.trim();

          // Make sure it's descriptive text (not employee count, location, or job type)
          if (desc &&
              desc.length > 20 &&
              desc.split(' ').length > 3 &&
              !desc.match(/^\d+\s*$/i) && // Not just a number
              !desc.match(/^\d+\s+(employee|people|staff)/i) &&
              !desc.match(/^[\d\s,]+$/) &&
              !desc.match(/^(Remote|Hybrid|Onsite|Full[- ]?time|Part[- ]?time|Contract)/i)) {
            console.log('[Extractor] ✓ Found company description near company name:', desc);
            return desc;
          }
        }
      }
    }

    // Strategy 2: Look in Company Info section for span.text-gray-600
    const companyInfoSection = Array.from(document.querySelectorAll('*')).find(el => {
      const text = el.textContent;
      return text && (text.includes('Company Info') || text.includes('About the Company'));
    });

    if (companyInfoSection) {
      const descSpans = companyInfoSection.querySelectorAll('span.text-gray-600');
      for (const descSpan of descSpans) {
        const desc = descSpan.textContent.trim();
        if (desc &&
            desc.length > 20 &&
            desc.split(' ').length > 3 &&
            !desc.match(/^\d+\s+(employee|people|staff)/i)) {
          console.log('[Extractor] ✓ Found company description in Company Info section:', desc);
          return desc;
        }
      }
    }

    // Strategy 3: Look for all span.text-gray-600 elements and pick the best match
    const descSpans = document.querySelectorAll('span.text-gray-600');
    console.log(`[Extractor] Found ${descSpans.length} span.text-gray-600 elements`);

    for (const descSpan of descSpans) {
      const desc = descSpan.textContent.trim();

      // Look for description-like text (longer than 30 chars, contains spaces, not just numbers/locations)
      if (desc &&
          desc.length > 30 &&
          desc.split(' ').length > 5 && // At least 5 words for better quality
          !desc.match(/^\d+\s+(employee|people|staff)/i) &&
          !desc.match(/^[\d\s,]+$/) && // Not just numbers and commas
          !desc.match(/^(Remote|Hybrid|Onsite|Full[- ]?time|Part[- ]?time|Contract)/i)) { // Not job type/location
        console.log('[Extractor] ✓ Found valid company description:', desc);
        return desc;
      }
    }

    console.log('[Extractor] ⚠️ No company description found');
    return null;
  }

  extractCompanyWebsite() {
    // Try JSON-LD first (most reliable)
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.hiringOrganization && jsonLd.hiringOrganization.url) {
      return jsonLd.hiringOrganization.url;
    }

    // NEW: Extract from "View All Jobs" link with base64 encoded company data
    // Format: /?company=ZXVfbGV2ZXJfX19wbmxmaW5fX19GaW5vbV9fX2Zpbm9tLmNv
    // Decodes to: eu_lever___pnlfin___Finom___finom.co (domain is last part)
    const viewAllJobsLink = Array.from(document.querySelectorAll('a')).find(a =>
      a.textContent.trim() === 'View All Jobs' && a.href.includes('company=')
    );

    if (viewAllJobsLink) {
      try {
        const url = new URL(viewAllJobsLink.href);
        const companyParam = url.searchParams.get('company');
        if (companyParam) {
          // Decode base64
          const decoded = atob(companyParam);
          console.log('[Extractor] Decoded company param:', decoded);

          // Format: region___platform___companyName___domain
          const parts = decoded.split('___');
          if (parts.length >= 4) {
            const domain = parts[parts.length - 1]; // Last part is domain
            const website = domain.startsWith('http') ? domain : `https://${domain}`;
            console.log('[Extractor] Extracted website:', website);
            return website;
          }
        }
      } catch (e) {
        console.warn('[Extractor] Failed to decode company param:', e);
      }
    }

    // Look for website button and check nearby links or data attributes
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
      const text = button.textContent.trim().toLowerCase();
      if (text.includes('website')) {
        // Check if button has a data attribute with URL
        const dataUrl = button.getAttribute('data-url') || button.getAttribute('data-href');
        if (dataUrl) return dataUrl;

        // Check for onclick with URL
        const onclick = button.getAttribute('onclick');
        if (onclick) {
          const urlMatch = onclick.match(/https?:\/\/[^\s'"]+/);
          if (urlMatch) return urlMatch[0];
        }

        // Check for nearby link in same container
        const container = button.closest('div');
        if (container) {
          const link = container.querySelector('a[href^="http"]');
          if (link) return link.href;
        }
      }
    }

    // Look for regular website links
    const links = document.querySelectorAll('a');
    for (const link of links) {
      const text = link.textContent.trim().toLowerCase();
      if (text === 'website' || text === 'company website' || text === 'visit website') {
        return link.href;
      }
    }

    // Try to infer from company name as last resort
    const companyName = this.extractCompanyName();
    if (companyName) {
      // Remove common company suffixes first, then clean
      let domain = companyName.toLowerCase()
        .replace(/\s+(technologies?|tech|corporation?|corp|company|inc\.?|ltd\.?|llc|limited|pvt\.?|private)/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();

      if (domain.length > 2) {
        console.log(`[Extractor] Inferred website from company name: ${domain}.com`);
        return `https://${domain}.com`;
      }
    }

    return null;
  }

  extractCompanyLogo() {
    let logoUrl = null;

    // Strategy 1: Look for picture > img (modern approach, includes favicons)
    const pictureImg = document.querySelector('picture img');
    if (pictureImg && pictureImg.src) {
      logoUrl = pictureImg.src;
      console.log('[Extractor] ✓ Found logo in picture tag:', logoUrl);
      return logoUrl;
    }

    // Strategy 2: Look for company logo image near company name
    const companyNameSpan = document.querySelector('span.text-xl.font-bold.text-gray-700, span.text-xl.font-semibold.text-gray-700');
    if (companyNameSpan) {
      // Look for an image in the same container or nearby
      const container = companyNameSpan.closest('div.flex');
      if (container) {
        const img = container.querySelector('img');
        if (img && img.src) {
          logoUrl = img.src;
          console.log('[Extractor] ✓ Found logo near company name:', logoUrl);
          return logoUrl;
        }
      }
    }

    // Strategy 3: Look for any company logo image
    const images = document.querySelectorAll('img[alt*="logo" i], img[class*="logo" i]');
    for (const img of images) {
      if (img.src) {
        logoUrl = img.src;
        console.log('[Extractor] ✓ Found logo by alt/class:', logoUrl);
        return logoUrl;
      }
    }

    console.log('[Extractor] ⚠️ No company logo found');
    return logoUrl;
  }

  extractLocation() {
    // Try JSON-LD first
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.jobLocation && jsonLd.jobLocation.address) {
      const addr = jsonLd.jobLocation.address;
      const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    // hiring.cafe: span next to location icon
    const locationIcons = document.querySelectorAll('svg path[d*="M15 10.5a3 3 0 1 1-6 0"]');
    for (const icon of locationIcons) {
      const svg = icon.closest('svg');
      if (svg && svg.nextElementSibling) {
        const text = svg.nextElementSibling.textContent.trim();
        // Skip "Loading..." text or placeholder text
        if (text && !text.includes('Loading') && !text.includes('Remote · Hybrid · Onsite')) {
          return text;
        }
      }
    }

    return null;
  }

  extractJobType() {
    // Check badges: span.rounded.text-xs.border-gray-400
    const badges = document.querySelectorAll('span.rounded.text-xs.border-gray-400');
    for (const badge of badges) {
      const text = badge.textContent.trim().toLowerCase();
      if (text === 'remote') return 'remote';
      if (text === 'hybrid') return 'hybrid';
      if (text === 'onsite' || text === 'on-site') return 'onsite';
    }

    return 'onsite'; // default
  }

  extractCommitmentType() {
    // Try JSON-LD first
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.employmentType && Array.isArray(jsonLd.employmentType)) {
      const type = jsonLd.employmentType[0].toLowerCase();
      if (type.includes('full')) return 'full-time';
      if (type.includes('part')) return 'part-time';
      if (type.includes('contract')) return 'contract';
    }

    // Check badges
    const badges = document.querySelectorAll('span.rounded.text-xs.border-gray-400');
    for (const badge of badges) {
      const text = badge.textContent.trim().toLowerCase();
      if (text === 'full time' || text === 'full-time') return 'full-time';
      if (text === 'part time' || text === 'part-time') return 'part-time';
      if (text === 'contract') return 'contract';
    }

    return 'full-time'; // default
  }

  extractPostedDate() {
    // Try JSON-LD first
    const jsonLd = this.getJsonLd();
    if (jsonLd && jsonLd.datePosted) {
      return jsonLd.datePosted;
    }

    // hiring.cafe: span.text-cyan-700.font-bold
    const posted = document.querySelector('span.text-cyan-700.font-bold');
    if (posted) {
      return posted.textContent.trim();
    }

    return new Date().toISOString();
  }

  extractExternalId() {
    // Extract from URL: /viewjob/xxxxx
    const match = window.location.pathname.match(/\/viewjob\/([^\/]+)/);
    return match ? match[1] : null;
  }

  extractApplicationUrl() {
    console.log('[Extractor] Starting application URL extraction...');

    // Strategy 0: Check Next.js props and React state for URLs
    const nextJsUrl = this.extractUrlFromNextJs();
    if (nextJsUrl && !nextJsUrl.includes('hiring.cafe')) {
      console.log('[Extractor] ✓ Found apply URL in Next.js data:', nextJsUrl);
      return nextJsUrl;
    }

    // Strategy 1: Check meta tags (og:url, canonical, etc.)
    const metaUrl = this.extractUrlFromMeta();
    if (metaUrl && !metaUrl.includes('hiring.cafe')) {
      console.log('[Extractor] ✓ Found apply URL in meta tags:', metaUrl);
      return metaUrl;
    }

    // Strategy 2: Search page source for apply URLs (Taleo, Greenhouse, Lever, etc.)
    const pageSource = document.documentElement.outerHTML;
    console.log('[Extractor] Searching page source for apply URLs...');

    // Common ATS URL patterns (ordered by priority - specific to general)
    const atsPatterns = [
      // Major ATS Systems
      /https?:\/\/recruiting[^"'\s]*\.ultipro\.com\/[^"'\s]*\/JobBoard\/[^"'\s]*/gi,  // UltiPro/UKG
      /https?:\/\/[^"'\s]*\.ultipro\.com\/[^"'\s]*\/OpportunityDetail[^"'\s]*/gi,  // UltiPro variants
      /https?:\/\/[^"'\s]*taleo\.net\/careersection\/[^"'\s]*/gi,  // Taleo
      /https?:\/\/[^"'\s]*\.taleo\.net\/[^"'\s]*\/jobdetail[^"'\s]*/gi,  // Taleo variants
      /https?:\/\/[^"'\s]*greenhouse\.io\/[^"'\s]*/gi,  // Greenhouse
      /https?:\/\/[^"'\s]*lever\.co\/[^"'\s]*/gi,  // Lever
      /https?:\/\/[^"'\s]*workday\.com\/[^"'\s]*\/job\/[^"'\s]*/gi,  // Workday
      /https?:\/\/[^"'\s]*myworkdayjobs\.com\/[^"'\s]*/gi,  // Workday Jobs
      /https?:\/\/[^"'\s]*\.wd[0-9]+\.myworkdayjobs\.com\/[^"'\s]*/gi,  // Workday subdomain
      /https?:\/\/[^"'\s]*icims\.com\/jobs\/[^"'\s]*/gi,  // iCIMS
      /https?:\/\/[^"'\s]*jobvite\.com\/[^"'\s]*/gi,  // Jobvite
      /https?:\/\/[^"'\s]*smartrecruiters\.com\/[^"'\s]*/gi,  // SmartRecruiters
      /https?:\/\/[^"'\s]*breezy\.hr\/[^"'\s]*/gi,  // Breezy HR
      /https?:\/\/[^"'\s]*applytojob\.com\/apply\/[^"'\s]*/gi,  // ApplyToJob
      /https?:\/\/[^"'\s]*successfactors\.com\/[^"'\s]*\/job\/[^"'\s]*/gi,  // SAP SuccessFactors
      /https?:\/\/[^"'\s]*\.successfactors\.com\/sfcareer\/[^"'\s]*/gi,  // SuccessFactors variants
      /https?:\/\/[^"'\s]*recruitingbypaycor\.com\/[^"'\s]*/gi,  // Paycor
      /https?:\/\/[^"'\s]*paycoronline\.net\/[^"'\s]*/gi,  // Paycor Online
      /https?:\/\/[^"'\s]*paylocity\.com\/[^"'\s]*\/apply\/[^"'\s]*/gi,  // Paylocity
      /https?:\/\/[^"'\s]*bamboohr\.com\/[^"'\s]*\/jobs\/[^"'\s]*/gi,  // BambooHR
      /https?:\/\/[^"'\s]*recruitee\.com\/[^"'\s]*/gi,  // Recruitee
      /https?:\/\/[^"'\s]*fountain\.com\/[^"'\s]*/gi,  // Fountain
      /https?:\/\/[^"'\s]*ashbyhq\.com\/[^"'\s]*/gi,  // Ashby
      /https?:\/\/[^"'\s]*jazz\.co\/[^"'\s]*/gi,  // JazzHR
      /https?:\/\/[^"'\s]*workable\.com\/[^"'\s]*/gi,  // Workable
      /https?:\/\/[^"'\s]*resumator\.com\/[^"'\s]*/gi,  // The Resumator
      /https?:\/\/[^"'\s]*jobscore\.com\/[^"'\s]*/gi,  // JobScore
      /https?:\/\/[^"'\s]*Newton\.com\/[^"'\s]*/gi,  // Newton
      /https?:\/\/[^"'\s]*bullhornstaffing\.com\/[^"'\s]*/gi,  // Bullhorn
      /https?:\/\/[^"'\s]*clearcompany\.com\/[^"'\s]*/gi,  // ClearCompany
      /https?:\/\/[^"'\s]*catsone\.com\/[^"'\s]*/gi,  // CATS
      /https?:\/\/[^"'\s]*apploi\.com\/[^"'\s]*/gi,  // Apploi
      /https?:\/\/[^"'\s]*hiringsolved\.com\/[^"'\s]*/gi,  // HiringSolved
      /https?:\/\/[^"'\s]*recruiterbox\.com\/[^"'\s]*/gi,  // RecruiterBox
      /https?:\/\/[^"'\s]*talentreef\.com\/[^"'\s]*/gi,  // TalentReef
      /https?:\/\/[^"'\s]*harri\.com\/[^"'\s]*/gi,  // Harri
      /https?:\/\/[^"'\s]*careerpuck\.com\/[^"'\s]*/gi,  // CareerPuck
      /https?:\/\/[^"'\s]*jobtarget\.com\/[^"'\s]*/gi,  // JobTarget
      /https?:\/\/[^"'\s]*adp\.com\/[^"'\s]*\/jobs\/[^"'\s]*/gi,  // ADP

      // Company-specific career portals - VERY specific patterns first
      /https?:\/\/careers\.[^"'\s]+\/[^"'\s]*(?:job|apply|position|opportunity|listing|opening)[^"'\s]*/gi,
      /https?:\/\/jobs\.[^"'\s]+\/[^"'\s]*(?:job|apply|position|listing|detail|view|opening)[^"'\s]*/gi,
      /https?:\/\/apply\.[^"'\s]+\/[^"'\s]*/gi,
      /https?:\/\/recruiting\.[^"'\s]+\/[^"'\s]*(?:job|apply|position)[^"'\s]*/gi,
      /https?:\/\/talent\.[^"'\s]+\/[^"'\s]*(?:job|apply|position)[^"'\s]*/gi,

      // Generic career portal paths (checked last, more conservative)
      /https?:\/\/[^"'\s]+\/careers\/[^"'\s]*job[^"'\s]*/gi,
      /https?:\/\/[^"'\s]+\/jobs\/[^"'\s]*(?:apply|detail|view)[^"'\s]*/gi,
      /https?:\/\/[^"'\s]+\/career\/job[^"'\s]*/gi,
      /https?:\/\/[^"'\s]+\/job\/[^"'\s]+/gi,
      /https?:\/\/[^"'\s]+\/apply\/[^"'\s]+/gi
    ];

    for (const pattern of atsPatterns) {
      const matches = pageSource.match(pattern);
      if (matches && matches.length > 0) {
        // Get the first match and clean it up
        let url = matches[0].replace(/['"\\]/g, '').trim();

        // Remove HTML tags that might be in the match
        url = url.replace(/<[^>]*>/g, '');

        // Remove trailing garbage characters
        url = url.replace(/[,;}\]>)]+$/, '');

        // Clean HTML entities
        url = url.replace(/&amp;/g, '&');
        url = url.replace(/&quot;/g, '');
        url = url.replace(/&#x27;/g, '');
        url = url.replace(/&gt;/g, '');
        url = url.replace(/&lt;/g, '');

        // Remove anything after HTML-like content or weird characters
        url = url.split(/[<>\r\n]/)[0];

        // Validate URL more strictly
        if (url.startsWith('http') &&
            !url.includes('hiring.cafe') &&
            !url.includes('.mp4') &&
            !url.includes('.jpg') &&
            !url.includes('.png') &&
            !url.includes('.gif') &&
            url.length > 20 &&
            url.length < 300) {

          console.log('[Extractor] ✓ Found apply URL in page source:', url);
          return url;
        }
      }
    }

    // Strategy 3: Enhanced Apply button inspection
    const applyButton = this.findApplyButton();
    if (applyButton) {
      console.log('[Extractor] Found Apply button:', applyButton);

      // Check onclick attribute
      const onclick = applyButton.getAttribute('onclick');
      if (onclick) {
        console.log('[Extractor] Button onclick:', onclick);
        const urlMatch = onclick.match(/https?:\/\/[^'"]+/);
        if (urlMatch) {
          console.log('[Extractor] ✓ Found URL in onclick:', urlMatch[0]);
          return urlMatch[0];
        }
      }

      // Check ALL data attributes (not just predefined ones)
      const allAttrs = applyButton.attributes;
      for (let i = 0; i < allAttrs.length; i++) {
        const attr = allAttrs[i];
        if (attr.value && attr.value.startsWith('http') && !attr.value.includes('hiring.cafe')) {
          console.log('[Extractor] ✓ Found URL in attribute', attr.name, ':', attr.value);
          return attr.value;
        }
      }

      // Check button's parent and siblings for hidden links
      const parent = applyButton.parentElement;
      if (parent) {
        const hiddenLink = parent.querySelector('a[href^="http"]');
        if (hiddenLink && !hiddenLink.href.includes('hiring.cafe')) {
          console.log('[Extractor] ✓ Found URL in button parent link:', hiddenLink.href);
          return hiddenLink.href;
        }
      }
    }

    // Strategy 4: Check for iframes that might contain apply forms
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src;
      if (src && src.startsWith('http') && !src.includes('hiring.cafe')) {
        // Check if iframe src looks like an apply/job URL
        if (src.match(/job|career|apply|position|opportunity|taleo|greenhouse|lever|workday|icims|ultipro/i)) {
          console.log('[Extractor] ✓ Found apply URL in iframe:', src);
          return src;
        }
      }
    }

    // Strategy 5: Look for "Apply" links with href
    const applyLinks = document.querySelectorAll('a[href*="apply" i], a[href*="career" i], a[href*="job" i]');
    for (const link of applyLinks) {
      const text = link.textContent.trim().toLowerCase();
      if (text.includes('apply') && link.href && link.href.startsWith('http') && !link.href.includes('hiring.cafe')) {
        console.log('[Extractor] ✓ Found apply URL from link:', link.href);
        return link.href;
      }
    }

    // Strategy 6: Check window object for exposed URLs
    const windowUrl = this.extractUrlFromWindow();
    if (windowUrl && !windowUrl.includes('hiring.cafe')) {
      console.log('[Extractor] ✓ Found apply URL in window object:', windowUrl);
      return windowUrl;
    }

    // Fallback: Use current page URL
    console.log('[Extractor] ⚠️ No specific apply URL found, using page URL');
    return window.location.href;
  }

  /**
   * Find the "Apply now" button - Enhanced version
   */
  findApplyButton() {
    console.log('[Extractor] Searching for Apply button...');

    // Strategy 1: Look for button with "Apply now" or "Apply" text
    const buttons = document.querySelectorAll('button, a.button, a.btn, [role="button"]');
    for (const button of buttons) {
      const text = button.textContent.trim().toLowerCase();
      if (text === 'apply now' || text === 'apply' || text === 'apply for this job') {
        console.log('[Extractor] Found Apply button by text:', text);
        return button;
      }
    }

    // Strategy 2: Look for buttons containing "apply" but with other text too
    for (const button of buttons) {
      const text = button.textContent.trim().toLowerCase();
      if (text.includes('apply') && text.length < 50) {
        console.log('[Extractor] Found Apply button by partial text:', text);
        return button;
      }
    }

    // Strategy 3: Look for button with specific classes (hiring.cafe specific)
    const classSelectors = [
      'button.bg-pink-500',
      'button[class*="pink"]',
      'button[class*="primary"]',
      'a[class*="apply"]',
      '[class*="apply-button"]',
      '[class*="applyButton"]'
    ];

    for (const selector of classSelectors) {
      const button = document.querySelector(selector);
      if (button) {
        console.log('[Extractor] Found Apply button by selector:', selector);
        return button;
      }
    }

    // Strategy 4: Look for links with "apply" in href
    const applyLink = document.querySelector('a[href*="apply" i]');
    if (applyLink) {
      console.log('[Extractor] Found Apply link with apply in href');
      return applyLink;
    }

    console.log('[Extractor] No Apply button found');
    return null;
  }

  /**
   * Extract application URL from Next.js props and React state
   */
  extractUrlFromNextJs() {
    try {
      // Check for Next.js __NEXT_DATA__ script
      const nextDataScript = document.querySelector('script#__NEXT_DATA__');
      if (nextDataScript) {
        const nextData = JSON.parse(nextDataScript.textContent);
        console.log('[Extractor] Found Next.js data, searching for URLs...');

        // Recursively search for URLs in the data
        const findUrls = (obj, depth = 0) => {
          if (depth > 10) return null; // Prevent infinite recursion
          if (!obj || typeof obj !== 'object') return null;

          for (const key in obj) {
            const value = obj[key];

            // Check if this looks like an application URL field
            if ((key.toLowerCase().includes('apply') ||
                 key.toLowerCase().includes('application') ||
                 key.toLowerCase().includes('joburl') ||
                 key.toLowerCase().includes('external')) &&
                typeof value === 'string' &&
                value.startsWith('http') &&
                !value.includes('hiring.cafe')) {
              return value;
            }

            // Recurse into nested objects
            if (typeof value === 'object') {
              const found = findUrls(value, depth + 1);
              if (found) return found;
            }
          }
          return null;
        };

        const url = findUrls(nextData);
        if (url) return url;
      }

      // Check for React props in DOM elements
      const elements = document.querySelectorAll('[data-props], [data-react-props]');
      for (const el of elements) {
        try {
          const propsJson = el.getAttribute('data-props') || el.getAttribute('data-react-props');
          if (propsJson) {
            const props = JSON.parse(propsJson);
            if (props.applicationUrl || props.applyUrl || props.jobUrl) {
              const url = props.applicationUrl || props.applyUrl || props.jobUrl;
              if (url && url.startsWith('http')) return url;
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    } catch (error) {
      console.warn('[Extractor] Error extracting from Next.js data:', error);
    }

    return null;
  }

  /**
   * Extract application URL from window object
   */
  extractUrlFromWindow() {
    try {
      // Check common window properties where URLs might be stored
      const windowProps = [
        'applicationUrl',
        'applyUrl',
        'jobApplicationUrl',
        'externalJobUrl',
        'careerUrl'
      ];

      for (const prop of windowProps) {
        if (window[prop] && typeof window[prop] === 'string' && window[prop].startsWith('http')) {
          console.log('[Extractor] Found URL in window.' + prop);
          return window[prop];
        }
      }

      // Check for common global job data objects
      if (window.jobData && window.jobData.applicationUrl) {
        return window.jobData.applicationUrl;
      }
      if (window.job && window.job.applyUrl) {
        return window.job.applyUrl;
      }
    } catch (error) {
      console.warn('[Extractor] Error extracting from window object:', error);
    }

    return null;
  }

  /**
   * Extract application URL from meta tags
   */
  extractUrlFromMeta() {
    // Check various meta tags that might contain the apply URL
    const metaSelectors = [
      'meta[property="og:url"]',
      'meta[name="application-url"]',
      'meta[name="job:application_url"]',
      'meta[property="job:url"]',
      'link[rel="canonical"]',
      'link[rel="alternate"]'
    ];

    for (const selector of metaSelectors) {
      const meta = document.querySelector(selector);
      if (meta) {
        const url = meta.getAttribute('content') || meta.getAttribute('href');
        if (url && url.startsWith('http') && !url.includes('hiring.cafe')) {
          // Check if it looks like an apply/job URL
          if (url.match(/job|career|apply|position|opportunity|employment/i)) {
            console.log('[Extractor] Found URL in meta tag', selector, ':', url);
            return url;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract career page URL by finding ACTUAL links in the page
   * No predictions - only real links found in the DOM
   */
  extractCareerPageUrl() {
    console.log('[Extractor] Looking for career page links in DOM...');

    try {
      // Look for actual links that go to career/jobs pages
      const linkSelectors = [
        // Text-based selectors (most reliable)
        'a[href*="/jobs"]:not([href*="/jobs/"]):not([href$=".pdf"])',  // /jobs but not /jobs/123
        'a[href*="/careers"]:not([href*="/careers/"]):not([href$=".pdf"])',  // /careers but not /careers/123
        'a[href*="careers."]',  // careers subdomain
        'a[href*="jobs."]',     // jobs subdomain

        // Common class names
        'a.back-to-jobs',
        'a.view-all-jobs',
        'a.all-jobs',
        'a.job-list',
        'a.careers-link',
        'a.back-to-search',

        // Data attributes
        'a[data-action*="back"]',
        'a[data-action*="all-jobs"]',

        // Breadcrumb links (often point to parent pages)
        '.breadcrumb a[href*="job"]',
        '.breadcrumb a[href*="career"]',
        'nav a[href*="job"]',
        'nav a[href*="career"]'
      ];

      // Try each selector
      for (const selector of linkSelectors) {
        const links = document.querySelectorAll(selector);

        for (const link of links) {
          const href = link.href;
          const text = link.textContent.trim().toLowerCase();

          // Validate the link
          if (!href || !href.startsWith('http')) continue;
          if (href === window.location.href) continue;  // Skip if same as current page

          // Look for keywords in link text that indicate it's a career page link
          const careerKeywords = [
            'view all', 'see all', 'all jobs', 'all positions', 'all openings',
            'back to jobs', 'back to careers', 'back to search', 'job search',
            'browse jobs', 'explore jobs', 'career opportunities', 'open positions'
          ];

          const hasCareerKeyword = careerKeywords.some(keyword => text.includes(keyword));

          // Check if URL looks like a career page (not a specific job)
          const looksLikeCareerPage =
            (href.includes('/jobs') && !href.match(/\/jobs\/[^\/]+$/)) ||
            (href.includes('/careers') && !href.match(/\/careers\/[^\/]+$/)) ||
            href.includes('careers.') ||
            href.includes('jobs.');

          if (hasCareerKeyword || looksLikeCareerPage) {
            console.log('[Extractor] ✅ Found career page link:', href, `(text: "${text}")`);
            return href;
          }
        }
      }

      // Look for links in meta tags
      const canonicalLink = document.querySelector('link[rel="canonical"]');
      if (canonicalLink && canonicalLink.href) {
        const canonical = canonicalLink.href;
        // If canonical points to a jobs/careers page (not the current job)
        if ((canonical.includes('/jobs') || canonical.includes('/careers')) &&
            canonical !== window.location.href) {
          console.log('[Extractor] ✅ Found career page in canonical:', canonical);
          return canonical;
        }
      }

      console.log('[Extractor] ❌ No career page links found in DOM');
      return null;

    } catch (error) {
      console.warn('[Extractor] Error finding career page links:', error);
      return null;
    }
  }

  extractLocationData() {
    const fullLocation = this.extractLocation();

    if (!fullLocation) {
      return {
        full_location: null,
        city: null,
        state: null,
        country: null,
        is_remote: false
      };
    }

    // Parse "City, State, Country" format
    const parts = fullLocation.split(',').map(p => p.trim());

    return {
      full_location: fullLocation,
      city: parts[0] || null,
      state: parts[1] || null,
      country: parts[2] || null,
      is_remote: this.extractJobType() === 'remote'
    };
  }

  extractResponsibilities() {
    // Look for "Responsibilities:" section in page text
    const text = document.body.innerText;
    const match = text.match(/Responsibilities?:\s*([^\n]+)/i);

    if (match) {
      let responsibilities = match[1].trim();

      // Remove common UI text patterns
      responsibilities = responsibilities.replace(/Apply now/gi, '');
      responsibilities = responsibilities.replace(/Save/gi, '');
      responsibilities = responsibilities.replace(/Mark Applied/gi, '');
      responsibilities = responsibilities.replace(/Hide Job/gi, '');
      responsibilities = responsibilities.replace(/Report & Hide/gi, '');
      responsibilities = responsibilities.replace(/Report &/gi, '');
      responsibilities = responsibilities.replace(/Job Description/gi, '');
      responsibilities = responsibilities.replace(/Description/gi, '');
      responsibilities = responsibilities.replace(/About Us/gi, '');
      responsibilities = responsibilities.replace(/Job Info/gi, '');
      responsibilities = responsibilities.replace(/Company Info/gi, '');

      // Clean up extra whitespace
      responsibilities = responsibilities.replace(/\s+/g, ' ').trim();

      // If what's left is too short, return null
      if (responsibilities.length < 10) {
        return null;
      }

      return responsibilities;
    }

    return null;
  }

  extractRequirements() {
    // Look for "Requirements Summary:" section
    const text = document.body.innerText;
    const match = text.match(/Requirements?\s+Summary:\s*([^\n]+(?:\n(?![A-Z][a-z]+:)[^\n]+)*)/i);

    if (match) {
      let requirements = match[1].trim().replace(/\s+/g, ' ');

      // Remove common UI text patterns from hiring.cafe
      requirements = requirements.replace(/Apply now/gi, '');
      requirements = requirements.replace(/Save/gi, '');
      requirements = requirements.replace(/Mark Applied/gi, '');
      requirements = requirements.replace(/Hide Job/gi, '');
      requirements = requirements.replace(/Report & Hide/gi, '');
      requirements = requirements.replace(/Report &/gi, '');
      requirements = requirements.replace(/Job Description/gi, '');
      requirements = requirements.replace(/Description/gi, '');
      requirements = requirements.replace(/About Us/gi, '');
      requirements = requirements.replace(/View All Jobs/gi, '');
      requirements = requirements.replace(/Website/gi, '');
      requirements = requirements.replace(/Log in/gi, '');
      requirements = requirements.replace(/HiringCafe/gi, '');
      requirements = requirements.replace(/Job Info/gi, '');
      requirements = requirements.replace(/Company Info/gi, '');

      // Clean up extra whitespace and trim
      requirements = requirements.replace(/\s+/g, ' ').trim();

      // If what's left is too short or empty, return null
      if (requirements.length < 10) {
        return null;
      }

      return requirements;
    }

    return null;
  }

  extractSkills() {
    // Look for "Technical Tools Mentioned:" section
    const text = document.body.innerText;
    const match = text.match(/Technical\s+Tools?\s+Mentioned:\s*([^\n]+)/i);

    if (match) {
      // Split by comma and clean up
      return match[1].split(',').map(skill => skill.trim()).filter(Boolean);
    }

    return [];
  }

  extractBenefits(description) {
    const benefits = [];

    if (!description) {
      return benefits;
    }

    // Remove HTML tags for easier parsing
    const text = description.replace(/<[^>]+>/g, ' ').toLowerCase();

    // Define benefit patterns to look for
    const benefitPatterns = {
      // Health & Insurance
      'Health Insurance': /health\s+insurance|medical\s+insurance|health\s+coverage|medical\s+coverage|health\s+care\s+plan/gi,
      'Dental Insurance': /dental\s+insurance|dental\s+coverage|dental\s+plan/gi,
      'Vision Insurance': /vision\s+insurance|vision\s+coverage|vision\s+plan/gi,
      'Life Insurance': /life\s+insurance/gi,

      // Retirement
      '401(k)': /401\s*k|401\(k\)/gi,
      'Pension': /pension\s+plan|pension\s+scheme/gi,
      'Retirement Plan': /retirement\s+plan|retirement\s+savings/gi,

      // Time Off
      'Paid Time Off': /paid\s+time\s+off|pto\b/gi,
      'Vacation': /vacation\s+days?|paid\s+vacation|annual\s+leave/gi,
      'Sick Leave': /sick\s+leave|sick\s+days?|paid\s+sick/gi,
      'Parental Leave': /parental\s+leave|maternity\s+leave|paternity\s+leave/gi,

      // Financial
      'Bonus': /\bbonus\b|annual\s+bonus|performance\s+bonus|sign[\s-]?on\s+bonus/gi,
      'Stock Options': /stock\s+options|equity|rsu|restricted\s+stock/gi,

      // Work Environment
      'Remote Work': /remote\s+work|work\s+from\s+home|wfh\b/gi,
      'Flexible Schedule': /flexible\s+schedule|flexible\s+hours|flexible\s+working/gi,
      'Hybrid Work': /hybrid\s+work|hybrid\s+working/gi,

      // Development
      'Professional Development': /professional\s+development|training|learning|education\s+assistance|tuition\s+reimbursement/gi,
      'Career Growth': /career\s+growth|career\s+advancement|promotion\s+opportunities/gi,

      // Wellness
      'Gym Membership': /gym\s+membership|fitness\s+center|fitness\s+membership/gi,
      'Wellness Program': /wellness\s+program|employee\s+assistance|mental\s+health/gi,

      // Other Perks
      'Employee Discounts': /employee\s+discount|staff\s+discount/gi,
      'Free Parking': /free\s+parking|parking\s+provided/gi,
      'Commuter Benefits': /commuter\s+benefit|transportation\s+allowance|transit\s+pass/gi,
      'Relocation Assistance': /relocation\s+assistance|relocation\s+package/gi,
      'Childcare': /childcare|child\s+care|daycare/gi
    };

    // Check for each benefit type
    for (const [benefitName, pattern] of Object.entries(benefitPatterns)) {
      if (pattern.test(text)) {
        benefits.push(benefitName);
      }
    }

    // Look for "benefits begin on day 1" type phrases
    if (/benefits?\s+begin\s+(?:on\s+)?day[\s-]?1|benefits?\s+start\s+(?:on\s+)?day[\s-]?1/gi.test(text)) {
      benefits.push('Benefits Start Day 1');
    }

    // Remove duplicates and return
    return [...new Set(benefits)];
  }

  extractEducation() {
    const text = document.body.innerText;
    const result = {
      requirement: [],
      preferred: []
    };

    // Define specific degree patterns to extract
    const degreePatterns = {
      // Doctoral level
      'PhD': /\bph\.?d\b/gi,
      'Doctorate': /\bdoctorate\b/gi,
      'Doctoral': /\bdoctoral\b/gi,
      'MD': /\bm\.?d(?!\w)\b/gi,
      'MDS': /\bmds\b/gi,
      'MBBS': /\bmbbs\b/gi,
      'PharmD': /\bpharmd\b/gi,

      // Masters level
      "Master's": /\bmaster'?s?(?:\s+degree)?\b/gi,
      'MS': /\bm\.?s\.?\b/gi,
      'MSc': /\bm\.?sc\.?\b/gi,
      'MBA': /\bm\.?b\.?a\.?\b/gi,
      'M.Com': /\bm\.?com\b/gi,
      'CA': /\bca\b/gi,
      'CFA': /\bcfa\b/gi,
      'PG': /\bpg\s+in\b/gi,
      'Post Graduate': /\bpost\s*graduate\b/gi,

      // Bachelors level
      "Bachelor's": /\bbachelor'?s?(?:\s+degree)?\b/gi,
      'BS': /\bb\.?s\.?\b/gi,
      'BSc': /\bb\.?sc\.?\b/gi,
      'BA': /\bb\.?a\.?\b/gi,
      'BE': /\bb\.?e\.?\b/gi,
      'B.Tech': /\bb\.?tech\b/gi,

      // High school
      'High School': /\bhigh\s+school\b/gi,
      'Secondary School': /\bsecondary\s+school\b/gi,
      'Diploma': /\bdiploma\b/gi
    };

    // Helper function to extract all degrees from a text segment
    const extractDegreesFromText = (textSegment) => {
      const foundDegrees = new Set();

      for (const [degreeName, pattern] of Object.entries(degreePatterns)) {
        // Reset regex lastIndex
        pattern.lastIndex = 0;

        if (pattern.test(textSegment)) {
          foundDegrees.add(degreeName);
        }
      }

      return Array.from(foundDegrees);
    };

    // Look in "Qualifications:" or "Education" sections first
    const qualificationPatterns = [
      /(?:qualifications?|education):\s*([^\n]+(?:\n(?![A-Z][a-z]+:)[^\n]+)*)/i,
      /(?:requirements?\s+summary:|must\s+have:)\s*([^\n]+(?:\n(?![A-Z][a-z]+:)[^\n]+)*)/i,
      /education[—\-:]\s*([^\n]+)/i
    ];

    let educationText = '';
    for (const pattern of qualificationPatterns) {
      const match = text.match(pattern);
      if (match) {
        educationText = match[1] || match[0];
        console.log('[Extractor] Found education section:', educationText.substring(0, 100));
        break;
      }
    }

    // If we found a dedicated section, extract from it
    if (educationText) {
      // Check for required education
      const requiredMatch = educationText.match(/(?:required|mandatory|must\s+have|minimum)[:\s]*([^.\n]+)/i);
      if (requiredMatch) {
        result.requirement = extractDegreesFromText(requiredMatch[1]);
      }

      // Check for preferred education
      const preferredMatch = educationText.match(/(?:preferred|preferable|desired|advantageous)[:\s]*([^.\n]+)/i);
      if (preferredMatch) {
        result.preferred = extractDegreesFromText(preferredMatch[1]);
      }

      // If no explicit required/preferred, extract all degrees from the section as requirement
      if (result.requirement.length === 0) {
        result.requirement = extractDegreesFromText(educationText);
      }
    } else {
      // Fallback: look in full text for required patterns
      const requiredPatterns = [
        /(?:required|must\s+have|minimum)[:\s]+([^.\n]+(?:bachelor|master|phd|doctorate|mba|ca|cfa|md|mbbs)[^.\n]*)/i,
        /(?:bachelor|master|phd|doctorate|mba|ca|cfa|md|mbbs)[^.\n]*(?:required|essential|mandatory)/i
      ];

      for (const pattern of requiredPatterns) {
        const match = text.match(pattern);
        if (match) {
          result.requirement = extractDegreesFromText(match[0]);
          if (result.requirement.length > 0) break;
        }
      }

      // Look for preferred patterns
      const preferredPatterns = [
        /(?:preferred|desired|nice\s+to\s+have)[:\s]+([^.\n]+(?:bachelor|master|phd|doctorate|mba)[^.\n]*)/i,
        /(?:bachelor|master|phd|doctorate|mba)[^.\n]*(?:preferred|desired|advantageous)/i
      ];

      for (const pattern of preferredPatterns) {
        const match = text.match(pattern);
        if (match) {
          result.preferred = extractDegreesFromText(match[0]);
          if (result.preferred.length > 0) break;
        }
      }
    }

    console.log('[Extractor] Education (arrays):', result);
    return result;
  }

  extractExperienceLevel() {
    // Look for experience pattern in text: "X-Y Years" or "X+ Years"
    const text = document.body.innerText;
    const match = text.match(/(\d+(?:\.\d+)?[\s-]+(?:to\s+)?\d+(?:\.\d+)?|[\d+]+)\s+years?/i);
    return match ? match[0] : null;
  }

  extractCategory() {
    const title = (this.extractTitle() || '').toLowerCase();

    // Simple categorization based on title keywords
    if (title.includes('engineer') || title.includes('developer') || title.includes('software')) {
      return 'Engineering';
    }
    if (title.includes('data') || title.includes('analyst') || title.includes('science')) {
      return 'Data & Analytics';
    }
    if (title.includes('design') || title.includes('ux') || title.includes('ui')) {
      return 'Design';
    }
    if (title.includes('manager') || title.includes('lead') || title.includes('director')) {
      return 'Management';
    }
    if (title.includes('sales') || title.includes('business development')) {
      return 'Sales';
    }
    if (title.includes('marketing')) {
      return 'Marketing';
    }
    if (title.includes('support') || title.includes('customer')) {
      return 'Customer Support';
    }
    if (title.includes('technical') || title.includes('specialist')) {
      return 'Technical';
    }

    return 'Other';
  }

  /**
   * Helper: Click a tab by its text content
   * @param {string} tabText - Text to search for in buttons/links (e.g., "Company Info")
   * @returns {boolean} - True if tab was found and clicked
   */
  clickTabByText(tabText) {
    try {
      // Look for button or link containing the tab text
      const buttons = document.querySelectorAll('button, a[role="tab"], div[role="tab"]');

      for (const button of buttons) {
        const text = button.textContent.trim();
        if (text === tabText || text.includes(tabText)) {
          console.log(`[Extractor] Clicking tab: ${tabText}`);
          button.click();
          return true;
        }
      }

      console.log(`[Extractor] Tab not found: ${tabText}`);
      return false;
    } catch (error) {
      console.error(`[Extractor] Error clicking tab:`, error);
      return false;
    }
  }

  /**
   * Helper: Synchronous wait (blocking)
   * @param {number} ms - Milliseconds to wait
   */
  syncWait(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait
    }
  }

  // ============================================================================
  // API ENDPOINT DETECTION (Enhanced)
  // ============================================================================

  /**
   * Detect API endpoint from page source
   */
  detectAPIEndpoint() {
    console.log('[Extractor] Detecting API endpoints...');

    const apiPatterns = [
      // Specific ATS APIs (highest priority)
      /https?:\/\/[^"'\s]*lever\.co\/[^"'\s]*\/postings[^"'\s]*/gi,
      /https?:\/\/api\.lever\.co\/[^"'\s]*/gi,
      /https?:\/\/boards-api\.greenhouse\.io\/[^"'\s]*/gi,
      /https?:\/\/api\.greenhouse\.io\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\.greenhouse\.io\/embed\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*workable\.com\/spi\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*workable\.com\/api\/[^"'\s]*/gi,
      /https?:\/\/api\.ashbyhq\.com\/[^"'\s]*/gi,
      /https?:\/\/jobs\.ashbyhq\.com\/api\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*smartrecruiters\.com\/api\/[^"'\s]*/gi,
      /https?:\/\/api\.smartrecruiters\.com\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*jobvite\.com\/api\/[^"'\s]*/gi,
      /https?:\/\/api\.jobvite\.com\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*breezy\.hr\/api\/[^"'\s]*/gi,
      /https?:\/\/api\.breezy\.hr\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*bamboohr\.com\/careers_api\/[^"'\s]*/gi,
      /https?:\/\/api\.bamboohr\.com\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*applytojob\.com\/api\/[^"'\s]*/gi,
      // Generic API patterns
      /https?:\/\/api\.[^"'\s]*\/[^"'\s]*jobs[^"'\s]*/gi,
      /https?:\/\/api\.[^"'\s]*\/[^"'\s]*careers[^"'\s]*/gi,
      /https?:\/\/api\.[^"'\s]*\/[^"'\s]*postings[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\/api\/[^"'\s]*jobs[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\/api\/[^"'\s]*careers[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\/api\/v[0-9]+\/[^"'\s]*jobs[^"'\s]*/gi,
      /https?:\/\/[^"'\s]+\/api\/[^"'\s]*/gi
    ];

    const foundAPIs = new Set();

    // Check all script tags
    document.querySelectorAll('script').forEach(script => {
      const content = script.textContent || script.innerHTML;
      apiPatterns.forEach(pattern => {
        const matches = content.match(pattern);
        if (matches) {
          matches.forEach(url => {
            const cleanUrl = url
              .replace(/['"\\]/g, '')
              .replace(/&quot;/g, '')
              .replace(/&amp;/g, '&')
              .trim();
            foundAPIs.add(cleanUrl);
          });
        }
      });
    });

    // Check HTML body
    const bodyHTML = document.body.innerHTML;
    apiPatterns.forEach(pattern => {
      const matches = bodyHTML.match(pattern);
      if (matches) {
        matches.forEach(url => {
          const cleanUrl = url
            .replace(/['"\\]/g, '')
            .replace(/&quot;/g, '')
            .replace(/&amp;/g, '&')
            .trim();
          foundAPIs.add(cleanUrl);
        });
      }
    });

    // Filter out non-API URLs
    const excludePatterns = [
      /\.pdf$/i, /\.png$/i, /\.jpg$/i, /\.jpeg$/i, /\.gif$/i, /\.svg$/i,
      /\.css$/i, /\.js$/i, /\.woff/i, /\.ttf/i,
      /\/docs?\//i, /\/documentation\//i, /\/help\//i, /\/support\//i,
      /\/static\//i, /\/assets\//i,
      /\/image\/api\//i, /\/images\/api\//i,  // Image APIs
      /diffbot\.com\/image/i,  // Diffbot image API
      /\/media\/api\//i, /\/cdn\/api\//i  // Media/CDN APIs
    ];

    const apiList = Array.from(foundAPIs).filter(url => {
      return !excludePatterns.some(pattern => pattern.test(url)) && url.startsWith('http');
    });

    // Prioritize job API URLs
    const jobAPIKeywords = ['posting', 'jobs', 'careers', 'positions', 'openings', 'opportunities'];
    const likelyJobAPIs = apiList.filter(url =>
      jobAPIKeywords.some(keyword => url.toLowerCase().includes(keyword))
    );

    const bestAPI = likelyJobAPIs.length > 0 ? likelyJobAPIs[0] : apiList[0];

    console.log('[Extractor] Found API endpoints:', apiList.length > 0 ? apiList : 'None');
    console.log('[Extractor] Best API endpoint:', bestAPI || 'None');

    return bestAPI || null;
  }

  /**
   * Detect ATS provider from URL and page content
   */
  detectATS() {
    const url = window.location.href;
    const html = document.documentElement.innerHTML;

    const atsPatterns = [
      { name: 'Greenhouse', patterns: [/greenhouse\.io/i, /gh_jid=/i] },
      { name: 'Lever', patterns: [/lever\.co/i, /lever-apply/i] },
      { name: 'Workable', patterns: [/workable\.com/i, /apply\.workable/i] },
      { name: 'Ashby', patterns: [/ashbyhq\.com/i, /jobs\.ashby/i] },
      { name: 'SmartRecruiters', patterns: [/smartrecruiters\.com/i] },
      { name: 'Jobvite', patterns: [/jobvite\.com/i] },
      { name: 'BambooHR', patterns: [/bamboohr\.com/i] },
      { name: 'JazzHR', patterns: [/jazz\.co/i, /resumator\.com/i] },
      { name: 'Breezy HR', patterns: [/breezy\.hr/i] },
      { name: 'BrassRing', patterns: [/brassring\.com/i] },
      { name: 'iCIMS', patterns: [/icims\.com/i] },
      { name: 'Taleo', patterns: [/taleo\.net/i] },
      { name: 'Workday', patterns: [/workday\.com/i, /myworkdayjobs\.com/i] },
      { name: 'UltiPro', patterns: [/ultipro\.com/i] },
      { name: 'SuccessFactors', patterns: [/successfactors\.com/i, /performancemanager\d+\.successfactors\.com/i] },
      { name: 'JobAppNetwork', patterns: [/jobappnetwork\.com/i] }
    ];

    for (const ats of atsPatterns) {
      for (const pattern of ats.patterns) {
        if (pattern.test(url) || pattern.test(html)) {
          console.log('[Extractor] Detected ATS:', ats.name);
          return ats.name;
        }
      }
    }

    console.log('[Extractor] No ATS detected, using "Custom"');
    return 'Custom';
  }
}

// Make globally available
window.HiringCafeJobExtractor = HiringCafeJobExtractor;
console.log('[Extractor] Loaded successfully');
