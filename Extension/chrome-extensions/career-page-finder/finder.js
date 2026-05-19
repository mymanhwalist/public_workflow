/**
 * Career Page Finder - Content Script
 * Simple overlay button to save career page URL
 */

// CRITICAL: Set up ping listener FIRST before anything else
// This ensures the script responds even if other code fails
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
});

try {
  console.log('[Finder] Content script loaded');
  console.log('[Finder] URL:', window.location.href);
} catch (e) {
  console.error('[Finder] Init error:', e);
}

let currentCompanyId = null;
let currentCompanyName = null;
let overlayButton = null;

// Track saved URLs for current company (multi-URL support)
let savedCareerUrls = [];
let savedApiEndpoints = [];

// Store intercepted API calls
const interceptedAPIs = new Set();

// ============================================
// NETWORK INTERCEPTION - Catch live API calls
// ============================================

// Wrap in try-catch to prevent crashes on strict CSP sites
try {
  // Intercept fetch() calls
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const url = args[0]?.url || args[0];
      if (typeof url === 'string' && url.startsWith('http')) {
        interceptedAPIs.add(url);
      }
    } catch (e) {}
    return originalFetch.apply(this, args);
  };
} catch (e) {
  console.log('[Finder] Could not intercept fetch:', e.message);
}

try {
  // Intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try {
      if (typeof url === 'string' && url.startsWith('http')) {
        interceptedAPIs.add(url);
      }
    } catch (e) {}
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
} catch (e) {
  console.log('[Finder] Could not intercept XHR:', e.message);
}

try {
  // Intercept sendBeacon (sometimes used for job tracking)
  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try {
        if (typeof url === 'string' && url.startsWith('http')) {
          interceptedAPIs.add(url);
        }
      } catch (e) {}
      return originalBeacon(url, data);
    };
  }
} catch (e) {
  console.log('[Finder] Could not intercept beacon:', e.message);
}

// ============================================
// MUTATION OBSERVER - Watch for dynamic content
// ============================================

const dynamicURLs = new Set();

try {
  // Watch for dynamically added iframes and scripts
  const observer = new MutationObserver((mutations) => {
    try {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) { // Element node
            // Check iframes
            if (node.tagName === 'IFRAME' && node.src) {
              dynamicURLs.add(node.src);
            }
            // Check scripts
            if (node.tagName === 'SCRIPT' && node.src) {
              dynamicURLs.add(node.src);
            }
            // Check nested iframes
            node.querySelectorAll?.('iframe[src]')?.forEach(iframe => {
              dynamicURLs.add(iframe.src);
            });
          }
        });
      });
    } catch (e) {}
  });

  // Start observing
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
} catch (e) {
  console.log('[Finder] Could not start mutation observer:', e.message);
}

// Listen for messages (ping already handled at top of file)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'initFinder') {
    console.log('[Finder] ===== INIT FINDER =====');
    console.log('[Finder] Company:', request.companyName);
    console.log('[Finder] Company ID:', request.companyId);
    console.log('[Finder] Current URL:', window.location.href);

    // Only reset saved URLs/APIs if this is a new company
    if (currentCompanyId !== request.companyId) {
      savedCareerUrls = [];
      savedApiEndpoints = [];
    }

    // Restore saved URLs from request if provided (for navigation within same company)
    if (request.savedCareerUrls && request.savedCareerUrls.length > 0) {
      savedCareerUrls = request.savedCareerUrls;
    }
    // Restore saved APIs separately (might have APIs without URLs from manual scan)
    if (request.savedApiEndpoints && request.savedApiEndpoints.length > 0) {
      savedApiEndpoints = request.savedApiEndpoints;
    }

    currentCompanyId = request.companyId;
    currentCompanyName = request.companyName;

    // Show overlay button
    console.log('[Finder] About to show overlay button...');
    console.log('[Finder] Previously saved URLs:', savedCareerUrls.length);
    try {
      showOverlayButton();
      console.log('[Finder] ✓ Overlay button shown successfully');
    } catch (error) {
      console.error('[Finder] ✗ Error showing overlay button:', error);
    }

    sendResponse({ success: true });
    return true;
  }

  return false;
});

/**
 * Show floating overlay button
 */
function showOverlayButton() {
  console.log('[Finder] showOverlayButton() called');

  // Remove existing button if any
  if (overlayButton) {
    console.log('[Finder] Removing existing overlay button');
    overlayButton.remove();
    overlayButton = null;
  }

  console.log('[Finder] Creating new overlay button element');

  // Check if current URL is already saved
  const currentUrl = window.location.href;
  const isAlreadySaved = savedCareerUrls.includes(currentUrl);
  const savedCount = savedCareerUrls.length;

  // Create overlay container
  overlayButton = document.createElement('div');
  overlayButton.id = 'career-finder-overlay';
  overlayButton.style.cssText = `
    all: initial;
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Status indicator
  const statusText = savedCount > 0
    ? `<span style="color: #10b981;">✓ ${savedCount}</span>`
    : '';
  const warningText = isAlreadySaved ? ' <span style="color: #f59e0b;">⚠</span>' : '';

  // Check if we have any APIs detected
  const apiCount = savedApiEndpoints.length;
  const apiIndicator = apiCount > 0 ? `<span style="color: #60a5fa;">🔗${apiCount}</span>` : '';

  overlayButton.innerHTML = `
    <div id="career-finder-panel" style="
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 10px 12px;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.5);
      cursor: move;
      user-select: none;
      min-width: 220px;
    ">
      <div id="career-finder-header" style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255,255,255,0.2);
        cursor: move;
      ">
        <span style="font-size: 11px; font-weight: 600; opacity: 0.9; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${currentCompanyName}
        </span>
        <span style="font-size: 11px;">${statusText}${warningText} ${apiIndicator}</span>
      </div>
      <div style="display: flex; gap: 6px; margin-bottom: 6px;">
        <button id="save-add-more-btn" style="
          flex: 1;
          background: white;
          color: #667eea;
          border: none;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
          ${isAlreadySaved ? 'opacity: 0.5;' : ''}
        ">+ Add</button>
        <button id="done-company-btn" style="
          flex: 1;
          background: ${savedCount > 0 ? '#10b981' : 'rgba(255,255,255,0.2)'};
          color: white;
          border: none;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        ">${savedCount > 0 ? '✓ Done' : '✓ Save'}</button>
        <button id="skip-company-btn" style="
          background: rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.9);
          border: none;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        ">Skip</button>
      </div>
      <div style="display: flex; gap: 6px; margin-bottom: 6px;">
        <button id="scan-api-btn" style="
          background: rgba(96, 165, 250, 0.3);
          color: white;
          border: 1px solid rgba(96, 165, 250, 0.5);
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        ">🔍 Scan</button>
        <div id="api-status" style="
          flex: 1;
          font-size: 10px;
          padding: 6px 8px;
          background: rgba(0,0,0,0.2);
          border-radius: 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          cursor: ${apiCount > 0 ? 'pointer' : 'default'};
        " title="${apiCount > 0 ? savedApiEndpoints[savedApiEndpoints.length - 1] : 'Click Scan to detect API'}">${apiCount > 0 ? '✓ ' + apiCount + ' API(s)' : 'No API yet'}</div>
        <button id="copy-api-btn" style="
          background: ${apiCount > 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.1)'};
          color: ${apiCount > 0 ? 'white' : 'rgba(255,255,255,0.4)'};
          border: none;
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 10px;
          cursor: ${apiCount > 0 ? 'pointer' : 'not-allowed'};
          font-family: inherit;
        " ${apiCount === 0 ? 'disabled' : ''}>📋</button>
        <button id="open-api-btn" style="
          background: ${apiCount > 0 ? 'rgba(96, 165, 250, 0.3)' : 'rgba(255,255,255,0.1)'};
          color: ${apiCount > 0 ? 'white' : 'rgba(255,255,255,0.4)'};
          border: none;
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 10px;
          cursor: ${apiCount > 0 ? 'pointer' : 'not-allowed'};
          font-family: inherit;
        " ${apiCount === 0 ? 'disabled' : ''}>↗</button>
      </div>
      <div style="display: flex; gap: 6px;">
        <input id="manual-api-input" type="text" placeholder="Paste API URL manually..." style="
          flex: 1;
          background: rgba(0,0,0,0.3);
          color: white;
          border: 1px solid rgba(255,255,255,0.2);
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 10px;
          font-family: inherit;
          outline: none;
        " />
        <button id="add-api-btn" style="
          background: rgba(16, 185, 129, 0.3);
          color: white;
          border: none;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        ">+ Add</button>
      </div>
    </div>
  `;

  // Add to DOM first
  if (!document.body) {
    console.error('[Finder] ✗ document.body is null! Page may not be loaded.');
    return;
  }
  document.body.appendChild(overlayButton);

  // Add event listeners
  setTimeout(() => {
    if (!overlayButton || !overlayButton.isConnected) {
      console.log('[Finder] Overlay button removed before event listeners could be added');
      return;
    }

    const saveAddMoreBtn = document.getElementById('save-add-more-btn');
    const doneBtn = document.getElementById('done-company-btn');
    const skipBtn = document.getElementById('skip-company-btn');
    const panel = document.getElementById('career-finder-panel');
    const header = document.getElementById('career-finder-header');

    if (saveAddMoreBtn) {
      saveAddMoreBtn.addEventListener('click', handleSaveAndAddMore);
    }
    if (doneBtn) {
      doneBtn.addEventListener('click', handleDoneWithCompany);
    }
    if (skipBtn) {
      skipBtn.addEventListener('click', handleSkipCompany);
    }

    const scanApiBtn = document.getElementById('scan-api-btn');
    if (scanApiBtn) {
      scanApiBtn.addEventListener('click', handleScanApi);
    }

    const copyApiBtn = document.getElementById('copy-api-btn');
    if (copyApiBtn) {
      copyApiBtn.addEventListener('click', handleCopyApi);
    }

    const openApiBtn = document.getElementById('open-api-btn');
    if (openApiBtn) {
      openApiBtn.addEventListener('click', handleOpenApi);
    }

    const apiStatus = document.getElementById('api-status');
    if (apiStatus && savedApiEndpoints.length > 0) {
      apiStatus.addEventListener('click', handleCopyApi);
    }

    const addApiBtn = document.getElementById('add-api-btn');
    const manualApiInput = document.getElementById('manual-api-input');
    if (addApiBtn && manualApiInput) {
      addApiBtn.addEventListener('click', () => handleManualApiAdd(manualApiInput));
      manualApiInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleManualApiAdd(manualApiInput);
      });
    }

    // Make draggable
    if (panel && header) {
      let isDragging = false;
      let startX, startY, initialX, initialY;

      header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = overlayButton.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        header.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        overlayButton.style.left = (initialX + dx) + 'px';
        overlayButton.style.top = (initialY + dy) + 'px';
        overlayButton.style.right = 'auto';
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          header.style.cursor = 'move';
        }
      });
    }

    console.log('[Finder] ✓ Overlay ready');
  }, 50);

  console.log('[Finder] ✓ Overlay button shown for company:', currentCompanyName);
}

/**
 * Handle "Save & Add More" button click - saves current URL and keeps tab open
 */
async function handleSaveAndAddMore(event) {
  const currentUrl = window.location.href;

  // Check if already saved
  if (savedCareerUrls.includes(currentUrl)) {
    console.log('[Finder] URL already saved, ignoring');
    return;
  }

  if (event && event.target) {
    event.target.disabled = true;
    event.target.textContent = '🔍 Scanning...';
  }

  console.log('[Finder] User clicked Save & Add More');

  // Trigger lazy content to discover more APIs
  await triggerLazyContent();

  // Detect API endpoint
  const apiEndpoint = detectAPIEndpoint();
  console.log('[Finder] Detected API endpoint:', apiEndpoint || 'None');

  // Validate API if found
  let validatedApi = null;
  if (apiEndpoint) {
    if (event && event.target) {
      event.target.textContent = '✓ Validating...';
    }
    const validation = await validateAPIEndpoint(apiEndpoint);
    if (validation.valid) {
      console.log('[Finder] ✓ API validated:', validation.jobCount, 'jobs');
      // Use actual URL that worked (might be different if alternative slug was tried)
      validatedApi = validation._actualUrl || apiEndpoint;
    } else {
      console.log('[Finder] ✗ API validation failed:', validation.error);
    }
  }

  // Add to local saved arrays
  savedCareerUrls.push(currentUrl);
  // Only add API if validated and not already present
  if (validatedApi && !savedApiEndpoints.includes(validatedApi)) {
    savedApiEndpoints.push(validatedApi);
  }

  console.log('[Finder] Saved URLs so far:', savedCareerUrls);

  // Notify background script about the addition (for tracking during navigation)
  chrome.runtime.sendMessage({
    action: 'careerPageAdded',
    companyId: currentCompanyId,
    careerPageUrl: currentUrl,
    apiEndpoint: validatedApi,
    savedCareerUrls: savedCareerUrls,
    savedApiEndpoints: savedApiEndpoints
  });

  // Refresh the overlay to show updated count
  showOverlayButton();
}

/**
 * Handle "Done with Company" button click - saves all URLs and moves to next company
 */
async function handleDoneWithCompany(event) {
  const currentUrl = window.location.href;

  // If no URLs saved yet, save current one first
  if (savedCareerUrls.length === 0) {
    if (event && event.target) {
      event.target.disabled = true;
      event.target.textContent = '🔍 Scanning...';
    }

    console.log('[Finder] No URLs saved yet, saving current page first');

    await triggerLazyContent();

    const apiEndpoint = detectAPIEndpoint();
    savedCareerUrls.push(currentUrl);

    // Validate API before adding
    if (apiEndpoint) {
      if (event && event.target) {
        event.target.textContent = '✓ Validating...';
      }
      const validation = await validateAPIEndpoint(apiEndpoint);
      if (validation.valid) {
        const actualApi = validation._actualUrl || apiEndpoint;
        console.log('[Finder] ✓ API validated:', validation.jobCount, 'jobs');
        if (!savedApiEndpoints.includes(actualApi)) {
          savedApiEndpoints.push(actualApi);
        }
      } else {
        console.log('[Finder] ✗ API validation failed:', validation.error);
      }
    }
  } else if (!savedCareerUrls.includes(currentUrl)) {
    // Current URL not saved, save it automatically
    if (event && event.target) {
      event.target.disabled = true;
      event.target.textContent = '🔍 Scanning...';
    }

    await triggerLazyContent();

    const apiEndpoint = detectAPIEndpoint();
    savedCareerUrls.push(currentUrl);

    // Validate API before adding
    if (apiEndpoint) {
      if (event && event.target) {
        event.target.textContent = '✓ Validating...';
      }
      const validation = await validateAPIEndpoint(apiEndpoint);
      if (validation.valid) {
        const actualApi = validation._actualUrl || apiEndpoint;
        console.log('[Finder] ✓ API validated:', validation.jobCount, 'jobs');
        if (!savedApiEndpoints.includes(actualApi)) {
          savedApiEndpoints.push(actualApi);
        }
      } else {
        console.log('[Finder] ✗ API validation failed:', validation.error);
      }
    }
  }

  console.log('[Finder] Done with company. Total URLs:', savedCareerUrls.length);
  console.log('[Finder] Career URLs:', savedCareerUrls);
  console.log('[Finder] API Endpoints:', savedApiEndpoints);

  // Show success message
  if (overlayButton) {
    const panel = overlayButton.querySelector('#career-finder-panel');
    if (panel) {
      panel.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      panel.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; padding: 4px;">
          <span style="font-size: 18px;">✅</span>
          <div>
            <div style="font-size: 12px; font-weight: 700;">
              ${savedCareerUrls.length} page${savedCareerUrls.length > 1 ? 's' : ''} saved!
            </div>
            <div style="font-size: 10px; opacity: 0.8;">
              ${savedApiEndpoints.length} API${savedApiEndpoints.length !== 1 ? 's' : ''} detected
            </div>
          </div>
        </div>
      `;
    }
  }

  // Send all saved URLs to background script
  chrome.runtime.sendMessage({
    action: 'careerPageSaved',
    companyId: currentCompanyId,
    careerPageUrls: savedCareerUrls,
    apiEndpoints: savedApiEndpoints,
    success: true
  }, (response) => {
    console.log('[Finder] Background response:', response);
  });

  // Reset local state
  savedCareerUrls = [];
  savedApiEndpoints = [];

  // Remove button after 1 second (tab will close)
  setTimeout(() => {
    if (overlayButton) {
      overlayButton.remove();
      overlayButton = null;
    }
  }, 1000);
}

