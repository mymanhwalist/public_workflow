/**
 * Career Page Inspector - Background Service Worker
 */

console.log('[Background] Career Page Inspector loading...');

let inspectionInProgress = false;
let shouldStopInspection = false;
let currentPages = [];

let scrapingInProgress = false;
let shouldStopScraping = false;
let currentScrapingPages = [];

// Message listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'startBatchInspection') {
    if (inspectionInProgress) {
      sendResponse({ success: false, error: 'Already in progress' });
      return true; // Keep channel open
    }

    inspectionInProgress = true;
    shouldStopInspection = false;
    currentPages = request.pages || [];

    // Start async inspection
    batchInspectPages(currentPages).then(() => {
      inspectionInProgress = false;
    }).catch(error => {
      inspectionInProgress = false;
      console.error('[Background] Inspection error:', error);
      chrome.runtime.sendMessage({
        action: 'inspectionLog',
        message: `Error: ${error.message}`,
        type: 'error'
      }).catch(() => {}); // Popup might be closed
    });

    sendResponse({ success: true, started: true });
    return true; // Keep channel open for async operation
  }

  if (request.action === 'stopInspection') {
    shouldStopInspection = true;
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'startBatchScraping') {
    if (scrapingInProgress) {
      sendResponse({ success: false, error: 'Already in progress' });
      return true; // Keep channel open
    }

    scrapingInProgress = true;
    shouldStopScraping = false;
    currentScrapingPages = request.pages || [];

    // Start async scraping
    batchScrapePages(currentScrapingPages).then(() => {
      scrapingInProgress = false;
    }).catch(error => {
      scrapingInProgress = false;
      console.error('[Background] Scraping error:', error);
      chrome.runtime.sendMessage({
        action: 'inspectionLog',
        message: `Error: ${error.message}`,
        type: 'error'
      }).catch(() => {});
    });

    sendResponse({ success: true, started: true });
    return true; // Keep channel open for async operation
  }

  if (request.action === 'stopScraping') {
    shouldStopScraping = true;
    sendResponse({ success: true });
    return true;
  }

  return false;
});

/**
 * Batch inspect career pages
 */
