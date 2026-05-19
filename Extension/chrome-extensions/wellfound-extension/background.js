// Background script for batch extraction and career page detection

// Import configuration and Supabase client
importScripts('config.js', 'supabase-client.js');

let extractedCompanies = [];
let extractionInProgress = false;
let currentExtractionPage = 1;
let totalPagesToExtract = 1;

// Supabase client instance
let supabaseClient = null;

// Initialize Supabase client
function initSupabase() {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey ||
      SUPABASE_CONFIG.url === 'YOUR_SUPABASE_URL') {
    console.log('[Background] Supabase not configured - skipping sync');
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = new SupabaseClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    console.log('[Background] ✓ Supabase client initialized');
  }

  return supabaseClient;
}

// Load saved data on startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['extractedCompanies'], (result) => {
    if (result.extractedCompanies) {
      extractedCompanies = result.extractedCompanies;
      console.log(`[Background] Loaded ${extractedCompanies.length} companies from storage`);
    }
  });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStatus') {
    sendResponse({
      companiesCount: extractedCompanies.length,
      inProgress: extractionInProgress,
      currentPage: currentExtractionPage,
      totalPages: totalPagesToExtract
    });
    return true;
  }

  if (request.action === 'startExtraction') {
    const startPage = request.startPage || 1;
    const endPage = request.endPage || 960;

    startBatchExtraction(startPage, endPage);

    sendResponse({ success: true, message: 'Extraction started' });
    return true;
  }

  if (request.action === 'findCareerPages') {
    findCareerPagesForAll();
    sendResponse({ success: true, message: 'Career page detection started' });
    return true;
  }

  if (request.action === 'syncToSupabase') {
    syncToSupabase();
    sendResponse({ success: true, message: 'Supabase sync started' });
    return true;
  }

  if (request.action === 'downloadData') {
    downloadCompaniesData();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'clearData') {
    extractedCompanies = [];
    chrome.storage.local.remove(['extractedCompanies']);
    sendResponse({ success: true });
    return true;
  }
});

async function startBatchExtraction(startPage, endPage) {
  extractionInProgress = true;
  currentExtractionPage = startPage;
  totalPagesToExtract = endPage;

  console.log(`[Background] Starting extraction from page ${startPage} to ${endPage}`);

  for (let page = startPage; page <= endPage; page++) {
    currentExtractionPage = page;

    const url = page === 1 ? 'https://wellfound.com/startups' : `https://wellfound.com/startups?page=${page}`;

    console.log(`[Background] Extracting page ${page}/${endPage}: ${url}`);

    try {
      // Open the page in a new tab
      const tab = await createTab(url);

      // Wait for page to load
      await waitForPageLoad(tab.id);

      // Extract companies from the page
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractCompanies' });

      if (response.success) {
        // Add new companies to the list
        extractedCompanies.push(...response.companies);

        console.log(`[Background] ✓ Page ${page}: Extracted ${response.companies.length} companies (Total: ${extractedCompanies.length})`);

        // Save to storage
        await saveToStorage();

        // Close the tab
        await chrome.tabs.remove(tab.id);

        // Small delay between pages to avoid rate limiting
        await delay(2000);
      } else {
        console.error(`[Background] Failed to extract page ${page}`);
      }
    } catch (error) {
      console.error(`[Background] Error on page ${page}:`, error);
    }

    // Notify popup of progress
    chrome.runtime.sendMessage({
      action: 'extractionProgress',
      currentPage: page,
      totalPages: endPage,
      companiesCount: extractedCompanies.length
    });
  }

  extractionInProgress = false;

  console.log(`[Background] ✓ Extraction complete! Total companies: ${extractedCompanies.length}`);

  // Auto-download the data
  await downloadCompaniesData();

  // Auto-sync to Supabase if enabled
  if (SUPABASE_CONFIG.autoSync) {
    console.log('[Background] Auto-syncing to Supabase...');
    await syncToSupabase();
  }

  // Notify popup
  chrome.runtime.sendMessage({
    action: 'extractionComplete',
    companiesCount: extractedCompanies.length
  });
}