/**
 * Handle manual API URL input
 */
async function handleManualApiAdd(inputEl) {
  const apiUrl = inputEl.value.trim();

  if (!apiUrl) {
    console.log('[Finder] No API URL entered');
    return;
  }

  // Validate URL format
  if (!apiUrl.startsWith('http')) {
    alert('Please enter a valid URL starting with http:// or https://');
    return;
  }

  // Check for duplicates
  if (savedApiEndpoints.includes(apiUrl)) {
    console.log('[Finder] API already added');
    inputEl.value = '';
    inputEl.placeholder = 'Already added!';
    setTimeout(() => { inputEl.placeholder = 'Paste API URL manually...'; }, 2000);
    return;
  }

  // Show validating state
  inputEl.disabled = true;
  inputEl.placeholder = 'Validating...';
  const addBtn = document.getElementById('add-api-btn');
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.textContent = '...';
  }

  // Validate the API
  const validation = await validateAPIEndpoint(apiUrl);

  if (!validation.valid) {
    console.log('[Finder] Manual API validation failed:', validation.error);
    inputEl.disabled = false;
    inputEl.value = '';
    inputEl.placeholder = `✗ ${validation.error}`;
    inputEl.style.borderColor = '#ef4444';
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = '+ Add';
    }
    setTimeout(() => {
      inputEl.placeholder = 'Paste API URL manually...';
      inputEl.style.borderColor = '';
    }, 3000);
    return;
  }

  // API is valid - add it
  savedApiEndpoints.push(apiUrl);
  console.log('[Finder] Manually added API:', apiUrl, '- Jobs:', validation.jobCount);

  // Re-enable input
  inputEl.disabled = false;
  if (addBtn) {
    addBtn.disabled = false;
    addBtn.textContent = '+ Add';
  }

  // Update UI
  const statusEl = document.getElementById('api-status');
  if (statusEl) {
    const shortUrl = apiUrl.length > 25 ? apiUrl.substring(0, 25) + '...' : apiUrl;
    statusEl.textContent = '✓ ' + shortUrl;
    statusEl.style.color = '#10b981';
    statusEl.style.cursor = 'pointer';
    statusEl.title = apiUrl;
    statusEl.onclick = handleCopyApi;
  }

  // Enable copy/open buttons
  const copyBtn = document.getElementById('copy-api-btn');
  const openBtn = document.getElementById('open-api-btn');
  if (copyBtn) {
    copyBtn.disabled = false;
    copyBtn.style.background = 'rgba(16, 185, 129, 0.3)';
    copyBtn.style.color = 'white';
    copyBtn.style.cursor = 'pointer';
  }
  if (openBtn) {
    openBtn.disabled = false;
    openBtn.style.background = 'rgba(96, 165, 250, 0.3)';
    openBtn.style.color = 'white';
    openBtn.style.cursor = 'pointer';
  }

  // Clear input
  inputEl.value = '';
  inputEl.placeholder = '✓ Added!';
  setTimeout(() => { inputEl.placeholder = 'Paste API URL manually...'; }, 2000);

  // Notify background about the new API
  chrome.runtime.sendMessage({
    action: 'careerPageAdded',
    companyId: currentCompanyId,
    careerPageUrl: null,
    apiEndpoint: apiUrl,
    savedCareerUrls: savedCareerUrls,
    savedApiEndpoints: savedApiEndpoints
  });

  // Update header API count
  const header = document.getElementById('career-finder-header');
  if (header) {
    const statusSpan = header.querySelector('span:last-child');
    if (statusSpan) {
      const urlCount = savedCareerUrls.length;
      const apiCount = savedApiEndpoints.length;
      let statusText = '';
      if (urlCount > 0) statusText += `<span style="color: #10b981;">✓${urlCount}</span> `;
      statusText += `<span style="color: #60a5fa;">🔗${apiCount}</span>`;
      statusSpan.innerHTML = statusText;
    }
  }
}

/**
 * Handle "Copy API" button click - copy last API to clipboard
 */
async function handleCopyApi() {
  if (savedApiEndpoints.length === 0) {
    console.log('[Finder] No API to copy');
    return;
  }

  const lastApi = savedApiEndpoints[savedApiEndpoints.length - 1];

  try {
    await navigator.clipboard.writeText(lastApi);
    console.log('[Finder] API copied to clipboard:', lastApi);

    const statusEl = document.getElementById('api-status');
    if (statusEl) {
      const originalText = statusEl.textContent;
      statusEl.textContent = '✓ Copied!';
      statusEl.style.color = '#10b981';
      setTimeout(() => {
        statusEl.textContent = originalText;
        statusEl.style.color = '';
      }, 1500);
    }
  } catch (e) {
    console.error('[Finder] Failed to copy:', e);
    // Fallback: select text
    prompt('Copy this API URL:', lastApi);
  }
}

/**
 * Handle "Open API" button click - open API in new tab
 */