async function batchInspectPages(pages) {
  const total = pages.length;
  console.log(`[Background] Starting batch inspection of ${total} pages`);

  for (let i = 0; i < pages.length; i++) {
    if (shouldStopInspection) {
      console.log(`[Background] Stopped at ${i}/${total}`);
      chrome.runtime.sendMessage({
        action: 'inspectionStopped',
        count: i
      }).catch(() => {}); // Popup might be closed
      shouldStopInspection = false;
      return;
    }

    const page = pages[i];
    let tab = null;
    let windowId = null;
    let newTabListener = null;
    let navigationListener = null;
    let messageListener = null; // Track message listener for cleanup
    let createdTabIds = []; // Track ONLY tabs we create

    try {
      // Log progress
      sendLog(`Opening: ${page.company_name} - Navigate to career page...`, 'info');

      // Validate URL before opening
      if (!page.website_url || !page.website_url.startsWith('http')) {
        console.log(`[Background] Invalid URL for ${page.company_name}: ${page.website_url}`);
        sendLog(`✗ ${page.company_name}: Invalid URL, skipping`, 'error');
        await saveSkippedCompany(page.id, page.company_name);
        continue; // Skip to next company
      }

      // Open tab with website_url
      tab = await chrome.tabs.create({ url: page.website_url, active: true });
      windowId = tab.windowId;
      createdTabIds.push(tab.id); // Track this tab

      // Wait for page load
      await waitForTabLoad(tab.id);

      // Check if page loaded successfully (not an error page)
      const tabInfo = await chrome.tabs.get(tab.id);
      if (tabInfo.url.startsWith('chrome-error://')) {
        console.log(`[Background] Error page detected for ${page.company_name}`);
        sendLog(`✗ ${page.company_name}: Website error, skipping`, 'error');
        await saveSkippedCompany(page.id, page.company_name);

        // Close the tab before skipping
        try {
          await chrome.tabs.remove(createdTabIds);
        } catch (e) {
          console.warn('[Background] Could not close tab:', e);
        }

        continue; // Skip to next company
      }

      // Ensure content script is loaded
      try {
        await ensureContentScriptLoaded(tab.id);
      } catch (injectionError) {
        console.log(`[Background] Content script injection failed for ${page.company_name}:`, injectionError.message);
        sendLog(`✗ ${page.company_name}: Cannot load page, moving to next`, 'error');
        // Auto-skip disabled - not marking as skipped in database
        // await saveSkippedCompany(page.id, page.company_name);

        // Close the tab before moving to next
        try {
          await chrome.tabs.remove(createdTabIds);
        } catch (e) {
          console.warn('[Background] Could not close tab:', e);
        }

        continue; // Skip to next company
      }

      // Send page info to content script (to show overlay button)
      await chrome.tabs.sendMessage(tab.id, {
        action: 'initInspector',
        pageId: page.id,
        companyName: page.company_name
      });

      // Listen for NEW TABS opened during navigation
      // (in case "Careers" link opens in new tab)
      newTabListener = async (newTab) => {
        // Only handle tabs in the same window
        if (newTab.windowId === windowId && !createdTabIds.includes(newTab.id)) {
          console.log('[Background] New tab detected, injecting inspector...');

          // Track this new tab
          createdTabIds.push(newTab.id);

          // Wait for new tab to load
          await waitForTabLoad(newTab.id);

          // Inject content script
          await ensureContentScriptLoaded(newTab.id);

          // Send page info to show overlay button
          await chrome.tabs.sendMessage(newTab.id, {
            action: 'initInspector',
            pageId: page.id,
            companyName: page.company_name
          });
        }
      };

      chrome.tabs.onCreated.addListener(newTabListener);

      // Listen for NAVIGATION in same tab (when career link loads in same tab)
      // Track last URL to avoid duplicate injections
      const lastUrls = new Map();
      let navigationCount = 0;

      navigationListener = async (details) => {
        // Only handle our created tabs, main frame only
        if (createdTabIds.includes(details.tabId) && details.frameId === 0) {

          // Skip if same URL (avoid duplicate injections)
          const lastUrl = lastUrls.get(details.tabId);
          if (lastUrl === details.url) {
            console.log('[Background] Same URL, skipping duplicate injection');
            return;
          }
          lastUrls.set(details.tabId, details.url);

          navigationCount++;
          console.log(`[Background] Navigation #${navigationCount}: ${details.url}`);
          sendLog(`Page ${navigationCount}: ${new URL(details.url).hostname}`, 'info');

          // Wait for page to fully settle
          await sleep(2000);

          try {
            // Check if tab still exists
            const tab = await chrome.tabs.get(details.tabId);
            if (!tab) {
              console.log('[Background] Tab no longer exists, skipping injection');
              return;
            }

            // Re-inject content script
            console.log('[Background] Re-injecting content script...');
            await ensureContentScriptLoaded(details.tabId);

            // Wait a bit before sending message
            await sleep(500);

            // Re-send page info to show overlay button
            await chrome.tabs.sendMessage(details.tabId, {
              action: 'initInspector',
              pageId: page.id,
              companyName: page.company_name
            });

            console.log('[Background] ✓ Content script re-injected successfully');
          } catch (e) {
            console.error('[Background] Failed to re-inject on navigation:', e);
            sendLog(`Navigation error: ${e.message}`, 'error');
          }
        }
      };

      chrome.webNavigation.onCompleted.addListener(navigationListener);

      // Wait for user to navigate and click "Save Career Page" or "Skip"
      // The content script will send back the inspection result or skip message
      let resolved = false; // Prevent race condition
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            // CRITICAL: Remove listener on timeout to prevent listener buildup
            if (messageListener) {
              chrome.runtime.onMessage.removeListener(messageListener);
              console.log('[Background] ⏱️ Timeout - listener removed');
            }
            reject(new Error('User did not save career page (5 min timeout)'));
          }
        }, 300000); // 5 minute timeout

        // Listen for save or skip event from content script
        messageListener = (message, sender, sendResponse) => {
          // Only log relevant messages to reduce noise
          if (message.action === 'careerPageSaved' || message.action === 'companySkipped') {
            console.log('[Background] Received message:', message.action, 'pageId:', message.pageId, 'expected:', page.id);
          }

          if (message.action === 'careerPageSaved' && message.pageId === page.id) {
            if (!resolved) {
              resolved = true;
              console.log('[Background] ✓ Matched! Processing save...');
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(messageListener);
              sendResponse({ success: true, received: true });
              resolve(message);
            }
            return true; // Keep message channel open for async response
          } else if (message.action === 'companySkipped' && message.pageId === page.id) {
            if (!resolved) {
              resolved = true;
              console.log('[Background] ⏭️ Company skipped by user');
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(messageListener);
              sendResponse({ success: true, skipped: true });
              resolve({ success: false, skipped: true });
            }
            return true; // Keep message channel open for async response
          }
          // Removed mismatch logging to reduce console noise
        };

        console.log('[Background] Waiting for careerPageSaved or companySkipped message for page:', page.id);
        chrome.runtime.onMessage.addListener(messageListener);
      });

      console.log('[Background] Received response:', response);

      if (response && response.success) {
        const careerPageUrls = response.careerPageUrls || [response.careerPageUrl];
        const inspection = response.inspection;

        console.log('[Background] Processing successful save...');

        // Save career page URLs (multiple) and inspection to Supabase
        await saveCareerPageAndInspection(page.id, careerPageUrls, inspection);

        const pageCount = careerPageUrls.length;
        sendLog(`✓ ${page.company_name}: Saved ${pageCount} page${pageCount > 1 ? 's' : ''}!`, 'success');

        // Wait for user to manually trigger scraping or skip
        console.log('[Background] Waiting for user to scrape job data...');
        sendLog(`Ready to scrape! Click "Scrape Now" or "Skip to Next Company"`, 'info');

        // Wait for scraping trigger or skip message
        let scrapingMessageListener = null; // Declare outside to avoid scope issues
        let scrapingResolved = false; // Prevent race condition

        const scrapingResponse = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (!scrapingResolved) {
              scrapingResolved = true;
              if (scrapingMessageListener) {
                chrome.runtime.onMessage.removeListener(scrapingMessageListener);
                console.log('[Background] ⏱️ Scraping timeout - listener removed');
              }
              reject(new Error('User did not trigger scraping (5 min timeout)'));
            }
          }, 300000); // 5 minute timeout

          // Listen for scraping trigger or skip
          scrapingMessageListener = (message, sender, sendResponse) => {
            if (message.action === 'triggerScraping' && message.pageId === page.id) {
              if (!scrapingResolved) {
                scrapingResolved = true;
                console.log('[Background] ✓ Scraping triggered by user');
                clearTimeout(timeout);
                chrome.runtime.onMessage.removeListener(scrapingMessageListener);
                sendResponse({ success: true, received: true });
                resolve({ action: 'scrape', data: message });
              }
              return true; // Keep message channel open for async response
            } else if (message.action === 'skipScraping' && message.pageId === page.id) {
              if (!scrapingResolved) {
                scrapingResolved = true;
                console.log('[Background] ⏭️ Scraping skipped by user');
                clearTimeout(timeout);
                chrome.runtime.onMessage.removeListener(scrapingMessageListener);
                sendResponse({ success: true, skipped: true });
                resolve({ action: 'skip' });
              }
              return true; // Keep message channel open for async response
            }
          };

          console.log('[Background] Waiting for triggerScraping or skipScraping message for page:', page.id);
          chrome.runtime.onMessage.addListener(scrapingMessageListener);
        });

        console.log('[Background] Scraping response:', scrapingResponse);

        if (scrapingResponse && scrapingResponse.action === 'scrape') {
          // User wants to scrape - perform scraping now
          try {
            sendLog(`🔄 Scraping job data for ${page.company_name}...`, 'info');

            // Get the currently active tab (user should be on the career page)
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];

            if (!activeTab) {
              throw new Error('No active tab found');
            }

            // Ensure content script is loaded
            await ensureContentScriptLoaded(activeTab.id);

            // Scrape job table from current page
            const scrapeResponse = await chrome.tabs.sendMessage(activeTab.id, {
              action: 'scrapeJobTable',
              pageId: page.id,
              companyName: page.company_name,
              jobTableSelector: inspection.job_table,
              jobItemSelector: inspection.job_item
            });

            if (scrapeResponse && scrapeResponse.success) {
              const jobTableHtml = scrapeResponse.jobTableHtml;
              const firstJobUrl = scrapeResponse.firstJobUrl;
              const apiEndpoint = scrapeResponse.apiEndpoint;

              console.log('[Background] Scraped table HTML length:', jobTableHtml?.length || 0);
              console.log('[Background] First job URL:', firstJobUrl);
              console.log('[Background] API endpoint:', apiEndpoint || 'None detected');

              let jobDetailHtml = null;
              let parsedJobData = null;

              // If we found a job URL, scrape the job detail page
              if (firstJobUrl) {
                try {
                  sendLog(`Opening job detail page...`, 'info');

                  // Open the job detail page in a new tab
                  const jobTab = await chrome.tabs.create({ url: firstJobUrl, active: true });
                  createdTabIds.push(jobTab.id);

                  // Wait for page load
                  await waitForTabLoad(jobTab.id);

                  // Inject content script
                  await ensureContentScriptLoaded(jobTab.id);

                  // Scrape the job detail page
                  const jobDetailResponse = await chrome.tabs.sendMessage(jobTab.id, {
                    action: 'scrapeJobDetail'
                  });

                  if (jobDetailResponse && jobDetailResponse.success) {
                    jobDetailHtml = jobDetailResponse.jobDetailHtml;
                    parsedJobData = jobDetailResponse.parsedJobData;
                    console.log('[Background] Scraped job detail HTML length:', jobDetailHtml?.length || 0);
                    console.log('[Background] Parsed job data:', parsedJobData);

                    // Log apply button info if found
                    if (parsedJobData?.applyButton) {
                      console.log('[Background] ✓ Found apply button:', parsedJobData.applyButton);
                      console.log('[Background] ✓ Apply URL:', parsedJobData.applyUrl || 'Not found');
                    }
                  }

                } catch (error) {
                  console.warn('[Background] Could not scrape job detail page:', error);
                  sendLog(`⚠️ Job detail scraping failed: ${error.message}`, 'error');
                }
              }

              // Save all data to Supabase
              await saveJobTableHtml(page.id, jobTableHtml, jobDetailHtml, apiEndpoint, parsedJobData);

              sendLog(`✓ ${page.company_name}: Scraped and saved!`, 'success');

              // Wait 3 seconds so user can see the success message
              await sleep(3000);

            } else {
              const error = scrapeResponse?.error || 'Unknown error';
              sendLog(`✗ Scraping failed: ${error}`, 'error');

              // Wait 2 seconds so user can see the error
              await sleep(2000);
            }

          } catch (error) {
            console.error('[Background] Scraping error:', error);
            sendLog(`✗ Scraping error: ${error.message}`, 'error');
          }

        } else if (scrapingResponse && scrapingResponse.action === 'skip') {
          // User skipped scraping - just continue to next company
          console.log('[Background] Scraping skipped, moving to next company');
          sendLog(`⏭️ ${page.company_name}: Scraping skipped`, 'info');
        }

      } else if (response && response.skipped) {
        console.log('[Background] Company skipped by user');

        // Save NULL values to mark as skipped
        await saveSkippedCompany(page.id, page.company_name);

        sendLog(`⏭️ ${page.company_name}: Skipped and marked`, 'info');
        await sleep(2000); // Brief pause before moving to next
      } else {
        const error = response?.error || 'Unknown error';
        console.log('[Background] Save failed:', error);
        sendLog(`✗ ${page.company_name}: ${error}`, 'error');
      }

    } catch (error) {
      console.error(`[Background] Error on ${page.company_name}:`, error);
      sendLog(`✗ ${page.company_name}: ${error.message}`, 'error');

    } finally {
      // Remove ALL listeners to prevent buildup
      if (messageListener) {
        try {
          chrome.runtime.onMessage.removeListener(messageListener);
          console.log('[Background] ✓ Message listener cleaned up');
        } catch (e) {
          // Listener might already be removed
        }
      }
      if (newTabListener) {
        chrome.tabs.onCreated.removeListener(newTabListener);
      }
      if (navigationListener) {
        chrome.webNavigation.onCompleted.removeListener(navigationListener);
      }

      // Close ONLY the tabs we created (not all tabs in window!)
      if (createdTabIds.length > 0) {
        try {
          console.log(`[Background] Closing ${createdTabIds.length} tabs we created`);

          // Filter out tabs that no longer exist
          const existingTabs = [];
          for (const tabId of createdTabIds) {
            try {
              await chrome.tabs.get(tabId);
              existingTabs.push(tabId);
            } catch (e) {
              console.log(`[Background] Tab ${tabId} already closed`);
            }
          }

          if (existingTabs.length > 0) {
            await chrome.tabs.remove(existingTabs);
            console.log(`[Background] Closed ${existingTabs.length} tabs`);
          }
        } catch (e) {
          console.warn('[Background] Could not close tabs:', e);
        }
      }

      // Human-like delay
      const delay = 2000 + Math.random() * 2000;
      await sleep(delay);

      // Send progress
      chrome.runtime.sendMessage({
        action: 'inspectionProgress',
        progress: {
          current: i + 1,
          total,
          percentage: Math.round(((i + 1) / total) * 100)
        }
      }).catch(() => {}); // Popup might be closed
    }
  }

  // Complete
  chrome.runtime.sendMessage({
    action: 'inspectionComplete',
    count: pages.length
  }).catch(() => {}); // Popup might be closed
}

