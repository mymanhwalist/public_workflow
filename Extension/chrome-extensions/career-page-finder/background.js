/**
 * Career Page Finder - Background Service Worker
 * Simple extension to find and save career page URLs
 */

console.log('[Background] Career Page Finder loading...');

let collectionInProgress = false;
let shouldStopCollection = false;
let currentCompanies = [];

// Keep service worker alive during active operations
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    console.log('[Background] Keep-alive tick');
  }, 20000); // Every 20 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Track saved URLs per company during collection (for multi-URL support)
let currentCompanySavedUrls = [];
let currentCompanySavedApis = [];

// Message listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle ping to wake up service worker
  if (request.action === 'ping') {
    console.log('[Background] Ping received');
    sendResponse({ pong: true });
    return true;
  }

  // Handle API validation requests from content script
  if (request.action === 'validateAPI') {
    console.log('[Background] Received validateAPI request for:', request.apiUrl);
    startKeepAlive(); // Keep service worker alive during validation
    validateAPIFromBackground(request.apiUrl)
      .then(result => {
        console.log('[Background] Sending validation result:', result);
        stopKeepAlive();
        sendResponse(result);
      })
      .catch(error => {
        console.error('[Background] Validation error:', error);
        stopKeepAlive();
        sendResponse({ valid: false, jobCount: 0, error: error.message || 'Unknown error' });
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'startBatchCollection') {
    if (collectionInProgress) {
      sendResponse({ success: false, error: 'Already in progress' });
      return true;
    }

    collectionInProgress = true;
    shouldStopCollection = false;
    currentCompanies = request.companies || [];

    // Start async collection
    startKeepAlive(); // Keep service worker alive during collection
    batchCollectCareerPages(currentCompanies).then(() => {
      collectionInProgress = false;
      stopKeepAlive();
    }).catch(error => {
      collectionInProgress = false;
      stopKeepAlive();
      console.error('[Background] Collection error:', error);
      chrome.runtime.sendMessage({
        action: 'collectionLog',
        message: `Error: ${error.message}`,
        type: 'error'
      }).catch(() => {});
    });

    sendResponse({ success: true, started: true });
    return true;
  }

  if (request.action === 'stopCollection') {
    shouldStopCollection = true;
    sendResponse({ success: true });
    return true;
  }

  return false;
});

/**
 * Batch collect career page URLs
 */