function handleOpenApi() {
  if (savedApiEndpoints.length === 0) {
    console.log('[Finder] No API to open');
    return;
  }

  const lastApi = savedApiEndpoints[savedApiEndpoints.length - 1];
  console.log('[Finder] Opening API in new tab:', lastApi);
  window.open(lastApi, '_blank');
}

/**
 * Validate API endpoint by fetching it and checking if it returns real jobs
 * @param {string} apiUrl - The API URL to validate
 * @returns {Promise<{valid: boolean, jobCount: number, error: string|null}>}
 */
async function validateAPIEndpoint(apiUrl) {
  console.log('[Finder] Validating API via background script:', apiUrl);

  // Helper function to validate a single URL
  async function tryValidate(url) {
    try {
      const result = await Promise.race([
        chrome.runtime.sendMessage({
          action: 'validateAPI',
          apiUrl: url
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
      ]);
      return result;
    } catch (e) {
      return { valid: false, jobCount: 0, error: e.message };
    }
  }

  try {
    // First, wake up the service worker with a ping
    try {
      await chrome.runtime.sendMessage({ action: 'ping' });
    } catch (e) {
      console.log('[Finder] Ping failed, service worker may be starting...');
    }

    // Try the primary URL first
    let result = await tryValidate(apiUrl);
    console.log('[Finder] Primary validation result:', result);

    // If it failed and this is a Greenhouse URL, try alternative slugs
    if ((!result || !result.valid) && apiUrl.includes('boards-api.greenhouse.io')) {
      const slugCandidates = window._greenhouseSlugCandidates || [];
      console.log('[Finder] Greenhouse validation failed, trying alternatives:', slugCandidates);

      for (let i = 1; i < slugCandidates.length; i++) {
        const altUrl = `https://boards-api.greenhouse.io/v1/boards/${slugCandidates[i]}/jobs`;
        console.log('[Finder] Trying alternative slug:', slugCandidates[i]);
        const altResult = await tryValidate(altUrl);

        if (altResult && altResult.valid) {
          console.log('[Finder] ✓ Alternative slug worked:', slugCandidates[i]);
          altResult._actualUrl = altUrl;
          return altResult;
        }
      }
    }

    // If it failed and this is an Ashby URL, try alternative slugs
    if ((!result || !result.valid) && apiUrl.includes('api.ashbyhq.com')) {
      const slugCandidates = window._ashbySlugCandidates || [];
      console.log('[Finder] Ashby validation failed, trying alternatives:', slugCandidates);

      for (let i = 1; i < slugCandidates.length; i++) {
        const altUrl = `https://api.ashbyhq.com/posting-api/job-board/${slugCandidates[i]}`;
        console.log('[Finder] Trying alternative Ashby slug:', slugCandidates[i]);
        const altResult = await tryValidate(altUrl);

        if (altResult && altResult.valid) {
          console.log('[Finder] ✓ Alternative Ashby slug worked:', slugCandidates[i]);
          altResult._actualUrl = altUrl;
          return altResult;
        }
      }
    }

    // Handle case where background script doesn't respond properly
    if (!result) {
      console.warn('[Finder] No response from background script');
      return { valid: false, jobCount: 0, error: 'No response - reload extension' };
    }

    return result;

  } catch (error) {
    console.error('[Finder] API validation error:', error);
    return {
      valid: false,
      jobCount: 0,
      error: error.message === 'Timeout' ? 'Timeout - try again' : 'Extension error - reload'
    };
  }
}

// Note: Direct fetch validation removed - doesn't work due to CORS
// All validation must go through background script

/**
 * Check if the API response contains real job data
 */
function validateJobData(data) {
  let jobs = [];

  // Handle different API response formats
  if (Array.isArray(data)) {
    // Lever format: array of jobs directly
    jobs = data;
  } else if (data && typeof data === 'object') {
    // Greenhouse/Ashby format: { jobs: [...] }
    if (Array.isArray(data.jobs)) {
      jobs = data.jobs;
    }
    // Workday format: { jobPostings: [...], total: N }
    else if (Array.isArray(data.jobPostings)) {
      jobs = data.jobPostings;
      console.log('[Finder] Workday format detected, total:', data.total || jobs.length);
    }
    // Some APIs use 'postings' or 'positions'
    else if (Array.isArray(data.postings)) {
      jobs = data.postings;
    }
    else if (Array.isArray(data.positions)) {
      jobs = data.positions;
    }
    // BambooHR format: { meta: {...}, result: [...] }
    else if (Array.isArray(data.result)) {
      jobs = data.result;
      console.log('[Finder] BambooHR format detected, total:', data.meta?.totalCount || jobs.length);
    }
    // Check for 'items' but verify they're jobs, not dropdown data
    else if (Array.isArray(data.items)) {
      const firstItem = data.items[0];
      // Dropdown data (schools, degrees) only has 'id' and 'text'
      if (firstItem && (firstItem.title || firstItem.name || firstItem.location)) {
        jobs = data.items;
      } else {
        return { valid: false, jobCount: 0, error: 'Dropdown data, not jobs' };
      }
    }
  }

  // Validate that jobs have expected fields
  if (jobs.length > 0) {
    const firstJob = jobs[0];
    // Real jobs have title/text and usually location or department
    const hasTitle = firstJob.title || firstJob.text || firstJob.name || firstJob.jobOpeningName;
    const hasJobFields = firstJob.location || firstJob.department || firstJob.team ||
                         firstJob.categories || firstJob.hostedUrl || firstJob.absolute_url ||
                         // Workday specific fields
                         firstJob.locationsText || firstJob.externalPath || firstJob.postedOn ||
                         // BambooHR specific fields
                         firstJob.departmentLabel || firstJob.employmentStatusLabel || firstJob.locationType;

    if (hasTitle && hasJobFields) {
      console.log('[Finder] ✓ Valid job API with', jobs.length, 'jobs');
      return { valid: true, jobCount: jobs.length, error: null };
    } else if (hasTitle) {
      // Has title but missing other fields - might still be valid
      console.log('[Finder] ⚠ API has titles but limited fields,', jobs.length, 'items');
      return { valid: true, jobCount: jobs.length, error: null };
    } else {
      return { valid: false, jobCount: 0, error: 'No job titles found' };
    }
  }

  return { valid: false, jobCount: 0, error: '0 jobs returned' };
}

/**
 * Handle "Scan API" button click - manually scan current page for API endpoints
 */
async function handleScanApi(event) {
  const btn = event?.target;
  const statusEl = document.getElementById('api-status');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '🔍 Scanning...';
  }
  if (statusEl) {
    statusEl.textContent = 'Scanning page...';
    statusEl.style.color = '#60a5fa';
  }

  console.log('[Finder] Manual API scan triggered');
  console.log('[Finder] Current URL:', window.location.href);

  // Trigger lazy content to discover APIs
  await triggerLazyContent();

  // Run API detection
  console.log('[Finder] Running detectAPIEndpoint...');
  const apiEndpoint = detectAPIEndpoint();
  console.log('[Finder] detectAPIEndpoint returned:', apiEndpoint);

  if (apiEndpoint) {
    console.log('[Finder] Manual scan found API:', apiEndpoint);

    // Update status to show validating
    if (statusEl) {
      statusEl.textContent = 'Validating API...';
      statusEl.style.color = '#60a5fa';
    }

    // VALIDATE the API - actually fetch it and check for real jobs
    console.log('[Finder] Starting validation for:', apiEndpoint);
    const validation = await validateAPIEndpoint(apiEndpoint);
    console.log('[Finder] Validation result:', JSON.stringify(validation));

    if (validation && validation.valid) {
      console.log('[Finder] ✓ API validated:', validation.jobCount, 'jobs');

      // Use the actual URL that worked (might be different if alternative slug was tried)
      const actualApiEndpoint = validation._actualUrl || apiEndpoint;
      console.log('[Finder] Using API endpoint:', actualApiEndpoint);

      // Add to saved APIs if not already present
      if (!savedApiEndpoints.includes(actualApiEndpoint)) {
        savedApiEndpoints.push(actualApiEndpoint);
        console.log('[Finder] Added new API endpoint, total:', savedApiEndpoints.length);
      }

      // Update apiEndpoint for the rest of this function
      apiEndpoint = actualApiEndpoint;

      if (statusEl) {
        // Show job count and truncated URL
        const shortUrl = apiEndpoint.length > 20
          ? apiEndpoint.substring(0, 20) + '...'
          : apiEndpoint;
        statusEl.textContent = `✓ ${validation.jobCount} jobs`;
        statusEl.style.color = '#10b981';
        statusEl.style.cursor = 'pointer';
        statusEl.title = `${apiEndpoint}\n\n${validation.jobCount} jobs found`; // Full URL on hover

        // Make status clickable to copy
        statusEl.onclick = handleCopyApi;
      }

      // Enable copy/open buttons
      const copyBtn = document.getElementById('copy-api-btn');
      const openBtn = document.getElementById('open-api-btn');
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.style.background = 'rgba(16, 185, 129, 0.3)';
        copyBtn.style.color = 'white';
        copyBtn.style.cursor = 'pointer';
      }
      if (openBtn) {
        openBtn.disabled = false;
        openBtn.style.background = 'rgba(96, 165, 250, 0.3)';
        openBtn.style.color = 'white';
        openBtn.style.cursor = 'pointer';
      }

      // Notify background about the new API
      chrome.runtime.sendMessage({
        action: 'careerPageAdded',
        companyId: currentCompanyId,
        careerPageUrl: null, // Not adding URL, just API
        apiEndpoint: apiEndpoint,
        savedCareerUrls: savedCareerUrls,
        savedApiEndpoints: savedApiEndpoints
      });

    } else {
      // API detected but validation failed
      const errorMsg = validation?.error || 'Unknown validation error';
      console.log('[Finder] ✗ API validation failed:', errorMsg);

      if (statusEl) {
        statusEl.textContent = `✗ ${errorMsg}`;
        statusEl.style.color = '#ef4444';
        statusEl.title = `API found but invalid:\n${apiEndpoint}\n\nError: ${errorMsg}`;
      }
    }

  } else {
    console.log('[Finder] Manual scan found no API');

    if (statusEl) {
      statusEl.textContent = '✗ No API found';
      statusEl.style.color = '#f59e0b';
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔍 Scan';
  }

  // Update the header to show API count
  const header = document.getElementById('career-finder-header');
  if (header && savedApiEndpoints.length > 0) {
    const statusSpan = header.querySelector('span:last-child');
    if (statusSpan) {
      const urlCount = savedCareerUrls.length;
      const apiCount = savedApiEndpoints.length;
      let statusText = '';
      if (urlCount > 0) statusText += `<span style="color: #10b981;">✓${urlCount}</span> `;
      statusText += `<span style="color: #60a5fa;">🔗${apiCount}</span>`;
      statusSpan.innerHTML = statusText;
    }
  }
}

/**
 * Handle skip company button click
 */
function handleSkipCompany() {
  console.log('[Finder] User skipped company:', currentCompanyName);

  // Check if overlayButton still exists
  if (!overlayButton) {
    console.error('[Finder] Overlay button not found, sending skip message anyway');
    chrome.runtime.sendMessage({
      action: 'companySkipped',
      companyId: currentCompanyId,
      companyName: currentCompanyName
    });
    return;
  }

  // Show skipped state
  const panel = overlayButton.querySelector('#career-finder-panel');
  if (panel) {
    panel.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
    panel.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; padding: 4px;">
        <span style="font-size: 18px;">⏭️</span>
        <div style="font-size: 12px; font-weight: 700;">Skipped!</div>
      </div>
    `;
  }

  // Send skip message to background script
  chrome.runtime.sendMessage({
    action: 'companySkipped',
    companyId: currentCompanyId,
    companyName: currentCompanyName
  });

  // Remove button after 1 second (tab will close)
  setTimeout(() => {
    if (overlayButton) {
      overlayButton.remove();
      overlayButton = null;
    }
  }, 1000);
}

/**
 * Derive API endpoint from known ATS URL patterns
 * This handles cases where API URL is not exposed in page source
 */
function deriveAPIFromURL(pageUrl) {
  const pageHTML = document.documentElement.innerHTML || '';

  // Check for gh_jid parameter (indicates embedded Greenhouse)
  if (pageUrl.includes('gh_jid=')) {
    console.log('[Finder] Detected gh_jid parameter - scanning for Greenhouse board ID...');

    // Pattern 1: Check intercepted network calls for Greenhouse API
    for (const url of interceptedAPIs) {
      const apiMatch = url.match(/boards-api\.greenhouse\.io\/v1\/boards\/([a-zA-Z0-9_-]+)/i);
      if (apiMatch) {
        console.log('[Finder] Found Greenhouse slug from intercepted API:', apiMatch[1]);
        return `https://boards-api.greenhouse.io/v1/boards/${apiMatch[1]}/jobs`;
      }
      const boardMatch = url.match(/(?:boards|job-boards)(?:\.[a-z]{2})?\.greenhouse\.io\/([a-zA-Z0-9_-]+)/i);
      if (boardMatch && boardMatch[1] !== 'embed' && boardMatch[1] !== 'v1') {
        console.log('[Finder] Found Greenhouse slug from intercepted URL:', boardMatch[1]);
        return `https://boards-api.greenhouse.io/v1/boards/${boardMatch[1]}/jobs`;
      }
    }

    // Pattern 2: Various Greenhouse embed URL formats with ?for= parameter
    // e.g., job_board?for=SLUG, job_board/js?for=SLUG, embed/job_board?for=SLUG
    const forMatch = pageHTML.match(/greenhouse\.io[^"']*[?&]for=([a-zA-Z0-9_-]+)/i);
    if (forMatch) {
      console.log('[Finder] Found Greenhouse slug from ?for= parameter:', forMatch[1]);
      return `https://boards-api.greenhouse.io/v1/boards/${forMatch[1]}/jobs`;
    }
    // Also check reverse order (for= might appear before greenhouse.io reference)
    const forMatch2 = pageHTML.match(/job_board(?:\/js)?\?for=([a-zA-Z0-9_-]+)/i);
    if (forMatch2) {
      console.log('[Finder] Found Greenhouse slug from job_board?for=:', forMatch2[1]);
      return `https://boards-api.greenhouse.io/v1/boards/${forMatch2[1]}/jobs`;
    }

    // Pattern 3: boards.greenhouse.io/SLUG or job-boards.greenhouse.io/SLUG (including regional like .eu)
    const boardUrlMatch = pageHTML.match(/(?:boards|job-boards)(?:\.[a-z]{2})?\.greenhouse\.io\/([a-zA-Z0-9_-]+)(?:\/|"|'|\s|$)/i);
    if (boardUrlMatch && boardUrlMatch[1] !== 'embed' && boardUrlMatch[1] !== 'v1') {
      console.log('[Finder] Found Greenhouse slug from URL in HTML:', boardUrlMatch[1]);
      return `https://boards-api.greenhouse.io/v1/boards/${boardUrlMatch[1]}/jobs`;
    }

    // Pattern 4: grnhse_app or greenhouse config in scripts
    const configMatch = pageHTML.match(/["']?(?:boardToken|board_token|boardId|board)["']?\s*[:=]\s*["']([a-zA-Z0-9_-]+)["']/i);
    if (configMatch) {
      console.log('[Finder] Found Greenhouse slug from config:', configMatch[1]);
      return `https://boards-api.greenhouse.io/v1/boards/${configMatch[1]}/jobs`;
    }

    // Pattern 5: Grnhse.Settings or grnhse_settings
    const grnhseMatch = pageHTML.match(/[Gg]rnhse[._]?[Ss]ettings.*?["']([a-zA-Z0-9_-]+)["']/);
    if (grnhseMatch) {
      console.log('[Finder] Found Greenhouse slug from Grnhse.Settings:', grnhseMatch[1]);
      return `https://boards-api.greenhouse.io/v1/boards/${grnhseMatch[1]}/jobs`;
    }

    // Pattern 6: data-board attribute
    const dataBoardMatch = pageHTML.match(/data-board=["']([a-zA-Z0-9_-]+)["']/i);
    if (dataBoardMatch) {
      console.log('[Finder] Found Greenhouse slug from data-board:', dataBoardMatch[1]);
      return `https://boards-api.greenhouse.io/v1/boards/${dataBoardMatch[1]}/jobs`;
    }

    // Pattern 7: Check for greenhouse.io in any script src and extract nearby slug
    const scriptSrcMatch = pageHTML.match(/src=["'][^"']*greenhouse\.io[^"']*["']/gi);
    if (scriptSrcMatch) {
      for (const src of scriptSrcMatch) {
        const slugMatch = src.match(/\/([a-zA-Z0-9_-]+)(?:\/|["']|$)/);
        if (slugMatch && slugMatch[1] !== 'embed' && slugMatch[1] !== 'v1' && slugMatch[1] !== 'js') {
          console.log('[Finder] Found Greenhouse slug from script src:', slugMatch[1]);
          return `https://boards-api.greenhouse.io/v1/boards/${slugMatch[1]}/jobs`;
        }
      }
    }

    // Pattern 8: Check all iframes on page (might be dynamically added)
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src || iframe.getAttribute('data-src') || '';
      if (src.includes('greenhouse.io')) {
        const slugMatch = src.match(/(?:for=|boards(?:\.[a-z]{2})?\.greenhouse\.io\/|job-boards(?:\.[a-z]{2})?\.greenhouse\.io\/)([a-zA-Z0-9_-]+)/i);
        if (slugMatch && slugMatch[1] !== 'embed') {
          console.log('[Finder] Found Greenhouse slug from iframe:', slugMatch[1]);
          return `https://boards-api.greenhouse.io/v1/boards/${slugMatch[1]}/jobs`;
        }
      }
    }

    // Pattern 8b: Check #grnhse_app element for data attributes
    const grnhseApp = document.getElementById('grnhse_app');
    if (grnhseApp) {
      console.log('[Finder] Found #grnhse_app element');
      // Check data-* attributes
      for (const attr of grnhseApp.attributes) {
        if (attr.value && attr.value.length > 1 && attr.value.length < 40) {
          console.log('[Finder] #grnhse_app attr:', attr.name, '=', attr.value);
        }
      }
      // Try to get board token from embedded content or nearby scripts
      const parentHTML = grnhseApp.parentElement?.innerHTML || '';
      const grnhseSlugMatch = parentHTML.match(/(?:for|board|token)[=:]["']?([a-zA-Z0-9_-]{2,40})["']?/i);
      if (grnhseSlugMatch) {
        console.log('[Finder] Found slug near #grnhse_app:', grnhseSlugMatch[1]);
        return `https://boards-api.greenhouse.io/v1/boards/${grnhseSlugMatch[1]}/jobs`;
      }
    }

    // Pattern 8c: Re-check intercepted APIs (may have been captured during lazy load)
    for (const url of interceptedAPIs) {
      if (url.includes('greenhouse.io')) {
        const slugMatch = url.match(/(?:for=|boards(?:\.[a-z]{2})?\.greenhouse\.io\/|job-boards(?:\.[a-z]{2})?\.greenhouse\.io\/)([a-zA-Z0-9_-]+)/i);
        if (slugMatch && !['embed', 'v1', 'js'].includes(slugMatch[1])) {
          console.log('[Finder] Found Greenhouse slug from intercepted URL (re-check):', slugMatch[1]);
          return `https://boards-api.greenhouse.io/v1/boards/${slugMatch[1]}/jobs`;
        }
      }
    }

    // Pattern 9: Check window objects for Greenhouse config
    try {
      const windowKeys = ['Grnhse', 'grnhse', 'greenhouse', 'GREENHOUSE_CONFIG', '__greenhouse'];
      for (const key of windowKeys) {
        if (window[key]) {
          const configStr = JSON.stringify(window[key]);
          const slugMatch = configStr.match(/["']?(?:board|boardToken|company)["']?\s*[:=]\s*["']([a-zA-Z0-9_-]+)["']/i);
          if (slugMatch) {
            console.log('[Finder] Found Greenhouse slug from window object:', slugMatch[1]);
            return `https://boards-api.greenhouse.io/v1/boards/${slugMatch[1]}/jobs`;
          }
        }
      }
    } catch (e) {}

    // Pattern 10: Try domain name as Greenhouse slug (common convention)
    // Store candidates to try - we'll return the first one that looks valid
    // The validation function will verify it actually works
    try {
      const urlObj = new URL(pageUrl);
      const hostname = urlObj.hostname.replace(/^www\./, '');
      const parts = hostname.split('.');
      const domainSlug = parts[0].toLowerCase();
      const tld = parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';

      // Short/trendy TLDs that are often part of company names
      const shortTLDs = ['io', 'co', 'ai', 'team', 'app', 'dev', 'tech', 'me', 'so', 'is', 'fm', 'tv', 'gg'];

      // Store both possible slugs - we'll try them in order during validation
      const slugCandidates = [];

      // Add simple domain slug
      if (domainSlug && /^[a-z0-9_-]{2,30}$/.test(domainSlug)) {
        slugCandidates.push(domainSlug);
      }

      // For short TLDs, also add combined slug (domain + TLD)
      if (shortTLDs.includes(tld) && parts.length === 2) {
        const combinedSlug = (parts[0] + parts[1]).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (combinedSlug && combinedSlug !== domainSlug && /^[a-z0-9]{3,30}$/.test(combinedSlug)) {
          slugCandidates.push(combinedSlug);
        }
      }

      // Store candidates globally for the validation function to try
      window._greenhouseSlugCandidates = slugCandidates;
      console.log('[Finder] Pattern 10: Greenhouse slug candidates:', slugCandidates);

      // Return first candidate - validation will try others if this fails
      if (slugCandidates.length > 0) {
        return `https://boards-api.greenhouse.io/v1/boards/${slugCandidates[0]}/jobs`;
      }
    } catch (e) {
      console.log('[Finder] Could not extract domain slug:', e.message);
    }

    console.log('[Finder] gh_jid detected but could not find board slug after all patterns');
    console.log('[Finder] Intercepted APIs:', Array.from(interceptedAPIs).filter(u => u.includes('greenhouse')));
    console.log('[Finder] Tip: Try clicking on the job listing first, then scan again');
    return null; // Explicitly return null if no pattern matched
  }

  // Check for ashby_jid parameter (indicates embedded Ashby)
  if (pageUrl.includes('ashby_jid=')) {
    console.log('[Finder] Detected ashby_jid parameter - scanning for Ashby board ID...');

    // Pattern 1: Check for jobs.ashbyhq.com/{company} in page HTML
    const ashbyUrlMatch = pageHTML.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_\-]+)/i);
    if (ashbyUrlMatch) {
      const slug = ashbyUrlMatch[1];
      console.log('[Finder] Found Ashby slug from page HTML:', slug);
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    }

    // Pattern 2: Check intercepted network calls for Ashby API
    for (const url of interceptedAPIs) {
      const apiMatch = url.match(/api\.ashbyhq\.com\/posting-api\/job-board\/([a-zA-Z0-9_\-%]+)/i);
      if (apiMatch) {
        console.log('[Finder] Found Ashby slug from intercepted API:', apiMatch[1]);
        return `https://api.ashbyhq.com/posting-api/job-board/${apiMatch[1]}`;
      }
    }

    // Pattern 3: Try domain name as Ashby slug (with alternatives)
    try {
      const urlObj = new URL(pageUrl);
      const hostname = urlObj.hostname.replace(/^www\./, '');
      const parts = hostname.split('.');
      const domainSlug = parts[0].toLowerCase();
      const tld = parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';

      const ashbyCandidates = [];
      const shortTLDs = ['io', 'co', 'ai', 'team', 'app', 'dev', 'tech', 'me'];

      if (domainSlug && /^[a-z0-9_-]{2,30}$/.test(domainSlug)) {
        ashbyCandidates.push(domainSlug);
      }
      if (shortTLDs.includes(tld) && parts.length === 2) {
        const combinedSlug = (parts[0] + parts[1]).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (combinedSlug !== domainSlug) {
          ashbyCandidates.push(combinedSlug);
        }
      }

      window._ashbySlugCandidates = ashbyCandidates;
      console.log('[Finder] Ashby slug candidates:', ashbyCandidates);

      if (ashbyCandidates.length > 0) {
        return `https://api.ashbyhq.com/posting-api/job-board/${ashbyCandidates[0]}`;
      }
    } catch (e) {
      console.log('[Finder] Could not extract domain for Ashby:', e.message);
    }

    console.log('[Finder] ashby_jid detected but could not find board slug');
    // Note: Some Ashby boards don't have public posting-api access
    return null;
  }

  // Check for Lever embed patterns in page source
  const leverEmbedMatch = pageHTML.match(/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/i);
  if (leverEmbedMatch) {
    console.log('[Finder] Found embedded Lever board:', leverEmbedMatch[1]);
    return `https://api.lever.co/v0/postings/${leverEmbedMatch[1]}?mode=json`;
  }

  // Check for Ashby embed patterns (company name may contain spaces encoded as %20)
  const ashbyEmbedMatch = pageHTML.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_\-\s%]+)/i);
  if (ashbyEmbedMatch) {
    const companyName = encodeURIComponent(decodeURIComponent(ashbyEmbedMatch[1]));
    console.log('[Finder] Found embedded Ashby board:', companyName);
    return `https://api.ashbyhq.com/posting-api/job-board/${companyName}`;
  }

  // Check for Workable embed patterns - apply.workable.com/{company} format
  const workableApplyEmbedMatch = pageHTML.match(/https?:\/\/apply\.workable\.com\/([a-zA-Z0-9_-]+)/i);
  if (workableApplyEmbedMatch && !['j', 'api'].includes(workableApplyEmbedMatch[1])) {
    console.log('[Finder] Found embedded Workable (apply) board:', workableApplyEmbedMatch[1]);
    return `https://apply.workable.com/api/v1/widget/accounts/${workableApplyEmbedMatch[1]}`;
  }

  // Check for Workable embed patterns - {company}.workable.com format
  const workableEmbedMatch = pageHTML.match(/https?:\/\/([a-zA-Z0-9_-]+)\.workable\.com/i);
  if (workableEmbedMatch && !['www', 'jobs', 'apply'].includes(workableEmbedMatch[1])) {
    console.log('[Finder] Found embedded Workable board:', workableEmbedMatch[1]);
    return `https://${workableEmbedMatch[1]}.workable.com/spi/v3/jobs`;
  }

  // Greenhouse embed variations (including regional like .eu):
  // - job-boards.greenhouse.io/embed/job_board?for={company}
  // - boards.greenhouse.io/embed/job_board?for={company}
  // - boards.eu.greenhouse.io/embed/job_board/js?for={company}
  const greenhouseEmbedMatch = pageUrl.match(/(?:job-)?boards(?:\.[a-z]{2})?\.greenhouse\.io\/embed\/job_board(?:\/js)?\?.*for=([^&#]+)/i);
  if (greenhouseEmbedMatch) {
    console.log('[Finder] Matched Greenhouse embed pattern, company:', greenhouseEmbedMatch[1]);
    return `https://boards-api.greenhouse.io/v1/boards/${greenhouseEmbedMatch[1]}/jobs`;
  }

  // Greenhouse: job-boards.greenhouse.io/{company} or job-boards.eu.greenhouse.io/{company}
  // Handles regional subdomains like .eu, .de, etc.
  const greenhouseMatch = pageUrl.match(/job-boards(?:\.[a-z]{2})?\.greenhouse\.io\/([^\/\?#]+)/i);
  if (greenhouseMatch && greenhouseMatch[1] !== 'embed') {
    console.log('[Finder] Matched Greenhouse job-boards pattern, company:', greenhouseMatch[1]);
    return `https://boards-api.greenhouse.io/v1/boards/${greenhouseMatch[1]}/jobs`;
  }

  // Greenhouse alternate: boards.greenhouse.io/{company} or boards.eu.greenhouse.io/{company}
  const greenhouseAltMatch = pageUrl.match(/boards(?:\.[a-z]{2})?\.greenhouse\.io\/([^\/\?#]+)/i);
  if (greenhouseAltMatch && greenhouseAltMatch[1] !== 'embed') {
    console.log('[Finder] Matched Greenhouse boards pattern, company:', greenhouseAltMatch[1]);
    return `https://boards-api.greenhouse.io/v1/boards/${greenhouseAltMatch[1]}/jobs`;
  }

  // Lever: jobs.lever.co/{company} → api.lever.co/v0/postings/{company}?mode=json
  // Note: Company name may be URL-encoded, normalize it
  const leverMatch = pageUrl.match(/jobs\.lever\.co\/([^\/\?#]+)/i);
  if (leverMatch) {
    const companyName = encodeURIComponent(decodeURIComponent(leverMatch[1]));
    return `https://api.lever.co/v0/postings/${companyName}?mode=json`;
  }

  // Ashby: jobs.ashbyhq.com/{company} → api.ashbyhq.com/posting-api/job-board/{company}
  // Note: Company name may be URL-encoded (%20 for spaces) or decoded, normalize it
  const ashbyMatch = pageUrl.match(/jobs\.ashbyhq\.com\/([^\/\?#]+)/i);
  if (ashbyMatch) {
    // Decode first (in case already encoded), then re-encode to ensure proper format
    const companyName = encodeURIComponent(decodeURIComponent(ashbyMatch[1]));
    return `https://api.ashbyhq.com/posting-api/job-board/${companyName}`;
  }

  // Workable: {company}.workable.com → {company}.workable.com/spi/v3/jobs
  const workableMatch = pageUrl.match(/https?:\/\/([^\.]+)\.workable\.com/i);
  if (workableMatch && !['www', 'jobs', 'apply'].includes(workableMatch[1])) {
    return `https://${workableMatch[1]}.workable.com/spi/v3/jobs`;
  }

  // Workable: apply.workable.com/{company} → apply.workable.com/api/v1/widget/accounts/{company}
  const workableApplyMatch = pageUrl.match(/https?:\/\/apply\.workable\.com\/([^\/\?#]+)/i);
  if (workableApplyMatch && !['j', 'api'].includes(workableApplyMatch[1])) {
    return `https://apply.workable.com/api/v1/widget/accounts/${workableApplyMatch[1]}`;
  }

  // Recruitee: {company}.recruitee.com → {company}.recruitee.com/api/offers
  const recruiteeMatch = pageUrl.match(/https?:\/\/([^\.]+)\.recruitee\.com/i);
  if (recruiteeMatch && recruiteeMatch[1] !== 'www') {
    return `https://${recruiteeMatch[1]}.recruitee.com/api/offers`;
  }

  // Teamtailor: {company}.teamtailor.com or career.{company}.com with teamtailor
  const teamtailorMatch = pageUrl.match(/https?:\/\/([^\.]+)\.teamtailor\.com/i);
  if (teamtailorMatch) {
    return `https://${teamtailorMatch[1]}.teamtailor.com/api/v1/jobs`;
  }

  // BambooHR: {company}.bamboohr.com/careers → {company}.bamboohr.com/careers/list
  const bambooMatch = pageUrl.match(/https?:\/\/([^\.]+)\.bamboohr\.com\/careers/i);
  if (bambooMatch) {
    return `https://${bambooMatch[1]}.bamboohr.com/careers/list`;
  }

  // SmartRecruiters: jobs.smartrecruiters.com/{company}
  const smartMatch = pageUrl.match(/jobs\.smartrecruiters\.com\/([^\/\?#]+)/i);
  if (smartMatch) {
    return `https://api.smartrecruiters.com/v1/companies/${smartMatch[1]}/postings`;
  }

  // Personio: {company}.jobs.personio.com or {company}.jobs.personio.de
  // Note: /xml endpoint is deprecated, use /search.json instead
  const personioMatch = pageUrl.match(/https?:\/\/([^\.]+)\.jobs\.personio\.(com|de)/i);
  if (personioMatch) {
    return `https://${personioMatch[1]}.jobs.personio.${personioMatch[2]}/search.json`;
  }

  // Breezy HR: {company}.breezy.hr
  const breezyMatch = pageUrl.match(/https?:\/\/([^\.]+)\.breezy\.hr/i);
  if (breezyMatch) {
    return `https://${breezyMatch[1]}.breezy.hr/json`;
  }

  // Welcome to the Jungle (WTTJ) job boards - No public API available
  // Includes: jobs.stationf.co, welcometothejungle.com, welcomekit.co
  if (pageUrl.includes('welcometothejungle.') ||
      pageUrl.includes('welcomekit.co') ||
      pageUrl.includes('jobs.stationf.co') ||
      pageHTML.includes('welcometothejungle.') ||
      pageHTML.includes('welcomekit.co')) {
    console.log('[Finder] Welcome to the Jungle (WTTJ) detected - No public API available (uses Algolia)');
    return null;
  }

  // JazzHR: {company}.applytojob.com - No public API available
  const jazzMatch = pageUrl.match(/https?:\/\/([^\.]+)\.applytojob\.com/i);
  if (jazzMatch) {
    console.log('[Finder] JazzHR detected - No public API available');
    return null;
  }

  // SuccessFactors: career*.successfactors.com/career?company=COMPANY
  // Note: No public API available, but we identify it
  const sfMatch = pageUrl.match(/career\d*\.successfactors\.com.*[?&]company=([^&#]+)/i);
  if (sfMatch) {
    console.log('[Finder] SuccessFactors detected (company:', sfMatch[1], ') - No public API available');
    return null; // No public API
  }

  // SuccessFactors embedded in custom domain
  if (pageHTML.includes('successfactors.com') || pageHTML.includes('sap.com/sf/')) {
    const sfCompanyMatch = pageHTML.match(/company[=:]["']?([a-zA-Z0-9_-]+)/i);
    if (sfCompanyMatch) {
      console.log('[Finder] SuccessFactors embedded (company:', sfCompanyMatch[1], ') - No public API available');
    }
    return null;
  }

  // Workday: {company}.wd{N}.myworkdayjobs.com/{locale}/{board}
  // API: POST https://{company}.wd{N}.myworkdayjobs.com/wday/cxs/{company}/{board}/jobs
  const workdayMatch = pageUrl.match(/https?:\/\/([^\.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^\/\?#]+)/i);
  if (workdayMatch) {
    const company = workdayMatch[1];
    const wdVersion = workdayMatch[2];
    const board = workdayMatch[3];
    const workdayApi = `https://${company}.${wdVersion}.myworkdayjobs.com/wday/cxs/${company}/${board}/jobs`;
    console.log('[Finder] Workday detected - API:', workdayApi);
    return workdayApi;
  }

  // BrassRing (IBM Kenexa): sjobs.brassring.com - No public API
  if (pageUrl.includes('brassring.com')) {
    console.log('[Finder] BrassRing (IBM Kenexa) detected - No public API available');
    return null;
  }

  // Taleo: taleo.net - No public API
  if (pageUrl.includes('taleo.net')) {
    console.log('[Finder] Taleo detected - No public API available');
    return null;
  }

  // iCIMS: icims.com - No public API
  if (pageUrl.includes('icims.com')) {
    console.log('[Finder] iCIMS detected - No public API available');
    return null;
  }

  return null;
}

/**
 * Detect API endpoint from page source - Universal Detection
 * Now includes: Network interception + DOM scanning + Delayed detection + URL derivation
 */
function detectAPIEndpoint() {
  console.log('[Finder] Detecting API endpoints (universal mode)...');
  console.log('[Finder] Intercepted network calls:', interceptedAPIs.size);
  console.log('[Finder] Dynamic elements (iframes/scripts):', dynamicURLs.size);

  // First, try to derive API from known URL patterns
  const currentUrl = window.location.href;
  const derivedAPI = deriveAPIFromURL(currentUrl);
  if (derivedAPI) {
    console.log('[Finder] ✓ Derived API from URL pattern:', derivedAPI);
    return derivedAPI;
  }

  const foundAPIs = new Set();

  // Patterns to reject from intercepted APIs (non-job endpoints)
  const rejectInterceptedPatterns = [
    /\/education\//i,
    /\/schools/i,
    /\/degrees/i,
    /\/departments\/?(\?|$)/i,
    /\/offices\/?(\?|$)/i,
    /\/sources\/?(\?|$)/i,
    /\/custom_fields/i,
    /\/demographic/i,
    /\/eeoc/i,
    /\/compliance/i,
    /\.js(\?|$)/i,
    /embed\/job_board\/js/i,
    /embed\/job_board\?for=/i,
    /sparrow\.cloudflare/i,
    /demandbase/i,
    /\$\{/,  // Template variables
  ];

  // Add intercepted network calls (filtered)
  interceptedAPIs.forEach(url => {
    // Skip if matches reject patterns
    if (rejectInterceptedPatterns.some(pattern => pattern.test(url))) {
      console.log('[Finder] Rejecting intercepted non-job URL:', url.substring(0, 60));
      return;
    }
    foundAPIs.add(url);
  });

  // Add dynamically loaded URLs (filtered - skip JS files)
  dynamicURLs.forEach(url => {
    if (url.endsWith('.js') || url.includes('/js?') || url.includes('.js?')) {
      return; // Skip JS files
    }
    foundAPIs.add(url);
  });

  // Known ATS domain patterns (for prioritization)
  const knownATSDomains = [
    'lever.co', 'greenhouse.io', 'workable.com', 'ashbyhq.com', 'ashby.com',
    'smartrecruiters.com', 'jobvite.com', 'breezy.hr', 'bamboohr.com',
    'applytojob.com', 'recruitee.com', 'jazzhr.com', 'rippling.com',
    'personio.com', 'personio.de', 'teamtailor.com', 'workday.com',
    'taleo.net', 'oracle.com', 'icims.com', 'paylocity.com', 'ukg.com',
    'successfactors.com', 'sap.com', 'paycom.com', 'deel.com', 'gusto.com',
    'fountain.com', 'jazz.co', 'hiringthing.com', 'pinpointhq.com',
    'comeet.com', 'polymer.co', 'gem.com', 'eightfold.ai', 'phenom.com',
    'avature.net', 'cornerstoneondemand.com', 'lumesse.com', 'hirebridge.com',
    'jobscore.com', 'clearcompany.com', 'zoho.com', 'freshworks.com',
    'bullhorn.com', 'crelate.com', 'vincere.io', 'manatal.com',
    'loxo.co', 'recruitcrm.io', 'zohorecruit.com', 'factorial.co',
    'hibob.com', 'namely.com', 'zenefits.com', 'justworks.com',
    'trinet.com', 'paychex.com', 'adp.com', 'ceridian.com',
    'myworkday.com', 'myworkdayjobs.com', 'wd5.myworkdayjobs.com'
  ];

  // Job-related keywords to identify relevant APIs (STRICT - must contain these)
  const jobKeywords = [
    // Core job terms - these are the PRIMARY indicators
    'job', 'jobs', 'posting', 'postings',
    'position', 'positions', 'opening', 'openings',
    'vacancy', 'vacancies', 'vacature', // Dutch
    'opportunity', 'opportunities',
    'requisition', 'requisitions',

    // Hiring/recruitment terms
    'recruit', 'recruiting', 'recruitment',
    'hiring', 'hire',

    // Application terms (but NOT just 'apply' which matches many URLs)
    'applicant', 'applicants',
    'candidate', 'candidates',

    // Listing terms
    'listing', 'listings',
    'jobboard',

    // Role terms
    'role', 'roles'

    // NOTE: Removed 'career', 'careers' (too generic, matches non-API pages)
    // NOTE: Removed 'department', 'departments' (matches non-job endpoints)
    // NOTE: Removed 'team', 'teams' (too generic)
    // NOTE: Removed ATS names (handled separately by isKnownATS)
  ];

  // Universal API patterns - catches any API URL
  const universalPatterns = [
    // Any URL with /api/ in path
    /https?:\/\/[^"'\s<>]+\/api\/[^"'\s<>]+/gi,
    // Any URL with api. subdomain
    /https?:\/\/api\.[^"'\s<>]+/gi,
    // Any URL with -api. or _api. in domain
    /https?:\/\/[^"'\s<>]*[-_]api\.[^"'\s<>]+/gi,
    // Any URL with /v1/, /v2/, /v3/, etc. (versioned APIs)
    /https?:\/\/[^"'\s<>]+\/v[0-9]+\/[^"'\s<>]+/gi,
    // Any URL with /rest/ or /graphql/
    /https?:\/\/[^"'\s<>]+\/(rest|graphql)\/[^"'\s<>]+/gi,
    // Any URL ending with .json
    /https?:\/\/[^"'\s<>]+\.json[^"'\s<>]*/gi,
    // Any URL with /feed/ or /data/
    /https?:\/\/[^"'\s<>]+\/(feed|data)\/[^"'\s<>]+/gi,
    // Embed/widget URLs (often contain job data)
    /https?:\/\/[^"'\s<>]+\/(embed|widget|iframe)[^"'\s<>]*/gi,
    // Known ATS URL patterns
    /https?:\/\/[^"'\s<>]*(?:lever|greenhouse|workable|ashby|recruitee|teamtailor|personio|workday|icims|jobvite|breezy|bamboo|smartrecruiter|jazzhr|fountain|paylocity)[^"'\s<>]*/gi
  ];

  // Function to clean extracted URLs
  const cleanUrl = (url) => {
    let cleaned = url
      .replace(/['"\\<>]/g, '')
      .replace(/&quot;/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '')
      .replace(/&gt;/g, '')
      .replace(/\\u002F/g, '/')
      .replace(/\\u003A/g, ':')
      .replace(/[)\]},;`]+$/, '') // Remove trailing punctuation including backticks
      .replace(/`/g, '')          // Remove any backticks
      .trim();

    // Fix malformed double protocols (https://https// or http://https://)
    cleaned = cleaned.replace(/^https?:\/\/https?:?\/\//i, 'https://');
    cleaned = cleaned.replace(/^https?:\/\/http:?\/\//i, 'http://');

    // Also fix double protocol in middle of URL
    cleaned = cleaned.replace(/https?:\/\/https?:\/\//gi, 'https://');

    // Fix missing colon (https// -> https://)
    cleaned = cleaned.replace(/^(https?):?\/\//, '$1://');

    return cleaned;
  };

  // Function to check if URL is job-related
  const isJobRelated = (url) => {
    const lowerUrl = url.toLowerCase();
    return jobKeywords.some(keyword => lowerUrl.includes(keyword));
  };

  // Function to check if URL is from known ATS
  const isKnownATS = (url) => {
    const lowerUrl = url.toLowerCase();
    return knownATSDomains.some(domain => lowerUrl.includes(domain));
  };

  // Function to extract URLs from text
  const extractUrls = (text) => {
    if (!text) return;

    universalPatterns.forEach(pattern => {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(url => {
          const cleaned = cleanUrl(url);
          if (cleaned.startsWith('http') && cleaned.length > 10) {
            foundAPIs.add(cleaned);
          }
        });
      }
    });
  };

  // 1. Check all script tags (inline and src)
  document.querySelectorAll('script').forEach(script => {
    // Check inline script content
    const content = script.textContent || script.innerHTML;
    if (content) {
      extractUrls(content);
    }

    // Check script src attribute
    const src = script.getAttribute('src');
    if (src && src.startsWith('http')) {
      const cleaned = cleanUrl(src);
      if (isJobRelated(cleaned) || isKnownATS(cleaned)) {
        foundAPIs.add(cleaned);
      }
    }
  });

  // 2. Check all iframes (often embed job boards)
  document.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src');
    if (src && src.startsWith('http')) {
      const cleaned = cleanUrl(src);
      foundAPIs.add(cleaned);
    }
  });

  // 3. Check link tags (preconnect, prefetch often reveal APIs)
  document.querySelectorAll('link[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('http')) {
      const cleaned = cleanUrl(href);
      if (isJobRelated(cleaned) || isKnownATS(cleaned)) {
        foundAPIs.add(cleaned);
      }
    }
  });

  // 4. Check meta tags
  document.querySelectorAll('meta[content]').forEach(meta => {
    const content = meta.getAttribute('content');
    if (content) {
      extractUrls(content);
    }
  });

  // 5. Check data attributes on elements
  document.querySelectorAll('[data-url], [data-src], [data-api], [data-endpoint], [data-feed]').forEach(el => {
    ['data-url', 'data-src', 'data-api', 'data-endpoint', 'data-feed'].forEach(attr => {
      const value = el.getAttribute(attr);
      if (value && value.startsWith('http')) {
        foundAPIs.add(cleanUrl(value));
      }
    });
  });

  // 6. Check the entire page HTML for any missed URLs
  const bodyHTML = document.body?.innerHTML || '';
  extractUrls(bodyHTML);

  // 7. Check window object for exposed API configs
  try {
    const windowKeys = ['apiUrl', 'apiEndpoint', 'jobsApi', 'careersApi', 'API_URL', 'API_ENDPOINT',
                        'JOBS_API', 'config', 'settings', '__NEXT_DATA__', '__NUXT__',
                        'pageProps', 'initialProps', 'appData'];

    windowKeys.forEach(key => {
      try {
        const value = window[key];
        if (value) {
          const str = typeof value === 'string' ? value : JSON.stringify(value);
          extractUrls(str);
        }
      } catch (e) {}
    });
  } catch (e) {}

  // 8. Check for Next.js/Nuxt.js data
  const nextDataEl = document.getElementById('__NEXT_DATA__');
  if (nextDataEl) {
    extractUrls(nextDataEl.textContent);
  }

  // Filter and categorize results - Exclude tracking, analytics, and non-job APIs
  const excludePatterns = [
    // File types - INCLUDING JavaScript files
    /\.(pdf|png|jpg|jpeg|gif|svg|ico|webp|css|woff|woff2|ttf|eot|mp4|mp3|wav)(\?|$)/i,
    /\.js(\?|$)/i,                 // JavaScript files
    /\/js\?/i,                     // JS endpoints like /js?for=
    /\/js\//i,                     // JS in path

    // CDN and static assets
    /fonts\./i,
    /cdn\./i,
    /static\./i,
    /assets\./i,
    /cloudfront/i,
    /amazonaws.*(?!execute-api)/i, // Keep API Gateway, exclude S3
    /akamai/i,
    /fastly/i,
    /_next\/static/i,              // Next.js static chunks
    /chunks\//i,                   // Webpack chunks

    // Cloudflare (analytics, workers, etc.)
    /sparrow\.cloudflare/i,        // Cloudflare analytics
    /cloudflare\.com\/cdn/i,
    /cloudflareinsights/i,
    /challenges\.cloudflare/i,

    // Analytics & tracking
    /analytics\./i,
    /google-analytics/i,
    /googletagmanager/i,
    /gtag\//i,
    /gtm\./i,
    /facebook\.com/i,
    /facebook\.net/i,
    /twitter\.com/i,
    /linkedin\.com\/(?!jobs)/i,
    /sentry\./i,
    /hotjar/i,
    /segment\./i,
    /mixpanel/i,
    /amplitude/i,
    /heap\./i,
    /fullstory/i,
    /logrocket/i,
    /newrelic/i,
    /datadog/i,
    /bugsnag/i,
    /rollbar/i,
    /demandbase/i,                 // Demandbase marketing

    // Chat & support widgets
    /intercom/i,
    /zendesk/i,
    /crisp/i,
    /drift/i,
    /freshchat/i,
    /tawk\.to/i,
    /livechat/i,
    /olark/i,

    // Marketing
    /hubspot(?!.*jobs)/i,
    /marketo/i,
    /pardot/i,
    /mailchimp/i,
    /klaviyo/i,
    /braze/i,
    /iterable/i,
    /customer\.io/i,
    /optimizely/i,
    /vwo\.com/i,
    /abtasty/i,

    // Event/tracking endpoints
    /\/track($|\/|\?)/i,
    /\/pixel($|\/|\?)/i,
    /\/beacon($|\/|\?)/i,
    /\/event($|\/|\?)/i,           // Catches /event and /events
    /\/events($|\/|\?)/i,
    /\/log($|\/|\?)/i,
    /\/logs($|\/|\?)/i,
    /\/collect($|\/|\?)/i,
    /\/analytics($|\/|\?)/i,
    /\/telemetry($|\/|\?)/i,
    /\/metrics($|\/|\?)/i,
    /\/pageview/i,
    /\/click($|\/|\?)/i,
    /\/impression/i,
    /\/conversion/i,

    // Auth endpoints (not job APIs)
    /\/oauth/i,
    /\/auth($|\/|\?)/i,
    /\/login($|\/|\?)/i,
    /\/logout($|\/|\?)/i,
    /\/session($|\/|\?)/i,
    /\/token($|\/|\?)/i,
    /cognito/i,
    /auth0/i,
    /okta/i,

    // Common non-job API paths
    /\/health($|\/|\?)/i,
    /\/status($|\/|\?)/i,
    /\/ping($|\/|\?)/i,
    /\/version($|\/|\?)/i,
    /\/config($|\/|\?)/i,
    /\/settings($|\/|\?)/i,
    /\/feature-flags/i,
    /\/flags($|\/|\?)/i,

    // Payment/subscription (not jobs)
    /stripe/i,
    /paypal/i,
    /braintree/i,
    /chargebee/i,
    /recurly/i,

    // Social sharing APIs (not job APIs)
    /api\.whatsapp\.com/i,
    /wa\.me/i,
    /t\.me/i,              // Telegram
    /twitter\.com\/intent/i,
    /x\.com\/intent/i,
    /facebook\.com\/sharer/i,
    /linkedin\.com\/sharing/i,
    /reddit\.com\/submit/i,
    /pinterest\.com\/pin/i,
    /mailto:/i,

    // ========== NON-JOB ATS ENDPOINTS (CRITICAL) ==========
    // These are Greenhouse/Lever/etc endpoints that are NOT job listings
    /\/education\//i,              // Education dropdowns (schools, degrees)
    /\/education$/i,
    /\/schools/i,                  // School lists
    /\/degrees/i,                  // Degree lists
    /\/departments\/?(\?|$)/i,     // Department lists (not jobs)
    /\/offices\/?(\?|$)/i,         // Office locations (not jobs)
    /\/sources\/?(\?|$)/i,         // Referral sources (not jobs)
    /\/compliance/i,               // Compliance data
    /\/custom_fields/i,            // Form field definitions
    /\/demographic/i,              // Demographic questions
    /\/eeoc/i,                     // EEOC compliance data

    // Embed pages that return HTML, not JSON
    /embed\/job_board\?for=/i,     // Greenhouse HTML embed (not API)
    /embed\/job_board\/js/i,       // Greenhouse JS embed

    // Keka HR JavaScript embeds (not APIs)
    /\.keka\.com\/careers\/api\/embedjobs\/js/i,

    // Pinpoint HR non-job endpoints
    /pinpointhq\.com\/jobs\.json/i // Returns HTML, not proper JSON
  ];

  // STRICT FILTERING: Only keep URLs that are actual API endpoints
  const validAPIs = Array.from(foundAPIs).filter(url => {
    // Must start with http
    if (!url.startsWith('http')) return false;

    // Reject malformed URLs (double protocol, invalid format)
    if (/^https?:\/\/https?/i.test(url)) return false;
    if (url.includes('//http')) return false;

    // Reject URLs with unresolved template variables like ${boardCode}
    if (/\$\{[^}]+\}/.test(url)) {
      console.log('[Finder] Rejecting URL with template variable:', url);
      return false;
    }

    // Reject URLs with backticks (malformed)
    if (url.includes('`')) return false;

    // Must be a valid URL
    try {
      new URL(url);
    } catch (e) {
      return false;
    }

    // Must not match exclude patterns
    if (excludePatterns.some(pattern => pattern.test(url))) return false;

    // Must be reasonable length
    if (url.length < 15 || url.length > 500) return false;

    const lowerUrl = url.toLowerCase();

    // EXCLUDE: Current page URL (we're looking for API, not the page itself)
    if (url === currentUrl || lowerUrl === currentUrl.toLowerCase()) {
      return false;
    }

    // EXCLUDE: Individual job post URLs (have job ID or slug after company)
    // These patterns match: /company/job-id, /company/uuid, /company/slug-title
    const individualJobPatterns = [
      // UUID pattern in URL
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      // Lever individual job: jobs.lever.co/company/jobid
      /jobs\.lever\.co\/[^\/]+\/[^\/\?]+$/i,
      // Greenhouse individual job: boards.greenhouse.io/company/jobs/123
      /greenhouse\.io\/[^\/]+\/jobs\/\d+/i,
      // Ashby individual job: jobs.ashbyhq.com/company/jobid
      /ashbyhq\.com\/[^\/]+\/[^\/\?]+$/i,
      // Workable individual job: company.workable.com/j/JOBCODE
      /workable\.com\/j\//i,
      // Generic: URL ending with numeric ID
      /\/\d{5,}($|\?)/,
      // Generic: URL with slug that looks like job title (has multiple hyphens)
      /\/[a-z]+-[a-z]+-[a-z]+-[a-z]+/i,
    ];

    if (individualJobPatterns.some(pattern => pattern.test(url))) {
      // But allow if it has clear API indicators
      const hasApiIndicator =
        lowerUrl.includes('/api/') ||
        lowerUrl.includes('api.') ||
        lowerUrl.includes('-api.') ||
        lowerUrl.endsWith('.json') ||
        /\/v[0-9]+\//.test(lowerUrl) ||
        lowerUrl.includes('mode=json') ||
        lowerUrl.includes('format=json');

      if (!hasApiIndicator) {
        return false;
      }
    }

    // MUST be from known ATS domain OR contain job-related keywords
    const isFromKnownATS = isKnownATS(url);
    const hasJobKeyword = jobKeywords.some(keyword => lowerUrl.includes(keyword));

    // If neither, reject it
    if (!isFromKnownATS && !hasJobKeyword) {
      return false;
    }

    return true;
  });

  // Score and sort APIs by relevance
  const scoredAPIs = validAPIs.map(url => {
    let score = 0;
    const lowerUrl = url.toLowerCase();

    // Check for API indicators (REQUIRED for high score)
    const hasApiIndicator =
      lowerUrl.includes('/api/') ||
      lowerUrl.includes('api.') ||
      lowerUrl.includes('-api.') ||
      lowerUrl.includes('_api.') ||
      lowerUrl.endsWith('.json') ||
      /\/v[0-9]+\//.test(lowerUrl) ||
      lowerUrl.includes('mode=json') ||
      lowerUrl.includes('format=json') ||
      lowerUrl.includes('/rest/') ||
      lowerUrl.includes('/graphql');

    // INTERCEPTED API with API indicator (highest priority)
    if (interceptedAPIs.has(url) && hasApiIndicator) score += 200;
    // Intercepted but no API indicator (might be job page navigation)
    else if (interceptedAPIs.has(url)) score += 50;

    // Dynamic iframe/script with API indicator
    if (dynamicURLs.has(url) && hasApiIndicator) score += 100;
    else if (dynamicURLs.has(url)) score += 30;

    // API indicators are heavily weighted
    if (lowerUrl.includes('/api/')) score += 80;
    if (lowerUrl.includes('api.')) score += 70;
    if (lowerUrl.includes('-api.') || lowerUrl.includes('_api.')) score += 60;
    if (/\/v[0-9]+\//.test(lowerUrl)) score += 50;
    if (lowerUrl.endsWith('.json') || lowerUrl.includes('mode=json')) score += 60;

    // Known ATS API domains (only the API subdomains, not job listing pages)
    const atsApiDomains = [
      'api.lever.co', 'boards-api.greenhouse.io', 'api.ashbyhq.com',
      'api.smartrecruiters.com', 'api.recruitee.com', 'api.teamtailor.com',
      'myworkdayjobs.com/wday/cxs',  // Workday API
      'apply.workable.com/api/'      // Workable API
    ];
    if (atsApiDomains.some(domain => lowerUrl.includes(domain))) {
      // Extra check: must be a jobs endpoint, not education/departments/etc
      if (lowerUrl.includes('/jobs') || lowerUrl.includes('/postings') || lowerUrl.includes('mode=json')) {
        score += 150;
      } else {
        // It's an ATS API domain but NOT a jobs endpoint - penalize heavily
        score -= 200;
        console.log('[Finder] ATS API but not jobs endpoint:', url);
      }
    }

    // Known ATS domain (but not necessarily API)
    if (isKnownATS(url)) score += 20;

    // Contains job-related keywords (reduced weight)
    let keywordCount = 0;
    jobKeywords.forEach(keyword => {
      if (lowerUrl.includes(keyword)) keywordCount++;
    });
    score += Math.min(keywordCount * 3, 15); // Cap at 15 points

    // Has embed/widget (often job embed)
    if (lowerUrl.includes('embed') || lowerUrl.includes('widget')) score += 15;

    // Bonus for common job API endpoint patterns
    if (/\/(jobs|postings|positions|openings|vacancies)\/?(\?|$)/i.test(lowerUrl)) score += 30;

    // Bonus for pagination patterns (indicates list endpoint)
    if (/[?&](page|offset|limit|per_page)=/i.test(lowerUrl)) score += 20;

    // PENALTIES

    // Penalize URLs that look like job listing pages (not APIs)
    // These are HTML pages, not API endpoints
    const jobListingPagePatterns = [
      /^https?:\/\/jobs\.lever\.co\/[^\/]+\/?$/i,           // jobs.lever.co/company
      /^https?:\/\/[^\/]*boards\.greenhouse\.io\/[^\/]+\/?$/i, // boards.greenhouse.io/company
      /^https?:\/\/jobs\.ashbyhq\.com\/[^\/]+\/?$/i,        // jobs.ashbyhq.com/company
      /^https?:\/\/[^\.]+\.workable\.com\/?$/i,             // company.workable.com
      /^https?:\/\/[^\.]+\.recruitee\.com\/?$/i,            // company.recruitee.com
      /^https?:\/\/[^\.]+\.teamtailor\.com\/?$/i,           // company.teamtailor.com
      /^https?:\/\/[^\.]+\.bamboohr\.com\/careers\/?$/i,    // company.bamboohr.com/careers
    ];
    if (jobListingPagePatterns.some(pattern => pattern.test(url))) {
      score -= 100; // Heavy penalty - this is the page, not the API
    }

    // Penalize if URL looks like a career/jobs HTML page
    if (/\/(careers?|jobs?)\/?($|\?|#)/i.test(lowerUrl) && !hasApiIndicator) {
      score -= 50;
    }

    // Penalize very long URLs (likely tracking)
    if (url.length > 200) score -= 30;

    // Penalize URLs with many query params (likely tracking)
    const queryParams = (url.match(/[&?]/g) || []).length;
    if (queryParams > 5) score -= queryParams * 3;

    // HARD REQUIREMENT: Must have API indicator to be considered valid
    // Without it, set score to 0 (will be filtered out by threshold)
    if (!hasApiIndicator) {
      score = 0;
    }

    const source = interceptedAPIs.has(url) ? 'LIVE' : dynamicURLs.has(url) ? 'DYNAMIC' : 'DOM';
    return { url, score, source };
  });

  // Sort by score descending
  scoredAPIs.sort((a, b) => b.score - a.score);

  // Get best API (highest score, must have score >= 50 to be considered a real API)
  // This threshold ensures we only return actual API endpoints, not job pages
  const bestAPI = scoredAPIs.find(api => api.score >= 50);

  // Enhanced logging
  const liveCount = scoredAPIs.filter(a => a.source === 'LIVE').length;
  const dynamicCount = scoredAPIs.filter(a => a.source === 'DYNAMIC').length;
  const domCount = scoredAPIs.filter(a => a.source === 'DOM').length;

  console.log('[Finder] ====== JOB API DETECTION RESULTS ======');
  console.log('[Finder] Raw URLs scanned:', foundAPIs.size);
  console.log('[Finder] Job-related APIs found:', scoredAPIs.length);
  console.log('[Finder] Sources: LIVE:', liveCount, '| DYNAMIC:', dynamicCount, '| DOM:', domCount);

  if (scoredAPIs.length > 0) {
    console.log('[Finder] Top candidates:');
    scoredAPIs.slice(0, 5).forEach((a, i) => {
      console.log(`  ${i + 1}. [${a.source}] Score: ${a.score} - ${a.url.substring(0, 80)}${a.url.length > 80 ? '...' : ''}`);
    });
    if (bestAPI) {
      console.log('[Finder] ✓ Best Job API (score >= 50):', bestAPI.url);
    } else {
      console.log('[Finder] ✗ No candidates met score threshold (>= 50)');
    }
  } else {
    console.log('[Finder] ✗ No job-related URLs found on this page');
  }

  return bestAPI ? bestAPI.url : null;
}

/**
 * Trigger lazy-loaded content to discover more APIs
 * Call this before detectAPIEndpoint for better results
 */
async function triggerLazyContent() {
  console.log('[Finder] Triggering lazy-loaded content...');

  // Check if this is a Greenhouse page (needs more time to load)
  const isGreenhousePage = window.location.href.includes('gh_jid=');
  const waitTime = isGreenhousePage ? 300 : 100;

  // 1. Scroll to trigger infinite scroll / lazy loading
  const scrollPositions = [0.5, 1];
  for (const pos of scrollPositions) {
    window.scrollTo(0, document.body.scrollHeight * pos);
    await new Promise(r => setTimeout(r, waitTime));
  }
  window.scrollTo(0, 0);

  // 1b. For Greenhouse pages, wait extra time for embed to load
  if (isGreenhousePage) {
    console.log('[Finder] Greenhouse page detected, waiting for embed to load...');

    // Wait up to 2 seconds for the Greenhouse embed to appear
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise(r => setTimeout(r, 500));

      // Check if grnhse_app div exists (Greenhouse creates this)
      const grnhseApp = document.getElementById('grnhse_app');
      if (grnhseApp) {
        console.log('[Finder] Found #grnhse_app div');
        break;
      }

      // Check if any Greenhouse scripts/iframes have loaded
      const pageHTML = document.documentElement.innerHTML;
      if (pageHTML.includes('greenhouse.io') || pageHTML.includes('grnhse')) {
        console.log('[Finder] Found greenhouse reference in HTML after wait');
        break;
      }

      // Check intercepted network calls
      const ghApiCalls = Array.from(interceptedAPIs).filter(u => u.includes('greenhouse'));
      if (ghApiCalls.length > 0) {
        console.log('[Finder] Found greenhouse in intercepted APIs:', ghApiCalls);
        break;
      }

      console.log('[Finder] Waiting for Greenhouse embed... attempt', attempt + 1);
    }

    // Try to find and click any "View Job" or similar buttons
    const jobButtons = document.querySelectorAll('button, a');
    for (const btn of jobButtons) {
      const text = btn.textContent?.toLowerCase() || '';
      if (text.includes('apply') || text.includes('view job') || text.includes('see job')) {
        btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        btn.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // 2. Click "Load More" or "Show All" buttons if present
  const loadMoreSelectors = [
    'button[class*="load-more"]',
    'button[class*="show-more"]',
    'button[class*="view-all"]',
    'a[class*="load-more"]',
    'a[class*="show-more"]',
    '[data-action="load-more"]',
    '.load-more',
    '.show-more',
    '.view-all-jobs'
  ];

  for (const selector of loadMoreSelectors) {
    try {
      const btn = document.querySelector(selector);
      if (btn && btn.offsetParent !== null) { // visible
        btn.click();
        console.log('[Finder] Clicked load more button:', selector);
        await new Promise(r => setTimeout(r, 300)); // Reduced from 1000ms
      }
    } catch (e) {}
  }

  // 3. Trigger any iframes to load
  document.querySelectorAll('iframe[data-src]').forEach(iframe => {
    if (!iframe.src && iframe.dataset.src) {
      iframe.src = iframe.dataset.src;
    }
  });

  // Wait for network requests to complete
  await new Promise(r => setTimeout(r, 200));

  console.log('[Finder] Lazy content triggered, intercepted APIs:', interceptedAPIs.size);
}

console.log('[Finder] Ready to find career pages');