/**
 * Save career page URLs (multiple) and inspection data to Supabase
 */
async function saveCareerPageAndInspection(pageId, careerPageUrls, inspection) {
  try {
    console.log('[Background] Starting Supabase save...');
    console.log('[Background] Page ID:', pageId);
    console.log('[Background] Career URLs:', careerPageUrls);
    console.log('[Background] Inspection:', inspection);

    const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase not configured');
    }

    console.log('[Background] Supabase URL:', config.supabaseUrl);

    // If multiple URLs, save as JSON string
    // If single URL, save as plain string
    const careerPageValue = careerPageUrls.length === 1
      ? careerPageUrls[0]
      : JSON.stringify(careerPageUrls);

    const payload = {
      career_page_url: careerPageValue,
      job_table: inspection.job_table,
      job_item: inspection.job_item,
      job_page: inspection.job_page,
      job_page_table: inspection.job_page_table,
      api_endpoint: inspection.api_endpoint || null,
      api_endpoint_detail: inspection.api_endpoint_detail || null,
      application_url: inspection.application_url || null,
      ats_provider: inspection.ats_provider || null,
      expand_button_selector: inspection.expand_button_selector || null,
      pagination_type: inspection.pagination_type || null,
      requires_expansion: inspection.requires_expansion || false,
      wait_time_ms: inspection.wait_time_ms || 1000,
      scroll_to_load: inspection.scroll_to_load || false,
      has_multiple_containers: inspection.has_multiple_containers || false,
      navigation_type: inspection.navigation_type || 'link',
      scraping_notes: inspection.scraping_notes || null
    };

    console.log('[Background] Payload:', payload);

    const url = `${config.supabaseUrl}/rest/v1/career_pages?id=eq.${pageId}`;
    console.log('[Background] Request URL:', url);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': config.supabaseKey,
        'Authorization': `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    console.log('[Background] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Background] Error response:', errorText);
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    console.log(`[Background] ✓ PATCH successful (${response.status})`);

    // Verify save by reading back the row
    const verifyUrl = `${config.supabaseUrl}/rest/v1/career_pages?id=eq.${pageId}&select=job_table,career_page_url`;
    const verifyResponse = await fetch(verifyUrl, {
      headers: {
        'apikey': config.supabaseKey,
        'Authorization': `Bearer ${config.supabaseKey}`
      }
    });

    if (verifyResponse.ok) {
      try {
        const verifyData = await verifyResponse.json();
        if (verifyData.length > 0 && verifyData[0].job_table) {
          console.log('[Background] ✓ Verified: job_table =', verifyData[0].job_table);
          console.log('[Background] ✓ Verified: career_page_url =', verifyData[0].career_page_url);
          sendLog(`✓ Verified save in database!`, 'success');
        } else {
          console.warn('[Background] ⚠️ Save might have failed - job_table still null!');
          sendLog(`⚠️ Save verification failed!`, 'error');
        }
      } catch (jsonError) {
        console.error('[Background] JSON parse error during verification:', jsonError);
        sendLog(`⚠️ Verification response invalid`, 'error');
      }
    }

  } catch (error) {
    console.error('[Background] Error saving to Supabase:', error);
    sendLog(`Supabase save error: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Save skipped company to Supabase with NULL values
 */
async function saveSkippedCompany(pageId, companyName) {
  try {
    console.log('[Background] Marking company as skipped:', companyName);

    const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase not configured');
    }

    // Set job_table to 'SKIPPED' so it won't be fetched again
    // Set other fields to NULL
    const payload = {
      career_page_url: null,
      job_table: 'SKIPPED',
      job_item: null,
      job_page: null,
      job_page_table: null
    };

    const url = `${config.supabaseUrl}/rest/v1/career_pages?id=eq.${pageId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': config.supabaseKey,
        'Authorization': `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    console.log('[Background] Skip response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Background] Error response:', errorText);
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    console.log('[Background] ✓ PATCH successful for skip');

    // Verify save by reading back the row
    const verifyUrl = `${config.supabaseUrl}/rest/v1/career_pages?id=eq.${pageId}&select=job_table`;
    const verifyResponse = await fetch(verifyUrl, {
      headers: {
        'apikey': config.supabaseKey,
        'Authorization': `Bearer ${config.supabaseKey}`
      }
    });

    if (verifyResponse.ok) {
      try {
        const verifyData = await verifyResponse.json();
        if (verifyData.length > 0 && verifyData[0].job_table === 'SKIPPED') {
          console.log('[Background] ✓ Verified: job_table = SKIPPED');
          sendLog(`✓ Verified skip saved in database!`, 'success');
        } else {
          console.warn('[Background] ⚠️ Skip might have failed - job_table not SKIPPED!');
          console.warn('[Background] Verify data:', verifyData);
          sendLog(`⚠️ Skip verification failed! job_table = ${verifyData[0]?.job_table}`, 'error');
          throw new Error('Skip verification failed');
        }
      } catch (jsonError) {
        console.error('[Background] JSON parse error during skip verification:', jsonError);
        sendLog(`⚠️ Skip verification response invalid`, 'error');
        throw jsonError;
      }
    } else {
      console.warn('[Background] ⚠️ Could not verify skip save');
      sendLog(`⚠️ Could not verify skip save`, 'error');
    }

    console.log('[Background] ✓ Company marked as skipped in database');

  } catch (error) {
    console.error('[Background] Error marking as skipped:', error);
    sendLog(`Skip save error: ${error.message}`, 'error');
    // Don't throw - continue even if marking fails to avoid breaking the batch process
  }
}