async function findCareerPagesForAll() {
  console.log(`[Background] Finding career pages for ${extractedCompanies.length} companies`);

  let found = 0;

  for (let i = 0; i < extractedCompanies.length; i++) {
    const company = extractedCompanies[i];

    if (company.careerPage) {
      continue; // Skip if already found
    }

    console.log(`[Background] [${i + 1}/${extractedCompanies.length}] Finding career page for ${company.name}`);

    const careerPage = await findCareerPage(company.website);

    if (careerPage) {
      company.careerPage = careerPage;
      found++;
      console.log(`[Background] ✓ Found: ${careerPage}`);
    } else {
      console.log(`[Background] ✗ Not found for ${company.name}`);
    }

    // Save progress every 10 companies
    if ((i + 1) % 10 === 0) {
      await saveToStorage();
    }

    // Small delay to avoid rate limiting
    await delay(1000);
  }

  await saveToStorage();

  console.log(`[Background] ✓ Career page detection complete! Found ${found} career pages`);

  // Auto-download updated data
  await downloadCompaniesData();

  // Auto-sync to Supabase if enabled
  if (SUPABASE_CONFIG.autoSync) {
    console.log('[Background] Auto-syncing to Supabase...');
    await syncToSupabase();
  }

  chrome.runtime.sendMessage({
    action: 'careerPagesComplete',
    found: found
  });
}

async function findCareerPage(websiteUrl) {
  if (!websiteUrl) return null;

  try {
    const url = new URL(websiteUrl);
    const domain = url.hostname.replace('www.', '');
    const baseUrl = `${url.protocol}//${url.hostname}`;

    // Common career page URLs to try (in order of specificity - most specific first)
    const careerUrls = [
      // Try deeper/more specific paths first (actual job listings)
      `${baseUrl}/about/careers/openings`,
      `${baseUrl}/careers/openings`,
      `${baseUrl}/jobs/openings`,
      `${baseUrl}/company/careers/openings`,

      // Try standard deep paths
      `${baseUrl}/about/careers`,
      `${baseUrl}/company/careers`,
      `${baseUrl}/company/jobs`,

      // Try subdomains (often dedicated career sites)
      `https://jobs.${domain}`,
      `https://careers.${domain}`,

      // Try standard paths
      `${baseUrl}/careers`,
      `${baseUrl}/jobs`,
      `${baseUrl}/career`,

      // Try alternative paths
      `${baseUrl}/join-us`,
      `${baseUrl}/work-with-us`,
      `${baseUrl}/opportunities`
    ];

    // Try each URL by actually opening it
    for (const careerUrl of careerUrls) {
      console.log(`[Background] Checking: ${careerUrl}`);
      const exists = await checkUrlExists(careerUrl);
      if (exists) {
        console.log(`[Background] ✓ Found: ${careerUrl}`);
        return careerUrl;
      }
    }

    console.log(`[Background] ✗ No career page found for ${websiteUrl}`);
    return null;
  } catch (error) {
    console.error(`[Background] Error finding career page for ${websiteUrl}:`, error);
    return null;
  }
}

