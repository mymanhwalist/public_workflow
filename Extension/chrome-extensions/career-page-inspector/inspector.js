/**
 * Career Page Inspector - Content Script
 * Shows overlay button for user to save career page and trigger inspection
 */

console.log('[Inspector] ========================================');
console.log('[Inspector] Content script STARTING to load...');
console.log('[Inspector] URL:', window.location.href);
console.log('[Inspector] ========================================');
console.log('[Inspector] Content script loaded');

let currentPageId = null;
let currentCompanyName = null;
let overlayButton = null;
let overlayCleanup = null; // Store cleanup function for event listeners
let savedCareerPages = []; // Track multiple career pages for same company

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'initInspector') {
    console.log('[Inspector] ===== INIT INSPECTOR =====');
    console.log('[Inspector] Company:', request.companyName);
    console.log('[Inspector] Page ID:', request.pageId);
    console.log('[Inspector] Current URL:', window.location.href);

    // Reset if new company
    if (currentPageId !== request.pageId) {
      console.log('[Inspector] New company detected, resetting saved pages');
      savedCareerPages = [];
    }

    currentPageId = request.pageId;
    currentCompanyName = request.companyName;

    // Show overlay button
    console.log('[Inspector] About to show overlay button...');
    try {
      showOverlayButton();
      console.log('[Inspector] ✓ Overlay button shown successfully');
    } catch (error) {
      console.error('[Inspector] ✗ Error showing overlay button:', error);
    }

    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'scrapeJobTable') {
    console.log('[Inspector] Scraping job table for:', request.companyName);
    console.log('[Inspector] Job table selector:', request.jobTableSelector);
    console.log('[Inspector] Job item selector:', request.jobItemSelector);

    try {
      // Find the job table container using the selector
      const jobTableElement = document.querySelector(request.jobTableSelector);

      if (!jobTableElement) {
        console.error('[Inspector] Job table element not found with selector:', request.jobTableSelector);
        sendResponse({
          success: false,
          error: `Job table not found: ${request.jobTableSelector}`
        });
        return true;
      }

      // Extract the outerHTML
      const jobTableHtml = jobTableElement.outerHTML;

      // Find the first job item to extract the job URL
      const firstJobItem = jobTableElement.querySelector(request.jobItemSelector);
      let firstJobUrl = null;

      if (firstJobItem) {
        // Look for a link within the job item
        const link = firstJobItem.querySelector('a[href]');
        if (link) {
          firstJobUrl = link.href;
          console.log('[Inspector] Found first job URL:', firstJobUrl);
        }
      }

      // Detect API endpoint on the career page
      const apiEndpoint = detectAPIEndpoint();
      if (apiEndpoint) {
        console.log('[Inspector] ✓ Detected API endpoint:', apiEndpoint);
      }

      console.log('[Inspector] ✓ Scraped job table HTML, length:', jobTableHtml.length);

      sendResponse({
        success: true,
        jobTableHtml: jobTableHtml,
        firstJobUrl: firstJobUrl,
        apiEndpoint: apiEndpoint
      });
      return true;

    } catch (error) {
      console.error('[Inspector] Error scraping job table:', error);
      sendResponse({
        success: false,
        error: error.message
      });
      return true;
    }
  }

  if (request.action === 'scrapeJobDetail') {
    console.log('[Inspector] Scraping job detail page');

    try {
      // Get the entire job detail page HTML
      const jobDetailElement = document.querySelector('body');

      if (!jobDetailElement) {
        sendResponse({
          success: false,
          error: 'Job detail page not found'
        });
        return true;
      }

      const jobDetailHtml = jobDetailElement.outerHTML;

      // Parse job detail page for structured data
      const parsedData = parseJobDetailPage();

      console.log('[Inspector] ✓ Scraped job detail HTML, length:', jobDetailHtml.length);
      console.log('[Inspector] ✓ Parsed job data:', parsedData);

      sendResponse({
        success: true,
        jobDetailHtml: jobDetailHtml,
        parsedJobData: parsedData
      });
      return true;

    } catch (error) {
      console.error('[Inspector] Error scraping job detail:', error);
      sendResponse({
        success: false,
        error: error.message
      });
      return true;
    }
  }

  return false;
});

/**
 * Helper function to remove overlay with cleanup
 */
function removeOverlay() {
  if (overlayButton) {
    // Call cleanup to remove event listeners
    if (overlayCleanup) {
      overlayCleanup();
      overlayCleanup = null;
    }
    overlayButton.remove();
    overlayButton = null;
  }
}

/**
 * Show floating overlay button
 */
function showOverlayButton() {
  console.log('[Inspector] showOverlayButton() called');

  // Remove existing button if any
  if (overlayButton) {
    console.log('[Inspector] Removing existing overlay button');
    removeOverlay();
  }

  console.log('[Inspector] Creating new overlay button element');
  // Create overlay button with backdrop
  overlayButton = document.createElement('div');
  overlayButton.id = 'career-inspector-button';
  overlayButton.style.cssText = 'all: initial; * { all: unset; }'; // Reset all styles
  overlayButton.innerHTML = `
    <!-- Semi-transparent backdrop for visibility -->
    <div style="
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      height: 250px;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
      z-index: 2147483646;
      pointer-events: none;
      border-radius: 0 0 0 20px;
    "></div>
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
      backdrop-filter: blur(10px);
    ">
      <div style="font-size: 11px; opacity: 0.9; margin-bottom: 8px; text-align: center;">
        ${currentCompanyName}
      </div>
      <button id="save-career-btn" style="
        width: 100%;
        background: white;
        color: #667eea;
        border: none;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        margin-bottom: 8px;
        transition: all 0.2s;
        font-family: inherit;
      " onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)';" onmouseout="this.style.transform=''; this.style.boxShadow='';">
        🔍 Save Career Page & Inspect
      </button>
      <button id="skip-company-btn" style="
        width: 100%;
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.3);
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
      " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)';" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)';">
        ⏭️ Skip This Company
      </button>
    </div>
  `;

  // Add event listeners with delay to ensure elements exist
  setTimeout(() => {
    const saveBtn = document.getElementById('save-career-btn');
    const skipBtn = document.getElementById('skip-company-btn');

    if (saveBtn) {
      saveBtn.addEventListener('click', handleSaveCareerPage);
      console.log('[Inspector] ✓ Save button event listener added');
    } else {
      console.error('[Inspector] ✗ Save button not found!');
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', handleSkipCompany);
      console.log('[Inspector] ✓ Skip button event listener added');
    } else {
      console.error('[Inspector] ✗ Skip button not found!');
    }
  }, 100);

  console.log('[Inspector] Appending overlay button to document.body');
  if (!document.body) {
    console.error('[Inspector] ✗ document.body is null! Page may not be loaded.');
    return;
  }

  document.body.appendChild(overlayButton);

  // Make the overlay draggable and store cleanup function
  overlayCleanup = makeOverlayDraggable(overlayButton);

  console.log('[Inspector] ✓ Overlay button appended to body');
  console.log('[Inspector] ✓ Overlay button shown for company:', currentCompanyName);
}

/**
 * Handle save career page button click
 */
async function handleSaveCareerPage(event) {
  // Prevent double clicks
  if (event && event.target) {
    event.target.disabled = true;
  }

  console.log('[Inspector] User clicked save button');

  // Update button to show loading
  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647; /* Maximum z-index to appear above all modals */
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      font-weight: 600;
      user-select: none;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">⏳</span>
        <div>
          <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
            ${currentCompanyName}
          </div>
          <div style="font-size: 15px; font-weight: 700;">
            Inspecting page...
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    // Get current URL
    const careerPageUrl = window.location.href;

    // Inspect the page
    const inspection = inspectCareerPage();

    // Detect API endpoint (for career page job listings)
    const apiEndpoint = detectAPIEndpoint();
    inspection.api_endpoint = apiEndpoint;

    // Auto-generate detail API pattern if list API exists
    if (apiEndpoint) {
      // For APIs that return lists, the detail endpoint is usually: {list_api}/{id}
      inspection.api_endpoint_detail = apiEndpoint.replace(/\?.*$/, '') + '/{id}';
      console.log('[Inspector] ✓ Detected list API:', apiEndpoint);
      console.log('[Inspector] ✓ Generated detail API:', inspection.api_endpoint_detail);
    }

    // Extract application URL (where users apply for jobs)
    const applicationUrl = extractApplicationUrl();
    inspection.application_url = applicationUrl;
    console.log('[Inspector] ✓ Detected application URL:', applicationUrl);

    // Detect ATS provider
    const atsProvider = detectATS();
    inspection.ats_provider = atsProvider;
    console.log('[Inspector] ✓ Detected ATS provider:', atsProvider);

    console.log('[Inspector] Inspection result:', inspection);

    // Show selector review/editing UI
    showSelectorReviewUI(careerPageUrl, inspection);

  } catch (error) {
    console.error('[Inspector] Error during inspection:', error);

    // Show error
    overlayButton.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647; /* Maximum z-index to appear above all modals */
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
        font-weight: 600;
        user-select: none;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">❌</span>
          <div>
            <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
              ${currentCompanyName}
            </div>
            <div style="font-size: 15px; font-weight: 700;">
              Error: ${error.message}
            </div>
          </div>
        </div>
      </div>
    `;

    // Send error to background script
    chrome.runtime.sendMessage({
      action: 'careerPageSaved',
      pageId: currentPageId,
      success: false,
      error: error.message
    });
  }
}

/**
 * Handle "Save Another Career Page" button click
 */
function handleSaveAnotherPage() {
  console.log('[Inspector] User wants to save another career page');

  // Reset overlay button to initial state
  showOverlayButton();
}

/**
 * Handle "Next Company" button click
 */
function handleNextCompany() {
  console.log('[Inspector] ========================================');
  console.log('[Inspector] USER CLICKED NEXT COMPANY BUTTON');
  console.log('[Inspector] Saved pages:', savedCareerPages.length);
  console.log('[Inspector] ========================================');

  // Show final state
  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647; /* Maximum z-index to appear above all modals */
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      font-weight: 600;
      user-select: none;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">✅</span>
        <div>
          <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
            ${currentCompanyName}
          </div>
          <div style="font-size: 15px; font-weight: 700;">
            Complete! Moving to next...
          </div>
        </div>
      </div>
    </div>
  `;

  // Get all career page URLs
  // Validate savedCareerPages array
  if (!savedCareerPages || savedCareerPages.length === 0) {
    console.error('[Inspector] No saved career pages!');
    showOverlayButton(); // Reset UI
    return;
  }

  const careerPageUrls = savedCareerPages.map(p => p.url);

  // Use inspection data from first saved page (or could use last, or best match)
  const inspection = savedCareerPages[0].inspection;

  console.log('[Inspector] Sending to background:', {
    pageId: currentPageId,
    careerPageUrls,
    inspection
  });

  // Send result to background script
  chrome.runtime.sendMessage({
    action: 'careerPageSaved',
    pageId: currentPageId,
    careerPageUrls: careerPageUrls, // Array of URLs
    inspection: inspection,
    success: true
  }, (response) => {
    console.log('[Inspector] Background response:', response);
  });

  // Remove button after 1 second (tab will close)
  setTimeout(() => {
    removeOverlay();
  }, 1000);
}