/**
 * Ensure content script is loaded in tab
 */
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    console.log('[Background] Content script already loaded');
  } catch (error) {
    // Content script not loaded, inject it
    console.log('[Background] Content script not loaded, injecting...');

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['inspector.js']
      });

      // Wait longer for script to initialize
      console.log('[Background] Waiting for content script to initialize...');
      await sleep(4000); // Increased from 3s to 4s

      // Try ping multiple times with delays (retry logic)
      for (let attempt = 1; attempt <= 5; attempt++) { // Increased from 3 to 5 attempts
        try {
          await chrome.tabs.sendMessage(tabId, { action: 'ping' });
          console.log(`[Background] ✓ Content script injected successfully (attempt ${attempt})`);
          return; // Success! Exit function
        } catch (pingError) {
          if (attempt < 5) { // Updated to match new attempt count
            console.log(`[Background] Ping attempt ${attempt}/5 failed, retrying in 3s...`);
            await sleep(3000); // Increased from 2s to 3s
          } else {
            console.warn('[Background] All ping attempts failed after 5 attempts');
            throw new Error('Content script injection failed - all ping attempts failed');
          }
        }
      }
    } catch (injectError) {
      console.error('[Background] Failed to inject content script:', injectError);
      // Throw error to let caller handle it (skip the company)
      throw new Error(`Content script injection failed: ${injectError.message}`);
    }
  }
}