async function checkUrlExists(url) {
  try {
    // Open URL in a new background tab
    const tab = await chrome.tabs.create({ url, active: false });

    // Wait for page to load or timeout
    const result = await Promise.race([
      waitForTabLoad(tab.id),
      timeout(5000, false) // 5 second timeout
    ]);

    // Check if page loaded successfully
    let exists = false;

    if (result) {
      // Get the final URL (after redirects) and title
      const tabInfo = await chrome.tabs.get(tab.id);

      // Check if it's a valid page (not 404, not error page)
      const is404 = tabInfo.title &&
        (tabInfo.title.includes('404') ||
         tabInfo.title.includes('Not Found') ||
         tabInfo.title.includes('Page Not Found') ||
         tabInfo.title.includes('Error'));

      // Check if URL redirected to homepage or different domain
      const finalUrl = new URL(tabInfo.url);
      const originalUrl = new URL(url);
      const samePath = finalUrl.pathname === originalUrl.pathname ||
                       finalUrl.pathname.startsWith(originalUrl.pathname);

      // Basic check passed, now verify it's actually a careers page
      if (!is404 && samePath) {
        // Inject script to check page content
        try {
          const [contentCheck] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const text = document.body.innerText.toLowerCase();
              const html = document.body.innerHTML.toLowerCase();

              // Check for career/job-related keywords
              const hasCareerKeywords =
                text.includes('career') ||
                text.includes('job') ||
                text.includes('position') ||
                text.includes('opening') ||
                text.includes('hiring') ||
                text.includes('opportunit') ||
                text.includes('apply') ||
                text.includes('join our team') ||
                text.includes('work with us');

              // Check for job-related HTML elements (job listings, apply buttons, etc.)
              const hasJobElements =
                html.includes('job') ||
                html.includes('career') ||
                html.includes('position') ||
                html.includes('apply');

              // Check if page has substantial content (not empty)
              const hasContent = text.trim().length > 100;

              return hasCareerKeywords && hasJobElements && hasContent;
            }
          });

          exists = contentCheck.result === true;

          if (!exists) {
            console.log(`[Background] ✗ Page exists but doesn't appear to be a careers page: ${url}`);
          }
        } catch (error) {
          console.log(`[Background] ⚠ Could not verify page content, assuming valid: ${url}`, error);
          // If content check fails (e.g., permission issues), fall back to basic check
          exists = true;
        }
      }
    }

    // Close the tab
    await chrome.tabs.remove(tab.id);

    return exists;
  } catch (error) {
    console.error(`[Background] Error checking ${url}:`, error);
    return false;
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    });
  });
}

function timeout(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

async function saveToStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ extractedCompanies }, () => {
      console.log(`[Background] ✓ Saved ${extractedCompanies.length} companies to storage`);
      resolve();
    });
  });
}

async function downloadCompaniesData() {
  if (extractedCompanies.length === 0) {
    console.log('[Background] No companies to download');
    return;
  }

  try {
    const jsonString = JSON.stringify(extractedCompanies, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `wellfound-companies-${timestamp}.json`;

    console.log('[Background] Triggering download:', filename);

    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    });

    console.log(`[Background] ✓ Downloaded: ${filename} (${extractedCompanies.length} companies)`);
  } catch (error) {
    console.error('[Background] Download failed:', error);
  }
}

function createTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      resolve(tab);
    });
  });
}

function waitForPageLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay to ensure content script is loaded
        setTimeout(resolve, 2000);
      }
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sync companies to Supabase
async function syncToSupabase() {
  const client = initSupabase();

  if (!client) {
    console.log('[Background] Supabase not configured - cannot sync');
    chrome.runtime.sendMessage({
      action: 'supabaseSyncComplete',
      error: 'Supabase not configured'
    });
    return;
  }

  if (extractedCompanies.length === 0) {
    console.log('[Background] No companies to sync');
    chrome.runtime.sendMessage({
      action: 'supabaseSyncComplete',
      error: 'No companies to sync'
    });
    return;
  }

  console.log(`[Background] Starting Supabase sync for ${extractedCompanies.length} companies...`);

  chrome.runtime.sendMessage({
    action: 'supabaseSyncProgress',
    message: `Syncing ${extractedCompanies.length} companies to Supabase...`
  });

  try {
    const results = await client.saveCareerPagesBulk(extractedCompanies);

    console.log(`[Background] ✓ Supabase sync complete: ${results.success} success, ${results.failed} failed`);

    chrome.runtime.sendMessage({
      action: 'supabaseSyncComplete',
      success: results.success,
      failed: results.failed,
      errors: results.errors
    });
  } catch (error) {
    console.error('[Background] Supabase sync failed:', error);
    chrome.runtime.sendMessage({
      action: 'supabaseSyncComplete',
      error: error.message
    });
  }
}