/**
 * Handle "Skip This Company" button click
 */
function handleSkipCompany() {
  console.log('[Inspector] User skipped company:', currentCompanyName);

  // Show skipped state
  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      font-weight: 600;
      user-select: none;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">⏭️</span>
        <div>
          <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
            ${currentCompanyName}
          </div>
          <div style="font-size: 15px; font-weight: 700;">
            Skipped! Moving to next...
          </div>
        </div>
      </div>
    </div>
  `;

  // Send skip message to background script
  chrome.runtime.sendMessage({
    action: 'companySkipped',
    pageId: currentPageId,
    companyName: currentCompanyName
  });

  // Remove button after 1 second (tab will close)
  setTimeout(() => {
    removeOverlay();
  }, 1000);
}

/**
 * Show selector review/editing UI with both auto-detected and manual input
 */
function showSelectorReviewUI(careerPageUrl, inspection) {
  // Count how many elements each selector finds
  const containerCount = inspection.job_table ? document.querySelectorAll(inspection.job_table).length : 0;
  const itemsCount = inspection.job_table && inspection.job_item ?
    document.querySelectorAll(`${inspection.job_table} ${inspection.job_item}`).length : 0;

  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      user-select: none;
      max-width: 450px;
      max-height: 90vh;
      overflow-y: auto;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div>
          <div style="font-size: 11px; opacity: 0.9;">
            ${currentCompanyName}
          </div>
          <div style="font-size: 16px; font-weight: 700; margin-top: 4px;">
            📋 Review Selectors
          </div>
        </div>
        <div style="font-size: 20px; opacity: 0.4; cursor: move; user-select: none;" title="Drag to move popup">⋮⋮</div>
      </div>

      <!-- Auto-detected section -->
      <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; opacity: 0.95;">
          🤖 Auto-detected:
        </div>
        <div style="font-size: 11px; line-height: 1.6; opacity: 0.9;">
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">Container:</span>
            <span style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px;">
              ${inspection.job_table || 'Not found'}
            </span>
            <span style="opacity: 0.7; margin-left: 4px;">(${containerCount} found)</span>
          </div>
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">Items:</span>
            <span style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px;">
              ${inspection.job_item || 'Not found'}
            </span>
            <span style="opacity: 0.7; margin-left: 4px;">(${itemsCount} found)</span>
          </div>
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">Link:</span>
            <span style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px; font-size: 10px;">
              ${inspection.job_page || 'Not found'}
            </span>
          </div>
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">API (list):</span>
            <span style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px; font-size: 10px;">
              ${inspection.api_endpoint || 'Not found (optional)'}
            </span>
          </div>
          ${inspection.api_endpoint_detail ? `
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">API (detail):</span>
            <span style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px; font-size: 10px;">
              ${inspection.api_endpoint_detail}
            </span>
          </div>
          ` : ''}
          ${inspection.application_url ? `
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">Apply URL:</span>
            <span style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px; font-size: 10px;">
              ${inspection.application_url}
            </span>
          </div>
          ` : ''}
          ${inspection.ats_provider ? `
          <div style="margin-bottom: 4px;">
            <span style="opacity: 0.7;">ATS:</span>
            <span style="font-family: monospace; background: rgba(16, 185, 129, 0.2); padding: 2px 6px; border-radius: 3px; font-size: 10px; color: rgba(16, 185, 129, 1);">
              ${inspection.ats_provider}
            </span>
          </div>
          ` : ''}
        </div>
        ${inspection.api_endpoint ? `
          <button id="test-api-btn" style="
            margin-top: 8px;
            width: 100%;
            padding: 6px 10px;
            background: rgba(16, 185, 129, 0.2);
            border: 1px solid rgba(16, 185, 129, 0.4);
            border-radius: 4px;
            color: white;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
          ">
            🧪 Test API
          </button>
          <div id="api-test-result" style="font-size: 10px; margin-top: 6px; line-height: 1.4;"></div>
        ` : ''}
      </div>

      <!-- Manual input section -->
      <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; opacity: 0.95; display: flex; justify-content: space-between; align-items: center;">
          <span>✏️ Edit manually (optional):</span>
          <button id="paste-html-btn" style="
            padding: 4px 8px;
            background: rgba(255,255,255,0.2);
            border: none;
            border-radius: 4px;
            font-size: 10px;
            color: white;
            cursor: pointer;
            font-weight: 600;
          ">📋 Paste HTML</button>
        </div>
        <div style="margin-bottom: 8px;">
          <label style="font-size: 11px; opacity: 0.8; display: block; margin-bottom: 3px;">Container selector:</label>
          <input type="text" id="manual-container" value="${inspection.job_table || ''}" style="
            width: 100%;
            padding: 6px;
            background: rgba(255,255,255,0.9);
            border: none;
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            color: #333;
          " placeholder=".job-listings">
          <button id="test-container" style="
            margin-top: 4px;
            padding: 4px 8px;
            background: rgba(255,255,255,0.2);
            border: none;
            border-radius: 4px;
            font-size: 10px;
            color: white;
            cursor: pointer;
          ">Test</button>
          <span id="container-result" style="font-size: 10px; margin-left: 6px; opacity: 0.8;"></span>
        </div>
        <div style="margin-bottom: 8px;">
          <label style="font-size: 11px; opacity: 0.8; display: block; margin-bottom: 3px;">Item selector:</label>
          <input type="text" id="manual-item" value="${inspection.job_item || ''}" style="
            width: 100%;
            padding: 6px;
            background: rgba(255,255,255,0.9);
            border: none;
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            color: #333;
          " placeholder="div.job-card">
          <button id="test-item" style="
            margin-top: 4px;
            padding: 4px 8px;
            background: rgba(255,255,255,0.2);
            border: none;
            border-radius: 4px;
            font-size: 10px;
            color: white;
            cursor: pointer;
          ">Test</button>
          <span id="item-result" style="font-size: 10px; margin-left: 6px; opacity: 0.8;"></span>
        </div>
        <div>
          <label style="font-size: 11px; opacity: 0.8; display: block; margin-bottom: 3px;">Link pattern (optional):</label>
          <input type="text" id="manual-link" value="${inspection.job_page || ''}" style="
            width: 100%;
            padding: 6px;
            background: rgba(255,255,255,0.9);
            border: none;
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            color: #333;
          " placeholder="/jobs/{id}">
        </div>
      </div>

      <!-- Visual picker button -->
      <div style="margin-bottom: 8px;">
        <button id="visual-picker-btn" style="
          width: 100%;
          padding: 10px;
          background: rgba(255,255,255,0.15);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 6px;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
        ">
          🎯 Pick Elements Visually
        </button>
        <div id="picker-status" style="font-size: 10px; margin-top: 4px; opacity: 0.8; text-align: center;"></div>
      </div>

      <!-- Verification button -->
      <div style="margin-bottom: 12px;">
        <button id="view-job-example" style="
          width: 100%;
          padding: 10px;
          background: rgba(255,255,255,0.15);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 6px;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
        ">
          🤖 Test Bot → Click First Job
        </button>
        <div id="view-job-result" style="font-size: 10px; margin-top: 4px; opacity: 0.8; text-align: center;"></div>
      </div>

      <!-- Action buttons -->
      <div style="display: flex; gap: 8px;">
        <button id="confirm-selectors" style="
          flex: 1;
          padding: 10px;
          background: white;
          color: #667eea;
          border: none;
          border-radius: 6px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
        ">
          ✓ Use These Selectors
        </button>
        <button id="cancel-selectors" style="
          padding: 10px 16px;
          background: rgba(255,255,255,0.2);
          color: white;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        ">
          Cancel
        </button>
      </div>
    </div>
  `;

  // Add event listeners
  setTimeout(() => {
    // Test API button
    document.getElementById('test-api-btn')?.addEventListener('click', () => {
      testAPI(inspection.api_endpoint);
    });

    // Paste HTML button
    document.getElementById('paste-html-btn')?.addEventListener('click', () => {
      showPasteHTMLModal();
    });

    // Visual Picker button
    document.getElementById('visual-picker-btn')?.addEventListener('click', () => {
      startVisualPicker();
    });

    // Test buttons
    document.getElementById('test-container')?.addEventListener('click', () => {
      const selector = document.getElementById('manual-container')?.value;
      testSelector(selector, 'container-result');
    });

    document.getElementById('test-item')?.addEventListener('click', () => {
      const containerSelector = document.getElementById('manual-container')?.value;
      const itemSelector = document.getElementById('manual-item')?.value;
      testSelector(`${containerSelector} ${itemSelector}`, 'item-result');
    });

    // View Job Example button
    document.getElementById('view-job-example')?.addEventListener('click', () => {
      const containerSelector = document.getElementById('manual-container')?.value;
      const itemSelector = document.getElementById('manual-item')?.value;
      const resultEl = document.getElementById('view-job-result');

      // Null check for resultEl
      if (!resultEl) {
        console.error('[Inspector] view-job-result element not found');
        return;
      }

      // Clear previous result and show processing
      resultEl.textContent = '🔄 Testing...';
      resultEl.style.color = '#fbbf24';

      if (!containerSelector || !itemSelector) {
        resultEl.textContent = '⚠️ Please enter container and item selectors first';
        resultEl.style.color = '#fca5a5';
        return;
      }

      try {
        // Find first job item
        const fullSelector = `${containerSelector} ${itemSelector}`;
        const firstJob = document.querySelector(fullSelector);

        if (!firstJob) {
          resultEl.textContent = `✗ No jobs found with: ${fullSelector}`;
          resultEl.style.color = '#fca5a5';
          return;
        }

        // Try to find link within the job item - search for all links
        const links = firstJob.querySelectorAll('a[href]');
        let jobLink = null;

        // Find the best link (prefer links with job-related paths)
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && !href.includes('#') && !href.includes('javascript:')) {
            jobLink = link;
            break; // Use first valid link
          }
        }

        // Also check for data attributes that might contain the URL
        if (!jobLink) {
          const dataUrl = firstJob.getAttribute('data-url') ||
                         firstJob.getAttribute('data-href') ||
                         firstJob.getAttribute('data-link');
          if (dataUrl) {
            console.log('[Inspector] Found URL in data attribute:', dataUrl);
            window.open(dataUrl, '_blank');
            resultEl.textContent = `✓ Opened via data-url: ${dataUrl}`;
            resultEl.style.color = '#86efac';
            return;
          }
        }

        const button = firstJob.querySelector('button');

        if (jobLink) {
          // Link found - open in new tab
          const jobUrl = jobLink.href;
          console.log('[Inspector] Opening sample job via link:', jobUrl);
          window.open(jobUrl, '_blank');
          resultEl.textContent = `✓ Opened: ${new URL(jobUrl).pathname}`;
          resultEl.style.color = '#86efac';
        } else if (button) {
          // Button found - try Ctrl+Click to open in new tab
          console.log('[Inspector] Found button - clicking to trigger navigation');
          console.log('[Inspector] Button to click:', button);

          resultEl.textContent = '🤖 Clicking button with Ctrl (open in new tab)...';
          resultEl.style.color = '#fbbf24';

          // Wait a moment then click the button
          setTimeout(() => {
            try {
              // Create a click event with Ctrl key to try opening in new tab
              const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                ctrlKey: true,  // Ctrl+Click to open in new tab
                metaKey: true   // Cmd+Click on Mac
              });
              button.dispatchEvent(clickEvent);
              console.log('[Inspector] ✓ Clicked button with Ctrl:', button.textContent.trim());
              resultEl.textContent = '✓ Clicked button (check if new tab opened)';
              resultEl.style.color = '#86efac';
            } catch (err) {
              console.error('[Inspector] Error clicking button:', err);
              resultEl.textContent = `✗ Click failed: ${err.message}`;
              resultEl.style.color = '#fca5a5';
            }
          }, 500);
        } else {
          // No link or button - click the whole element with Ctrl
          console.log('[Inspector] No link or button - clicking element to trigger navigation');
          console.log('[Inspector] Element to click:', firstJob);

          resultEl.textContent = '🤖 Clicking element with Ctrl (open in new tab)...';
          resultEl.style.color = '#fbbf24';

          // Wait a moment then click
          setTimeout(() => {
            try {
              // Create a click event with Ctrl key
              const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                ctrlKey: true,  // Ctrl+Click to open in new tab
                metaKey: true   // Cmd+Click on Mac
              });
              firstJob.dispatchEvent(clickEvent);
              console.log('[Inspector] ✓ Clicked first job item with Ctrl');
              resultEl.textContent = '✓ Clicked element (check if new tab opened)';
              resultEl.style.color = '#86efac';
            } catch (err) {
              console.error('[Inspector] Error clicking element:', err);
              resultEl.textContent = `✗ Click failed: ${err.message}`;
              resultEl.style.color = '#fca5a5';
            }
          }, 500);
        }
      } catch (error) {
        console.error('[Inspector] Error opening job example:', error);
        resultEl.textContent = `✗ Error: ${error.message}`;
        resultEl.style.color = '#fca5a5';
      }
    });

    // Confirm button
    document.getElementById('confirm-selectors')?.addEventListener('click', () => {
      // Detect expand/load more buttons - check both class names AND text content
      let expandButtons = document.querySelectorAll(
        'button[class*="load"], button[class*="more"], button[class*="expand"], button[class*="reveal"], button[class*="view-all"]'
      );

      // If no buttons found by class, check button text content
      if (expandButtons.length === 0) {
        const allButtons = document.querySelectorAll('button');
        const matchingButtons = Array.from(allButtons).filter(btn => {
          const text = btn.textContent.toLowerCase();
          return text.includes('view all') ||
                 text.includes('show all') ||
                 text.includes('load more') ||
                 text.includes('see all') ||
                 text.includes('view more') ||
                 text.includes('show more');
        });
        expandButtons = matchingButtons;
      }

      const expandButtonSelector = expandButtons.length > 0 ?
        generateSelector(expandButtons[0]) : null;

      // Detect if multiple containers exist
      const containers = document.querySelectorAll(inspection.job_table || 'div');
      const hasMultipleContainers = containers.length > 1;

      // Detect navigation type (already handled in earlier code)
      const firstItem = document.querySelector(`${inspection.job_table} ${inspection.job_item}`);
      let navigationType = 'link';
      if (firstItem) {
        const link = firstItem.querySelector('a[href]');
        const button = firstItem.querySelector('button');
        if (!link && button) {
          navigationType = 'button';
        } else if (!link && !button) {
          navigationType = 'card_click';
        }
      }

      const finalInspection = {
        job_table: document.getElementById('manual-container')?.value || null,
        job_item: document.getElementById('manual-item')?.value || null,
        job_page: document.getElementById('manual-link')?.value || null,
        job_page_table: null,
        api_endpoint: inspection.api_endpoint || null,
        api_endpoint_detail: inspection.api_endpoint_detail || null,
        application_url: inspection.application_url || null,
        ats_provider: inspection.ats_provider || null,

        // New expansion/pagination metadata
        expand_button_selector: expandButtonSelector,
        pagination_type: expandButtonSelector ? 'expand' : 'none',
        requires_expansion: expandButtons.length > 0,
        wait_time_ms: 1000,
        scroll_to_load: false,
        has_multiple_containers: hasMultipleContainers,
        navigation_type: navigationType,
        scraping_notes: null
      };

      console.log('[Inspector] User confirmed selectors:', finalInspection);
      console.log('[Inspector] List API:', finalInspection.api_endpoint);
      console.log('[Inspector] Detail API:', finalInspection.api_endpoint_detail);
      console.log('[Inspector] Expand button:', finalInspection.expand_button_selector);
      console.log('[Inspector] Navigation type:', finalInspection.navigation_type);

      // Add to saved pages array
      savedCareerPages.push({
        url: careerPageUrl,
        inspection: finalInspection
      });

      // Send career page data to background for saving
      const careerPageUrls = savedCareerPages.map(p => p.url);
      chrome.runtime.sendMessage({
        action: 'careerPageSaved',
        pageId: currentPageId,
        careerPageUrls: careerPageUrls,
        inspection: finalInspection,
        success: true
      }, (response) => {
        console.log('[Inspector] Background acknowledged career page save:', response);
      });

      // Show scraping options
      showScrapingOptions();
    });

    // Cancel button
    document.getElementById('cancel-selectors')?.addEventListener('click', () => {
      showOverlayButton(); // Reset to initial state
    });
  }, 100);
}