/**
 * Wait for tab to load
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let timeout;

    const listener = function(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 2000);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

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
 * Send log message to popup
 */
function sendLog(message, type = 'info') {
  chrome.runtime.sendMessage({
    action: 'inspectionLog',
    message,
    type
  }).catch(() => {
    // Popup might be closed, ignore silently
  });
}

/**
 * Batch scrape job postings from career pages
 */
async function batchScrapePages(pages) {
  const total = pages.length;
  console.log(`[Background] Starting batch scraping of ${total} pages`);

  for (let i = 0; i < pages.length; i++) {
    if (shouldStopScraping) {
      console.log(`[Background] Scraping stopped at ${i}/${total}`);
      chrome.runtime.sendMessage({
        action: 'scrapingStopped',
        count: i
      }).catch(() => {});
      shouldStopScraping = false;
      return;
    }

    const page = pages[i];
    let tab = null;
    let createdTabIds = [];

    try {
      // Log progress
      sendLog(`Scraping: ${page.company_name}...`, 'info');

      // Open career page URL directly
      const careerPageUrl = Array.isArray(page.career_page_url)
        ? JSON.parse(page.career_page_url)[0]
        : page.career_page_url;

      if (!careerPageUrl) {
        sendLog(`✗ ${page.company_name}: No career page URL`, 'error');
        continue;
      }

      tab = await chrome.tabs.create({ url: careerPageUrl, active: true });
      createdTabIds.push(tab.id);

      // Wait for page load
      await waitForTabLoad(tab.id);

      // Inject content script
      await ensureContentScriptLoaded(tab.id);

      // Send scraping request to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'scrapeJobTable',
        pageId: page.id,
        companyName: page.company_name,
        jobTableSelector: page.job_table,
        jobItemSelector: page.job_item
      });

      if (response && response.success) {
        const jobTableHtml = response.jobTableHtml;
        const firstJobUrl = response.firstJobUrl;

        console.log('[Background] Scraped table HTML length:', jobTableHtml?.length || 0);
        console.log('[Background] First job URL:', firstJobUrl);

        let jobDetailHtml = null;

        // If we found a job URL, scrape the job detail page
        if (firstJobUrl) {
          try {
            sendLog(`Opening job detail page...`, 'info');

            // Open the job detail page in a new tab
            const jobTab = await chrome.tabs.create({ url: firstJobUrl, active: true });
            createdTabIds.push(jobTab.id);

            // Wait for page load
            await waitForTabLoad(jobTab.id);

            // Inject content script
            await ensureContentScriptLoaded(jobTab.id);

            // Scrape the job detail page
            const jobDetailResponse = await chrome.tabs.sendMessage(jobTab.id, {
              action: 'scrapeJobDetail'
            });

            if (jobDetailResponse && jobDetailResponse.success) {
              jobDetailHtml = jobDetailResponse.jobDetailHtml;
              console.log('[Background] Scraped job detail HTML length:', jobDetailHtml?.length || 0);
            }

          } catch (error) {
            console.warn('[Background] Could not scrape job detail page:', error);
            sendLog(`⚠️ Job detail scraping failed: ${error.message}`, 'error');
          }
        }

        // Save both to Supabase as JSON
        await saveJobTableHtml(page.id, jobTableHtml, jobDetailHtml);

        sendLog(`✓ ${page.company_name}: Scraped successfully!`, 'success');

        await sleep(2000); // Pause before closing

      } else {
        const error = response?.error || 'Unknown error';
        sendLog(`✗ ${page.company_name}: ${error}`, 'error');
      }

    } catch (error) {
      console.error(`[Background] Scraping error on ${page.company_name}:`, error);
      sendLog(`✗ ${page.company_name}: ${error.message}`, 'error');

    } finally {
      // Close tabs
      if (createdTabIds.length > 0) {
        try {
          const existingTabs = [];
          for (const tabId of createdTabIds) {
            try {
              await chrome.tabs.get(tabId);
              existingTabs.push(tabId);
            } catch (e) {
              console.log(`[Background] Tab ${tabId} already closed`);
            }
          }
          if (existingTabs.length > 0) {
            await chrome.tabs.remove(existingTabs);
          }
        } catch (e) {
          console.warn('[Background] Could not close tabs:', e);
        }
      }

      // Human-like delay
      const delay = 1000 + Math.random() * 1000;
      await sleep(delay);

      // Send progress
      chrome.runtime.sendMessage({
        action: 'scrapingProgress',
        progress: {
          current: i + 1,
          total,
          percentage: Math.round(((i + 1) / total) * 100)
        }
      }).catch(() => {});
    }
  }

  // Complete
  chrome.runtime.sendMessage({
    action: 'scrapingComplete',
    count: pages.length
  }).catch(() => {});
}

