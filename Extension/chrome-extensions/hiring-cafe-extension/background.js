/**
 * Background Service Worker
 * Handles batch extraction with persistent storage
 */

console.log('[Background] Loading...');

let extractedJobs = [];
let currentJobUrls = [];
let extractionInProgress = false;
let shouldStopExtraction = false;

// Load from storage on startup (CRITICAL for persistence)
chrome.storage.local.get(['extractedJobs'], (result) => {
  if (result.extractedJobs && Array.isArray(result.extractedJobs)) {
    extractedJobs = result.extractedJobs;
    console.log(`[Background] Loaded ${extractedJobs.length} jobs from storage`);
  }
});

// Message listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'getExtractedJobs') {
    sendResponse({ jobs: extractedJobs, count: extractedJobs.length });
    return true;
  }

  if (request.action === 'clearExtractedJobs') {
    extractedJobs = [];
    chrome.storage.local.set({ extractedJobs: [] });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'scrollComplete') {
    // Receive jobs array with company info, extract URLs
    const jobs = request.jobs || [];
    currentJobUrls = jobs.map(job => job.url || job);
    console.log(`[Background] Received ${currentJobUrls.length} job URLs`);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'startBatchExtraction') {
    if (extractionInProgress) {
      sendResponse({ success: false, error: 'Already in progress' });
      return false;
    }

    extractionInProgress = true;
    shouldStopExtraction = false;
    const urls = request.urls || currentJobUrls;

    // Start async extraction (don't wait for response)
    batchExtractJobs(urls).then(async results => {
      extractedJobs = results;
      extractionInProgress = false;

      // PERSIST TO STORAGE (wait for completion before sending message)
      await new Promise((resolve) => {
        chrome.storage.local.set({ extractedJobs: results }, () => {
          console.log(`[Background] ✓ Saved ${results.length} jobs to storage`);
          resolve();
        });
      });

      // Auto-download JSON file
      console.log('[Background] Starting auto-download...');
      await autoDownloadJobs(results);

      // Auto-upload to Supabase
      console.log('[Background] Starting auto-upload to Supabase...');
      await autoUploadJobs(results);

      // Now send completion message (after storage is saved and download started)
      chrome.runtime.sendMessage({
        action: 'extractionComplete',
        count: results.length
      });
    }).catch(error => {
      extractionInProgress = false;
      chrome.runtime.sendMessage({
        action: 'extractionError',
        error: error.message
      });
    });

    // Send immediate response
    sendResponse({ success: true, started: true });
    return false;
  }

  if (request.action === 'stopExtraction') {
    shouldStopExtraction = true;
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Batch extract jobs from URLs
 */
async function batchExtractJobs(urls) {
  const results = [];
  const total = urls.length;

  console.log(`[Background] Starting batch extraction of ${total} jobs`);

  for (let i = 0; i < urls.length; i++) {
    if (shouldStopExtraction) {
      console.log(`[Background] Stopped at ${i}/${total}`);

      // Save partial results (wait for completion)
      await new Promise((resolve) => {
        chrome.storage.local.set({ extractedJobs: results }, () => {
          console.log(`[Background] ✓ Saved ${results.length} partial jobs to storage`);
          resolve();
        });
      });

      // Auto-download partial results
      console.log('[Background] Auto-downloading partial results...');
      await autoDownloadJobs(results);

      // Auto-upload partial results
      console.log('[Background] Auto-uploading partial results...');
      await autoUploadJobs(results);

      // Now send stopped message (after storage and download)
      chrome.runtime.sendMessage({
        action: 'extractionStopped',
        count: results.length
      });

      shouldStopExtraction = false;
      return results;
    }

    const url = urls[i];
    let tab = null;

    try {
      // Log progress
      chrome.runtime.sendMessage({
        action: 'extractionLog',
        message: `Opening: ${url.split('/').pop()}...`,
        type: 'info'
      });

      // Open tab in foreground (active: true allows proper interaction with page)
      tab = await chrome.tabs.create({ url, active: true });

      // Ensure tab is focused and brought to foreground
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });

      // Wait for load
      await waitForTabLoad(tab.id);

      // Additional delay to ensure page is fully interactive and ready for button clicks
      await sleep(2000);

      // Ensure content scripts are loaded
      await ensureContentScriptsLoaded(tab.id);

      // Extract (with timeout)
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { action: 'extractJob' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Extraction timeout (30s)')), 30000)
        )
      ]);

      console.log(`[Background] Response:`, response);

      if (response && response.success) {
        const jobData = response.data;
        const title = jobData.title || 'Untitled';

        console.log(`[Background] ✓ Extracted: ${title}`);
        console.log(`[Background] 🔍 DEBUG - api_endpoint: ${jobData.api_endpoint}`);
        console.log(`[Background] 🔍 DEBUG - career_page_url: ${jobData.career_page_url}`);
        console.log(`[Background] 🔍 DEBUG - Condition check: !api_endpoint=${!jobData.api_endpoint}, hasCareerUrl=${!!jobData.career_page_url}`);

        chrome.runtime.sendMessage({
          action: 'extractionLog',
          message: `✓ ${title}`,
          type: 'success'
        }).catch(() => {});

        // NEW: Try to detect API from career page if we don't have it yet
        if (!jobData.api_endpoint && jobData.career_page_url) {
          console.log(`[Background] ═══════════════════════════════════════`);
          console.log(`[Background] 🔍 NO API FOUND ON JOB PAGE`);
          console.log(`[Background] ✅ Found real career page link in DOM`);
          console.log(`[Background] 🌐 Opening career page: ${jobData.career_page_url}`);
          console.log(`[Background] ═══════════════════════════════════════`);

          chrome.runtime.sendMessage({
            action: 'extractionLog',
            message: `🔍 Opening career page to detect API...`,
            type: 'info'
          }).catch(() => {});

          try {
            const apiData = await detectAPIFromCareerPage(jobData.career_page_url);

            if (apiData.api_endpoint) {
              console.log(`[Background] ═══════════════════════════════════════`);
              console.log(`[Background] 🎉 SUCCESS! Found API: ${apiData.api_endpoint}`);
              console.log(`[Background] ═══════════════════════════════════════`);

              jobData.api_endpoint = apiData.api_endpoint;
              jobData.api_endpoint_detail = apiData.api_endpoint_detail;

              chrome.runtime.sendMessage({
                action: 'extractionLog',
                message: `✅ Found API: ${apiData.api_endpoint.substring(0, 50)}...`,
                type: 'success'
              }).catch(() => {});
            } else {
              console.log(`[Background] ❌ No API found on career page either`);
            }
          } catch (error) {
            console.error(`[Background] ⚠️ Error checking career page:`, error.message);
          }
        } else if (jobData.api_endpoint) {
          console.log(`[Background] ✅ API already found on job page: ${jobData.api_endpoint}`);
        } else {
          console.log(`[Background] ⚠️ No career page URL available to check`);
        }

        results.push(jobData);

        // Save career page to Wellfound Supabase (async, don't wait)
        if (jobData.career_page_url && jobData.company) {
          saveCareerPageToWellfound(jobData).catch(err => {
            console.warn('[Background] Failed to save career page:', err);
          });
        }
      } else {
        const error = response?.error || 'Unknown error';
        console.error(`[Background] ✗ Failed: ${error}`);

        chrome.runtime.sendMessage({
          action: 'extractionLog',
          message: `✗ Failed: ${error}`,
          type: 'error'
        });
      }

    } catch (error) {
      console.error(`[Background] Error on ${url}:`, error);

      chrome.runtime.sendMessage({
        action: 'extractionLog',
        message: `✗ Exception: ${error.message}`,
        type: 'error'
      });
    } finally {
      // ALWAYS close tab (even if error occurs)
      if (tab) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch (e) {
          console.warn(`[Background] Could not close tab:`, e);
        }
      }

      // Human-like delay (2-4s)
      const delay = 2000 + Math.random() * 2000;
      await sleep(delay);

      // Send progress
      chrome.runtime.sendMessage({
        action: 'extractionProgress',
        progress: {
          current: i + 1,
          total,
          percentage: Math.round(((i + 1) / total) * 100)
        }
      });
    }
  }

  return results;
}