async function batchCollectCareerPages(companies) {
  const total = companies.length;
  console.log(`[Background] Starting batch collection of ${total} companies`);

  for (let i = 0; i < companies.length; i++) {
    console.log(`[Background] ========== Starting company ${i + 1}/${total} ==========`);

    if (shouldStopCollection) {
      console.log(`[Background] Stopped at ${i}/${total}`);
      chrome.runtime.sendMessage({
        action: 'collectionStopped',
        count: i
      }).catch(() => {});
      shouldStopCollection = false;
      return;
    }

    const company = companies[i];
    console.log(`[Background] Company: ${company.company_name}, ID: ${company.id}`);

    // Reset saved URLs for this company (multi-URL support)
    currentCompanySavedUrls = [];
    currentCompanySavedApis = [];

    let tab = null;
    let messageListener = null;
    let navigationListener = null;
    let newTabListener = null;
    let addedUrlListener = null;
    let tabClosedListener = null;
    let createdTabIds = [];
    let navigationInProgress = false;
    let lastNavigationTime = Date.now();
    let newTabProcessing = false;
    let shouldCloseTabs = false; // Only close tabs when intentionally done
    let errorHandled = false; // Set to true when we've already handled an error and should skip finally cleanup

    try {
      // Log progress
      sendLog(`Opening: ${company.company_name} - Navigate to career page...`, 'info');

      // Validate URL before opening
      if (!company.website_url || !company.website_url.startsWith('http')) {
        console.log(`[Background] Invalid URL for ${company.company_name}: ${company.website_url}`);
        sendLog(`✗ ${company.company_name}: Invalid URL, skipping`, 'error');
        // Don't save as SKIPPED, leave as NULL to retry later
        continue;
      }

      // Normalize URL (upgrade http to https to avoid redirect issues)
      let websiteUrl = company.website_url;
      if (websiteUrl.startsWith('http://')) {
        websiteUrl = websiteUrl.replace('http://', 'https://');
        console.log(`[Background] Upgraded to HTTPS: ${websiteUrl}`);
      }

      // Open tab with website_url
      tab = await chrome.tabs.create({ url: websiteUrl, active: true });
      createdTabIds.push(tab.id);

      // Wait for page load
      try {
        await waitForTabLoad(tab.id);
      } catch (loadError) {
        errorHandled = true;
        console.log(`[Background] Tab load failed for ${company.company_name}:`, loadError.message);
        sendLog(`✗ ${company.company_name}: ${loadError.message}`, 'error');
        try { await chrome.tabs.remove(createdTabIds); } catch (e) {}
        await sleep(200);
        continue;
      }

      // Check if page loaded successfully (not an error page)
      let tabInfo;
      try {
        tabInfo = await chrome.tabs.get(tab.id);
      } catch (e) {
        errorHandled = true;
        console.log(`[Background] Tab no longer exists for ${company.company_name}`);
        sendLog(`✗ ${company.company_name}: Tab closed`, 'error');
        continue;
      }

      const isErrorPage = tabInfo.url.startsWith('chrome-error://') ||
                          tabInfo.url.startsWith('chrome://') ||
                          tabInfo.url === 'about:blank';

      if (isErrorPage) {
        errorHandled = true;
        console.log(`[Background] Error page for ${company.company_name}: ${tabInfo.url}`);
        sendLog(`✗ ${company.company_name}: Website unreachable`, 'error');
        try { await chrome.tabs.remove(createdTabIds); } catch (e) {}
        await sleep(200);
        continue;
      }

      // Ensure content script is loaded
      try {
        await ensureContentScriptLoaded(tab.id);
      } catch (injectionError) {
        errorHandled = true;

        const errMsg = injectionError.message || '';
        const isErrorPageMsg = errMsg.includes('error page') || errMsg.includes('Cannot access');
        const logMsg = isErrorPageMsg
          ? `✗ ${company.company_name}: Website unreachable`
          : `✗ ${company.company_name}: Site blocks scripts`;

        console.log(`[Background] ${logMsg}:`, errMsg);
        sendLog(logMsg, 'error');

        try { await chrome.tabs.remove(createdTabIds); } catch (e) {}
        await sleep(200);
        continue;
      }

      // Send company info to content script (to show save button)
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'initFinder',
          companyId: company.id,
          companyName: company.company_name,
          savedCareerUrls: currentCompanySavedUrls,
          savedApiEndpoints: currentCompanySavedApis
        });
      } catch (msgError) {
        // Set flag FIRST to prevent retry logic in finally block
        errorHandled = true;

        console.log(`[Background] Failed to init finder for ${company.company_name}:`, msgError.message);
        sendLog(`✗ ${company.company_name}: Page not responding - skipping`, 'warning');

        try {
          await chrome.tabs.remove(createdTabIds);
        } catch (e) {}

        await sleep(300);
        continue;
      }

      // Listen for careerPageAdded messages (when user saves a URL or scans for API)
      addedUrlListener = (message, sender, sendResponse) => {
        if (message.action === 'careerPageAdded' && message.companyId === company.id) {
          try {
            currentCompanySavedUrls = message.savedCareerUrls || [];
            currentCompanySavedApis = message.savedApiEndpoints || [];

            // Log appropriate message based on what was added
            if (message.careerPageUrl) {
              const urlPath = new URL(message.careerPageUrl).pathname;
              console.log('[Background] URL added:', message.careerPageUrl);
              sendLog(`Added: ${urlPath} (${currentCompanySavedUrls.length} URLs, ${currentCompanySavedApis.length} APIs)`, 'success');
            } else if (message.apiEndpoint) {
              console.log('[Background] API added:', message.apiEndpoint);
              sendLog(`API found: ${currentCompanySavedApis.length} API(s)`, 'success');
            }

            console.log('[Background] Current state - URLs:', currentCompanySavedUrls.length, 'APIs:', currentCompanySavedApis.length);
            sendResponse({ success: true });
          } catch (e) {
            console.error('[Background] Error in careerPageAdded:', e);
            sendResponse({ success: true });
          }
          return true;
        }
        return false; // IMPORTANT: let other listeners handle non-matching messages
      };
      chrome.runtime.onMessage.addListener(addedUrlListener);

      // Listen for NEW TABS opened during navigation (e.g., "Careers" opens in new tab)
      const windowId = tab.windowId;

      newTabListener = async (newTab) => {
        // Only handle tabs in the same window
        if (newTab.windowId === windowId && !createdTabIds.includes(newTab.id)) {
          console.log('[Background] New tab detected, injecting finder...');

          // Track this new tab and mark processing
          createdTabIds.push(newTab.id);
          newTabProcessing = true;
          lastNavigationTime = Date.now();

          try {
            // Wait for new tab to load
            await waitForTabLoad(newTab.id);

            // Check if tab still exists
            try {
              await chrome.tabs.get(newTab.id);
            } catch (e) {
              console.log('[Background] New tab no longer exists');
              newTabProcessing = false;
              return;
            }

            // Inject content script
            await ensureContentScriptLoaded(newTab.id);

            // Send company info to show overlay button (include saved URLs)
            await chrome.tabs.sendMessage(newTab.id, {
              action: 'initFinder',
              companyId: company.id,
              companyName: company.company_name,
              savedCareerUrls: currentCompanySavedUrls,
              savedApiEndpoints: currentCompanySavedApis
            });

            console.log('[Background] ✓ New tab processed successfully');
            console.log('[Background] Passed saved URLs:', currentCompanySavedUrls.length);
          } catch (e) {
            console.error('[Background] Error processing new tab:', e);
          } finally {
            newTabProcessing = false;
            lastNavigationTime = Date.now();
          }
        }
      };

      chrome.tabs.onCreated.addListener(newTabListener);

      // Listen for NAVIGATION in same tab (when career link loads in same tab)
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

          // Mark navigation in progress
          navigationInProgress = true;
          lastNavigationTime = Date.now();

          navigationCount++;
          console.log(`[Background] Navigation #${navigationCount}: ${details.url}`);
          try {
            sendLog(`Page ${navigationCount}: ${new URL(details.url).hostname}`, 'info');
          } catch (e) {
            sendLog(`Page ${navigationCount}: navigated`, 'info');
          }

          // Wait for page to settle (reduced from 2000ms)
          await sleep(500);

          try {
            // Check if tab still exists
            try {
              await chrome.tabs.get(details.tabId);
            } catch (tabError) {
              console.log('[Background] Tab no longer exists, skipping injection');
              navigationInProgress = false;
              return;
            }

            // Re-inject content script
            console.log('[Background] Re-injecting content script...');
            await ensureContentScriptLoaded(details.tabId);

            // Brief wait before sending message (reduced from 500ms)
            await sleep(100);

            // Re-send company info to show overlay button (include saved URLs)
            await chrome.tabs.sendMessage(details.tabId, {
              action: 'initFinder',
              companyId: company.id,
              companyName: company.company_name,
              savedCareerUrls: currentCompanySavedUrls,
              savedApiEndpoints: currentCompanySavedApis
            });

            console.log('[Background] ✓ Content script re-injected successfully');
            console.log('[Background] Passed saved URLs:', currentCompanySavedUrls.length);
          } catch (e) {
            console.error('[Background] Failed to re-inject on navigation:', e);
            sendLog(`Navigation error: ${e.message}`, 'error');
          } finally {
            navigationInProgress = false;
            lastNavigationTime = Date.now();
          }
        }
      };

      chrome.webNavigation.onCompleted.addListener(navigationListener);

      // Wait for user to navigate and click "Save Career Page" or "Skip"
      let resolved = false;

      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            shouldCloseTabs = true;
            if (messageListener) {
              chrome.runtime.onMessage.removeListener(messageListener);
            }
            if (tabClosedListener) {
              chrome.tabs.onRemoved.removeListener(tabClosedListener);
            }
            console.log('[Background] ⏱️ Timeout - listener removed');
            reject(new Error('User did not save career page (5 min timeout)'));
          }
        }, 300000); // 5 minute timeout

        // Listen for tab being closed (by website or user)
        tabClosedListener = (removedTabId) => {
          if (createdTabIds.includes(removedTabId) && !resolved) {
            console.log('[Background] ⚠️ Tab closed unexpectedly:', removedTabId);
            resolved = true;
            errorHandled = true;
            clearTimeout(timeout);
            if (messageListener) {
              chrome.runtime.onMessage.removeListener(messageListener);
            }
            chrome.tabs.onRemoved.removeListener(tabClosedListener);
            reject(new Error('Tab closed by website or user'));
          }
        };
        chrome.tabs.onRemoved.addListener(tabClosedListener);

        // Listen for save or skip event from content script
        messageListener = (message, sender, sendResponse) => {
          if (message.action === 'careerPageSaved' && message.companyId === company.id) {
            if (!resolved) {
              resolved = true;
              shouldCloseTabs = true;
              console.log('[Background] ✓ Career page saved');
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(messageListener);
              if (tabClosedListener) {
                chrome.tabs.onRemoved.removeListener(tabClosedListener);
              }
              sendResponse({ success: true, received: true });
              resolve(message);
            }
            return true;
          } else if (message.action === 'companySkipped' && message.companyId === company.id) {
            if (!resolved) {
              resolved = true;
              shouldCloseTabs = true;
              console.log('[Background] ⏭️ Company skipped by user');
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(messageListener);
              if (tabClosedListener) {
                chrome.tabs.onRemoved.removeListener(tabClosedListener);
              }
              sendResponse({ success: true, skipped: true });
              resolve({ success: false, skipped: true });
            }
            return true;
          }
          return false; // IMPORTANT: let other listeners handle non-matching messages
        };

        console.log('[Background] Waiting for careerPageSaved or companySkipped message for company:', company.id);
        chrome.runtime.onMessage.addListener(messageListener);
      });

      console.log('[Background] Received response:', response);

      if (response && response.success) {
        // Handle array of URLs (multi-URL support)
        const careerPageUrls = response.careerPageUrls || [response.careerPageUrl];
        const apiEndpoints = response.apiEndpoints || (response.apiEndpoint ? [response.apiEndpoint] : []);

        console.log('[Background] Saving career page URLs and API endpoints...');
        console.log('[Background] Career URLs:', careerPageUrls);
        console.log('[Background] API endpoints:', apiEndpoints);

        // Save career page URLs and API endpoints to Supabase as JSON arrays
        await saveCareerPageUrls(company.id, careerPageUrls, apiEndpoints);

        const urlCount = careerPageUrls.length;
        const apiCount = apiEndpoints.length;
        sendLog(`✓ ${company.company_name}: Saved ${urlCount} URL${urlCount > 1 ? 's' : ''} + ${apiCount} API${apiCount !== 1 ? 's' : ''}!`, 'success');

      } else if (response && response.skipped) {
        console.log('[Background] Company skipped by user');

        // Save as "TODO" so we know it was reviewed but needs manual work
        await saveCareerPageUrls(company.id, ['TODO'], []);
        sendLog(`⏭️ ${company.company_name}: Marked as TODO`, 'info');
      } else {
        const error = response?.error || 'Unknown error';
        console.log('[Background] Save failed:', error);
        sendLog(`✗ ${company.company_name}: ${error}`, 'error');
      }

    } catch (error) {
      console.error(`[Background] Error on ${company.company_name}:`, error);

      const errorMsg = error.message.toLowerCase();

      // Errors that should close tabs and move on
      const shouldSkipErrors = [
        'timeout',
        'user did not save',
        'error page',
        'showing error',
        'not exist',
        'no tab',
        'cannot access',
        'blocked',
        'refused',
        'closed',
        'crashed',
        'killed'
      ];

      const isSkippableError = shouldSkipErrors.some(e => errorMsg.includes(e));

      if (isSkippableError) {
        shouldCloseTabs = true;
        errorHandled = true;
        sendLog(`✗ ${company.company_name}: ${error.message} - will retry later`, 'error');

        // Close tabs immediately for these errors
        if (createdTabIds.length > 0) {
          try {
            await chrome.tabs.remove(createdTabIds);
          } catch (e) {}
        }
      } else {
        // For unknown errors, log but also close and move on
        // (Changed from keeping tabs open, which caused stuck states)
        console.log('[Background] Unknown error - closing tabs and moving on');
        sendLog(`✗ ${company.company_name}: ${error.message}`, 'error');
        shouldCloseTabs = true;
        errorHandled = true;

        if (createdTabIds.length > 0) {
          try {
            await chrome.tabs.remove(createdTabIds);
          } catch (e) {}
        }
      }

    } finally {
      // Remove listeners
      if (messageListener) {
        try {
          chrome.runtime.onMessage.removeListener(messageListener);
          console.log('[Background] ✓ Message listener cleaned up');
        } catch (e) {
          // Already removed
        }
      }
      if (tabClosedListener) {
        try {
          chrome.tabs.onRemoved.removeListener(tabClosedListener);
          console.log('[Background] ✓ Tab closed listener cleaned up');
        } catch (e) {
          // Already removed
        }
      }
      if (navigationListener) {
        try {
          chrome.webNavigation.onCompleted.removeListener(navigationListener);
          console.log('[Background] ✓ Navigation listener cleaned up');
        } catch (e) {
          // Already removed
        }
      }
      if (newTabListener) {
        try {
          chrome.tabs.onCreated.removeListener(newTabListener);
          console.log('[Background] ✓ New tab listener cleaned up');
        } catch (e) {
          // Already removed
        }
      }
      if (addedUrlListener) {
        try {
          chrome.runtime.onMessage.removeListener(addedUrlListener);
          console.log('[Background] ✓ Added URL listener cleaned up');
        } catch (e) {
          // Already removed
        }
      }

      // Wait for any pending navigation or new tab processing to complete
      if (navigationInProgress || newTabProcessing) {
        console.log('[Background] Waiting for pending navigation to complete...');
        const maxWait = 10000; // Max 10 seconds
        const startWait = Date.now();

        while ((navigationInProgress || newTabProcessing) && (Date.now() - startWait) < maxWait) {
          await sleep(500);
        }

        if (navigationInProgress || newTabProcessing) {
          console.log('[Background] Navigation still in progress after timeout, proceeding anyway');
        } else {
          console.log('[Background] Navigation completed');
        }
      }

      // Only close tabs if user explicitly saved/skipped or timeout occurred
      if (shouldCloseTabs) {
        // Brief grace period after navigation (reduced from 3000ms)
        const timeSinceLastNav = Date.now() - lastNavigationTime;
        const gracePeriod = 500;
        if (timeSinceLastNav < gracePeriod) {
          const waitTime = gracePeriod - timeSinceLastNav;
          console.log(`[Background] Waiting ${waitTime}ms grace period...`);
          await sleep(waitTime);
        }

        // Close tabs
        if (createdTabIds.length > 0) {
          try {
            console.log(`[Background] Closing ${createdTabIds.length} tabs`);

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

        // Brief delay between companies (reduced from 2-4s)
        const delay = 300 + Math.random() * 400;
        console.log(`[Background] Waiting ${Math.round(delay)}ms before next company...`);
        await sleep(delay);
      } else if (!errorHandled) {
        // Only run retry logic if we haven't already handled the error
        console.log('[Background] ⚠️ Keeping tabs open - unexpected error occurred');
        sendLog(`Error occurred - tabs kept open for ${company.company_name}`, 'info');

        // Wait for user to take action (save/skip) or retry with a new wait
        try {
          console.log('[Background] Restarting wait for user action...');

          // Set up a new wait for save/skip
          let retryListener = null;
          const retryResponse = await new Promise((resolve, reject) => {
            const retryTimeout = setTimeout(() => {
              shouldCloseTabs = true;
              // Clean up listener on timeout
              if (retryListener) {
                chrome.runtime.onMessage.removeListener(retryListener);
              }
              reject(new Error('Retry timeout (3 min)'));
            }, 180000); // 3 minute retry timeout

            retryListener = (message, sender, sendResponse) => {
              if (message.action === 'careerPageSaved' && message.companyId === company.id) {
                shouldCloseTabs = true;
                clearTimeout(retryTimeout);
                chrome.runtime.onMessage.removeListener(retryListener);
                sendResponse({ success: true, received: true });
                resolve(message);
                return true;
              } else if (message.action === 'companySkipped' && message.companyId === company.id) {
                shouldCloseTabs = true;
                clearTimeout(retryTimeout);
                chrome.runtime.onMessage.removeListener(retryListener);
                sendResponse({ success: true, skipped: true });
                resolve({ success: false, skipped: true });
                return true;
              }
              return false; // IMPORTANT: let other listeners handle non-matching messages
            };

            chrome.runtime.onMessage.addListener(retryListener);
          });

          // Handle the retry response
          if (retryResponse && retryResponse.success) {
            const careerPageUrls = retryResponse.careerPageUrls || [retryResponse.careerPageUrl];
            const apiEndpoints = retryResponse.apiEndpoints || (retryResponse.apiEndpoint ? [retryResponse.apiEndpoint] : []);
            await saveCareerPageUrls(company.id, careerPageUrls, apiEndpoints);
            sendLog(`✓ ${company.company_name}: Saved after retry!`, 'success');
          } else if (retryResponse && retryResponse.skipped) {
            await saveCareerPageUrls(company.id, ['TODO'], []);
            sendLog(`⏭️ ${company.company_name}: Marked as TODO`, 'info');
          }

          // Now close tabs
          if (createdTabIds.length > 0) {
            try {
              const existingTabs = [];
              for (const tabId of createdTabIds) {
                try {
                  await chrome.tabs.get(tabId);
                  existingTabs.push(tabId);
                } catch (e) {}
              }
              if (existingTabs.length > 0) {
                await chrome.tabs.remove(existingTabs);
              }
            } catch (e) {}
          }

          await sleep(300 + Math.random() * 400);

        } catch (retryError) {
          console.log('[Background] Retry also timed out');
          // Don't save as SKIPPED, leave as NULL to retry later
          sendLog(`✗ ${company.company_name}: Retry timeout - will retry later`, 'error');

          // Close tabs after retry timeout
          if (createdTabIds.length > 0) {
            try {
              await chrome.tabs.remove(createdTabIds);
            } catch (e) {}
          }
        }
      }

      // Send progress update (even for error-handled companies)
      chrome.runtime.sendMessage({
        action: 'collectionProgress',
        progress: {
          current: i + 1,
          total,
          percentage: Math.round(((i + 1) / total) * 100)
        }
      }).catch(() => {});

      console.log(`[Background] ✅ Company ${i + 1}/${total} complete. Moving to next...`);
    }
  }

  console.log(`[Background] 🎉 All ${companies.length} companies processed!`);

  // Complete
  chrome.runtime.sendMessage({
    action: 'collectionComplete',
    count: companies.length
  }).catch(() => {});
}