/**
 * Save scraped job table HTML and job detail HTML to Supabase
 */
async function saveJobTableHtml(pageId, jobTableHtml, jobDetailHtml = null, apiEndpoint = null, parsedJobData = null) {
  try {
    console.log('[Background] Saving scraped data to Supabase...');
    console.log('[Background] Page ID:', pageId);
    console.log('[Background] Table HTML length:', jobTableHtml?.length || 0);
    console.log('[Background] Job detail HTML length:', jobDetailHtml?.length || 0);
    console.log('[Background] API endpoint:', apiEndpoint || 'None');
    console.log('[Background] Parsed job data:', parsedJobData);

    const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase not configured');
    }

    // Save HTML as JSON object
    const scrapedData = {
      table_html: jobTableHtml,
      job_detail_html: jobDetailHtml
    };

    // Build payload with all new fields
    const payload = {
      job_page_table: JSON.stringify(scrapedData)
    };

    // Add API endpoint if detected
    if (apiEndpoint) {
      payload.api_endpoint = apiEndpoint;
    }

    // Add parsed job data as JSON if available
    if (parsedJobData) {
      payload.parsed_job_data = JSON.stringify(parsedJobData);
    }

    const url = `${config.supabaseUrl}/rest/v1/career_pages?id=eq.${pageId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': config.supabaseKey,
        'Authorization': `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    console.log('[Background] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Background] Error response:', errorText);
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    const detailStatus = jobDetailHtml ? `+ job detail (${jobDetailHtml.length} chars)` : '(no job detail)';
    const apiStatus = apiEndpoint ? `+ API endpoint` : '';
    const applyButtonStatus = parsedJobData?.applyButton ? `+ apply button` : '';
    console.log(`[Background] ✓ Saved table (${jobTableHtml.length} chars) ${detailStatus} ${apiStatus} ${applyButtonStatus}`);

  } catch (error) {
    console.error('[Background] Error saving scraped data:', error);
    throw error;
  }
}

console.log('[Background] Career Page Inspector loaded successfully');