/**
 * Auto-download extracted jobs as JSON
 */
async function autoDownloadJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    console.log('[Background] No jobs to download');
    return;
  }

  try {
    const jsonString = JSON.stringify(jobs, null, 2);

    // Convert to base64 data URL (works in service workers)
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `hiring-cafe-jobs-${timestamp}.json`;

    console.log('[Background] Triggering download:', filename);

    // Trigger download
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false  // Don't prompt, auto-save to downloads folder
    });

    console.log(`[Background] ✓ Auto-downloaded: ${filename} (${jobs.length} jobs, ID: ${downloadId})`);
  } catch (error) {
    console.error('[Background] Auto-download failed:', error);
    // Don't throw - let extraction complete even if download fails
  }
}

/**
 * Auto-upload extracted jobs to Supabase
 */
async function autoUploadJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    console.log('[Upload] No jobs to upload');
    return;
  }

  try {
    // Get Supabase config from chrome storage (set in popup)
    const supabaseConfig = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    if (!supabaseConfig.supabaseUrl || !supabaseConfig.supabaseKey) {
      console.warn('[Upload] Supabase not configured. Skipping upload.');
      console.warn('[Upload] Configure Supabase in extension popup first.');
      return;
    }

    const HIRING_CAFE_SUPABASE = {
      url: supabaseConfig.supabaseUrl,
      key: supabaseConfig.supabaseKey
    };

    console.log(`[Upload] Uploading ${jobs.length} jobs to Supabase...`);
    console.log(`[Upload] Using Supabase: ${HIRING_CAFE_SUPABASE.url}`);

    // Keep service worker alive during upload
    const keepAlive = setInterval(() => {
      console.log(`[Upload] Keep-alive tick`);
    }, 20000);

    let successCount = 0;
    let errorCount = 0;

    // Build payloads for all jobs
    function buildPayload(job) {
      return {
        p_title: job.title,
        p_description: job.description,
        p_responsibilities: job.responsibilities,
        p_requirement_summary: job.requirement_summary,
        p_job_type: job.job_type,
        p_commitment_type: job.commitment_type,
        p_category: job.category,
        p_experience_level: job.experience_level,
        p_salary_min: job.salary_min,
        p_salary_max: job.salary_max,
        p_salary_currency: job.salary_currency,
        p_salary_period: job.salary_period,
        p_education_requirement: job.education_requirement || [],
        p_education_preferred: job.education_preferred || [],
        p_application_url: job.application_url,
        p_source_url: job.source_url,
        p_external_id: job.external_id,
        p_posted_date: job.posted_date,
        p_raw_data: job.raw_data || {},
        p_company_name: job.company?.name,
        p_company_website: job.company?.website,
        p_company_description: job.company?.description,
        p_company_logo_url: job.company?.logo_url,
        p_company_linkedin_url: job.company?.linkedin_url,
        p_company_year_founded: job.company?.year_founded,
        p_company_employees: job.company?.number_employees,
        p_company_industries: job.company?.industries || [],
        p_company_activities: job.company?.activities || [],
        p_company_funding_stage: job.company?.funding_stage,
        p_location_city: job.location?.city,
        p_location_state: job.location?.state,
        p_location_country: job.location?.country,
        p_location_full: job.location?.full_location,
        p_is_remote: job.location?.is_remote || false,
        p_skills: job.skills || [],
        p_benefits: job.benefits || [],
        p_career_url: job.career_page_url || null,
        p_api_endpoint: job.api_endpoint || null,
        p_api_endpoint_detail: job.api_endpoint_detail || null,
        p_ats_provider: job.ats_provider || null
      };
    }

    // Upload in concurrent batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(job =>
          fetch(`${HIRING_CAFE_SUPABASE.url}/rest/v1/rpc/save_hiring_cafe_job_to_existing_schema`, {
            method: 'POST',
            headers: {
              'apikey': HIRING_CAFE_SUPABASE.key,
              'Authorization': `Bearer ${HIRING_CAFE_SUPABASE.key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(buildPayload(job))
          }).then(async res => {
            if (res.ok) return { ok: true };
            const text = await res.text();
            return { ok: false, error: text };
          })
        )
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          successCount++;
        } else {
          errorCount++;
          const err = r.status === 'rejected' ? r.reason : r.value.error;
          if (errorCount <= 5) console.error(`[Upload] Error:`, err);
        }
      }

      if ((i + BATCH_SIZE) % 100 < BATCH_SIZE) {
        console.log(`[Upload] Progress: ${Math.min(i + BATCH_SIZE, jobs.length)}/${jobs.length} (ok=${successCount}, err=${errorCount})`);
      }

      // Small delay between batches
      await sleep(100);
    }

    clearInterval(keepAlive);
    console.log(`[Upload] ✓ Upload complete: ${successCount} succeeded, ${errorCount} failed`);

    // Send completion message to UI (ignore if popup is closed)
    try {
      chrome.runtime.sendMessage({
        action: 'extractionLog',
        message: `☁️ Uploaded ${successCount}/${jobs.length} jobs to Supabase`,
        type: successCount === jobs.length ? 'success' : 'warning'
      });
    } catch (e) {
      // Popup might be closed, ignore
    }

  } catch (error) {
    console.error('[Upload] Upload failed:', error);
    try {
      chrome.runtime.sendMessage({
        action: 'extractionLog',
        message: `✗ Upload failed: ${error.message}`,
        type: 'error'
      });
    } catch (e) {
      // Popup might be closed, ignore
    }
  }
}

/**
 * Ensure content scripts are loaded in tab
 */
async function ensureContentScriptsLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch (error) {
    // Content script not loaded, inject it
    console.log('[Background] Content script not loaded, injecting...');

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['contentExtractor.js', 'content.js']
    });

    // Wait for scripts to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Wait for tab to load (with timeout)
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let timeout;

    const listener = function(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 3000); // Extra delay for dynamic content to fully load
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Timeout after 20 seconds
    timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout (20s)'));
    }, 20000);
  });
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Save career page to Wellfound Supabase database
 * Extracts company career page from job application URL
 */
async function saveCareerPageToWellfound(jobData) {
  try {
    const WELLFOUND_SUPABASE = {
      url: 'https://vmdbwpqopujirdcthgta.supabase.co',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzEwNzAyMiwiZXhwIjoyMDgyNjgzMDIyfQ.c7QWY4J6cbVRnT9tOrw5ZcBdjzrWUZnNc_VVO1NOv00'
    };

    const companyName = jobData.company.name;
    const companyWebsite = jobData.company.website;
    const careerPageUrl = jobData.career_page_url;

    if (!companyName || !careerPageUrl) {
      console.log('[Wellfound] Skipping - missing required data');
      return;
    }

    console.log('[Wellfound] Saving career page:', companyName, '->', careerPageUrl);

    // Call Supabase save_career_page function
    const response = await fetch(`${WELLFOUND_SUPABASE.url}/rest/v1/rpc/save_career_page`, {
      method: 'POST',
      headers: {
        'apikey': WELLFOUND_SUPABASE.key,
        'Authorization': `Bearer ${WELLFOUND_SUPABASE.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_company_name: companyName,
        p_website_url: companyWebsite || careerPageUrl,
        p_career_page_url: careerPageUrl,
        p_job_table: null,
        p_job_item: null,
        p_job_page: null,
        p_job_page_table: null
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[Wellfound] ✓ Career page saved:', companyName, result);

    // Send log message to UI (ignore if popup is closed)
    try {
      chrome.runtime.sendMessage({
        action: 'extractionLog',
        message: `💼 Saved career page: ${companyName}`,
        type: 'info'
      });
    } catch (e) {
      // Popup might be closed, ignore
    }

  } catch (error) {
    console.error('[Wellfound] Error saving career page:', error);
    throw error;
  }
}

/**
 * Detect API endpoint by opening career page
 * This significantly improves detection rate!
 */
async function detectAPIFromCareerPage(careerPageUrl) {
  try {
    console.log(`[API Detection] 🌐 Fetching career page: ${careerPageUrl}`);

    // Fetch the page HTML directly (no content scripts needed!)
    const response = await fetch(careerPageUrl);

    if (!response.ok) {
      console.warn(`[API Detection] ⚠️ HTTP ${response.status}: ${response.statusText}`);
      return { api_endpoint: null, api_endpoint_detail: null };
    }

    const html = await response.text();
    console.log(`[API Detection] ✅ Fetched ${html.length} characters`);

    // Extract API endpoints from HTML
    const apiEndpoint = extractAPIFromHTML(html, careerPageUrl);

    if (apiEndpoint) {
      console.log(`[API Detection] 🎉 SUCCESS! Found API: ${apiEndpoint}`);

      const apiEndpointDetail = apiEndpoint.replace(/\?.*$/, '') + '/{id}';

      return {
        api_endpoint: apiEndpoint,
        api_endpoint_detail: apiEndpointDetail
      };
    }

    console.log(`[API Detection] ❌ No API endpoint found in HTML`);
    return { api_endpoint: null, api_endpoint_detail: null };

  } catch (error) {
    console.error(`[API Detection] ⚠️ Error:`, error.message);
    return { api_endpoint: null, api_endpoint_detail: null };
  }
}

/**
 * Extract API endpoint from HTML string
 * Same logic as contentExtractor.js but for background parsing
 */
function extractAPIFromHTML(html, pageUrl) {
  const foundAPIs = new Set();

  // API patterns (same as contentExtractor.js)
  const apiPatterns = [
    // Specific ATS APIs
    /https?:\/\/[^"'\s]*lever\.co\/[^"'\s]*\/postings[^"'\s]*/gi,
    /https?:\/\/api\.lever\.co\/[^"'\s]*/gi,
    /https?:\/\/boards-api\.greenhouse\.io\/[^"'\s]*/gi,
    /https?:\/\/api\.greenhouse\.io\/[^"'\s]*/gi,
    /https?:\/\/api\.smartrecruiters\.com\/[^"'\s]*/gi,
    /https?:\/\/jobs\.smartrecruiters\.com\/[^"'\s]*\/api\/[^"'\s]*/gi,
    /https?:\/\/api\.ashbyhq\.com\/[^"'\s]*/gi,
    /https?:\/\/jobs\.ashbyhq\.com\/[^"'\s]*\/api\/[^"'\s]*/gi,
    /https?:\/\/apply\.workable\.com\/api\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\.workable\.com\/[^"'\s]*\/api\/[^"'\s]*/gi,
    /https?:\/\/api\.bamboohr\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\.bamboohr\.com\/[^"'\s]*\/api\/[^"'\s]*/gi,
    /https?:\/\/api\.jobvite\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\.myworkdayjobs\.com\/[^"'\s]*\/api\/[^"'\s]*/gi,

    // Generic API patterns
    /https?:\/\/[^"'\s]*\/api\/v?\d+\/[^"'\s]*(?:job|career|posting|position|opening|opportunity)[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/api\/[^"'\s]*(?:job|career|posting|position|opening|opportunity)[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/v?\d+\/[^"'\s]*(?:job|career|posting|position)[^"'\s]*\.json/gi,
    /https?:\/\/[^"'\s]*\/(?:job|career|posting|position)[^"'\s]*\.json/gi
  ];

  // Search for API patterns in HTML
  apiPatterns.forEach(pattern => {
    const matches = html.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const cleanUrl = match
          .replace(/['"<>]/g, '')
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
    /\/image\/api\//i, /\/images\/api\//i,
    /diffbot\.com\/image/i,
    /\/media\/api\//i, /\/cdn\/api\//i
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

  console.log('[API Detection] Found API endpoints in HTML:', apiList.length > 0 ? apiList.length : 'None');

  return bestAPI || null;
}

console.log('[Background] ════════════════════════════════════════════════');
console.log('[Background] 🚀 LOADED - VERSION 2.1.0-FETCH-BASED-DETECTION');
console.log('[Background] ✅ Career page API detection: ENABLED (FETCH-BASED)');
console.log('[Background] ✅ No permission issues - works on all domains!');
console.log('[Background] ════════════════════════════════════════════════');
