/**
 * Content Script for hiring.cafe
 * Handles scrolling and extraction
 */

console.log('[Content] Loading...');

// Initialize extractor
let extractor;
try {
  extractor = new HiringCafeJobExtractor();
  console.log('[Content] Extractor initialized');
} catch (error) {
  console.error('[Content] Extractor init failed:', error);
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content] Received message:', request.action);

  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'extractJob') {
    (async () => {
      try {
        // Small delay to let page settle
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!extractor) {
          extractor = new HiringCafeJobExtractor();
        }

        const jobData = await extractor.extractJobData();

        if (jobData) {
          sendResponse({ success: true, data: jobData });
        } else {
          sendResponse({ success: false, error: 'Extraction returned null' });
        }
      } catch (error) {
        console.error('[Content] Extraction error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep channel open for async
  }

  if (request.action === 'detectAPI') {
    (async () => {
      try {
        if (!extractor) {
          extractor = new HiringCafeJobExtractor();
        }

        const apiEndpoint = extractor.detectAPIEndpoint();
        const atsProvider = extractor.detectATS();

        let apiEndpointDetail = null;
        if (apiEndpoint) {
          apiEndpointDetail = apiEndpoint.replace(/\?.*$/, '') + '/{id}';
        }

        sendResponse({
          success: true,
          api_endpoint: apiEndpoint,
          api_endpoint_detail: apiEndpointDetail,
          ats_provider: atsProvider
        });
      } catch (error) {
        console.error('[Content] API detection error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();

    return true; // Keep channel open for async
  }

  if (request.action === 'extractJobUrls') {
    const jobs = extractJobUrlsFromPage();
    sendResponse({ success: true, jobs });
    return true;
  }

  if (request.action === 'startAutoScroll') {
    const maxScrolls = request.maxScrolls || 50;

    // Start scrolling (don't wait for completion)
    scrollToLoadMore(maxScrolls, () => {
      const jobs = extractJobUrlsFromPage();

      chrome.runtime.sendMessage({
        action: 'scrollComplete',
        jobs,
        count: jobs.length
      });
    });

    // Send immediate response
    sendResponse({ success: true, started: true });
    return false;
  }
});

/**
 * Extract job URLs with company names from listing page
 */
function extractJobUrlsFromPage() {
  const jobsMap = new Map(); // url -> { url, company }

  // Find all links containing /viewjob/
  const links = document.querySelectorAll('a[href*="/viewjob/"]');

  links.forEach((link, index) => {
    if (!link.href || !link.href.includes('/viewjob/')) return;

    const url = link.href;
    let companyName = null;

    // Strategy 1: Look for company name in parent card
    const parentCard = link.closest('div[class*="card"]') || link.closest('div[class*="job"]');
    if (parentCard) {
      // Try to find company name in card
      const companySpan = parentCard.querySelector('span[class*="company"]') ||
                         parentCard.querySelector('div[class*="company"]') ||
                         parentCard.querySelector('[class*="CompanyName"]');

      if (companySpan) {
        companyName = companySpan.textContent.trim();
      }
    }

    // Strategy 2: Look for @ symbol pattern (common in hiring.cafe)
    if (!companyName) {
      const textContent = link.closest('div')?.textContent || '';
      const atMatch = textContent.match(/@\s*([A-Za-z0-9\s\-&.]+?)(?:\s*•|\s*\||$)/);
      if (atMatch) {
        companyName = atMatch[1].trim();
      }
    }

    // Strategy 3: Fallback to Unknown-{index}
    if (!companyName || companyName.length === 0) {
      companyName = `Unknown-${index + 1}`;
    }

    // Store as map to prevent duplicate URLs
    if (!jobsMap.has(url)) {
      jobsMap.set(url, {
        url: url,
        company: companyName
      });
    }
  });

  const jobs = Array.from(jobsMap.values());
  console.log(`[Content] Found ${jobs.length} jobs from ${new Set(jobs.map(j => j.company)).size} companies`);
  return jobs;
}

/**
 * Auto-scroll to load more jobs
 */
function scrollToLoadMore(maxScrolls, callback) {
  let scrollCount = 0;
  let lastHeight = document.body.scrollHeight;
  let noNewContentCount = 0;

  console.log(`[Content] Starting scroll (max ${maxScrolls})...`);

  const scrollInterval = setInterval(() => {
    // Scroll to bottom
    window.scrollTo(0, document.body.scrollHeight);

    setTimeout(() => {
      const newHeight = document.body.scrollHeight;

      if (newHeight === lastHeight) {
        noNewContentCount++;
        console.log(`[Content] No new content (${noNewContentCount}/3)`);

        if (noNewContentCount >= 3) {
          clearInterval(scrollInterval);
          console.log('[Content] Scroll complete - reached end');
          if (callback) callback();
          return;
        }
      } else {
        noNewContentCount = 0;
        console.log(`[Content] Scroll progress: ${scrollCount + 1}/${maxScrolls}`);
      }

      lastHeight = newHeight;
      scrollCount++;

      if (scrollCount >= maxScrolls) {
        clearInterval(scrollInterval);
        console.log(`[Content] Scroll complete - max reached`);
        if (callback) callback();
      }
    }, 2000); // Wait 2s for content to load

  }, 3000); // Scroll every 3s
}

console.log('[Content] Loaded successfully');