/**
 * Show modal for pasting HTML
 */
function showPasteHTMLModal() {
  const modal = document.createElement('div');
  modal.id = 'paste-html-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    z-index: 2147483648;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  modal.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      max-height: 80vh;
      overflow-y: auto;
      color: white;
    ">
      <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700;">
        📋 Paste Job Listings HTML
      </h3>
      <p style="margin: 0 0 12px 0; font-size: 12px; opacity: 0.9;">
        Paste the HTML containing your job listings. The extension will analyze it and find the selectors automatically.
      </p>
      <textarea id="html-input" placeholder="Paste HTML here..." style="
        width: 100%;
        height: 200px;
        padding: 10px;
        border: none;
        border-radius: 6px;
        font-family: monospace;
        font-size: 11px;
        resize: vertical;
        background: rgba(255,255,255,0.95);
        color: #333;
      "></textarea>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button id="analyze-html-btn" style="
          flex: 1;
          padding: 10px;
          background: white;
          color: #667eea;
          border: none;
          border-radius: 6px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
        ">
          🔍 Analyze & Fill
        </button>
        <button id="close-modal-btn" style="
          padding: 10px 20px;
          background: rgba(255,255,255,0.2);
          color: white;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        ">
          Cancel
        </button>
      </div>
      <div id="parse-result" style="
        margin-top: 12px;
        padding: 10px;
        background: rgba(255,255,255,0.1);
        border-radius: 6px;
        font-size: 12px;
        display: none;
      "></div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  document.getElementById('analyze-html-btn')?.addEventListener('click', () => {
    const html = document.getElementById('html-input').value;
    analyzeHTML(html);
  });

  document.getElementById('close-modal-btn')?.addEventListener('click', () => {
    modal.remove();
  });

  // Focus textarea
  setTimeout(() => {
    document.getElementById('html-input')?.focus();
  }, 100);
}

/**
 * Analyze pasted HTML and extract selectors
 */
function analyzeHTML(htmlString) {
  const resultEl = document.getElementById('parse-result');

  // Null check for resultEl
  if (!resultEl) {
    console.error('[Inspector] parse-result element not found');
    return;
  }

  try {
    // Create a temporary container to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = htmlString;

    // Find containers
    const containers = [];

    // Check for tables
    temp.querySelectorAll('table').forEach(table => {
      const rows = table.querySelectorAll('tbody tr, tr');
      if (rows.length >= 2) {
        containers.push({
          element: table,
          type: 'table',
          itemCount: rows.length,
          containerSelector: generateSelectorFromElement(table),
          itemSelector: table.querySelector('tbody') ? 'tbody tr' : 'tr'
        });
      }
    });

    // Check for lists
    temp.querySelectorAll('ul, ol').forEach(list => {
      const items = list.querySelectorAll('li');
      if (items.length >= 2) {
        containers.push({
          element: list,
          type: 'list',
          itemCount: items.length,
          containerSelector: generateSelectorFromElement(list),
          itemSelector: 'li'
        });
      }
    });

    // Check for div containers
    temp.querySelectorAll('div').forEach(div => {
      const children = Array.from(div.children).filter(child =>
        child.tagName === 'DIV' || child.tagName === 'ARTICLE' || child.tagName === 'SECTION'
      );

      if (children.length >= 2) {
        containers.push({
          element: div,
          type: 'div-container',
          itemCount: children.length,
          containerSelector: generateSelectorFromElement(div),
          itemSelector: children[0].tagName.toLowerCase()
        });
      }
    });

    if (containers.length === 0) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '❌ No job container found. Make sure you pasted the job listings section.';
      return;
    }

    // Pick the best container (most items)
    containers.sort((a, b) => b.itemCount - a.itemCount);
    const best = containers[0];

    // Find link pattern
    const firstLink = best.element.querySelector('a[href]');
    let linkPattern = '';
    if (firstLink) {
      const href = firstLink.getAttribute('href');
      // Convert to absolute URL if relative
      try {
        const url = new URL(href, window.location.href);
        linkPattern = url.href.replace(/\/[a-zA-Z0-9_-]+\/?$/, '/{id}');
      } catch (e) {
        linkPattern = href;
      }
    }

    // Fill the form fields (with null checks)
    const containerInput = document.getElementById('manual-container');
    const itemInput = document.getElementById('manual-item');
    const linkInput = document.getElementById('manual-link');

    if (containerInput) containerInput.value = best.containerSelector;
    if (itemInput) itemInput.value = best.itemSelector;
    if (linkInput) linkInput.value = linkPattern;

    // Show success
    resultEl.style.display = 'block';
    resultEl.style.background = 'rgba(16, 185, 129, 0.2)';
    resultEl.innerHTML = `
      ✓ Found ${best.type}!<br>
      Container: <code style="background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px;">${best.containerSelector}</code><br>
      Items: ${best.itemCount} found<br>
      <br>
      <strong>Fields auto-filled! Close this and click "Test" to verify.</strong>
    `;

    // Close modal after 2 seconds
    setTimeout(() => {
      document.getElementById('paste-html-modal')?.remove();
    }, 2000);

  } catch (error) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = `❌ Error parsing HTML: ${error.message}`;
  }
}