/**
 * Save career page URLs and API endpoints to Supabase
 * Stores JSON array as string in existing columns
 */
async function saveCareerPageUrls(companyId, careerPageUrls, apiEndpoints = []) {
  try {
    console.log('[Background] Saving career page URLs and API endpoints...');
    console.log('[Background] Company ID:', companyId);
    console.log('[Background] Career URLs:', careerPageUrls);
    console.log('[Background] API endpoints:', apiEndpoints);

    const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase not configured');
    }

    // Store JSON array as string in existing columns
    const payload = {
      career_page_url: JSON.stringify(careerPageUrls),
      api_endpoint: apiEndpoints.length > 0 ? JSON.stringify(apiEndpoints) : null
    };

    const url = `${config.supabaseUrl}/rest/v1/career_pages?id=eq.${companyId}`;

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

  } catch (error) {
    console.error('[Background] Error saving to Supabase:', error);
    sendLog(`Supabase save error: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Ensure content script is loaded in tab
 */
async function ensureContentScriptLoaded(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    console.log('[Background] Content script already loaded');
  } catch (error) {
    console.log('[Background] Content script not loaded, injecting...');

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['finder.js']
      });

      console.log('[Background] Waiting for content script to initialize...');
      await sleep(200); // Reduced from 1000ms

      // Try ping with retry
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await chrome.tabs.sendMessage(tabId, { action: 'ping' });
          console.log(`[Background] ✓ Content script injected successfully (attempt ${attempt})`);
          return;
        } catch (pingError) {
          if (attempt < 3) {
            console.log(`[Background] Ping attempt ${attempt}/3 failed, retrying...`);
            await sleep(300); // Reduced from 1000ms
          } else {
            console.warn('[Background] All ping attempts failed - site may block content scripts');
            throw new Error('Content script blocked by site');
          }
        }
      }
    } catch (injectError) {
      console.error('[Background] Failed to inject content script:', injectError);
      throw new Error(`Content script injection failed: ${injectError.message}`);
    }
  }
}

/**
 * Wait for tab to load
 */
function waitForTabLoad(tabId) {
  return new Promise(async (resolve, reject) => {
    let timeout;
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(updateListener);
        chrome.tabs.onRemoved.removeListener(removeListener);
      }
    };

    const updateListener = function(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        // Check if it loaded to an error page
        if (tab && tab.url && (tab.url.startsWith('chrome-error://') || tab.url.startsWith('chrome://'))) {
          setTimeout(() => resolve(), 100); // Still resolve, error page check happens after
        } else {
          setTimeout(() => resolve(), 300);
        }
      }
    };

    // Detect if tab is closed/crashed before loading
    const removeListener = function(removedTabId) {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error('Tab closed before loading'));
      }
    };

    // Check if tab is already loaded before adding listener
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        console.log('[Background] Tab already loaded');
        setTimeout(resolve, 100);
        return;
      }
    } catch (e) {
      reject(new Error('Tab does not exist'));
      return;
    }

    chrome.tabs.onUpdated.addListener(updateListener);
    chrome.tabs.onRemoved.addListener(removeListener);

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Page load timeout'));
    }, 25000); // 25 second timeout
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
    action: 'collectionLog',
    message,
    type
  }).catch(() => {
    // Popup might be closed
  });
}

/**
 * Validate API endpoint from background script (avoids page CSP/service worker issues)
 */
async function validateAPIFromBackground(apiUrl) {
  console.log('[Background] Validating API:', apiUrl);

  try {
    const isWorkday = apiUrl.includes('myworkdayjobs.com/wday/cxs/');

    // Add timeout with AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('[Background] Fetch timeout, aborting...');
      controller.abort();
    }, 7000);

    let response;
    if (isWorkday) {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limit: 20, offset: 0 }),
        signal: controller.signal
      });
    } else {
      response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log('[Background] API returned HTTP', response.status);
      return { valid: false, jobCount: 0, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    console.log('[Background] API response type:', typeof data, Array.isArray(data) ? 'array' : '');

    // Parse job data from various formats
    let jobs = [];
    if (Array.isArray(data)) {
      jobs = data;
      console.log('[Background] Direct array format, jobs:', jobs.length);
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.jobs)) {
        jobs = data.jobs;
        console.log('[Background] jobs[] format, count:', jobs.length);
      }
      else if (Array.isArray(data.jobPostings)) {
        jobs = data.jobPostings;
        console.log('[Background] jobPostings[] format, count:', jobs.length);
      }
      else if (Array.isArray(data.postings)) {
        jobs = data.postings;
        console.log('[Background] postings[] format, count:', jobs.length);
      }
      else if (Array.isArray(data.positions)) {
        jobs = data.positions;
        console.log('[Background] positions[] format, count:', jobs.length);
      }
      else if (Array.isArray(data.result)) {
        jobs = data.result; // BambooHR
        console.log('[Background] result[] (BambooHR) format, count:', jobs.length);
      }
      else {
        console.log('[Background] Unknown object format, keys:', Object.keys(data).slice(0, 10));
      }
    }

    if (jobs.length > 0) {
      const firstJob = jobs[0];
      const hasTitle = firstJob.title || firstJob.text || firstJob.name || firstJob.jobOpeningName;
      if (hasTitle) {
        console.log('[Background] ✓ Valid API with', jobs.length, 'jobs');
        return { valid: true, jobCount: jobs.length, error: null };
      } else {
        console.log('[Background] Jobs found but no title field. First job keys:', Object.keys(firstJob).slice(0, 10));
      }
    }

    return { valid: false, jobCount: 0, error: '0 jobs returned' };

  } catch (error) {
    const errorMsg = error.name === 'AbortError' ? 'Timeout (15s)' : (error.message?.substring(0, 30) || 'Fetch failed');
    console.error('[Background] API validation error:', errorMsg);
    return { valid: false, jobCount: 0, error: errorMsg };
  }
}

console.log('[Background] Career Page Finder loaded successfully');