/**
 * Generate CSS selector from an element
 */
function generateSelectorFromElement(element) {
  // Try ID first
  if (element.id) {
    return `#${element.id}`;
  }

  // Try unique class
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/).filter(c => c.length > 0);
    if (classes.length > 0) {
      const tagName = element.tagName.toLowerCase();
      return `${tagName}.${classes[0]}`;
    }
  }

  // Try data attributes
  const dataUi = element.getAttribute('data-ui');
  if (dataUi) {
    return `[data-ui="${dataUi}"]`;
  }

  // Fallback to tag name
  return element.tagName.toLowerCase();
}

/**
 * Test a CSS selector and show results
 */
function testSelector(selector, resultElementId) {
  try {
    const elements = document.querySelectorAll(selector);
    const resultEl = document.getElementById(resultElementId);
    if (resultEl) {
      resultEl.textContent = `✓ Found ${elements.length} element${elements.length !== 1 ? 's' : ''}`;
      resultEl.style.color = elements.length > 0 ? '#86efac' : '#fca5a5';
    }

    // Briefly highlight found elements
    if (elements.length > 0 && elements.length < 50) {
      elements.forEach(el => {
        const originalOutline = el.style.outline;
        el.style.outline = '2px solid #10b981';
        setTimeout(() => {
          el.style.outline = originalOutline;
        }, 2000);
      });
    }
  } catch (error) {
    const resultEl = document.getElementById(resultElementId);
    if (resultEl) {
      resultEl.textContent = `✗ Invalid selector`;
      resultEl.style.color = '#fca5a5';
    }
  }
}

/**
 * Show scraping options after selectors are confirmed
 */
function showScrapingOptions() {
  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      user-select: none;
      animation: pulse 2s infinite;
    ">
      <style>
        @keyframes pulse {
          0%, 100% { box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4); }
          50% { box-shadow: 0 8px 32px rgba(16, 185, 129, 0.8); }
        }
      </style>
      <div style="margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 18px;">✅</span>
          <div style="font-size: 15px; font-weight: 700;">
            Selectors saved!
          </div>
        </div>
        <div style="font-size: 11px; opacity: 0.85; margin-bottom: 8px;">
          ${currentCompanyName}
        </div>
        <div style="font-size: 12px; font-weight: 600; opacity: 0.95; background: rgba(255,255,255,0.2); padding: 8px; border-radius: 6px; text-align: center;">
          ⚠️ Choose an option below ⚠️
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex-direction: column;">
        <button id="scrape-now-btn" style="
          width: 100%;
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.95);
          color: #059669;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        ">
          🔄 Scrape Job Data Now
        </button>
        <button id="skip-scraping-btn" style="
          width: 100%;
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.2);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        ">
          ⏭️ Skip to Next Company
        </button>
      </div>
    </div>
  `;

  // Add event listeners to scraping buttons
  setTimeout(() => {
    const scrapeNowBtn = document.getElementById('scrape-now-btn');
    const skipScrapingBtn = document.getElementById('skip-scraping-btn');

    if (scrapeNowBtn) {
      scrapeNowBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Inspector] Scrape Now button clicked');
        await handleScrapeNow();
      });
    }

    if (skipScrapingBtn) {
      skipScrapingBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Inspector] Skip Scraping button clicked');
        handleSkipScraping();
      });
    }

    console.log('[Inspector] ✓ Buttons ready - waiting for user choice');
  }, 100);
}

/**
 * Handle "Scrape Job Data Now" button click
 */
async function handleScrapeNow() {
  console.log('[Inspector] User clicked Scrape Now button');

  // Show loading state
  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      font-weight: 600;
      user-select: none;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">🔄</span>
        <div>
          <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
            ${currentCompanyName}
          </div>
          <div style="font-size: 15px; font-weight: 700;">
            Scraping job data...
          </div>
        </div>
      </div>
    </div>
  `;

  // Validate savedCareerPages array
  if (!savedCareerPages || savedCareerPages.length === 0) {
    console.error('[Inspector] No saved career pages!');
    showOverlayButton(); // Reset UI
    return;
  }

  // Get all career page URLs
  const careerPageUrls = savedCareerPages.map(p => p.url);

  // Use inspection data from first saved page
  const inspection = savedCareerPages[0].inspection;

  // Send message to background to trigger scraping
  chrome.runtime.sendMessage({
    action: 'triggerScraping',
    pageId: currentPageId,
    careerPageUrls: careerPageUrls,
    inspection: inspection
  }, (response) => {
    console.log('[Inspector] Scraping triggered, response:', response);

    // Show success state
    overlayButton.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
        font-weight: 600;
        user-select: none;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">✅</span>
          <div>
            <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
              ${currentCompanyName}
            </div>
            <div style="font-size: 15px; font-weight: 700;">
              Scraping complete! Moving to next...
            </div>
          </div>
        </div>
      </div>
    `;

    // Remove button after 1 second (tab will close)
    setTimeout(() => {
      if (overlayButton) {
        overlayButton.remove();
      }
    }, 1000);
  });
}

/**
 * Handle "Skip to Next Company" button click (after inspection)
 */
function handleSkipScraping() {
  console.log('[Inspector] User skipped scraping for:', currentCompanyName);

  // Show skipped state
  overlayButton.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      font-weight: 600;
      user-select: none;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">⏭️</span>
        <div>
          <div style="font-size: 11px; opacity: 0.9; margin-bottom: 2px;">
            ${currentCompanyName}
          </div>
          <div style="font-size: 15px; font-weight: 700;">
            Skipped scraping! Moving to next...
          </div>
        </div>
      </div>
    </div>
  `;

  // Validate savedCareerPages array
  if (!savedCareerPages || savedCareerPages.length === 0) {
    console.error('[Inspector] No saved career pages!');
    showOverlayButton(); // Reset UI
    return;
  }

  // Get all career page URLs
  const careerPageUrls = savedCareerPages.map(p => p.url);

  // Use inspection data from first saved page
  const inspection = savedCareerPages[0].inspection;

  // Send message to background to save inspection and move to next without scraping
  chrome.runtime.sendMessage({
    action: 'skipScraping',
    pageId: currentPageId,
    careerPageUrls: careerPageUrls,
    inspection: inspection
  }, (response) => {
    console.log('[Inspector] Skip scraping response:', response);
  });

  // Remove button after 1 second (tab will close)
  setTimeout(() => {
    removeOverlay();
  }, 1000);
}

/**
 * Main inspection function
 */
function inspectCareerPage() {
  const result = {
    job_table: null,      // Container with all jobs
    job_item: null,       // Individual job item selector
    job_page: null,       // Job detail page link pattern
    job_page_table: null  // (For later use on job detail pages)
  };

  // Find job container and items
  const jobContainer = findJobContainer();

  if (jobContainer) {
    result.job_table = generateSelector(jobContainer.container);
    result.job_item = jobContainer.itemSelector;

    // Find job links pattern
    const jobLinks = findJobLinks(jobContainer.container);
    if (jobLinks && jobLinks.length > 0) {
      result.job_page = detectLinkPattern(jobLinks);
    }
  }

  return result;
}

/**
 * Find the main container holding all job listings
 */
function findJobContainer() {
  console.log('[Inspector] Searching for job container...');

  // Common job-related keywords
  const jobKeywords = [
    'job', 'career', 'position', 'opening', 'opportunity',
    'vacancy', 'role', 'posting', 'listing', 'recruitment'
  ];

  // Find all potential containers
  const containers = [];

  // Check tables
  document.querySelectorAll('table').forEach(table => {
    // Skip if in excluded elements
    if (isInExcludedElement(table)) {
      return;
    }

    const rows = table.querySelectorAll('tr');
    if (rows.length >= 2) { // At least 2 rows (header + 1 job)
      const score = scoreElement(table, jobKeywords);
      if (score > 0) {
        containers.push({
          element: table,
          type: 'table',
          itemCount: rows.length - 1, // Exclude header
          itemSelector: 'tr:not(:first-child)',
          score
        });
      }
    }
  });

  // Check lists (ul/ol)
  document.querySelectorAll('ul, ol').forEach(list => {
    // Skip if in excluded elements
    if (isInExcludedElement(list)) {
      return;
    }

    const items = list.querySelectorAll('li');
    if (items.length >= 2) {
      const score = scoreElement(list, jobKeywords);
      if (score > 0) {
        containers.push({
          element: list,
          type: 'list',
          itemCount: items.length,
          itemSelector: 'li',
          score
        });
      }
    }
  });

  // Check div containers with repeated children
  document.querySelectorAll('div').forEach(div => {
    // Skip if this div is inside footer/header/nav
    if (isInExcludedElement(div)) {
      return;
    }

    const children = Array.from(div.children).filter(child => {
      return child.tagName === 'DIV' || child.tagName === 'ARTICLE' || child.tagName === 'SECTION';
    });

    if (children.length >= 2 && children.length < 100) {
      // Check if children are similar (repeated pattern)
      const areSimilar = checkSimilarElements(children.slice(0, 3));

      if (areSimilar) {
        const score = scoreElement(div, jobKeywords);
        if (score > 0) {
          // Generate a more specific selector for the child items
          const firstChild = children[0];
          let itemSelector = null;

          // Priority 1: ARIA role attributes (most stable)
          if (firstChild.hasAttribute('role')) {
            const role = firstChild.getAttribute('role');
            // Only use meaningful roles
            if (['listitem', 'article', 'row', 'gridcell'].includes(role)) {
              itemSelector = `[role="${role}"]`;
            }
          }

          // Priority 2: data-* attributes (very specific)
          if (!itemSelector && firstChild.hasAttribute('data-test-id')) {
            const testId = firstChild.getAttribute('data-test-id');
            itemSelector = `[data-test-id="${testId}"]`;
          }
          if (!itemSelector && firstChild.hasAttribute('data-qa')) {
            const qa = firstChild.getAttribute('data-qa');
            itemSelector = `[data-qa="${qa}"]`;
          }

          // Priority 3: Meaningful class names
          if (!itemSelector && firstChild.className && firstChild.className.trim()) {
            const classes = firstChild.className.split(' ').filter(c => c.trim());
            // Look for job-related classes first
            const jobRelatedClasses = classes.filter(c =>
              /job|career|position|opening|posting|listing|item|card/i.test(c)
            );
            if (jobRelatedClasses.length > 0) {
              itemSelector = `.${jobRelatedClasses[0]}`;
            } else if (classes.length > 0) {
              // Use first class as fallback
              itemSelector = `.${classes[0]}`;
            }
          }

          // Priority 4: Tag name (last resort)
          if (!itemSelector) {
            itemSelector = firstChild.tagName.toLowerCase();
          }

          containers.push({
            element: div,
            type: 'div-container',
            itemCount: children.length,
            itemSelector: itemSelector,
            score
          });
        }
      }
    }
  });

  if (containers.length === 0) {
    console.log('[Inspector] No job container found');
    return null;
  }

  // Sort by score (highest first)
  containers.sort((a, b) => b.score - a.score);

  console.log(`[Inspector] Found ${containers.length} potential containers`);
  console.log('[Inspector] Best match:', containers[0]);

  return {
    container: containers[0].element,
    itemSelector: containers[0].itemSelector,
    itemCount: containers[0].itemCount
  };
}

/**
 * Check if element is inside footer/header/nav or has those keywords
 */
function isInExcludedElement(element) {
  // Check if inside excluded tag
  if (element.closest('footer, header, nav')) {
    return true;
  }

  // Check element's own class/id for excluded keywords
  const className = (element.className || '').toLowerCase();
  const id = (element.id || '').toLowerCase();
  const excludedKeywords = ['footer', 'header', 'nav', 'menu', 'sidebar', 'advertisement', 'cookie', 'banner'];

  return excludedKeywords.some(keyword =>
    className.includes(keyword) || id.includes(keyword)
  );
}

/**
 * Score an element based on job-related keywords and position
 */
function scoreElement(element, keywords) {
  let score = 0;

  const text = element.textContent.toLowerCase();
  const className = (element.className || '').toLowerCase();
  const id = (element.id || '').toLowerCase();

  // PENALTY: Exclude footer/header/nav elements
  const excludedKeywords = ['footer', 'header', 'nav', 'menu', 'sidebar', 'cookie', 'banner'];
  if (excludedKeywords.some(k => className.includes(k) || id.includes(k))) {
    return 0; // Disqualify completely
  }

  // BONUS: Inside main/article/section tags
  if (element.closest('main, article, section')) {
    score += 15;
  }

  keywords.forEach(keyword => {
    // Class name match (highest weight)
    if (className.includes(keyword)) score += 10;

    // ID match
    if (id.includes(keyword)) score += 8;

    // Check if multiple instances of keyword appear (indicates list)
    const count = (text.match(new RegExp(keyword, 'gi')) || []).length;
    if (count >= 2) score += count * 2;
  });

  // Check for links (job listings usually have links)
  const links = element.querySelectorAll('a');
  if (links.length >= 2) score += links.length;

  // POSITION-BASED SCORING: Prefer middle of page
  const rect = element.getBoundingClientRect();
  const elementTop = rect.top + window.scrollY;
  const pageHeight = document.documentElement.scrollHeight;
  const relativePosition = elementTop / pageHeight;

  // Penalize if too close to top (<20%) or bottom (>80%)
  if (relativePosition < 0.2) {
    score -= 10; // Likely header/banner area
  } else if (relativePosition > 0.8) {
    score -= 20; // Likely footer area
  } else {
    score += 10; // Bonus for being in content area
  }

  return score;
}

/**
 * Check if elements are similar (repeated pattern)
 */
function checkSimilarElements(elements) {
  if (elements.length < 2) return false;

  const first = elements[0];
  const firstSignature = getElementSignature(first);

  return elements.slice(1).every(el => {
    const signature = getElementSignature(el);
    return similarSignatures(firstSignature, signature);
  });
}

/**
 * Get element signature for comparison
 */
function getElementSignature(element) {
  return {
    tagName: element.tagName,
    childCount: element.children.length,
    hasLink: !!element.querySelector('a'),
    hasImage: !!element.querySelector('img'),
    classList: Array.from(element.classList).sort().join(' ')
  };
}

/**
 * Check if two signatures are similar
 */
function similarSignatures(sig1, sig2) {
  return sig1.tagName === sig2.tagName &&
         Math.abs(sig1.childCount - sig2.childCount) <= 2 &&
         sig1.classList === sig2.classList;
}

/**
 * Find job links in container
 */
function findJobLinks(container) {
  const links = [];

  container.querySelectorAll('a').forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      const fullUrl = new URL(href, window.location.href).href;
      links.push({
        element: link,
        href: fullUrl,
        text: link.textContent.trim()
      });
    }
  });

  console.log(`[Inspector] Found ${links.length} job links`);
  return links;
}

/**
 * Detect common pattern in job links
 */
function detectLinkPattern(links) {
  if (links.length === 0) return null;

  // Get first link as example
  const exampleLink = links[0].href;

  try {
    const url = new URL(exampleLink);

    // Extract pattern (remove unique ID/slug)
    let pattern = url.pathname;

    // Replace numbers and unique strings with placeholders
    pattern = pattern.replace(/\/\d+/g, '/{id}');
    pattern = pattern.replace(/\/[a-f0-9-]{20,}/g, '/{id}');

    return url.origin + pattern;

  } catch (error) {
    return exampleLink;
  }
}

/**
 * Generate CSS selector for element
 */
function generateSelector(element) {
  if (!element) return null;

  // Try ID first
  if (element.id) {
    return `#${element.id}`;
  }

  // Try data-* attributes (very specific)
  if (element.hasAttribute('data-test-id')) {
    return `[data-test-id="${element.getAttribute('data-test-id')}"]`;
  }
  if (element.hasAttribute('data-qa')) {
    return `[data-qa="${element.getAttribute('data-qa')}"]`;
  }

  // Try class combination - prefer unique/descriptive classes
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/).filter(c => c.length > 0);

    // Keywords that indicate a specific, meaningful class
    const meaningfulKeywords = ['job', 'career', 'position', 'card', 'list', 'item', 'posting', 'opening'];

    // Find classes with meaningful keywords
    const meaningfulClasses = classes.filter(c =>
      meaningfulKeywords.some(keyword => c.toLowerCase().includes(keyword))
    );

    // If we found meaningful classes, use just those
    if (meaningfulClasses.length > 0) {
      const classSelector = '.' + meaningfulClasses.join('.');
      const matches = document.querySelectorAll(classSelector);
      if (matches.length >= 1 && matches.length < 10) {
        return classSelector;
      }
      // Even if not unique, use the first meaningful class
      return `.${meaningfulClasses[0]}`;
    }

    // Otherwise try all classes
    if (classes.length > 0) {
      const classSelector = '.' + classes.join('.');
      // Verify it's unique enough
      const matches = document.querySelectorAll(classSelector);
      if (matches.length === 1 || matches.length < 5) {
        return classSelector;
      }
      // Use just the first class as fallback
      return `.${classes[0]}`;
    }
  }

  // Generate path selector (last resort)
  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c.length > 0);
      if (classes.length > 0) {
        selector += '.' + classes[0]; // Use only first class for shorter selector
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Limit depth
    if (path.length >= 3) break; // Reduce depth to make selector simpler
  }

  return path.join(' > ');
}

/**
 * Detect API endpoints in the page HTML
 */
// ============================================================================
// ENHANCED: Comprehensive API & Application URL Detection
// ============================================================================

/**
 * Extract URL from Next.js __NEXT_DATA__ prop
 */
function extractUrlFromNextJs() {
  try {
    const nextDataScript = document.getElementById('__NEXT_DATA__');
    if (nextDataScript) {
      const data = JSON.parse(nextDataScript.textContent);

      // Check common Next.js paths for job URLs
      const paths = [
        data?.props?.pageProps?.job?.applyUrl,
        data?.props?.pageProps?.job?.url,
        data?.props?.pageProps?.jobPosting?.applyUrl,
        data?.props?.pageProps?.jobPosting?.url,
        data?.props?.pageProps?.listing?.applyUrl,
        data?.props?.initialData?.job?.applyUrl,
        data?.query?.url,
        data?.query?.applyUrl
      ];

      for (const path of paths) {
        if (path && typeof path === 'string' && path.startsWith('http')) {
          console.log('[Inspector] ✓ Found URL in Next.js data:', path);
          return path;
        }
      }
    }
  } catch (e) {
    console.log('[Inspector] No Next.js data found');
  }
  return null;
}

/**
 * Extract URL from meta tags
 */
function extractUrlFromMeta() {
  const metaSelectors = [
    'meta[property="og:url"]',
    'meta[name="twitter:url"]',
    'meta[property="al:web:url"]',
    'link[rel="canonical"]'
  ];

  for (const selector of metaSelectors) {
    const meta = document.querySelector(selector);
    if (meta) {
      const url = meta.getAttribute('content') || meta.getAttribute('href');
      if (url && url.startsWith('http')) {
        console.log('[Inspector] ✓ Found URL in meta tag:', url);
        return url;
      }
    }
  }
  return null;
}

/**
 * Extract URL from window object
 */
function extractUrlFromWindow() {
  try {
    // Check common global variables
    const paths = [
      window.jobData?.applyUrl,
      window.jobData?.url,
      window.jobPosting?.applyUrl,
      window.posting?.url,
      window.applicationUrl,
      window.applyUrl
    ];

    for (const path of paths) {
      if (path && typeof path === 'string' && path.startsWith('http')) {
        console.log('[Inspector] ✓ Found URL in window object:', path);
        return path;
      }
    }
  } catch (e) {
    console.log('[Inspector] No URL in window object');
  }
  return null;
}

/**
 * Enhanced: Extract application/apply URL from page
 * Based on hiring-cafe-extension patterns
 */
function extractApplicationUrl() {
  console.log('[Inspector] Starting application URL extraction...');

  // Strategy 0: Check Next.js props and React state
  const nextJsUrl = extractUrlFromNextJs();
  if (nextJsUrl) return nextJsUrl;

  // Strategy 1: Check meta tags
  const metaUrl = extractUrlFromMeta();
  if (metaUrl) return metaUrl;

  // Strategy 2: Search page source for apply URLs
  const pageSource = document.documentElement.outerHTML;

  // Comprehensive ATS URL patterns (ordered by priority - specific to general)
  const atsPatterns = [
    // Major ATS Systems
    /https?:\/\/recruiting[^"'\s]*\.ultipro\.com\/[^"'\s]*\/JobBoard\/[^"'\s]*/gi,  // UltiPro/UKG
    /https?:\/\/[^"'\s]*\.ultipro\.com\/[^"'\s]*\/OpportunityDetail[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*taleo\.net\/careersection\/[^"'\s]*/gi,  // Taleo
    /https?:\/\/[^"'\s]*\.taleo\.net\/[^"'\s]*\/ats\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*greenhouse\.io\/[^"'\s]*\/jobs\/[^"'\s]*/gi,  // Greenhouse
    /https?:\/\/boards\.greenhouse\.io\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*lever\.co\/[^"'\s]*/gi,  // Lever
    /https?:\/\/jobs\.lever\.co\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*workday\.com\/[^"'\s]*\/job\/[^"'\s]*/gi,  // Workday
    /https?:\/\/[^"'\s]*myworkdayjobs\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\.wd[0-9]+\.myworkdayjobs\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*icims\.com\/jobs\/[^"'\s]*/gi,  // iCIMS
    /https?:\/\/careers\.[^"'\s]*\.icims\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*jobvite\.com\/[^"'\s]*/gi,  // Jobvite
    /https?:\/\/jobs\.jobvite\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*smartrecruiters\.com\/[^"'\s]*/gi,  // SmartRecruiters
    /https?:\/\/jobs\.smartrecruiters\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*breezy\.hr\/[^"'\s]*/gi,  // Breezy HR
    /https?:\/\/[^"'\s]*\.breezy\.hr\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*applytojob\.com\/apply\/[^"'\s]*/gi,  // ApplyToJob
    /https?:\/\/[^"'\s]*successfactors\.com\/[^"'\s]*\/job\/[^"'\s]*/gi,  // SAP SuccessFactors
    /https?:\/\/[^"'\s]*\.successfactors\.com\/sfcareer\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*bamboohr\.com\/[^"'\s]*\/jobs\/[^"'\s]*/gi,  // BambooHR
    /https?:\/\/[^"'\s]*\.bamboohr\.com\/careers\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*ashbyhq\.com\/[^"'\s]*/gi,  // Ashby
    /https?:\/\/jobs\.ashbyhq\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*workable\.com\/[^"'\s]*\/j\/[^"'\s]*/gi,  // Workable
    /https?:\/\/apply\.workable\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*recruitee\.com\/[^"'\s]*/gi,  // Recruitee
    /https?:\/\/[^"'\s]*\.recruitee\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*jazz\.co\/[^"'\s]*\/apply\/[^"'\s]*/gi,  // JazzHR
    /https?:\/\/[^"'\s]*\.applytojob\.com\/apply\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*paycomonline\.net\/[^"'\s]*\/ats\/[^"'\s]*/gi,  // Paycom
    /https?:\/\/[^"'\s]*\.paycomonline\.net\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*resumator\.com\/[^"'\s]*/gi,  // Resumator (Jazz)
    /https?:\/\/[^"'\s]*\.resumator\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*comeet\.com\/[^"'\s]*\/[^"'\s]*/gi,  // Comeet
    /https?:\/\/[^"'\s]*\.comeet\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*pinpointhq\.com\/[^"'\s]*/gi,  // Pinpoint
    /https?:\/\/[^"'\s]*\.pinpointhq\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*fountain\.com\/[^"'\s]*\/apply\/[^"'\s]*/gi,  // Fountain
    /https?:\/\/[^"'\s]*\.fountain\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*mycareerpage\.net\/[^"'\s]*/gi,  // MyCareerPage
    /https?:\/\/[^"'\s]*\.mycareerpage\.net\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*talentify\.io\/[^"'\s]*\/job\/[^"'\s]*/gi,  // Talentify
    /https?:\/\/[^"'\s]*\.talentify\.io\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*hr-manager\.net\/[^"'\s]*/gi,  // HR Manager
    /https?:\/\/[^"'\s]*\.hr-manager\.net\/[^"'\s]*/gi,
    // Generic patterns (lower priority)
    /https?:\/\/[^"'\s]*\/careers\/[^"'\s]*\/apply[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/jobs\/[^"'\s]*\/apply[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/apply\/[^"'\s]*/gi
  ];

  for (const pattern of atsPatterns) {
    const matches = pageSource.match(pattern);
    if (matches && matches.length > 0) {
      // Clean URL
      let url = matches[0]
        .replace(/['"\\]/g, '')
        .replace(/&quot;/g, '')
        .replace(/&amp;/g, '&')
        .trim();

      // Remove trailing punctuation
      url = url.replace(/[,;:.)}\]]+$/, '');

      // Validate URL
      if (url.startsWith('http') && url.length > 15) {
        console.log('[Inspector] ✓ Found ATS application URL:', url);
        return url;
      }
    }
  }

  // Strategy 3: Check window object
  const windowUrl = extractUrlFromWindow();
  if (windowUrl) return windowUrl;

  // Strategy 4: Look for "Apply" links
  const applyLinks = document.querySelectorAll('a[href*="apply"], a[href*="application"]');
  for (const link of applyLinks) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('http')) {
      console.log('[Inspector] ✓ Found apply link:', href);
      return href;
    }
  }

  // Fallback: Current URL
  console.log('[Inspector] ⚠ No application URL found, using current URL');
  return window.location.href;
}

/**
 * Detect API endpoint from page source
 * Enhanced with comprehensive patterns
 */
function detectAPIEndpoint() {
  console.log('[Inspector] Detecting API endpoints...');

  const apiPatterns = [
    // Specific ATS APIs (highest priority)
    /https?:\/\/[^"'\s]*lever\.co\/[^"'\s]*\/postings[^"'\s]*/gi,  // Lever API
    /https?:\/\/api\.lever\.co\/[^"'\s]*/gi,
    /https?:\/\/boards-api\.greenhouse\.io\/[^"'\s]*/gi,  // Greenhouse API
    /https?:\/\/api\.greenhouse\.io\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\.greenhouse\.io\/embed\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*workable\.com\/spi\/[^"'\s]*/gi,  // Workable API
    /https?:\/\/[^"'\s]*workable\.com\/api\/[^"'\s]*/gi,
    /https?:\/\/api\.ashbyhq\.com\/[^"'\s]*/gi,  // Ashby API
    /https?:\/\/jobs\.ashbyhq\.com\/api\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*smartrecruiters\.com\/api\/[^"'\s]*/gi,  // SmartRecruiters API
    /https?:\/\/api\.smartrecruiters\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*jobvite\.com\/api\/[^"'\s]*/gi,  // Jobvite API
    /https?:\/\/api\.jobvite\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*breezy\.hr\/api\/[^"'\s]*/gi,  // Breezy API
    /https?:\/\/api\.breezy\.hr\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*bamboohr\.com\/careers_api\/[^"'\s]*/gi,  // BambooHR API
    /https?:\/\/api\.bamboohr\.com\/[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*applytojob\.com\/api\/[^"'\s]*/gi,  // ApplyToJob API
    // Generic API patterns (lower priority)
    /https?:\/\/api\.[^"'\s]*\/[^"'\s]*jobs[^"'\s]*/gi,
    /https?:\/\/api\.[^"'\s]*\/[^"'\s]*careers[^"'\s]*/gi,
    /https?:\/\/api\.[^"'\s]*\/[^"'\s]*postings[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/api\/[^"'\s]*jobs[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/api\/[^"'\s]*careers[^"'\s]*/gi,
    /https?:\/\/[^"'\s]*\/api\/[^"'\s]*postings[^"'\s]*/gi,
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
          // Clean URL
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

  // Check inline scripts in HTML
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

  // Filter out non-API URLs (PDFs, images, docs, etc.)
  const excludePatterns = [
    /\.pdf$/i,
    /\.png$/i,
    /\.jpg$/i,
    /\.jpeg$/i,
    /\.gif$/i,
    /\.svg$/i,
    /\.css$/i,
    /\.js$/i,
    /\.woff/i,
    /\.ttf/i,
    /\/docs?\//i,
    /\/documentation\//i,
    /\/help\//i,
    /\/support\//i,
    /\/static\//i,
    /\/assets\//i
  ];

  const apiList = Array.from(foundAPIs).filter(url => {
    // Exclude URLs that match exclude patterns
    return !excludePatterns.some(pattern => pattern.test(url)) && url.startsWith('http');
  });

  // Prioritize URLs that look like real job APIs
  const jobAPIKeywords = ['posting', 'jobs', 'careers', 'positions', 'openings', 'opportunities', 'v0', 'v1', 'v2', 'v3'];
  const likelyJobAPIs = apiList.filter(url =>
    jobAPIKeywords.some(keyword => url.toLowerCase().includes(keyword))
  );

  const bestAPI = likelyJobAPIs.length > 0 ? likelyJobAPIs[0] : apiList[0];

  console.log('[Inspector] Found API endpoints:', apiList.length > 0 ? apiList : 'None');
  console.log('[Inspector] Best API endpoint:', bestAPI || 'None');

  return bestAPI || null;
}

/**
 * ENHANCED Parse job detail page with multi-strategy extraction
 */
function parseJobDetailPage() {
  console.log('[Inspector] 🚀 Starting ENHANCED job detail parsing...');

  const data = {
    // Metadata
    job_id: extractJobId(),
    url: window.location.href,
    scraped_at: new Date().toISOString(),
    ats_provider: detectATS(),

    // Core fields with confidence
    title: extractTitle(),
    location: extractLocation(),

    // Full sections (not just 500 chars!)
    sections: extractSections(),

    // Apply info
    apply: extractApplyButton(),

    // Salary
    salary: extractSalary(),

    // Legacy compatibility (for existing code)
    description: null,
    requirements: null,
    jobType: null,
    applyButton: null,
    applyUrl: null,

    // Overall confidence
    overall_confidence: null
  };

  // Fill legacy fields for backward compatibility
  if (data.sections.summary) {
    data.description = data.sections.summary.content.substring(0, 500);
  }
  if (data.sections.requirements) {
    data.requirements = data.sections.requirements.content.substring(0, 500);
  }
  if (data.apply.button) {
    data.applyButton = data.apply.button;
    data.applyUrl = data.apply.url;
  }

  // Calculate overall confidence
  const confidenceScores = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
  const scores = [
    confidenceScores[data.title.confidence || 'none'],
    confidenceScores[data.location.confidence || 'none'],
    confidenceScores[data.apply.confidence || 'none']
  ];
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  data.overall_confidence = avgScore >= 2.5 ? 'high' : avgScore >= 1.5 ? 'medium' : avgScore >= 0.5 ? 'low' : 'none';

  console.log('[Inspector] ✅ Parsing complete. Confidence:', data.overall_confidence);
  console.log('[Inspector] Extracted:', {
    title: data.title.value,
    location: data.location.value,
    sections: Object.keys(data.sections),
    applyUrl: data.apply.url
  });

  return data;
}

// ============================================================================
// HELPER: Multi-selector extraction with confidence
// ============================================================================
function extractWithSelectors(selectors, validationFn = null) {
  for (const config of selectors) {
    const el = document.querySelector(config.selector);
    if (el && el.textContent.trim()) {
      const value = el.textContent.trim();
      if (validationFn && !validationFn(value)) continue;
      return { value: value, confidence: config.confidence, selector: config.selector };
    }
  }
  return { value: null, confidence: 'none', selector: null };
}

// ============================================================================
// TITLE EXTRACTION
// ============================================================================
function extractTitle() {
  const TITLE_SELECTORS = [
    { selector: 'h1[itemprop="title"]', confidence: 'high' },
    { selector: 'h1.job-title', confidence: 'high' },
    { selector: 'h1[class*="job-title"]', confidence: 'high' },
    { selector: 'h1[class*="title"]', confidence: 'medium' },
    { selector: '.section-header h1', confidence: 'medium' },
    { selector: 'h1', confidence: 'low' }
  ];

  const result = extractWithSelectors(TITLE_SELECTORS, (text) => {
    return text.length > 3 && text.length < 200 && !text.includes('http');
  });

  if (result.value) return result;

  // Fallback: Find first h1
  const h1 = document.querySelector('h1');
  if (h1) {
    return { value: h1.textContent.trim(), confidence: 'low', selector: 'h1 fallback' };
  }

  return { value: null, confidence: 'none', selector: null };
}

// ============================================================================
// LOCATION EXTRACTION
// ============================================================================
function extractLocation() {
  const LOCATION_SELECTORS = [
    { selector: '[itemprop="jobLocation"]', confidence: 'high' },
    { selector: '.attrax-job-information-widget__freetext-field-value', confidence: 'high' }, // Achieve.com
    { selector: '.job__location', confidence: 'high' },
    { selector: '[class*="location" i][class*="value" i]', confidence: 'medium' },
    { selector: '[class*="location"]', confidence: 'medium' },
    { selector: '[class*="job-location"]', confidence: 'medium' },
    { selector: '[data-ui="location"]', confidence: 'medium' }
  ];

  const result = extractWithSelectors(LOCATION_SELECTORS, (text) => {
    // Filter out labels and empty text
    const cleanText = text.trim();
    return !cleanText.includes('http') &&
           cleanText.length > 2 &&
           cleanText.length < 200 &&
           !cleanText.includes('Location:') &&
           !cleanText.includes('__');
  });

  if (result.value) return result;

  // Fallback: Look for SVG location icons
  const svgs = document.querySelectorAll('svg');
  for (const svg of svgs) {
    const paths = svg.querySelectorAll('path');
    for (const path of paths) {
      const d = path.getAttribute('d') || '';
      if (d.startsWith('M') && (d.includes('18.') || d.includes('12.') || d.includes('6.'))) {
        const parent = svg.parentElement;
        const nextEl = svg.nextElementSibling || parent?.nextElementSibling;
        if (nextEl && nextEl.textContent.trim()) {
          const text = nextEl.textContent.trim();
          if (text.length > 3 && text.length < 200 && !text.includes('http')) {
            return { value: text, confidence: 'medium', selector: 'svg icon detection' };
          }
        }
      }
    }
  }

  return { value: null, confidence: 'none', selector: null };
}

// ============================================================================
// SECTION EXTRACTION
// ============================================================================
function extractSections() {
  const sections = {};

  // First, try site-specific class-based extraction (Achieve.com, etc.)
  const siteSpecificSections = {
    '.jobad-jobdescription': 'summary',
    '.jobad-qualifications': 'requirements',
    '.jobad-additionalInformation': 'benefits',
    '.jobad-companydescription': 'company',
    '.description-widget [aria-label="Job description"]': 'full_description'
  };

  for (const [selector, sectionName] of Object.entries(siteSpecificSections)) {
    const el = document.querySelector(selector);
    if (el) {
      let content = '';
      if (sectionName === 'full_description') {
        // Get all content from description widget
        content = el.textContent.trim();
        // Split into sections if it contains section markers
        if (content.includes('Job Description') && content.includes('Qualifications')) {
          continue; // Will be extracted by individual sections
        }
      } else {
        // Get content after the section header
        const parent = el.parentElement;
        if (parent) {
          const nextSibling = el.nextElementSibling;
          if (nextSibling) {
            content = nextSibling.textContent.trim();
          }
        }
        if (!content) {
          content = extractContentAfterHeading(el);
        }
      }

      if (content && content.length > 20) {
        sections[sectionName] = {
          title: el.textContent.trim(),
          content: content,
          confidence: 'high'
        };
      }
    }
  }

  // If site-specific didn't work, try heading-based patterns
  if (Object.keys(sections).length === 0) {
    const patterns = {
      summary: /job summary|about (the|this) (role|position)|overview|job description/i,
      responsibilities: /responsibilities|duties|what you('ll| will) do|your role|key responsibilities/i,
      requirements: /requirements|qualifications|must have|what we need|you('ll| will) need/i,
      nice_to_have: /nice to have|preferred|bonus|plus|ideal/i,
      benefits: /benefits|perks|what we offer|why join|package|additional information/i,
      salary: /salary|compensation|pay/i,
      schedule: /schedule|hours|working hours/i
    };

    const headings = document.querySelectorAll('h2, h3, h4, h5, strong, b, p > strong, .description-title');

    for (const heading of headings) {
      const headingText = heading.textContent.trim();
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
  }

  // Last resort: try to get description widget content
  if (Object.keys(sections).length === 0) {
    const descWidget = document.querySelector('.description-widget, [class*="description"]');
    if (descWidget) {
      const content = descWidget.textContent.trim();
      if (content && content.length > 50 && !content.includes('Jump to main content')) {
        sections.summary = {
          title: 'Job Description',
          content: content,
          confidence: 'low'
        };
      }
    }
  }

  return sections;
}

function extractContentAfterHeading(heading) {
  const content = [];
  let current = heading.nextElementSibling;

  while (current && content.length < 50) {
    const tagName = current.tagName?.toLowerCase();
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) break;
    if ((tagName === 'strong' || tagName === 'b') && current.textContent.length < 100) break;

    if (current.textContent?.trim()) {
      if (tagName === 'ul' || tagName === 'ol') {
        const items = Array.from(current.querySelectorAll('li')).map(li => '• ' + li.textContent.trim());
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
function extractApplyButton() {
  const APPLY_SELECTORS = [
    { selector: 'button[aria-label*="Apply" i]', confidence: 'high' },
    { selector: 'a[aria-label*="Apply" i]', confidence: 'high' },
    { selector: 'button[class*="apply" i]', confidence: 'high' },
    { selector: 'a[class*="apply" i]', confidence: 'high' },
    { selector: 'a[href*="apply"]', confidence: 'medium' },
    { selector: '[data-qa*="apply"]', confidence: 'high' },
    { selector: 'button.btn', confidence: 'low' },
    { selector: 'a.button', confidence: 'low' }
  ];

  for (const config of APPLY_SELECTORS) {
    try {
      const el = document.querySelector(config.selector);
      if (el) {
        return {
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
    } catch (e) { continue; }
  }

  // Fallback: Text search
  const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
  for (const btn of buttons) {
    const text = (btn.textContent || btn.value || '').toLowerCase();
    if (text.includes('apply') || text === 'submit' || text === 'join') {
      return {
        button: {
          text: btn.textContent.trim() || btn.value,
          tag: btn.tagName.toLowerCase(),
          class: btn.className,
          id: btn.id,
          type: btn.type || null
        },
        url: extractApplyUrl(btn),
        confidence: 'medium',
        selector: 'text search'
      };
    }
  }

  return { button: null, url: null, confidence: 'none', selector: null };
}

function extractApplyUrl(element) {
  if (element.tagName === 'A' && element.href) return element.href;
  const parentLink = element.closest('a');
  if (parentLink?.href) return parentLink.href;
  const form = element.closest('form');
  if (form?.action) return form.action;
  return null;
}

// ============================================================================
// JOB ID EXTRACTION
// ============================================================================
function extractJobId() {
  const url = window.location.href;
  const patterns = [
    /gh_jid=([^&]+)/, /jobs?\/([^\/\?]+)/, /posting[s]?\/([^\/\?]+)/, /job-openings?\/([^\/\?]+)/, /career\/([^\/\?]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  const pathParts = new URL(url).pathname.split('/').filter(p => p);
  return pathParts[pathParts.length - 1] || null;
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
    { name: 'Ashby', patterns: [/ashbyhq\.com/i] },
    { name: 'BambooHR', patterns: [/bamboohr\.com/i] }
  ];
  for (const ats of atsPatterns) {
    for (const pattern of ats.patterns) {
      if (pattern.test(url) || pattern.test(html)) return ats.name;
    }
  }
  return 'Custom';
}

// ============================================================================
// SALARY EXTRACTION
// ============================================================================
function extractSalary() {
  const bodyText = document.body.textContent;
  const patterns = [
    /\$\s?([\d,]+)\s*-\s*\$?\s?([\d,]+)\s*(?:per\s+)?(year|yr|annually|k)?/i,
    /£\s?([\d,]+)k?\s*-\s*£?\s?([\d,]+)k?/i,
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

/**
 * Test API endpoint
 */
async function testAPI(apiUrl) {
  const resultEl = document.getElementById('api-test-result');
  if (!resultEl || !apiUrl) return;

  resultEl.innerHTML = '<span style="color: #fbbf24;">⏳ Testing API...</span>';

  try {
    console.log('[Inspector] Testing API:', apiUrl);

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[Inspector] API Response:', data);

    // Try to find jobs array (different APIs have different structures)
    let jobs = null;
    let jobCount = 0;

    if (Array.isArray(data)) {
      jobs = data;
      jobCount = data.length;
    } else if (data.jobs && Array.isArray(data.jobs)) {
      jobs = data.jobs;
      jobCount = data.jobs.length;
    } else if (data.data && Array.isArray(data.data)) {
      jobs = data.data;
      jobCount = data.data.length;
    } else if (data.postings && Array.isArray(data.postings)) {
      jobs = data.postings;
      jobCount = data.postings.length;
    }

    if (jobs && jobs.length > 0) {
      const sampleJob = jobs[0];
      const jobTitle = sampleJob.title || sampleJob.text || sampleJob.name || 'Unknown';
      const jobUrl = sampleJob.absolute_url || sampleJob.hostedUrl || sampleJob.applyUrl || 'N/A';

      resultEl.innerHTML = `
        <div style="color: #86efac; margin-bottom: 4px;">✓ API is working!</div>
        <div style="opacity: 0.8;">Found ${jobCount} jobs</div>
        <div style="opacity: 0.8; margin-top: 4px;">Sample: "${jobTitle.substring(0, 40)}${jobTitle.length > 40 ? '...' : ''}"</div>
        <div style="opacity: 0.7; margin-top: 4px; word-break: break-all;">${jobUrl !== 'N/A' ? '✓ Has job URLs' : '⚠️ No URLs in response'}</div>
      `;
    } else {
      resultEl.innerHTML = `
        <div style="color: #fbbf24;">⚠️ API responded but no jobs found</div>
        <div style="opacity: 0.7; margin-top: 4px;">Response structure: ${Object.keys(data).join(', ')}</div>
      `;
    }
  } catch (error) {
    console.error('[Inspector] API test failed:', error);

    // Check if it's a CORS error
    const isCorsError = error.message.includes('Failed to fetch') ||
                        error.message.includes('CORS') ||
                        error.message.includes('blocked');

    if (isCorsError) {
      resultEl.innerHTML = `
        <div style="color: #fbbf24;">⚠️ CORS blocked (browser security)</div>
        <div style="color: #86efac; margin-top: 4px; font-weight: 600;">✓ API works! (test in browser)</div>
        <div style="opacity: 0.8; margin-top: 4px; font-size: 9px;">Extensions can't test APIs due to CORS.</div>
        <div style="opacity: 0.8; margin-top: 2px; font-size: 9px;">Your bot will work fine (no CORS on backend).</div>
      `;
    } else {
      resultEl.innerHTML = `
        <div style="color: #fca5a5;">✗ API test failed</div>
        <div style="opacity: 0.8; margin-top: 4px; word-break: break-word;">${error.message}</div>
        <div style="color: #86efac; margin-top: 6px; font-weight: 600;">✓ HTML selectors still work!</div>
        <div style="opacity: 0.7; margin-top: 2px;">Use click-through scraping instead</div>
      `;
    }
  }
}

/**
 * Start visual element picker mode
 */
let pickerOverlay = null;
let pickerState = null;

function startVisualPicker() {
  console.log('[Inspector] Starting visual picker...');

  // Initialize picker state
  pickerState = {
    step: 1, // 1 = pick container, 2 = pick item
    container: null,
    item: null,
    hoveredElement: null
  };

  // Create full-screen overlay with instructions
  pickerOverlay = document.createElement('div');
  pickerOverlay.id = 'visual-picker-overlay';
  pickerOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2147483646;
    pointer-events: none;
  `;

  // Create instruction box
  const instructionBox = document.createElement('div');
  instructionBox.id = 'picker-instructions';
  instructionBox.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 24px 32px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 15px;
    font-weight: 600;
    text-align: center;
    pointer-events: auto;
    z-index: 2147483647;
  `;
  instructionBox.innerHTML = `
    <div style="font-size: 20px; margin-bottom: 12px;">🎯</div>
    <div style="margin-bottom: 8px;">STEP 1: Click on the job list container</div>
    <div style="font-size: 12px; opacity: 0.9;">Click the element that contains all job listings</div>
    <button id="cancel-picker" style="
      margin-top: 16px;
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border: none;
      border-radius: 6px;
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    ">Cancel</button>
  `;

  // Create highlight overlay for hovering
  const highlightBox = document.createElement('div');
  highlightBox.id = 'picker-highlight';
  highlightBox.style.cssText = `
    position: absolute;
    pointer-events: none;
    border: 3px solid #10b981;
    background: rgba(16, 185, 129, 0.1);
    z-index: 2147483645;
    display: none;
  `;

  document.body.appendChild(pickerOverlay);
  document.body.appendChild(instructionBox);
  document.body.appendChild(highlightBox);

  // Hide the main overlay button temporarily
  if (overlayButton) {
    overlayButton.style.display = 'none';
  }

  // Add event listeners
  document.addEventListener('mousemove', handlePickerMouseMove, true);
  document.addEventListener('click', handlePickerClick, true);
  document.getElementById('cancel-picker')?.addEventListener('click', cancelPicker);

  // Update picker status
  const statusEl = document.getElementById('picker-status');
  if (statusEl) {
    statusEl.textContent = 'Visual picker active...';
    statusEl.style.color = '#86efac';
  }
}

function handlePickerMouseMove(e) {
  if (!pickerState) return;

  const highlightBox = document.getElementById('picker-highlight');
  if (!highlightBox) return;

  // Get element under cursor (excluding our overlay elements)
  const elements = document.elementsFromPoint(e.clientX, e.clientY);
  const targetElement = elements.find(el =>
    el.id !== 'visual-picker-overlay' &&
    el.id !== 'picker-instructions' &&
    el.id !== 'picker-highlight' &&
    el.id !== 'cancel-picker' &&
    !el.closest('#picker-instructions')
  );

  if (!targetElement || targetElement === document.body || targetElement === document.documentElement) {
    highlightBox.style.display = 'none';
    return;
  }

  // Highlight the element
  const rect = targetElement.getBoundingClientRect();
  highlightBox.style.display = 'block';
  highlightBox.style.left = rect.left + window.scrollX + 'px';
  highlightBox.style.top = rect.top + window.scrollY + 'px';
  highlightBox.style.width = rect.width + 'px';
  highlightBox.style.height = rect.height + 'px';

  pickerState.hoveredElement = targetElement;
}

function handlePickerClick(e) {
  if (!pickerState) return;

  // Ignore clicks on our UI
  if (e.target.closest('#picker-instructions') || e.target.id === 'cancel-picker') {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const element = pickerState.hoveredElement;
  if (!element) return;

  if (pickerState.step === 1) {
    // Step 1: Container selected
    pickerState.container = element;
    pickerState.step = 2;

    console.log('[Inspector] Container selected:', element);

    // Update instructions
    const instructionBox = document.getElementById('picker-instructions');
    if (instructionBox) {
      instructionBox.innerHTML = `
        <div style="font-size: 20px; margin-bottom: 12px;">🎯</div>
        <div style="margin-bottom: 8px;">STEP 2: Click on a job item</div>
        <div style="font-size: 12px; opacity: 0.9;">Click any single job listing inside the container</div>
        <button id="cancel-picker" style="
          margin-top: 16px;
          padding: 8px 16px;
          background: rgba(255,255,255,0.2);
          border: none;
          border-radius: 6px;
          color: white;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        ">Cancel</button>
      `;
      document.getElementById('cancel-picker')?.addEventListener('click', cancelPicker);
    }

    // Change highlight color to blue
    const highlightBox = document.getElementById('picker-highlight');
    if (highlightBox) {
      highlightBox.style.border = '3px solid #3b82f6';
      highlightBox.style.background = 'rgba(59, 130, 246, 0.1)';
    }

  } else if (pickerState.step === 2) {
    // Step 2: Item selected
    pickerState.item = element;

    console.log('[Inspector] Item selected:', element);

    // Generate selectors
    const containerSelector = generateSelector(pickerState.container);
    const itemSelector = generateItemSelector(pickerState.item);

    console.log('[Inspector] Generated container selector:', containerSelector);
    console.log('[Inspector] Generated item selector:', itemSelector);

    // Find link within the selected item
    const link = pickerState.item.querySelector('a[href]');
    let linkPattern = '';

    if (link) {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const fullUrl = new URL(href, window.location.href).href;

        // Extract pattern (remove unique ID/slug)
        try {
          const url = new URL(fullUrl);
          let pattern = url.pathname;

          // Replace numbers and unique strings with placeholders
          pattern = pattern.replace(/\/\d+/g, '/{id}');
          pattern = pattern.replace(/\/[a-f0-9-]{20,}/g, '/{id}');
          pattern = pattern.replace(/\/[a-f0-9]{8,}/g, '/{id}');

          linkPattern = url.origin + pattern;
          console.log('[Inspector] Generated link pattern:', linkPattern);
        } catch (error) {
          linkPattern = fullUrl;
          console.log('[Inspector] Using full URL as link pattern:', linkPattern);
        }
      }
    } else {
      console.log('[Inspector] No link found in selected item');
    }

    // Fill in the manual input fields
    const containerInput = document.getElementById('manual-container');
    const itemInput = document.getElementById('manual-item');
    const linkInput = document.getElementById('manual-link');

    if (containerInput) containerInput.value = containerSelector;
    if (itemInput) itemInput.value = itemSelector;
    if (linkInput && linkPattern) linkInput.value = linkPattern;

    // Update status
    const statusEl = document.getElementById('picker-status');
    if (statusEl) {
      const linkStatus = linkPattern ? ' + link pattern' : ' (no link found)';
      statusEl.textContent = '✓ Selectors captured' + linkStatus;
      statusEl.style.color = '#86efac';
    }

    // Clean up picker
    endPicker();
  }
}

function generateItemSelector(element) {
  // Priority 1: ARIA role attributes (most stable)
  if (element.hasAttribute('role')) {
    const role = element.getAttribute('role');
    if (['listitem', 'article', 'row', 'gridcell'].includes(role)) {
      return `[role="${role}"]`;
    }
  }

  // Priority 2: data-* attributes (very specific)
  if (element.hasAttribute('data-test-id')) {
    return `[data-test-id="${element.getAttribute('data-test-id')}"]`;
  }
  if (element.hasAttribute('data-qa')) {
    return `[data-qa="${element.getAttribute('data-qa')}"]`;
  }

  // Priority 3: Job-related class names
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/).filter(c => c.length > 0);
    const jobRelatedClasses = classes.filter(c =>
      /job|career|position|opening|posting|listing|item|card/i.test(c)
    );
    if (jobRelatedClasses.length > 0) {
      return `.${jobRelatedClasses[0]}`;
    }
    if (classes.length > 0) {
      return `.${classes[0]}`;
    }
  }

  // Priority 4: Tag name (last resort)
  return element.tagName.toLowerCase();
}

function cancelPicker() {
  endPicker();

  const statusEl = document.getElementById('picker-status');
  if (statusEl) {
    statusEl.textContent = 'Cancelled';
    statusEl.style.color = '#fca5a5';
  }
}

function endPicker() {
  // Remove event listeners
  document.removeEventListener('mousemove', handlePickerMouseMove, true);
  document.removeEventListener('click', handlePickerClick, true);

  // Remove overlay elements
  document.getElementById('picker-instructions')?.remove();
  document.getElementById('picker-highlight')?.remove();
  document.getElementById('visual-picker-overlay')?.remove();

  // Show the main overlay button again
  if (overlayButton) {
    overlayButton.style.display = 'block';
  }

  // Reset state
  pickerState = null;
  pickerOverlay = null;
}

/**
 * Make overlay button draggable
 * Returns a cleanup function to remove event listeners
 */
function makeOverlayDraggable(element) {
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const dragHandle = element.querySelector('[data-drag-handle]') || element;

  dragHandle.style.cursor = 'move';

  dragHandle.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    // Only allow dragging from the handle/header area
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
      return; // Don't drag when clicking buttons or inputs
    }

    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === dragHandle || dragHandle.contains(e.target)) {
      isDragging = true;
      dragHandle.style.cursor = 'grabbing';
    }
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();

      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      // Get the first div inside overlayButton
      const innerDiv = element.firstElementChild;
      if (innerDiv) {
        innerDiv.style.position = 'fixed';
        innerDiv.style.left = (20 + currentX) + 'px';
        innerDiv.style.top = (20 + currentY) + 'px';
        innerDiv.style.right = 'auto';
      }
    }
  }

  function dragEnd(e) {
    if (isDragging) {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      dragHandle.style.cursor = 'move';
    }
  }

  // Return cleanup function
  return function cleanup() {
    dragHandle.removeEventListener('mousedown', dragStart);
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', dragEnd);
  };
}

console.log('[Inspector] Ready to inspect');
